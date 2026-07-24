// Cloud Functions — notificaciones push de Evalúa Fácil.
//
// Todas respetan si el usuario habilitó esa categoría en
// `notificationSettings/{uid}` (pantalla de notificaciones del alumno o del
// docente); onSubmissionEntregada y onEstudianteActivado además tienen un
// SEGUNDO gate más fino (por actividad/asignatura, ver sus comentarios):
//   1. onActividadEscrita   — actividad nueva visible para el alumno.
//   2. onSubmissionActualizada — se publicó una calificación.
//   3. onSubmissionEntregada — un estudiante entregó una actividad marcada
//      por el docente con "Notificarme" (activity.notificarDocente).
//   4. onEstudianteActivado — un estudiante se activó en una asignatura
//      marcada por el docente con "Notificarme" (subject.notificarActivacion,
//      ver la pestaña Estudiantes en SubjectPage.jsx).
//   5. revisarProgramados   — programada cada 30 min: actividades cuyo
//      publishAt ya pasó (visibilidad puramente por tiempo, sin escritura de
//      doc) + recordatorios de entrega, con la anticipación que cada
//      estudiante haya elegido (recordatorios.anticipacionMinutos).
//
// Todo push que de verdad se manda (sin importar la categoría) queda
// registrado en `notificationLog` — ver enviarPushDirecto() — que alimenta
// la pantalla "Registro de notificaciones" del docente.
//
// Sonido, volumen y repetición los controla el propio teléfono del
// estudiante (como con cualquier otra app) — la app NO los configura, así
// que cada push va como "notification" payload normal: el sistema operativo
// la muestra solo con la app en segundo plano o cerrada. Con la app en
// primer plano, Android no la muestra automáticamente, así que el cliente
// (ver src/utils/pushNotifications.js) la refleja con una notificación local
// simple usando el mismo título/cuerpo.

const { initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { getMessaging } = require('firebase-admin/messaging')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')

initializeApp()
const db = getFirestore()
const messaging = getMessaging()

const TITULOS = {
  actividadesNuevas: { title: 'Nueva actividad', body: 'Tu maestro publicó una actividad nueva.' },
  calificaciones: { title: 'Te calificaron', body: 'Ya tienes una calificación nueva.' },
  recordatorios: { title: 'Recordatorio de entrega', body: 'Se acerca la fecha límite de una actividad.' },
  // Docente — ver onSubmissionEntregada() más abajo.
  nuevasEntregas: { title: 'Nueva entrega', body: 'Un estudiante entregó una actividad.' },
}

// ─── Visibilidad de actividad — replica isActivityPublished() de
// src/utils/activityVisibility.js (single source of truth en el cliente). ───
function actividadVisible(a, parcialOculto) {
  if (parcialOculto) return false
  if (!a?.oculta) return true
  if (a.publishAt) return new Date(a.publishAt).getTime() <= Date.now()
  return false
}

async function parcialesOcultosDe(asignaturaId) {
  const snap = await db.collection('subjects').doc(asignaturaId).get()
  return snap.data()?.parcialesOcultos || []
}

// ─── Envío ───────────────────────────────────────────────────────────────
// Nivel bajo: manda el push (si hay tokens) y deja un registro en
// `notificationLog` — origen único de datos para la pantalla "Registro de
// notificaciones" (src/pages/teacher/NotificationLog.jsx), sin importar por
// cuál categoría haya llegado. Sin gate de categoría: quien llama decide si
// debe enviarse (ver enviarPush() para el caso normal gateado por
// notificationSettings, y onEstudianteActivado() para el caso gateado por un
// campo de la propia asignatura en vez de un ajuste global).
// Códigos de FCM que significan "este token ya no sirve" (se reinstaló la
// app, se le borraron datos, o el usuario desinstaló) — se limpian solos de
// notificationSettings para no volver a intentarlos ni ensuciar el registro.
const TOKEN_INVALIDO = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
])

