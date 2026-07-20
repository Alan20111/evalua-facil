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
