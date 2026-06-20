import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'

// A student account (one Firebase Auth uid) can be enrolled in several subjects.
// Each enrollment is a separate `students` doc sharing the same `uid`, one per subject.
// These helpers resolve those docs so every student page uses the RIGHT record for the
// subject it's showing (submissions are keyed by the per-subject student doc id).

// Returns ALL enrollment docs for the signed-in account (one per subject).
export async function getEnrollments(currentUser, userProfile) {
  // Primary: by auth uid (set on every activated student doc).
  if (currentUser?.uid) {
    const snap = await getDocs(query(collection(db, 'students'), where('uid', '==', currentUser.uid)))
    if (!snap.empty) return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  }
  // Fallback: the single student doc referenced by the profile.
  if (userProfile?.studentId) {
    const s = await getDoc(doc(db, 'students', userProfile.studentId))
    if (s.exists()) return [{ id: s.id, ...s.data() }]
  }
  // Last resort: by username parsed from the fake email (legacy accounts).
  if (currentUser?.email) {
    const username = currentUser.email.split('@')[0].split('.')[0].toUpperCase()
    const snap = await getDocs(query(collection(db, 'students'), where('username', '==', username)))
    if (!snap.empty) return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  }
  return []
}

// Returns the enrollment doc for a specific subject, or null if not enrolled.
export async function getEnrollmentForSubject(currentUser, userProfile, asignaturaId) {
  const all = await getEnrollments(currentUser, userProfile)
  return all.find((s) => s.asignaturaId === asignaturaId) || null
}
