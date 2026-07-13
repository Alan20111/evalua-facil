// Cloud Functions — Fase 3 de notificaciones push de Evalúa Fácil.
//
// Tres funciones, cada una respeta la configuración por categoría que el
// estudiante guarda en `notificationSettings/{uid}` (Fase 1):
//   1. onActividadEscrita   — actividad nueva visible para el alumno.
//   2. onSubmissionActualizada — se publicó una calificación.
//   3. revisarProgramados   — programada cada 30 min: actividades cuyo
//      publishAt ya pasó (visibilidad puramente por tiempo, sin escritura de
//      doc) + recordatorios de entrega 24h/2h antes de fechaLimite.
//
// Cada push se envía como mensaje de DATOS (no "notification" payload) — el
// cliente (Fase 4) decide sonido/volumen/repetición/postergación con ese
// payload en vez de dejar que el sistema operativo la muestre directo.

const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { getMessaging } = require('firebase-admin/messaging')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')

initializeApp()
const db = getFirestore()
const messaging = getMessaging()

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
// o no tiene tokens registrados (aún no llegó a la Fase 4), no hace nada.
// Los valores del data payload de FCM deben ser strings.
async function enviarPush(uid, categoria, dataExtra = {}) {
  if (!uid) return
  const settingsSnap = await db.collection('notificationSettings').doc(uid).get()
  if (!settingsSnap.exists) return
  const settings = settingsSnap.data()
  const cfg = settings[categoria]
  if (!cfg?.habilitado) return
  const tokens = settings.fcmTokens || []
  if (!tokens.length) return

  const data = {
    categoria,
    sonido: String(cfg.sonido || 'campana'),
    repetir: String(cfg.repetir || 'una_vez'),
    volumen: String(cfg.volumen ?? 70),
    postergarMinutos: String(cfg.postergarMinutos ?? 5),
    maxPostergaciones: String(cfg.maxPostergaciones ?? 3),
    ...Object.fromEntries(Object.entries(dataExtra).map(([k, v]) => [k, String(v)])),
  }
  try {
    await messaging.sendEachForMulticast({ tokens, data })
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

// ─── 3) Programadas + recordatorios de entrega ─────────────────────────────
// Corre cada 30 min. Ventana de 35 min (> intervalo del scheduler) para no
// perder ninguna actividad entre corridas.
const SCHEDULE_INTERVAL = 'every 30 minutes'
const WINDOW_MS = 35 * 60 * 1000
const TIERS = [
  { id: '24h', ms: 24 * 60 * 60 * 1000 },
  { id: '2h', ms: 2 * 60 * 60 * 1000 },
]

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

  // 3b) Recordatorios de entrega — 24h y 2h antes de fechaLimite, solo a
  // quien no haya entregado todavía. Sin filtro de rango en la query (evita
  // necesitar un índice compuesto nuevo — mismo criterio que el resto de la
  // app): trae todas las actividades y filtra fechaLimite en memoria.
  const todasSnap = await db.collection('activities').get()
  for (const doc of todasSnap.docs) {
    const a = doc.data()
    if (!a.fechaLimite) continue
    const deadline = new Date(a.fechaLimite.includes('T') ? a.fechaLimite : `${a.fechaLimite}T00:00:00`).getTime()
    const msLeft = deadline - now
    if (msLeft <= 0) continue

    for (const tier of TIERS) {
      if (msLeft > tier.ms || msLeft < tier.ms - WINDOW_MS) continue
      const yaEnviados = a.recordatoriosEnviados?.[tier.id] || []

      const [estudiantes, submissionsSnap] = await Promise.all([
        estudiantesDeAsignatura(a.asignaturaId),
        db.collection('submissions').where('actividadId', '==', doc.id).get(),
      ])
      const entregaronIds = new Set(submissionsSnap.docs.map((s) => s.data().alumnoId))
      const pendientes = estudiantes.filter((d) => !entregaronIds.has(d.id) && !yaEnviados.includes(d.id))
      if (!pendientes.length) continue

      await Promise.all(pendientes.map((d) =>
        enviarPush(d.data().uid, 'recordatorios', { actividadId: doc.id, tier: tier.id })
      ))
      await doc.ref.update({
        [`recordatoriosEnviados.${tier.id}`]: [...yaEnviados, ...pendientes.map((d) => d.id)],
      })
    }
  }
})
