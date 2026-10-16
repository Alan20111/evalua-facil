// F-09 (2026-09-06) — Helpers para leer colecciones protegidas desde el
// servidor. Reemplazan los getDocs/onSnapshot directos en pantallas de
// alumno después de que las reglas de Firestore dejaron de permitir lectura
// abierta a cualquier autenticado en activities/resources/materials/avisos/
// academicEvents/horarioBloques.
//
// El servidor verifica la inscripción real del alumno antes de entregar
// datos. Los Timestamps del Admin SDK llegan como { seconds, nanoseconds };
// rehydrateTimestamps() los envuelve con .toDate() para que el código
// existente que llama a ts.toDate() siga funcionando sin cambios.

import { auth } from '../firebase'
import { fetchApi } from './apiBase'

export function rehydrateTimestamps(v) {
  if (!v || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(rehydrateTimestamps)
  const keys = Object.keys(v)
  // Detectar { seconds: number, nanoseconds: number } (Timestamp serializado)
  if (
    keys.length === 2 &&
    keys.includes('seconds') && typeof v.seconds === 'number' &&
    keys.includes('nanoseconds') && typeof v.nanoseconds === 'number'
  ) {
    return { seconds: v.seconds, nanoseconds: v.nanoseconds, toDate: () => new Date(v.seconds * 1000 + v.nanoseconds / 1e6) }
  }
  const out = {}
  for (const k of keys) out[k] = rehydrateTimestamps(v[k])
  return out
}

async function callContentApi(body) {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('No autenticado')
  const res = await fetchApi('/api/subject/content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || 'Error al cargar el contenido')
  return (json.docs || []).map(rehydrateTimestamps)
}

export async function fetchContent(subjectId, tipo) {
  return callContentApi({ subjectId, tipo })
}

export async function fetchContentBatch(subjectIds, tipo) {
  if (!subjectIds || subjectIds.length === 0) return []
  return callContentApi({ subjectIds, tipo })
}

export async function fetchActivity(activityId) {
  const docs = await callContentApi({ tipo: 'activities', docId: activityId })
  return docs[0] || null
}

// ── Entregas del estudiante (PR 2b-1) ──────────────────────────────────────
// Las entregas, los promedios y —con `respuestas: true`— las respuestas de UNA
// actividad, leídas por el servidor SIN lo que el docente ocultó (la nota se
// quita allá, no en la pantalla). Sustituye a las consultas directas a
// `submissions`. Ver api/_lib/entregasAlumno.js.
//
//   fetchMisEntregas()                          → todas las asignaturas (Dashboard, Agenda)
//   fetchMisEntregas({ asignaturaId })          → una asignatura
//   fetchMisEntregas({ actividadId, respuestas }) → una actividad (+ sus respuestas)
//
// Devuelve { entregas, promedios, respuestas }; los tiempos vienen rehidratados
// igual que en fetchContent. `promedios[asignaturaId]` = { parciales, final }.
export async function fetchMisEntregas({ asignaturaId, actividadId, respuestas } = {}) {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('No autenticado')
  const body = {}
  if (asignaturaId) body.asignaturaId = asignaturaId
  if (actividadId) body.actividadId = actividadId
  if (respuestas) body.respuestas = true
  const res = await fetchApi('/api/student/mis-entregas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || 'No pudimos cargar tus entregas')
  return {
    entregas: (json.entregas || []).map(rehydrateTimestamps),
    promedios: json.promedios || {},
    respuestas: (json.respuestas || []).map(rehydrateTimestamps),
  }
}

// Avisa desde qué versión entra el estudiante (hooks/useClientePing.js). No
// espera ni propaga errores: registrar la versión nunca debe estorbar a nadie.
export async function registrarClienteAlumno({ plataforma, versionName, buildId }) {
  try {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    await fetchApi('/api/student/cliente-ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plataforma, versionName, buildId }),
    })
  } catch { /* sin red o sin sesión: no pasa nada */ }
}
