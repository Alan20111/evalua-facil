import {
  collection, query, where, getDocs, doc,
} from 'firebase/firestore'
// Escrituras a través del candado de suscripción vencida (ver ./firestoreGuard.js).
import { deleteDoc, writeBatch } from './firestoreGuard'
import { db, auth } from '../firebase'
import { apiUrl } from './apiBase'

async function fetchSubmissionsForActivities(actIds) {
  if (actIds.length === 0) return []
  const chunks = []
  for (let i = 0; i < actIds.length; i += 30) chunks.push(actIds.slice(i, i + 30))
  const snaps = await Promise.all(
    chunks.map((ids) => getDocs(query(collection(db, 'submissions'), where('actividadId', 'in', ids))))
  )
  return snaps.flatMap((s) => s.docs)
}

// Deletes in writeBatch chunks of ≤500 ops to stay within Firestore limits.
async function batchDeleteDocs(refs) {
  const LIMIT = 490
  for (let i = 0; i < refs.length; i += LIMIT) {
    const batch = writeBatch(db)
    refs.slice(i, i + LIMIT).forEach((r) => batch.delete(r))
    await batch.commit()
  }
}

// A12 · H1 — `resources` y `materials` guardan archivos en Cloudinary
// (url / archivos[]), y borrarlos ahí exige CLOUDINARY_API_KEY/
// CLOUDINARY_API_SECRET, que nunca viven en el cliente (ver
// api/subject/delete-resources.js). Antes esta cascada ni siquiera borraba
// los DOCUMENTOS de `resources` — quedaban huérfanos y legibles para
// siempre — y para `materials` tampoco se limpiaba Cloudinary.
//
// Se llama primero, mientras los documentos todavía existen: es el único
// momento en que el servidor puede leer sus URLs antes de que la cascada del
// cliente borre el resto. Si falla (sin conexión, función caída), se
// registra pero NO bloquea el resto del borrado — mismo criterio que ya
// usaba el `.catch` de `materials` aquí abajo: peor es un botón "Eliminar"
// atorado que unos cuantos archivos huérfanos.
async function deleteSubjectResourcesAndFiles(subjectId) {
  try {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    const res = await fetch(apiUrl('/api/subject/delete-resources'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ subjectId }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      console.warn(`[borrar-asignatura ${subjectId}] resources/materials no se pudieron borrar: ${data.error || res.status}`)
    }
  } catch (err) {
    console.warn(`[borrar-asignatura ${subjectId}] resources/materials no se pudieron borrar: ${err.message}`)
  }
}

// Fully deletes a subject and all related data in cascade:
// resources+materials (server, incl. their Cloudinary files) → activities →
// submissions → students → attendance → horarioBloques → subject doc.
// NOTE: Firebase Auth accounts of students are NOT deleted (same as per-student delete today).
// `docenteId` is required to list `horarioBloques`: its Firestore rule is owner-only
// (unlike activities/students/attendance, which any authenticated user can
// read), so the query must filter by docenteId too or the list itself is denied.
export async function deleteSubjectCascade(subjectId, docenteId) {
  await deleteSubjectResourcesAndFiles(subjectId)

  const [actsSnap, studsSnap, attSnap, bloquesSnap] = await Promise.all([
    getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', subjectId))),
    getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId))),
    getDocs(query(collection(db, 'attendance'), where('asignaturaId', '==', subjectId))),
    getDocs(query(collection(db, 'horarioBloques'), where('docenteId', '==', docenteId), where('asignaturaId', '==', subjectId))),
  ])

  const actIds = actsSnap.docs.map((d) => d.id)
  const subsDocs = await fetchSubmissionsForActivities(actIds)

  const refs = [
    ...subsDocs.map((d) => doc(db, 'submissions', d.id)),
    ...actsSnap.docs.map((d) => doc(db, 'activities', d.id)),
    ...studsSnap.docs.map((d) => doc(db, 'students', d.id)),
    ...attSnap.docs.map((d) => doc(db, 'attendance', d.id)),
    ...bloquesSnap.docs.map((d) => doc(db, 'horarioBloques', d.id)),
  ]
  await batchDeleteDocs(refs)
  await deleteDoc(doc(db, 'subjects', subjectId))
}

// Aquí vivía deleteSubjectSubmissions, que borraba las entregas de toda la
// asignatura al archivarla. Se quitó junto con ese comportamiento: archivar ya
// no borra nada. Borraba el trabajo del estudiante y ni siquiera liberaba el
// espacio que pretendía —los archivos seguían en Cloudinary, solo se destruía
// el documento que apuntaba a ellos— así que no había nada que salvar de ella.

// Deletes the submissions of a single student enrollment (submissions are keyed by the
// per-subject `students` doc id). Call before deleting the student doc to avoid orphans.
export async function deleteSubmissionsByStudent(studentDocId) {
  const snap = await getDocs(query(collection(db, 'submissions'), where('alumnoId', '==', studentDocId)))
  await batchDeleteDocs(snap.docs.map((d) => doc(db, 'submissions', d.id)))
}

// Deletes the submissions of a single activity. Call before deleting the activity doc.
export async function deleteSubmissionsByActivity(activityId) {
  const snap = await getDocs(query(collection(db, 'submissions'), where('actividadId', '==', activityId)))
  await batchDeleteDocs(snap.docs.map((d) => doc(db, 'submissions', d.id)))
}

// Deletes only the students of a subject and their submissions.
// Used in the "start from 0" unarchive flow.
export async function deleteSubjectStudents(subjectId) {
  const [actsSnap, studsSnap] = await Promise.all([
    getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', subjectId))),
    getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId))),
  ])
  const actIds = actsSnap.docs.map((d) => d.id)
  const subsDocs = await fetchSubmissionsForActivities(actIds)

  const refs = [
    ...subsDocs.map((d) => doc(db, 'submissions', d.id)),
    ...studsSnap.docs.map((d) => doc(db, 'students', d.id)),
  ]
  await batchDeleteDocs(refs)
}
