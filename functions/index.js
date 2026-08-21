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
//   6. onAvisoEscrito       — el docente publicó un aviso nuevo (título y
//      cuerpo los escribe el propio docente, no un texto genérico).
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
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')

initializeApp()

// Sistema de créditos IA: el ledger (transacciones de saldo) y las funciones
// de IA viven en módulos propios; aquí solo se cablean sus exportaciones.
const creditosLedger = require('./creditosLedger')
const ia = require('./ia')
exports.ejecutarOperacionIA = ia.ejecutarOperacionIA
exports.mantenimientoCreditosIA = ia.mantenimientoCreditosIA

// Chat de Administración (19-ago-2026) — solo lectura, exclusivo admin,
// independiente del Chat con Asistente del docente (ver functions/adminChat.js).
const adminChat = require('./adminChat')
exports.chatAdmin = adminChat.chatAdmin

// Ajuste manual de saldo de créditos IA — solo admin (renombrado de
// resetearCreditosIA, 20-ago-2026: en créditos puros no hay "capacidad" a la
// que resetear, así que la operación es un delta explícito con motivo — ver
// creditosLedger.ajustarSaldoManual). El cliente no puede tocar iaCreditos
// directamente (firestore.rules: allow write: if false), así que esto es la
// única puerta, y valida el rol server-side igual que cualquier otra ruta de
// admin.
exports.ajustarSaldoCreditosIA = onCall(async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para continuar')
  const perfil = await db.doc(`users/${uid}`).get()
  if (!perfil.exists || perfil.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo un administrador puede ajustar créditos')
  }
  const docenteId = request.data?.docenteId
  const delta = request.data?.delta
  const motivo = request.data?.motivo || null
  if (!docenteId || typeof docenteId !== 'string') {
    throw new HttpsError('invalid-argument', 'Falta el docente a ajustar')
  }
  if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0) {
    throw new HttpsError('invalid-argument', 'El ajuste debe ser un número distinto de cero')
  }
  try {
    const r = await creditosLedger.ajustarSaldoManual({ uid: docenteId, delta, motivo, adminUid: uid })
    logger.info(`ajustarSaldoCreditosIA: admin ${uid} ajustó a ${docenteId} en ${delta} → saldo=${r.saldo}`)
    return r
  } catch (e) {
    if (e.codigo === 'DELTA_INVALIDO') throw new HttpsError('invalid-argument', e.message)
    logger.error(`ajustarSaldoCreditosIA(${docenteId}):`, e.message)
    throw new HttpsError('internal', 'No se pudo ajustar el saldo')
  }
})

// Aprobar una compra de créditos adicionales (18-ago-2026) — solo admin.
// Igual que resetearCreditosIA: `iaCreditos` es de solo lectura para el
// cliente, así que abonar el saldo SIEMPRE pasa por aquí. La cantidad y el
// precio nunca vienen del cliente en esta llamada — el servidor los lee de
// `creditPurchases/{purchaseId}`, el documento que ya validaron las reglas
// de Firestore al crearse (cantidad/precio deben coincidir con
// config/iaTarifas.paquetesCreditos). Idempotente por diseño del propio
// ledger: una segunda aprobación del mismo id no vuelve a sumar créditos.
exports.aprobarCompraCreditos = onCall(async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para continuar')
  const perfil = await db.doc(`users/${uid}`).get()
  if (!perfil.exists || perfil.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo un administrador puede aprobar compras de créditos')
  }
  const purchaseId = request.data?.purchaseId
  if (!purchaseId || typeof purchaseId !== 'string') {
    throw new HttpsError('invalid-argument', 'Falta la compra a aprobar')
  }
  try {
    const r = await creditosLedger.acreditarCompraCreditos({ purchaseId, adminUid: uid })
    logger.info(`aprobarCompraCreditos: admin ${uid} aprobó ${purchaseId} → +${r.creditos} créditos`)
    return r
  } catch (e) {
    if (e.codigo === 'COMPRA_INEXISTENTE' || e.codigo === 'ESTADO_INVALIDO') {
      throw new HttpsError('failed-precondition', e.message, { codigo: e.codigo })
    }
    logger.error(`aprobarCompraCreditos(${purchaseId}):`, e.message)
    throw new HttpsError('internal', 'No se pudo aprobar la compra')
  }
})
const db = getFirestore()
const messaging = getMessaging()

const TITULOS = {
  actividadesNuevas: { title: 'Nueva actividad', body: 'Tu maestro publicó una actividad nueva.' },
  calificaciones: { title: 'Te calificaron', body: 'Ya tienes una calificación nueva.' },
  recordatorios: { title: 'Recordatorio de entrega', body: 'Se acerca la fecha límite de una actividad.' },
  // Docente — ver onSubmissionEntregada() más abajo.
  nuevasEntregas: { title: 'Nueva entrega', body: 'Un estudiante entregó una actividad.' },
}

