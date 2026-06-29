import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { createTeacherAccount } from './teacherAccount'

// Shared by Login's and Register's "Continuar con Google" buttons: signing in
// with Google always lands a teacher in the app, whether or not they've used
// Google before — only create the Firestore profile the first time.
export async function createTeacherAccountIfNew(user) {
  const ref = doc(db, 'users', user.uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await createTeacherAccount(user.uid, user.email, user.photoURL || null, 'google')
  }
}