// `logExtra` (objeto, no null) marca las categorías propias de la Bitácora
// del docente (nuevasEntregas, activacionEstudiante — ver más abajo): esas se
// registran en notificationLog SIEMPRE que la categoría esté habilitada,
// aunque el docente no tenga token (solo usa la web — los tokens FCM solo se
// registran en la app nativa, ver src/utils/pushNotifications.js) o el envío
// del push falle. La Bitácora es un registro de lo que pasó, no de si el
// push llegó — antes, sin token, la entrega/activación ocurría de verdad
// pero no quedaba ningún rastro. Las categorías del alumno (llamadas sin
// logExtra, vía enviarPush) se quedan con el comportamiento de antes (solo
// si el push de verdad se mandó): no hay pantalla que las muestre, así que
// registrarlas sin push no serviría más que para inflar la base de datos.
async function enviarPushDirecto(uid, notification, data = {}, descripcion = null, logExtra = null) {
  if (!uid) return
  const settingsSnap = await db.collection('notificationSettings').doc(uid).get()
  const tokens = settingsSnap.exists ? (settingsSnap.data().fcmTokens || []) : []
  let enviado = false
  if (tokens.length) {
    try {
      const res = await messaging.sendEachForMulticast({ tokens, notification, data })
      res.responses.forEach((r, i) => {
        if (!r.success) logger.error(`enviarPushDirecto(${uid}) token ${i} falló: ${r.error?.code} — ${r.error?.message}`)
      })
      const tokensInvalidos = res.responses
        .map((r, i) => (!r.success && TOKEN_INVALIDO.has(r.error?.code) ? tokens[i] : null))
        .filter(Boolean)
      if (tokensInvalidos.length) {
        await settingsSnap.ref.update({ fcmTokens: FieldValue.arrayRemove(...tokensInvalidos) })
      }
      enviado = res.successCount > 0
    } catch (err) {
      logger.error(`enviarPushDirecto(${uid}) falló:`, err.message)
    }
  }
  if (logExtra || enviado) {
    await db.collection('notificationLog').add({
      uid,
      titulo: notification.title,
      descripcion: descripcion || notification.body,
      ...(logExtra || {}),
      createdAt: FieldValue.serverTimestamp(),
    })
  }
}

// Lee la preferencia del usuario para esa categoría (notificationSettings);
// si está deshabilitada, no hace nada. Los valores de `data` deben ser
// strings (requisito de FCM).
async function enviarPush(uid, categoria, dataExtra = {}) {
  if (!uid) return
  const settingsSnap = await db.collection('notificationSettings').doc(uid).get()
  if (!settingsSnap.exists) return
  const cfg = settingsSnap.data()[categoria]
  if (!cfg?.habilitado) return

  const notification = TITULOS[categoria]
  const data = {
    categoria,
    ...Object.fromEntries(Object.entries(dataExtra).map(([k, v]) => [k, String(v)])),
  }
  await enviarPushDirecto(uid, notification, data)
}

async function estudiantesDeAsignatura(asignaturaId) {
  const snap = await db.collection('students').where('asignaturaId', '==', asignaturaId).get()
  return snap.docs
}

// ─── 1) Actividad nueva visible ────────────────────────────────────────────
// onWrite (create + update) para cubrir tanto "se crea ya visible" como
// "estaba oculta y se publicó" en la misma función. Idempotente vía
// `notificadoNuevaActividad` — nunca se notifica dos veces la misma actividad.
exports.onActividadEscrita = onDocumentWritten('activities/{activityId}', async (event) => {
  const after = event.data?.after
  if (!after?.exists) return // borrada
  const a = after.data()
  if (a.notificadoNuevaActividad) return

  const parcialesOcultos = await parcialesOcultosDe(a.asignaturaId)
  if (!actividadVisible(a, parcialesOcultos.includes(a.parcial))) return

  const estudiantes = await estudiantesDeAsignatura(a.asignaturaId)
  await Promise.all(estudiantes.map((d) =>
    enviarPush(d.data().uid, 'actividadesNuevas', { actividadId: event.params.activityId })
  ))
  await after.ref.update({ notificadoNuevaActividad: true })
})