// ─── 0) Reconciliación de tokens push duplicados ───────────────────────────
// El token de FCM es del DISPOSITIVO, no de la cuenta — al cambiar de sesión
// en el mismo teléfono (docente↔alumno, o dos cuentas del mismo rol), el
// cliente (reasignarToken en src/utils/pushNotifications.js y webPush.js)
// AGREGA el token a la cuenta nueva, pero el intento de QUITARLO de la
// cuenta anterior lo hace escribiendo en notificationSettings/{cuenta
// anterior} — un doc que ya no le pertenece. La regla de Firestore
// (`allow write: if request.auth.uid == uid`) rechaza esa escritura sin
// avisar (el cliente la manda con .catch(()=>{}) a propósito, best-effort),
// así que el token se queda huérfano en la cuenta vieja para siempre: dos
// cuentas reciben el mismo push físico hasta que alguien lo limpie a mano.
// Esta función corre con permisos de Admin (sí puede escribir en cualquier
// doc) y hace exactamente esa limpieza: cuando aparece un token NUEVO en un
// notificationSettings/{uid}, lo quita de cualquier OTRA cuenta que lo
// tuviera. Documento pequeño (nada de submissions/activities), así que un
// query array-contains sin índice compuesto es suficiente.
exports.onTokenPushEscrito = onDocumentWritten('notificationSettings/{uid}', async (event) => {
  const after = event.data?.after
  if (!after?.exists) return
  const afterTokens = after.data().fcmTokens || []
  const beforeTokens = event.data.before?.exists ? (event.data.before.data().fcmTokens || []) : []
  const nuevos = afterTokens.filter((t) => !beforeTokens.includes(t))
  if (!nuevos.length) return
  const uid = event.params.uid
  for (const token of nuevos) {
    const dupSnap = await db.collection('notificationSettings').where('fcmTokens', 'array-contains', token).get()
    await Promise.all(
      dupSnap.docs
        .filter((d) => d.id !== uid)
        .map((d) => d.ref.update({ fcmTokens: FieldValue.arrayRemove(token) }))
    )
  }
})

// ─── Visibilidad de actividad — replica isActivityPublished() de
// src/utils/activityVisibility.js (single source of truth en el cliente). ───
function actividadVisible(a, parcialOculto) {
  if (parcialOculto) return false
  if (!a?.oculta) return true
  if (a.publishAt) return new Date(a.publishAt).getTime() <= Date.now()
  return false
}

// Lee de la asignatura las dos cosas que deciden si vale la pena avisar de una
// actividad: sus parciales ocultos y si está archivada. Antes solo devolvía los
// parciales ocultos, y nada consultaba `archived` — por eso una asignatura
// archivada seguía mandando notificaciones a sus estudiantes cada vez que el
// docente tocaba una actividad, meses después de cerrar el ciclo.
async function estadoAsignatura(asignaturaId) {
  const snap = await db.collection('subjects').doc(asignaturaId).get()
  const d = snap.data() || {}
  return { parcialesOcultos: d.parcialesOcultos || [], archivada: !!d.archived }
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
// Canal de Android por categoría — DEBE coincidir con CANALES/
// CANAL_POR_CATEGORIA en src/utils/pushNotifications.js, que es quien crea
// estos canales en el teléfono la primera vez. Sin `android.notification.
// channelId` en el mensaje de FCM, Android ignora el canal que la app haya
// creado y cae en uno genérico — pedido explícito: "no reutilizar este canal
// para otros tipos de notificaciones", así que cada categoría declara el
// suyo aquí. Categorías sin canal propio (docente: nuevasEntregas) se quedan
// sin este campo — FCM usa el canal por default del plugin.
// Sufijo "_v2": ver el mismo comentario en src/utils/pushNotifications.js —
// un NotificationChannel de Android es inmutable una vez creado, así que el
// id tuvo que cambiar para que el sonido/importancia nuevos de verdad
// aplicaran en teléfonos que ya tenían el canal viejo instalado.
const CANAL_POR_CATEGORIA = {
  avisos: 'avisos_v2',
  actividadesNuevas: 'actividades_v2',
  calificaciones: 'calificaciones_v2',
  recordatorios: 'recordatorios_v2',
  pagoNuevo: 'pagos_v1',
  // El mismo canal para las dos puntas del pago: al admin le llega el que
  // entra, al docente el suyo ya resuelto. Un canal de Android es inmutable
  // una vez creado, así que abrir uno nuevo solo para esto obligaría a un
  // 'pagos_v2' y a que el admin volviera a ajustar sonido y prioridad.
  pagoResuelto: 'pagos_v1',
}

async function enviarPushDirecto(uid, notification, data = {}, descripcion = null, logExtra = null) {
  if (!uid) return
  const settingsSnap = await db.collection('notificationSettings').doc(uid).get()
  const tokens = settingsSnap.exists ? (settingsSnap.data().fcmTokens || []) : []
  const channelId = CANAL_POR_CATEGORIA[data.categoria]
  let enviado = false
  if (tokens.length) {
    try {
      const res = await messaging.sendEachForMulticast({
        tokens,
        notification,
        data,
        ...(channelId ? { android: { notification: { channelId } } } : {}),
      })
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
      // La categoría también para las notificaciones del ALUMNO (que llegan
      // por enviarPush, sin logExtra): su Bitácora la usa para poner el
      // rótulo del renglón (ACTIVIDAD NUEVA / CALIFICACIÓN / …). Va antes del
      // spread de logExtra para que las del docente, que ya traen la suya,
      // sigan mandando.
      ...(data.categoria ? { categoria: data.categoria } : {}),
      titulo: notification.title,
      descripcion: descripcion || notification.body,
      ...(logExtra || {}),
      createdAt: FieldValue.serverTimestamp(),
    })
  }
}

