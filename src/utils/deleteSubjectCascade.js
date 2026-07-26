import {
  collection, query, where, getDocs, doc,
} from 'firebase/firestore'
// Escrituras a través del candado de suscripción vencida (ver ./firestoreGuard.js).
import { deleteDoc, writeBatch } from './firestoreGuard'
import { db } from '../firebase'

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

// Fully deletes a subject and all related data in cascade:
// activities → submissions → materials → students → attendance → subject doc.
// NOTE: Firebase Auth accounts of students are NOT deleted (same as per-student delete today).
export async function deleteSubjectCascade(subjectId) {
  // `materials` is fetched separately, with its rejection swallowed: if its
  // Firestore rules aren't deployed yet, getDocs() rejects with
  // permission-denied — that must never block deleting the subject itself
  // (it would have, via this same Promise.all). Worst case, a few orphaned
  // `materials` docs are left behind instead of a stuck "Eliminar" button.
  const [actsSnap, studsSnap, attSnap] = await Promise.all([
    getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', subjectId))),
    getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId))),
    getDocs(query(collection(db, 'attendance'), where('asignaturaId', '==', subjectId))),
  ])
  const matsSnap = await getDocs(query(collection(db, 'materials'), where('asignaturaId', '==', subjectId))).catch(() => ({ docs: [] }))

  const actIds = actsSnap.docs.map((d) => d.id)
  const subsDocs = await fetchSubmissionsForActivities(actIds)

  const refs = [
    ...subsDocs.map((d) => doc(db, 'submissions', d.id)),
    ...actsSnap.docs.map((d) => doc(db, 'activities', d.id)),
    ...matsSnap.docs.map((d) => doc(db, 'materials', d.id)),
    ...studsSnap.docs.map((d) => doc(db, 'students', d.id)),
    ...attSnap.docs.map((d) => doc(db, 'attendance', d.id)),
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