// ─── 2) Calificación publicada ──────────────────────────────────────────────
// onWrite (no solo onUpdate): en actividades de observación el doc de
// submission se CREA ya con calificacion puesta (el docente califica
// directo, sin entrega previa del alumno — ver ActivityPage.jsx isObservacion)
// así que un trigger de solo-update nunca vería esa primera calificación.
// Se notifica la PRIMERA vez que calificacion pasa a tener un valor (ya sea
// al crearse el doc así, o en una actualización null->valor) — ediciones
// posteriores de una calificación ya notificada no vuelven a avisar (evita
// spam si el docente ajusta la nota después).
exports.onSubmissionActualizada = onDocumentWritten('submissions/{submissionId}', async (event) => {
  const after = event.data?.after
  if (!after?.exists) return // borrada
  const before = event.data.before?.data() // undefined si es creación
  const afterData = after.data()
  if (before?.calificacion != null || afterData.calificacion == null) return
  if (afterData.notificadoCalificacion) return

  const studentSnap = await db.collection('students').doc(afterData.alumnoId).get()
  await enviarPush(studentSnap.data()?.uid, 'calificaciones', { actividadId: afterData.actividadId })
  await after.ref.update({ notificadoCalificacion: true })
})

// ─── 3) Entrega notificada al docente ───────────────────────────────────────
// Solo para actividades marcadas por el docente con "Notificarme" al editarlas
// (activity.notificarDocente — ver EntregableEditor.jsx / EvaluacionEditor.jsx).
// docenteId YA es el Auth uid del docente (a diferencia de alumnoId, que es el
// id del documento en `students` — distinto de su uid).
// "Entregada" significa cosas distintas según el tipo de actividad:
//   - Entregable/observación: el doc de submission se crea de una sola vez al
//     entregar — se reclama en su única escritura.
//   - Evaluación: el doc se crea al INICIAR el intento (tiempoInicio) y se
//     actualiza al terminar → se reclama cuando estadoEvaluacion está
//     'finalizado' (igual criterio que usa el cliente en EvaluacionManager.jsx).
// Idempotente vía notificadoEntregaDocente — una sola vez por submission,
// reclamado ATÓMICAMENTE en una transacción (ver más abajo), no comparando
// contra el snapshot `before` del evento. Doble gate (igual que Estudiante
// activado): act.notificarDocente (por actividad) Y
// notificationSettings.nuevasEntregas.habilitado (global). Título y cuerpo
// son dinámicos (nombre del estudiante, asignatura y actividad) — por eso
// usa enviarPushDirecto en vez de enviarPush, que solo arma texto fijo desde
// TITULOS.
exports.onSubmissionEntregada = onDocumentWritten('submissions/{submissionId}', async (event) => {
  const after = event.data?.after
  if (!after?.exists) return // borrada
  const afterData = after.data()
  if (afterData.notificadoEntregaDocente) return

  const actSnap = await db.collection('activities').doc(afterData.actividadId).get()
  if (!actSnap.exists) return
  const act = actSnap.data()
  if (!act.notificarDocente) return

  const esEvaluacion = act.tipo === 'evaluacion'
  if (esEvaluacion ? afterData.estadoEvaluacion !== 'finalizado' : false) return

  const settingsSnap = await db.collection('notificationSettings').doc(act.docenteId).get()
  if (settingsSnap.exists && settingsSnap.data().nuevasEntregas?.habilitado === false) return

  // Reclama el aviso releyendo el documento EN VIVO dentro de una
  // transacción — no depende del snapshot `before` del evento, que bajo
  // ráfagas de escrituras muy rápidas (confirmado con un caso real: 34
  // reintentos seguidos de un mismo cuestionario) puede coalescerse o
  // llegar desordenado, haciendo que "antes no estaba finalizado" salga
  // falso y la entrega nunca se notifique. Así, sin importar cuántos
  // eventos intermedios se hayan perdido, la primera invocación que vea el
  // documento finalizado y sin reclamar gana, y las demás se retiran solas.
  const claimed = await db.runTransaction(async (tx) => {
    const freshSnap = await tx.get(after.ref)
    if (!freshSnap.exists) return false
    const fresh = freshSnap.data()
    if (fresh.notificadoEntregaDocente) return false
    if (esEvaluacion && fresh.estadoEvaluacion !== 'finalizado') return false
    tx.update(after.ref, { notificadoEntregaDocente: true })
    return true
  })
  if (!claimed) return

  const [studentSnap, subjSnap, numeroActividad] = await Promise.all([
    db.collection('students').doc(afterData.alumnoId).get(),
    db.collection('subjects').doc(act.asignaturaId).get(),
    actividadLabelDe(act, afterData.actividadId),
  ])
  const subj = subjSnap.data()
  const nombreEstudiante = nombreEstudianteDe(studentSnap.data())
  const nombreAsignatura = nombreAsignaturaDe(subj)
  const verbo = !esEvaluacion ? 'entregó'
    : act.categoria === 'examen' ? 'presentó el examen'
    : act.categoria === 'cuestionario' ? 'presentó el cuestionario'
    : 'terminó la evaluación'
  // Distingue ENTREGA / CUESTIONARIO / EXAMEN en la Bitácora (pedido
  // explícito) — mismo criterio que `verbo` arriba, pero como valor plano
  // para que el cliente (describeEntry en NotificationSettings.jsx) arme el
  // rótulo sin repetir esta lógica.
  const tipoEntrega = !esEvaluacion ? 'entrega'
    : act.categoria === 'examen' ? 'examen'
    : act.categoria === 'cuestionario' ? 'cuestionario'
    : 'evaluacion'

  await enviarPushDirecto(
    act.docenteId,
    { title: 'Nueva entrega', body: `${nombreEstudiante} ${verbo} "${act.nombre}" — ${nombreAsignatura}` },
    { categoria: 'nuevasEntregas', actividadId: afterData.actividadId, submissionId: event.params.submissionId },
    null,
    {
      categoria: 'nuevasEntregas', estudiante: nombreEstudiante, asignatura: subj?.nombre || '', grupo: subj?.grupo || '',
      actividad: act.nombre || '', numeroActividad, tipoEntrega,
      // Para que la Bitácora pueda llevar directo a esa entrega (pedido
      // explícito: el nombre del estudiante en Detalles es un enlace).
      actividadId: afterData.actividadId, alumnoId: afterData.alumnoId,
    },
  )
})