// Lee la preferencia del usuario para esa categoría (notificationSettings);
// si está deshabilitada A PROPÓSITO, no hace nada. Opt-OUT, no opt-in —
// mismo criterio que enviarPushDirecto usa para el docente (nuevasEntregas,
// activacionEstudiante): ausente/true = notifica, solo se salta si el
// usuario lo apagó explícitamente. Antes exigía `cfg?.habilitado === true`
// (opt-in) — bug real confirmado: la pantalla de Notificaciones del alumno
// (NotificationSettings.jsx) MUESTRA los interruptores activados por
// defecto aunque nunca se haya guardado nada (mergeWithDefaults), pero
// nunca escribe el campo hasta que el alumno toca un interruptor — como
// casi ningún alumno abre esa pantalla, "Calificaciones"/"Actividades
// nuevas"/"Recordatorios" nunca se enviaban a la gran mayoría, aunque la
// app les mostrara que estaban activadas.
// `notificationOverride` reemplaza el título/cuerpo fijo de TITULOS[categoria]
// — lo usan los Avisos, donde el título y el mensaje los escribe el propio
// docente en cada aviso, no un texto genérico por categoría.
// `asignaturaId` solo aplica a la categoría 'avisos' — es el único caso con
// un segundo nivel de silencio POR ASIGNATURA (ver NotificationSettings.jsx
// del alumno, "Avisos por asignatura"): el interruptor general puede seguir
// prendido y aun así no mandar el push de una materia puntual que el
// estudiante silenció. Las demás categorías no tienen ese segundo nivel.
async function enviarPush(uid, categoria, dataExtra = {}, notificationOverride = null, asignaturaId = null) {
  if (!uid) return
  const settingsSnap = await db.collection('notificationSettings').doc(uid).get()
  const settingsData = settingsSnap.exists ? settingsSnap.data() : {}
  const cfg = settingsData[categoria]
  if (cfg?.habilitado === false) return
  if (categoria === 'avisos' && asignaturaId && settingsData.avisosPorAsignatura?.[asignaturaId] === false) return

  const notification = notificationOverride || TITULOS[categoria]
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

  const { parcialesOcultos, archivada } = await estadoAsignatura(a.asignaturaId)
  if (archivada) return // ciclo cerrado: no se avisa de nada
  if (!actividadVisible(a, parcialesOcultos.includes(a.parcial))) return

  const estudiantes = await estudiantesDeAsignatura(a.asignaturaId)
  await Promise.all(estudiantes.map((d) =>
    enviarPush(d.data().uid, 'actividadesNuevas', { actividadId: event.params.activityId })
  ))
  await after.ref.update({ notificadoNuevaActividad: true })
})

