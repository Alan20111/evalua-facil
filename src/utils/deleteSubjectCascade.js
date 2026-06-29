import {
  collection, query, where, getDocs, deleteDoc, doc, writeBatch,
} from 'firebase/firestore'
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
// activities → submissions → materials → students → subject doc.
// NOTE: Firebase Auth accounts of students are NOT deleted (same as per-student delete today).
export async function deleteSubjectCascade(subjectId) {
  const [actsSnap, studsSnap, matsSnap] = await Promise.all([
    getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', subjectId))),
    getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId))),
    getDocs(query(collection(db, 'materials'), where('asignaturaId', '==', subjectId))),
  ])

  const actIds = actsSnap.docs.map((d) => d.id)
  const subsDocs = await fetchSubmissionsForActivities(actIds)

  const refs = [
    ...subsDocs.map((d) => doc(db, 'submissions', d.id)),
    ...actsSnap.docs.map((d) => doc(db, 'activities', d.id)),
    ...matsSnap.docs.map((d) => doc(db, 'materials', d.id)),
    ...studsSnap.docs.map((d) => doc(db, 'students', d.id)),
  ]
  await batchDeleteDocs(refs)
  await deleteDoc(doc(db, 'subjects', subjectId))
}

// Deletes ONLY the submissions of a subject, keeping activities + students.
// Used when archiving: the archived subject keeps the course "skeleton" but not
// the entregas (which are optionally exported as a ZIP first).
export async function deleteSubjectSubmissions(subjectId) {
  const actsSnap = await getDocs(
    query(collection(db, 'activities'), where('asignaturaId', '==', subjectId))
  )
  const subsDocs = await fetchSubmissionsForActivities(actsSnap.docs.map((d) => d.id))
  await batchDeleteDocs(subsDocs.map((d) => doc(db, 'submissions', d.id)))
}

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