// ─── 4) Estudiante activado ─────────────────────────────────────────────────
// Doble gate: notificationSettings.activacionEstudiante.habilitado
// (interruptor global en NotificationSettings.jsx) Y subj.notificarActivacion
// (por asignatura, checkbox en la pestaña Estudiantes de SubjectPage.jsx —
// activado por defecto, se salta solo si el docente lo apagó ahí). Se usa
// enviarPushDirecto en vez de enviarPush porque el título/cuerpo son
// dinámicos (nombre del estudiante y de la asignatura) — enviarPush solo
// arma texto fijo desde TITULOS.
//
// Dispara tanto en la primera activación como en una reactivación tras un
// reinicio de contraseña (Activation.jsx pone activado:true en ambos casos;
// antes de eso el campo es undefined o false, nunca true) — el docente
// probablemente quiere saber de las dos.
//
// Réplica de studentFullName()/subjectDisplayName() (src/utils/studentSearch.js
// y src/utils/subjectName.js) — mismas reglas, duplicadas a propósito: el
// backend de Functions es CommonJS y no puede importar los módulos ES del
// cliente.
function nombreEstudianteDe(s) {
  return `${s?.apellidoPaterno || ''} ${s?.apellidoMaterno || ''} ${s?.nombre || ''}`.replace(/\s+/g, ' ').trim() || 'Un estudiante'
}
function nombreAsignaturaDe(subj) {
  const nombre = subj?.nombre || ''
  const grupo = subj?.grupo || ''
  return grupo ? `${nombre} — ${grupo}` : nombre
}

// "1.2" — el número que el docente reconoce como "el de la actividad" (NO
// el número de intento del estudiante, que es intrascendente — pedido
// explícito de corregirlo). Mismo cálculo que activityLabelById en
// SubjectPage.jsx: la posición de esta actividad entre sus hermanas del
// MISMO parcial, contando solo las publicadas — nunca un campo guardado,
// para que el número no se desalinee si algo se borra o reordena. Así el
// número en la Bitácora es siempre el mismo que el docente ve en su lista
// de actividades.
async function actividadLabelDe(act, actividadId) {
  const snap = await db.collection('activities')
    .where('asignaturaId', '==', act.asignaturaId)
    .where('parcial', '==', act.parcial)
    .get()
  const esBorrador = (a) => a.oculta && !a.publishedAt && !a.publishAt
  const hermanas = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => !esBorrador(a))
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  const idx = hermanas.findIndex((a) => a.id === actividadId)
  return idx >= 0 ? `${act.parcial}.${idx + 1}` : ''
}