// ─── Aviso publicado ────────────────────────────────────────────────────
// onCreate únicamente (a diferencia de onActividadEscrita): un aviso nace ya
// publicado siempre — no hay borrador ni programación (ver src/utils/avisos.js
// y AvisosTab.jsx), así que solo el primer write importa. Idempotente por
// `notificado` de todos modos, para no duplicar el push si la función
// reintenta la misma escritura.
exports.onAvisoEscrito = onDocumentWritten('avisos/{avisoId}', async (event) => {
  const after = event.data?.after
  if (!after?.exists) return // borrado
  const before = event.data.before
  if (before?.exists) return // solo se notifica al crear, no al editar
  const a = after.data()
  if (a.notificado) return

  const subjSnap = await db.collection('subjects').doc(a.asignaturaId).get()
  const materia = subjSnap.exists ? subjSnap.data().nombre || '' : ''

  const estudiantes = await estudiantesDeAsignatura(a.asignaturaId)
  // Pedido explícito: la notificación debe mostrar, como mínimo, nombre de la
  // asignatura (título del push), título del aviso y un fragmento del
  // mensaje (cuerpo del push, "título: mensaje"). El mensaje es opcional —
  // si el docente lo deja vacío (ej. "No habrá clase" ya se explica solo),
  // el cuerpo se queda solo con el título, sin el "" pegado.
  const notification = {
    title: materia ? `Nuevo aviso en ${materia}` : 'Nuevo aviso',
    body: a.mensaje ? `${a.titulo}: ${a.mensaje}` : a.titulo,
  }
  await Promise.all(estudiantes.map((d) =>
    enviarPush(d.data().uid, 'avisos', { asignaturaId: a.asignaturaId, avisoId: event.params.avisoId }, notification, a.asignaturaId)
  ))
  await after.ref.update({ notificado: true })
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

  // El aviso ya quedó reclamado (notificadoEntregaDocente:true) arriba, así
  // que si algo de aquí en adelante truena (un get() que falla, un timeout),
  // sin este try/catch la entrega se queda marcada como "ya notificada" para
  // siempre sin haber mandado el push NI escrito la Bitácora — silencioso,
  // sin forma de reintentar. Si falla, se libera el reclamo para que la
  // PRÓXIMA escritura a este submission (una calificación, una edición) lo
  // vuelva a intentar, y se relanza el error para que quede en los logs de
  // Cloud Functions en vez de perderse.
  try {
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
      // alumnoId viaja aquí también (no solo en logExtra) porque este `data` es
      // lo único que de verdad llega al dispositivo por FCM — sin él, tocar la
      // notificación push no sabía a qué entrega específica ir (ver
      // resolveDestino en src/utils/pushNotifications.js).
      { categoria: 'nuevasEntregas', actividadId: afterData.actividadId, submissionId: event.params.submissionId, alumnoId: afterData.alumnoId },
      null,
      {
        categoria: 'nuevasEntregas', estudiante: nombreEstudiante, asignatura: subj?.nombre || '', grupo: subj?.grupo || '',
        actividad: act.nombre || '', numeroActividad, tipoEntrega,
        // Para que la Bitácora pueda llevar directo a esa entrega (pedido
        // explícito: el nombre del estudiante en Detalles es un enlace).
        actividadId: afterData.actividadId, alumnoId: afterData.alumnoId,
      },
    )
  } catch (err) {
    logger.error(`onSubmissionEntregada(${event.params.submissionId}) falló tras reclamar el aviso — se libera para reintentar:`, err)
    await after.ref.update({ notificadoEntregaDocente: false }).catch(() => {})
    throw err
  }
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
// Capitaliza igual que capitalizarNombre() (src/utils/nombres.js): endereza lo
// que no trae intención de mayúsculas (todo MAYÚSCULAS o todo minúsculas) y
// respeta tal cual lo que ya viene mezclado ("de la Cruz"), para que la
// notificación se lea igual que la pantalla.
function capitalizarNombre(texto) {
  const limpio = String(texto ?? '').trim().replace(/\s+/g, ' ')
  if (!limpio) return ''
  if (/\p{Lu}/u.test(limpio) && /\p{Ll}/u.test(limpio)) return limpio
  return limpio
    .toLocaleLowerCase('es')
    .replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase('es'))
}
function nombreEstudianteDe(s) {
  return [s?.apellidoPaterno, s?.apellidoMaterno, s?.nombre]
    .map(capitalizarNombre)
    .filter(Boolean)
    .join(' ') || 'Un estudiante'
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

// Copia deliberada de `publicacionVisible` (src/utils/evaluacionGrading.js).
// `functions/` es otro paquete y no puede importar de `src/`, y esta regla
// —cuándo se publican las respuestas— tiene que evaluarse en el servidor:
// desde A08 es él quien decide si el alumno ve cuál era la correcta, no el
// navegador. Si cambia una, cambia la otra; hay casos de prueba en las dos.
function publicacionVisible(modo, fecha, flag) {
  if (modo === 'nunca') return false
  if (modo === 'inmediato') return true
  if (modo === 'fecha') return !!fecha && new Date().toISOString() >= fecha
  return !!flag
}

// Extraída a functions/calificacionIntentos.js — fuente única de verdad,
// compartida también con OP-10 (functions/ia.js), sobre qué intento gana.
const { resolverCalificacionFinal } = require('./calificacionIntentos')

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

  // La clave de respuestas vive APARTE del reactivo desde A08: el alumno lee
  // `preguntas` para contestar, y `clave` solo la abre el docente dueño (las
  // reglas no pueden filtrar campos, así que lo hace el modelo de datos). Aquí
  // se juntan otra vez porque el Admin SDK no pasa por las reglas.
  const [pregSnap, claveSnap, respSnap] = await Promise.all([
    actSnap.ref.collection('preguntas').get(),
    actSnap.ref.collection('clave').get(),
    after.ref.collection('respuestas').get(),
  ])
  const claves = {}
  claveSnap.docs.forEach((d) => { claves[d.id] = d.data().respuestaCorrecta ?? null })
  const preguntas = pregSnap.docs.map((d) => ({
    id: d.id, ...d.data(), respuestaCorrecta: claves[d.id] ?? null,
  }))
  const respuestasGuardadas = {}
  respSnap.docs.forEach((d) => { respuestasGuardadas[d.id] = d.data() })

  // Puntos por pregunta desde la fuente de verdad del servidor. Los tipos de
  // revisión manual quedan null (pendientes) — igual que hacía el cliente:
  // cada intento nuevo resetea la revisión manual del anterior.
  const respuestasPorPregunta = {}
  preguntas.forEach((p) => {
    respuestasPorPregunta[p.id] = { puntosObtenidos: calcularPuntosPregunta(p, respuestasGuardadas[p.id] || {}) }
  })

  // El veredicto se escribe EN LA RESPUESTA DEL ALUMNO, que es suya y que ya
  // carga su pantalla de revisión. Antes esa pantalla comparaba contra
  // `respuestaCorrecta` del reactivo — por eso la clave tenía que viajarle.
  //
  // `correcta` va siempre: saber si acertaste no revela cuál era la buena.
  // `respuestaCorrecta` va SOLO si el docente publicó las respuestas, que es
  // exactamente la regla de negocio que hasta hoy decidía el navegador.
  const ev = act.evaluacion || {}
  const revelarCorrectas = publicacionVisible(
    ev.publicarRespuestas || 'inmediato', ev.publicarRespuestasFecha, ev.respuestasPublicadas
  )
  await Promise.all(preguntas.map((p) => {
    const puntos = respuestasPorPregunta[p.id].puntosObtenidos
    const marcas = { puntosObtenidos: puntos }
    // Las abiertas quedan pendientes de revisión: ahí no hay veredicto todavía.
    if (puntos != null) marcas.correcta = puntos > 0
    // Se escribe también cuando NO se revela, para borrar lo que hubiera
    // quedado de una configuración anterior más permisiva.
    marcas.respuestaCorrecta = revelarCorrectas ? (p.respuestaCorrecta ?? null) : null
    return after.ref.collection('respuestas').doc(p.id).set(marcas, { merge: true })
  }))

  const calificacionIntento = calcularCalificacion(preguntas, respuestasPorPregunta, act.maxCalif || 10)
  // Un instrumento "Sin calificación" (diagnóstico) no produce nota. El
  // servidor no lo sabía y calificaba igual, con dos consecuencias visibles
  // para el estudiante:
  //   · Le aparecía una nota donde el docente dijo que no habría ninguna. Y si
  //     además eligió que los reactivos NO se ponderen, la ponderación total da
  //     cero y la nota calculada es 0 — un cero de aspecto reprobatorio en un
  //     diagnóstico.
  //   · Escribir `calificacion` dispara onSubmissionActualizada, así que le
  //     llegaba un push "Ya tienes una calificación nueva".
  // Misma lectura que el cliente (ver sinCalificacion en
  // src/utils/activityVisibility.js): el campo puede venir en la actividad o
  // dentro de su configuración de evaluación.
  const noLleveNota = act.sinCalificacion === true || act.evaluacion?.sinCalificacion === true
  // Corrección de Kike (12-ago-2026, Tanda 2): un instrumento sin
  // calificación NUNCA tiene nada "pendiente de revisión" — sus
  // respuesta_corta son respuestas de encuesta, no algo a lo que el docente
  // deba ponerle puntos. Sin esto, el diagnóstico de contexto se quedaba
  // para siempre en la lista de "requiere revisión" de EvaluacionManager.jsx,
  // esperando una calificación que nunca va a existir.
  const pendienteRevision = noLleveNota ? false : resolverPendienteRevision(preguntas, respuestasPorPregunta)

  await db.runTransaction(async (tx) => {
    const freshSnap = await tx.get(after.ref)
    if (!freshSnap.exists) return
    const fresh = freshSnap.data()
    if (fresh.estadoEvaluacion !== 'finalizado') return
    const num = fresh.intentoActual || ((fresh.intentos?.length || 0) + 1)
    const previos = fresh.intentos || []
    if (previos.some((i) => i.numero === num)) return
    // El intento se registra siempre —es lo que hace idempotente a esta
    // función, y de paso deja el puntaje disponible para las estadísticas del
    // diagnóstico—; lo que no se escribe sin nota es el campo `calificacion`.
    const marcas = {
      pendienteRevision,
      estado: noLleveNota || pendienteRevision ? 'entregado' : 'calificado',
      intentos: [...previos, { numero: num, calificacion: calificacionIntento }],
    }
    if (!noLleveNota) {
      marcas.calificacion = resolverCalificacionFinal(previos, calificacionIntento, act.evaluacion?.conservar)
    }
    tx.update(after.ref, marcas)

    // Capa 2 (OP-10) — fotografía inmutable de las respuestas de ESTE
    // intento, tomada de `respuestasGuardadas`/`respuestasPorPregunta` ya
    // leídas arriba (antes de esta transacción, con las respuestas vivas de
    // este intento — todavía no las pudo limpiar un reintento posterior: eso
    // solo pasa cuando el alumno vuelve a ActivityPage y pide empezar de
    // nuevo, después de que este intento ya quedó 'finalizado'). Mismo guard
    // de idempotencia que `intentos[]` arriba: si `num` ya se hubiera
    // procesado, ya habríamos retornado antes de llegar aquí. `tx.create`
    // (no `tx.set`) además rechaza de raíz cualquier intento de sobrescribir
    // un snapshot que ya exista, aunque `intentos[]` estuviera inconsistente.
    //
    // Solo lo que OP-10 necesita para el detalle por reactivo — nunca texto
    // libre ni archivos (no aportan al análisis, que solo mira reactivos
    // objetivos) ni nombre/identidad del estudiante (ya la da la ruta).
    const snapshotRespuestas = {}
    preguntas.forEach((p) => {
      const guardada = respuestasGuardadas[p.id] || {}
      const puntos = respuestasPorPregunta[p.id].puntosObtenidos
      snapshotRespuestas[p.id] = {
        opcionSeleccionada: guardada.opcionSeleccionada ?? null,
        correcta: puntos != null ? puntos > 0 : null,
        puntosObtenidos: puntos,
      }
    })
    tx.create(after.ref.collection('intentosRespuestas').doc(String(num)), {
      numero: num,
      calificacion: calificacionIntento,
      respuestas: snapshotRespuestas,
      creadoEn: FieldValue.serverTimestamp(),
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
  // Alta tardía: días anteriores a que el alumno se inscribiera se excluyen
  // del resumen — sin esto, `presente ?? true` (abajo) contaba como
  // asistencia cada columna de antes de que existiera su inscripción, igual
  // que hacía countPresence() del docente antes de corregirse (ver
  // src/utils/attendance.js).
  const studentSnap = await db.doc(`students/${studentId}`).get()
  // La inscripción ya no existe: el docente dio de baja al estudiante. Su
  // resumen se BORRA, no se recalcula.
  //
  // Sin esto revivía, y revivía mal. La baja no limpia la llave del alumno de
  // los mapas `presentes` de cada columna de asistencia (igual que pasaba con
  // `activities.extensiones` antes de corregirse), así que `idsAfectados` lo
  // seguía incluyendo en cada edición del pase de lista y esta función volvía
  // a escribirle el resumen. Y como `presentes?.[id] !== false` da verdadero
  // para una llave ausente, el resumen resucitado lo marcaba **presente en
  // todas las clases**. Un alumno borrado, con asistencia perfecta, visible
  // para quien conservara su uid.
  if (!studentSnap.exists) {
    await db.doc(`attendanceSummaries/${studentId}`).delete()
    return
  }
  const createdAt = studentSnap.data().createdAt
  const enrolledFrom = createdAt?.toDate ? (() => {
    const d = createdAt.toDate()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })() : null

  const snap = await db.collection('attendance').where('asignaturaId', '==', asignaturaId).get()
  const records = snap.docs.map((d) => d.data())
    // A13 · H1 · Registros viejos sin `parcial`: antes se filtraban para
    // evitar que String(undefined) → 'undefined' generara una clave inválida
    // en porParcial y tronara el .set(). El comentario anterior decía "el
    // docente ya los excluye de su tabla", pero el cliente usa `?? 1` y SÍ
    // los muestra en Parcial 1 — quedaba un desfase real entre la vista del
    // docente y el resumen del alumno. Se corrige asignando el mismo fallback.
    .map((r) => r.parcial != null ? r : { ...r, parcial: 1 })
    .filter((r) => !enrolledFrom || r.fecha >= enrolledFrom)
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

// A18 · H1 — fecha-solo sin hora se ancla al FIN del día (23:59:59), igual
// que parseFechaLimite en el cliente (activityVisibility.js). Antes usaba
// T00:00:00 (inicio del día), lo que hacía que el recordatorio se disparara
// ~24 h antes de lo que el alumno esperaba para actividades sin hora explícita.
function parsearFechaLimiteMs(fechaLimite) {
  return new Date(fechaLimite.includes('T') ? fechaLimite : `${fechaLimite}T23:59:59`).getTime()
}
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
    const { parcialesOcultos, archivada } = await estadoAsignatura(a.asignaturaId)
    if (archivada) continue // ciclo cerrado: no se avisa de nada
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
    const deadline = parsearFechaLimiteMs(a.fechaLimite)
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
      // Opt-out, no opt-in — mismo criterio y mismo motivo que enviarPush()
      // arriba: sin cfg guardado (alumno que nunca abrió Notificaciones), se
      // usa el default del cliente (habilitado, 1 día antes) en vez de
      // saltarse el recordatorio en silencio.
      const cfg = settingsSnaps[i]?.data()?.recordatorios
      if (cfg?.habilitado === false) return
      const anticipacionMs = (cfg?.anticipacionMinutos || 1440) * 60_000
      if (msLeft > anticipacionMs || msLeft < anticipacionMs - WINDOW_MS) return
      await enviarPush(d.data().uid, 'recordatorios', { actividadId: doc.id })
      nuevosEnviados.push(d.id)
    }))
    if (nuevosEnviados.length) {
      await doc.ref.update({ recordatoriosEnviados: [...yaEnviados, ...nuevosEnviados] })
    }
  }
})

