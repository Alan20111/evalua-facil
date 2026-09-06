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
import { apiUrl } from './apiBase'

function rehydrateTimestamps(v) {
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
  const res = await fetch(apiUrl('/api/subject/content'), {
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