exports.onEstudianteActivado = onDocumentWritten('students/{studentId}', async (event) => {
  const after = event.data?.after
  if (!after?.exists) return // borrado
  const before = event.data.before?.data()
  const afterData = after.data()
  if (afterData.activado !== true || before?.activado === true) return
  if (afterData.notificadoActivacion) return

  const subjSnap = await db.collection('subjects').doc(afterData.asignaturaId).get()
  if (!subjSnap.exists) return
  const subj = subjSnap.data()
  // Igual que notificarClase (localReminders.js): activado por defecto,
  // ausente/true = notifica, solo se salta si el docente lo apagó a
  // propósito. Antes era al revés (ausente = false, opt-in) y como ninguna
  // asignatura vieja tenía el campo, la notificación nunca se disparaba —
  // confirmado con datos reales: 5 asignaturas, ninguna con el campo en true.
  if (subj.notificarActivacion === false) return

  const settingsSnap = await db.collection('notificationSettings').doc(subj.docenteId).get()
  if (settingsSnap.exists && settingsSnap.data().activacionEstudiante?.habilitado === false) return

  const nombreEstudiante = nombreEstudianteDe(afterData)
  const nombreAsignatura = nombreAsignaturaDe(subj)
  await enviarPushDirecto(
    subj.docenteId,
    { title: 'Estudiante activado', body: `${nombreEstudiante} se activó en ${nombreAsignatura}` },
    { categoria: 'activacionEstudiante', asignaturaId: afterData.asignaturaId, alumnoId: event.params.studentId },
    null,
    { categoria: 'activacionEstudiante', estudiante: nombreEstudiante, asignatura: subj.nombre || '', grupo: subj.grupo || '' },
  )
  await after.ref.update({ notificadoActivacion: true })
})

// ─── 4.5) Calificación server-side de evaluaciones ─────────────────────────
// El cliente YA NO calcula ni escribe la calificación al finalizar un
// cuestionario/examen (las reglas se lo prohíben): solo marca
// estadoEvaluacion:'finalizado'. Esta función recalcula todo con la fuente
// de verdad del servidor (preguntas con respuestaCorrecta + respuestas del
// alumno) — así un cliente modificado no puede inventarse su nota.
//
// Réplica exacta de src/utils/evaluacionGrading.js (calcularPuntosPregunta,
// calcularCalificacion, resolverPendienteRevision, resolverCalificacionFinal)
// — duplicada a propósito: Functions es CommonJS y no importa los módulos ES
// del cliente (mismo criterio que nombreEstudianteDe / actividadVisible).
const TIPOS_OBJETIVOS = ['opcion_multiple', 'verdadero_falso']
const TIPOS_REVISION_MANUAL = ['respuesta_corta', 'subir_archivo']

function calcularPuntosPregunta(pregunta, respuesta) {
  if (!TIPOS_OBJETIVOS.includes(pregunta.tipo)) return null
  const correcta = respuesta?.opcionSeleccionada != null && respuesta.opcionSeleccionada === pregunta.respuestaCorrecta
  return correcta ? (pregunta.ponderacion || 0) : 0
}

function calcularCalificacion(preguntas, respuestasPorPregunta, maxCalif = 10) {
  const totalPonderacion = preguntas.reduce((sum, p) => sum + (p.ponderacion || 0), 0)
  if (totalPonderacion === 0) return 0
  const obtenida = preguntas.reduce((sum, p) => sum + (respuestasPorPregunta[p.id]?.puntosObtenidos ?? 0), 0)
  return Math.round((obtenida / totalPonderacion) * maxCalif * 10) / 10
}

function resolverPendienteRevision(preguntas, respuestasPorPregunta) {
  return preguntas.some((p) => TIPOS_REVISION_MANUAL.includes(p.tipo) && (respuestasPorPregunta[p.id]?.puntosObtenidos ?? null) == null)
}

function resolverCalificacionFinal(intentosPrevios, calificacionNueva, conservar) {
  if (intentosPrevios.length === 0) return calificacionNueva
  const previas = intentosPrevios.map((i) => i.calificacion)
  switch (conservar) {
    case 'primero':
      return previas[0]
    case 'promedio':
      return Math.round((([...previas, calificacionNueva].reduce((a, b) => a + b, 0)) / (previas.length + 1)) * 10) / 10
    case 'mejor':
      return Math.max(...previas, calificacionNueva)
    case 'ultimo':
    default:
      return calificacionNueva
  }
}