// ─── 6) Pago nuevo — aviso al administrador ────────────────────────────────
// Cada docente que registra un pago (queda "pendiente" hasta que el admin lo
// aprueba/rechaza en el panel — ver PaymentsTable.jsx) dispara un push a
// TODOS los administradores, para no depender de que alguien entre a
// revisar el panel a cada rato. onCreate únicamente (before no existe): un
// pago no se vuelve a "crear", solo cambia de estado con Aprobar/Rechazar,
// que son updates — esos NO deben volver a notificar. Idempotente por
// `notificadoAdmin`, mismo criterio que el resto de las funciones de este
// archivo.
exports.onPagoCreado = onDocumentWritten('payments/{paymentId}', async (event) => {
  const after = event.data?.after
  if (!after?.exists) return // borrado
  if (event.data.before?.exists) return // solo al crearse, no en updates (Aprobar/Rechazar)
  const pago = after.data()
  if (pago.notificadoAdmin) return
  // Solo lo que de verdad espera al admin. Abrir el checkout de una pasarela
  // crea el doc como 'iniciado' (ver api/_lib/billing.js startPayment) y los
  // cobros automáticos entran ya 'completado': ninguno de los dos necesita que
  // nadie los revise. Avisarlos convertía cada checkout abandonado en un
  // "Nuevo pago: registró un pago de $116" por un pago que nunca existió.
  if (pago.status !== 'pendiente') return

  const [teacherSnap, adminsSnap] = await Promise.all([
    pago.docenteId ? db.collection('users').doc(pago.docenteId).get() : Promise.resolve(null),
    db.collection('users').where('role', '==', 'admin').get(),
  ])
  const docente = teacherSnap?.exists ? teacherSnap.data() : null
  const nombreDocente = docente?.nombreMostrar || docente?.email || 'Un docente'
  const monto = typeof pago.monto === 'number'
    ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(pago.monto)
    : ''
  const notification = {
    title: 'Nuevo pago',
    body: monto ? `${nombreDocente} registró un pago de ${monto}` : `${nombreDocente} registró un pago nuevo`,
  }

  await Promise.all(adminsSnap.docs.map(async (adminDoc) => {
    const settingsSnap = await db.collection('notificationSettings').doc(adminDoc.id).get()
    // Opt-out, no opt-in — default activado (ver Toggle en el panel del
    // admin): ausente/true = notifica, solo se salta si el propio admin lo
    // apagó a propósito. Mismo criterio que el resto de las categorías del
    // docente en este archivo (nuevasEntregas, activacionEstudiante).
    if (settingsSnap.exists && settingsSnap.data().pagoNuevo?.habilitado === false) return
    await enviarPushDirecto(
      adminDoc.id,
      notification,
      { categoria: 'pagoNuevo', paymentId: event.params.paymentId },
    )
  }))
  await after.ref.update({ notificadoAdmin: true })
})

