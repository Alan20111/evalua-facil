// Cloud Functions — notificaciones push de Evalúa Fácil.
//
// Cada función respeta si el usuario habilitó esa categoría en
// `notificationSettings/{uid}` (pantalla de notificaciones del alumno o del
// docente):
//   1. onActividadEscrita   — actividad nueva visible para el alumno.
//   2. onSubmissionActualizada — se publicó una calificación.
//   3. onSubmissionEntregada — un estudiante entregó una actividad marcada
//      por el docente con "Notificarme" (activity.notificarDocente).
//   4. revisarProgramados   — programada cada 30 min: actividades cuyo
//      publishAt ya pasó (visibilidad puramente por tiempo, sin escritura de
//      doc) + recordatorios de entrega, con la anticipación que cada
//      estudiante haya elegido (recordatorios.anticipacionMinutos).
//
// Sonido, volumen y repetición los controla el propio teléfono del
// estudiante (como con cualquier otra app) — la app NO los configura, así
// que cada push va como "notification" payload normal: el sistema operativo
// la muestra solo con la app en segundo plano o cerrada. Con la app en
// primer plano, Android no la muestra automáticamente, así que el cliente
// (ver src/utils/pushNotifications.js) la refleja con una notificación local
// simple usando el mismo título/cuerpo.

const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
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
// Lee la preferencia del estudiante para esa categoría; si está deshabilitada
// o no tiene tokens registrados, no hace nada. Los valores de `data` deben
// ser strings (requisito de FCM).
async function enviarPush(uid, categoria, dataExtra = {}) {
  if (!uid) return
  const settingsSnap = await db.collection('notificationSettings').doc(uid).get()
  if (!settingsSnap.exists) return
  const settings = settingsSnap.data()
  const cfg = settings[categoria]
  if (!cfg?.habilitado) return
  const tokens = settings.fcmTokens || []
  if (!tokens.length) return

  const notification = TITULOS[categoria]
  const data = {
    categoria,
    ...Object.fromEntries(Object.entries(dataExtra).map(([k, v]) => [k, String(v)])),
  }
  try {
    await messaging.sendEachForMulticast({ tokens, notification, data })
  } catch (err) {
    logger.error(`enviarPush(${uid}, ${categoria}) falló:`, err.message)
  }
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
// id del documento en `students` — distinto de su uid), así que enviarPush()
// se llama directo con él, sin lookup extra.
// "Entregada" significa cosas distintas según el tipo de actividad:
//   - Entregable/observación: el doc de submission se crea de una sola vez al
//     entregar → onCreate (before === undefined).
//   - Evaluación: el doc se crea al INICIAR el intento (tiempoInicio) y se
//     actualiza al terminar → dispara cuando estadoEvaluacion pasa a
//     'finalizado' (igual criterio que usa el cliente en EvaluacionManager.jsx).
// Idempotente vía notificadoEntregaDocente — una sola vez por submission.
exports.onSubmissionEntregada = onDocumentWritten('submissions/{submissionId}', async (event) => {
  const after = event.data?.after
  if (!after?.exists) return // borrada
  const before = event.data.before?.data() // undefined si es creación
  const afterData = after.data()
  if (afterData.notificadoEntregaDocente) return

  const actSnap = await db.collection('activities').doc(afterData.actividadId).get()
  if (!actSnap.exists) return
  const act = actSnap.data()
  if (!act.notificarDocente) return

  const esEvaluacion = act.tipo === 'evaluacion'
  const seAcabaDeEntregar = esEvaluacion
    ? afterData.estadoEvaluacion === 'finalizado' && before?.estadoEvaluacion !== 'finalizado'
    : !before
  if (!seAcabaDeEntregar) return

  await enviarPush(act.docenteId, 'nuevasEntregas', { actividadId: afterData.actividadId, submissionId: event.params.submissionId })
  await after.ref.update({ notificadoEntregaDocente: true })
})

// ─── 4) Programadas + recordatorios de entrega ─────────────────────────────
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