// Idempotente por INTENTO: el número de intento en curso (intentoActual) se
// registra en intentos[] al calificar — cualquier re-disparo (la propia
// escritura de esta función, ediciones del docente, notificaciones) ve el
// intento ya registrado y se retira. La transacción relee el doc EN VIVO
// (mismo patrón anti-ráfagas que onSubmissionEntregada).
exports.onEvaluacionFinalizada = onDocumentWritten('submissions/{submissionId}', async (event) => {
  const after = event.data?.after
  if (!after?.exists) return // borrada
  const sub = after.data()
  if (sub.estadoEvaluacion !== 'finalizado') return
  const intentoNum = sub.intentoActual || ((sub.intentos?.length || 0) + 1)
  if ((sub.intentos || []).some((i) => i.numero === intentoNum)) return // este intento ya se calificó

  const actSnap = await db.collection('activities').doc(sub.actividadId).get()
  if (!actSnap.exists || actSnap.data().tipo !== 'evaluacion') return
  const act = actSnap.data()

  const [pregSnap, respSnap] = await Promise.all([
    actSnap.ref.collection('preguntas').get(),
    after.ref.collection('respuestas').get(),
  ])
  const preguntas = pregSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const respuestasGuardadas = {}
  respSnap.docs.forEach((d) => { respuestasGuardadas[d.id] = d.data() })

  // Puntos por pregunta desde la fuente de verdad del servidor. Los tipos de
  // revisión manual quedan null (pendientes) — igual que hacía el cliente:
  // cada intento nuevo resetea la revisión manual del anterior.
  const respuestasPorPregunta = {}
  preguntas.forEach((p) => {
    respuestasPorPregunta[p.id] = { puntosObtenidos: calcularPuntosPregunta(p, respuestasGuardadas[p.id] || {}) }
  })
  await Promise.all(preguntas.map((p) =>
    after.ref.collection('respuestas').doc(p.id).set(
      { puntosObtenidos: respuestasPorPregunta[p.id].puntosObtenidos },
      { merge: true }
    )
  ))

  const calificacionIntento = calcularCalificacion(preguntas, respuestasPorPregunta, act.maxCalif || 10)
  const pendienteRevision = resolverPendienteRevision(preguntas, respuestasPorPregunta)

  await db.runTransaction(async (tx) => {
    const freshSnap = await tx.get(after.ref)
    if (!freshSnap.exists) return
    const fresh = freshSnap.data()
    if (fresh.estadoEvaluacion !== 'finalizado') return
    const num = fresh.intentoActual || ((fresh.intentos?.length || 0) + 1)
    const previos = fresh.intentos || []
    if (previos.some((i) => i.numero === num)) return
    tx.update(after.ref, {
      calificacion: resolverCalificacionFinal(previos, calificacionIntento, act.evaluacion?.conservar),
      pendienteRevision,
      estado: pendienteRevision ? 'entregado' : 'calificado',
      intentos: [...previos, { numero: num, calificacion: calificacionIntento }],
    })
  })
})

// ─── 4.6) Resumen de asistencia por alumno ──────────────────────────────────
// `attendance/{id}` es una "columna" (fecha+hora) COMPARTIDA por todo el
// grupo: presentes/justificadas/motivos de TODOS los estudiantes en un solo
// documento. Por eso las reglas solo dejan leerlo al docente — el motivo de
// una justificación (texto libre) puede ser información sensible (salud,
// familia) que un compañero no debe ver, y antes de la auditoría de
// seguridad cualquier alumno podía listar la asistencia de toda la
// plataforma con un cliente modificado.
//
// Esta función mantiene, por cada alumno afectado, un resumen PROPIO en
// `attendanceSummaries/{studentId}` (mismo id que su enrollment en
// `students` — así `ownsStudentDoc` en las reglas ya sirve tal cual). El
// alumno nunca lee el documento compartido: solo su resumen, recalculado
// aquí a partir de la fuente de verdad, igual que onEvaluacionFinalizada
// recalcula la calificación en vez de confiar en lo que mande el cliente.
function idsAfectados(before, after) {
  if (!before) return Object.keys(after?.presentes || {})
  if (!after) return Object.keys(before?.presentes || {}) // se borró la columna completa
  const ids = new Set([...Object.keys(before.presentes || {}), ...Object.keys(after.presentes || {})])
  const cambiaron = []
  for (const id of ids) {
    const antesPresente = before.presentes?.[id] !== false
    const despuesPresente = after.presentes?.[id] !== false
    const antesJustif = !!before.justificadas?.[id]
    const despuesJustif = !!after.justificadas?.[id]
    // El texto del motivo también cuenta como cambio — si solo se edita la
    // justificación (sin tocar presente/justificada), antes esto no
    // disparaba un recálculo y el resumen del alumno se quedaba con el
    // motivo viejo para siempre (bug real reportado).
    const antesMotivo = before.motivos?.[id] || ''
    const despuesMotivo = after.motivos?.[id] || ''
    if (antesPresente !== despuesPresente || antesJustif !== despuesJustif || antesMotivo !== despuesMotivo) cambiaron.push(id)
  }
  return cambiaron
}