// ─── 7) Pago resuelto — aviso al DOCENTE ───────────────────────────────────
// El otro lado del anterior. Aprobar o rechazar pasa en el panel del
// administrador, en otro momento y en otra pantalla: sin este aviso, el
// docente que registró su transferencia no tenía forma de enterarse más que
// volviendo al perfil a mirar. Peor todavía cuando lo aprobaban con la
// plataforma abierta — seguía viendo "en revisión" y con el candado de
// escritura puesto aunque su suscripción ya estuviera activa (el cliente ya
// relee al volver a la pantalla, ver useSubscription.js; esto es lo que lo
// hace volver).
//
// Sin interruptor para apagarlo, a diferencia del aviso al admin: es el acuse
// de un movimiento de dinero del propio docente, no una notificación de
// actividad. Idempotente por `notificadoResuelto` — y el update que pone esa
// marca vuelve a disparar esta función, pero para entonces el status ya no
// cambió, así que se sale por la primera puerta.
exports.onPagoResuelto = onDocumentWritten('payments/{paymentId}', async (event) => {
  const after = event.data?.after
  const before = event.data?.before
  if (!after?.exists || !before?.exists) return
  const antes = before.data()
  const ahora = after.data()
  if (antes.status === ahora.status) return
  if (antes.status !== 'pendiente') return
  if (ahora.status !== 'completado' && ahora.status !== 'rechazado') return
  if (ahora.notificadoResuelto) return

  const aprobado = ahora.status === 'completado'
  const notification = aprobado
    ? {
        title: 'Pago aprobado',
        body: 'Tu suscripción quedó activa. Ya puedes seguir trabajando con normalidad.',
      }
    : {
        title: 'No pudimos confirmar tu pago',
        body: ahora.notasAdmin
          ? `${ahora.notasAdmin} — entra a tu perfil para reenviarlo.`
          : 'Entra a tu perfil para revisar el motivo y reenviarlo con tu comprobante.',
      }

  await enviarPushDirecto(
    ahora.docenteId,
    notification,
    { categoria: 'pagoResuelto', paymentId: event.params.paymentId },
  )
  await after.ref.update({ notificadoResuelto: true })
})

