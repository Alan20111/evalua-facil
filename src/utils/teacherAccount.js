import { Timestamp, addDoc, collection, doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { sendWelcomeEmail } from './welcomeEmail'
import { calcTrialEnd } from './subscriptionHelpers'

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
export async function createTeacherAccount(uid, email, photoURL = null, provider = 'password', sendEmail = true) {
  await setDoc(doc(db, 'users', uid), {
    role: 'docente',
    email: email.trim().toLowerCase(),
    photoURL,
    profileComplete: false,
    provider,
    hasLocalPassword: provider === 'password',
  })

  const trialStart = new Date()
  const trialEnd = calcTrialEnd(trialStart)
  await addDoc(collection(db, 'subscriptions'), {
    docenteId: uid,
    planId: '',
    status: 'trial',
    fechaInicio: Timestamp.fromDate(trialStart),
    fechaVencimiento: Timestamp.fromDate(trialEnd),
    createdAt: Timestamp.fromDate(trialStart),
    updatedAt: Timestamp.fromDate(trialStart),
  })

  if (sendEmail) sendWelcomeEmail({ email: email.trim().toLowerCase() }).catch(() => {})
}
