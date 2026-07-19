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

// Traduce un error de "Continuar con Google" a lo que hay que mostrar. Devuelve
// { cancelled } cuando el usuario cerró el diálogo (no se muestra nada) y, si no,
// un `message`. En la app se ANEXA el detalle nativo (p. ej. "10:" = falta
// registrar la huella SHA-1 del APK en Firebase; "12500"/"12501" = cancelado o
// mal configurado) para poder diagnosticar desde el celular.
export function googleErrorInfo(err) {
  const code = err?.code || ''
  const rawMsg = err?.message || ''
  const msg = rawMsg.toLowerCase()
  if (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    msg.includes('cancel') ||
    msg.includes('12501')
  ) {
    return { cancelled: true, message: null }
  }
  if (code === 'auth/account-exists-with-different-credential') {
    return { cancelled: false, message: 'Ya tienes una cuenta con este correo. Inicia sesión con tu contraseña.' }
  }
  const detail = IS_NATIVE_APP && rawMsg ? ` (${rawMsg})` : ''
  return { cancelled: false, message: `No se pudo iniciar sesión con Google${detail}` }
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
