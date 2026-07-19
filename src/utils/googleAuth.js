import { doc, getDoc } from 'firebase/firestore'
import { GoogleAuthProvider, signInWithCredential, signInWithPopup } from 'firebase/auth'
import { auth, db } from '../firebase'
import { createTeacherAccount } from './teacherAccount'
import { IS_NATIVE_APP } from './platform'

// "Continuar con Google" — en la web usa el popup de Firebase; en la app nativa
// usa el flujo NATIVO de Google (plugin) y luego autentica el JS SDK con la
// credencial, porque signInWithPopup no funciona dentro del WebView de Capacitor
// (abre una ventana que el WebView no maneja → pantalla en blanco).
export async function signInWithGoogle() {
  if (IS_NATIVE_APP) {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
    const result = await FirebaseAuthentication.signInWithGoogle()
    const credential = GoogleAuthProvider.credential(
      result.credential?.idToken,
      result.credential?.accessToken,
    )
    const cred = await signInWithCredential(auth, credential)
    return cred.user
  }
  const result = await signInWithPopup(auth, new GoogleAuthProvider())
  return result.user
}

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