// ─── Candado de suscripción: espejo de la vigencia en users/{uid} ─────────
// Las reglas de Firestore no pueden consultar `subscriptions` por docenteId
// (no hay consultas dentro de una regla, solo get() por ruta exacta), así que
// la fecha hasta la que el docente puede TRABAJAR se copia a un campo de su
// propio documento: `users/{docenteId}.suscripcionHasta`.
//
// Se guarda una FECHA y no un sí/no a propósito: la regla la compara contra
// request.time, así que el vencimiento ocurre solo con el paso del tiempo, sin
// que nada tenga que correr ese día ni cada noche.
//
// Nadie más puede escribir ese campo: las reglas congelan `suscripcionHasta`
// en las actualizaciones que hace el propio docente sobre su perfil (ver
// firestore.rules, match /users), y esta función usa el Admin SDK, que no pasa
// por ellas.
//
// El cálculo es el mismo de src/utils/subscriptionHelpers.js
// (effectiveVencimiento) — no se puede importar desde aquí (otro paquete), así
// que se repite. Si cambia allá, cambia aquí: son las dos caras del MISMO
// criterio, y discrepar significa o dejar trabajar a quien no pagó o bloquear
// a quien sí.
const DIAS_PRUEBA = 30

function vigenciaDe(sub) {
  if (!sub) return null
  // Cancelada NO corta de inmediato: conserva hasta la fecha ya cubierta.
  // 'vencida' guardada explícitamente sí corta ya.
  if (sub.status === 'vencida') return new Date(0)
  const inicio = sub.fechaInicio?.toDate?.() || (sub.fechaInicio ? new Date(sub.fechaInicio) : null)
  // Sin planId nunca hubo un pago aprobado: lo único real es su prueba.
  if (sub.status === 'trial' || !sub.planId) {
    if (!inicio) return null
    const fin = new Date(inicio)
    fin.setDate(fin.getDate() + DIAS_PRUEBA)
    return fin
  }
  // Cortesía indefinida: no vence nunca.
  if (sub.planId === 'cortesia' && sub.cortesiaIndefinida === true) {
    return new Date('2999-12-31T00:00:00Z')
  }
  const venc = sub.fechaVencimiento?.toDate?.() || (sub.fechaVencimiento ? new Date(sub.fechaVencimiento) : null)
  if (venc) return venc
  if (!inicio) return null
  const fin = new Date(inicio)
  fin.setMonth(fin.getMonth() + 1)
  return fin
}

