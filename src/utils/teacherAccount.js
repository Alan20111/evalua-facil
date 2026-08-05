import { doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { sendWelcomeEmail } from './welcomeEmail'

// Creates the minimal Firestore profile + trial subscription for a brand-new
// docente account (email/password or Google). Profile starts incomplete —
// AuthContext/App.jsx route the teacher to /onboarding until they set their name.
// `provider` + `hasLocalPassword` let "Acceso desde otra computadora"
// (LinkAccountModal) look the account up directly in Firestore instead of
// relying solely on Firebase Auth's fetchSignInMethodsForEmail, which can
// return an empty list under email-enumeration protection and produce a
// false "account doesn't exist" — this is the authoritative Firestore-side
// record of how the account was created and whether it already has a
// password (see ProtectAccount.jsx and ResetPassword.jsx, which set
// hasLocalPassword: true once one is added later).
// `extra` sobrescribe/añade campos al doc inicial — lo usa Register.jsx para
// crear la cuenta ya con `profileComplete: true` y el resto del perfil (paso
// 2, "Cuéntanos quién eres") en una sola escritura, en vez de crear primero
// con profileComplete:false y depender de Onboarding para completarla en un
// segundo paso.
export async function createTeacherAccount(uid, email, photoURL = null, provider = 'password', sendEmail = true, extra = {}) {
  await setDoc(doc(db, 'users', uid), {
    role: 'docente',
    email: email.trim().toLowerCase(),
    photoURL,
    profileComplete: false,
    provider,
    hasLocalPassword: provider === 'password',
    ...extra,
  })

  // La suscripción de prueba NO se crea aquí: la pone la Cloud Function
  // onDocenteCreado en cuanto existe este documento, con fechas del servidor.
  // Dejarla en el navegador obligaba a permitirle al docente crear
  // suscripciones, y con eso podía inventarse una con la fecha de vencimiento
  // que quisiera, o una prueba nueva cada vez que se le acababa la anterior.
  // Mientras la función corre (un instante), el docente no queda bloqueado:
  // sin suscripción, ni el cliente ni las reglas lo tratan como vencido.

  // sendEmail=false en el camino de autorreparación (AuthContext): no es una
  // cuenta nueva, es una existente recuperándose de un doc users/{uid} perdido,
  // así que no se le reenvía el correo de bienvenida.
  if (sendEmail) sendWelcomeEmail({ email: email.trim().toLowerCase() }).catch(() => {})
}