// Recalcula TODO el resumen del alumno desde cero (todas las columnas de su
// asignatura) — más simple y siempre correcto que ir acumulando deltas, y el
// volumen de columnas por asignatura (decenas, no miles) hace que un
// recálculo completo sea barato.
async function recalcularResumenAsistencia(asignaturaId, studentId) {
  const snap = await db.collection('attendance').where('asignaturaId', '==', asignaturaId).get()
  const records = snap.docs.map((d) => d.data())
    // Columnas viejas de antes de que existiera el campo `parcial` (confirmado
    // en producción: 4 de 27 documentos reales) no tienen a qué parcial
    // agruparse — el propio docente ya las excluye de su tabla de Asistencias
    // (agrupa por parcial === p), así que aquí se ignoran igual por
    // consistencia. Sin este filtro, `parcial: undefined` tronaba el .set()
    // de Firestore entero y NINGÚN alumno de esa asignatura recibía su
    // resumen actualizado — el bug real reportado ("no se refleja").
    .filter((r) => r.parcial != null)
    .sort((a, b) => (a.fecha === b.fecha ? a.slot - b.slot : a.fecha.localeCompare(b.fecha)))

  const porParcial = {}
  // Mismo cálculo por-slot que countPresence() del docente (src/utils/
  // attendance.js) — así el % que ve el alumno siempre coincide con el que
  // ve su maestro. Un día con varias horas (duracion > 1) suma varios slots.
  let asistTotal = 0, inasistTotal = 0, justifTotal = 0
  // `registros` es SOLO para la lista visual del alumno — un chip por DÍA
  // (no por slot), para no mostrar la misma fecha repetida cuando el día
  // tuvo varias horas de clase. Si alguna hora de ese día fue falta, el día
  // se muestra como falta (el peor estado gana); "justificada" pesa más que
  // "presente" para que una falta justificada no se pierda entre horas
  // presentes del mismo día.
  const RANGO = { falta: 2, justificada: 1, presente: 0 }
  const porDia = {}

  for (const r of records) {
    const presente = r.presentes?.[studentId] !== false
    const justificada = !!r.justificadas?.[studentId]
    const estado = presente ? 'presente' : justificada ? 'justificada' : 'falta'
    const p = String(r.parcial)
    if (!porParcial[p]) porParcial[p] = { asist: 0, inasist: 0, justif: 0, total: 0 }
    porParcial[p].total++
    if (estado === 'falta') { porParcial[p].inasist++; inasistTotal++ }
    else {
      porParcial[p].asist++; asistTotal++
      if (estado === 'justificada') { porParcial[p].justif++; justifTotal++ }
    }
    const actual = porDia[r.fecha]
    if (!actual || RANGO[estado] > RANGO[actual.estado]) {
      // El motivo (texto libre del docente al justificar) es propio del
      // alumno — se guarda igual que el estado, solo para SU resumen; nunca
      // se expone el documento compartido `attendance` con los motivos de
      // todo el grupo. Vacío si no aplica (falta/presente).
      porDia[r.fecha] = { fecha: r.fecha, parcial: r.parcial, estado, motivo: r.motivos?.[studentId] || '' }
    }
  }

  const registros = Object.values(porDia).sort((a, b) => a.fecha.localeCompare(b.fecha))

  await db.doc(`attendanceSummaries/${studentId}`).set({
    asignaturaId,
    porParcial,
    total: { asist: asistTotal, inasist: inasistTotal, justif: justifTotal, total: records.length },
    registros,
    updatedAt: FieldValue.serverTimestamp(),
  })
}