// Modelo de créditos puros (20-ago-2026): ya no hay candado de suscripción
// que sincronizar ni prueba de 30 días que reponer — onSuscripcionEscrita,
// sincronizarCandadoSuscripcion y crearPruebaSiFalta se eliminan por
// completo (ver docs/ia/PLAN_TECNICO_CREDITOS_PUROS.md §4). `subscriptions`/
// `payments`/`plans` quedan como colecciones históricas sin lógica que las
// escriba desde aquí.
//
// onDocenteCreado se conserva: ahora otorga el regalo de bienvenida de
// créditos (50, una sola vez, sin caducidad) apenas se crea la cuenta del
// docente — síncrono con la creación para que Asistencia nunca vea una
// ventana de saldo 0 en una cuenta nueva.
exports.onDocenteCreado = onDocumentWritten('users/{uid}', async (event) => {
  const after = event.data?.after
  if (!after?.exists) return
  const perfil = after.data()
  if (perfil.role !== 'docente') return
  try {
    const r = await creditosLedger.otorgarCreditosBienvenida({ uid: event.params.uid })
    if (!r.repetida) logger.info(`onDocenteCreado: ${event.params.uid} recibió ${creditosLedger.CREDITOS_BIENVENIDA} créditos de bienvenida`)
  } catch (e) {
    logger.error(`otorgarCreditosBienvenida(${event.params.uid}):`, e.message)
  }
})

// ── Solo para las pruebas ───────────────────────────────────────────────────
//
// La lógica de estas funciones se prueba llamándola directamente contra el
// emulador de Firestore (`test/servidor.test.mjs`), sin levantar el emulador
// de Functions — que es caro, lento y solo verificaría el cableado de los
// disparadores, una línea por función. Decisión del PO, 6-ago-2026.
//
// Es un objeto plano, no una función de firebase-functions: el análisis del
// despliegue solo recoge exportaciones con `__endpoint`, así que esto no se
// despliega ni cuenta como función. Hay un caso de prueba que lo comprueba.
exports._pruebas = {
  calcularPuntosPregunta,
  calcularCalificacion,
  resolverPendienteRevision,
  resolverCalificacionFinal,
  idsAfectados,
  actividadVisible,
  parsearFechaLimiteMs,
  vigenciaDe,
  recalcularResumenAsistencia,
  TIPOS_OBJETIVOS,
  TIPOS_REVISION_MANUAL,
}