exports.onAttendanceEscrita = onDocumentWritten('attendance/{attendanceId}', async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after = event.data?.after?.exists ? event.data.after.data() : null
  if (!before && !after) return
  const asignaturaId = (after || before).asignaturaId
  const afectados = idsAfectados(before, after)
  if (!afectados.length) return
  await Promise.all(afectados.map((studentId) => recalcularResumenAsistencia(asignaturaId, studentId)))
})

// ─── 5) Programadas + recordatorios de entrega ─────────────────────────────
// Corre cada 30 min. Ventana de 35 min (> intervalo del scheduler) para no
// perder ninguna actividad entre corridas.
const SCHEDULE_INTERVAL = 'every 30 minutes'
const WINDOW_MS = 35 * 60 * 1000

exports.revisarProgramados = onSchedule(SCHEDULE_INTERVAL, async () => {
  const now = Date.now()

  // 3a) Actividades ocultas cuyo publishAt ya pasó — visibilidad que cambia
  // puramente por tiempo, sin ninguna escritura al doc que dispare onWrite.
  const ocultasSnap = await db.collection('activities').where('oculta', '==', true).get()
  for (const doc of ocultasSnap.docs) {
    const a = doc.data()
    if (a.notificadoNuevaActividad || !a.publishAt) continue
    if (new Date(a.publishAt).getTime() > now) continue
    const parcialesOcultos = await parcialesOcultosDe(a.asignaturaId)
    if (parcialesOcultos.includes(a.parcial)) continue
    const estudiantes = await estudiantesDeAsignatura(a.asignaturaId)
    await Promise.all(estudiantes.map((d) =>
      enviarPush(d.data().uid, 'actividadesNuevas', { actividadId: doc.id })
    ))
    await doc.ref.update({ notificadoNuevaActividad: true })
  }

  // 3b) Recordatorios de entrega — cada estudiante elige su propia
  // anticipación (recordatorios.anticipacionMinutos, ver
  // src/pages/student/NotificationSettings.jsx), solo a quien no haya
  // entregado todavía. Un solo aviso por actividad+estudiante
  // (recordatoriosEnviados, lista plana de alumnoId). Sin filtro de rango en
  // la query (evita necesitar un índice compuesto nuevo — mismo criterio que
  // el resto de la app): trae todas las actividades y filtra en memoria.
  const todasSnap = await db.collection('activities').get()
  for (const doc of todasSnap.docs) {
    const a = doc.data()
    if (!a.fechaLimite) continue
    const deadline = new Date(a.fechaLimite.includes('T') ? a.fechaLimite : `${a.fechaLimite}T00:00:00`).getTime()
    const msLeft = deadline - now
    if (msLeft <= 0) continue

    const yaEnviados = a.recordatoriosEnviados || []
    const [estudiantes, submissionsSnap] = await Promise.all([
      estudiantesDeAsignatura(a.asignaturaId),
      db.collection('submissions').where('actividadId', '==', doc.id).get(),
    ])
    const entregaronIds = new Set(submissionsSnap.docs.map((s) => s.data().alumnoId))
    const candidatos = estudiantes.filter((d) => !entregaronIds.has(d.id) && !yaEnviados.includes(d.id))
    if (!candidatos.length) continue

    const settingsSnaps = await Promise.all(candidatos.map((d) =>
      d.data().uid ? db.collection('notificationSettings').doc(d.data().uid).get() : null
    ))
    const nuevosEnviados = []
    await Promise.all(candidatos.map(async (d, i) => {
      const cfg = settingsSnaps[i]?.data()?.recordatorios
      if (!cfg?.habilitado) return
      const anticipacionMs = (cfg.anticipacionMinutos || 60) * 60_000
      if (msLeft > anticipacionMs || msLeft < anticipacionMs - WINDOW_MS) return
      await enviarPush(d.data().uid, 'recordatorios', { actividadId: doc.id })
      nuevosEnviados.push(d.id)
    }))
    if (nuevosEnviados.length) {
      await doc.ref.update({ recordatoriosEnviados: [...yaEnviados, ...nuevosEnviados] })
    }
  }
})
