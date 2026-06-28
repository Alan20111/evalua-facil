import { Timestamp, addDoc, collection, doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { sendWelcomeEmail } from './welcomeEmail'
import { calcTrialEnd } from './subscriptionHelpers'

// Creates the minimal Firestore profile + trial subscription for a brand-new
// docente account (email/password or Google). Profile starts incomplete —
// AuthContext/App.jsx route the teacher to /onboarding until they set their name.
export async function createTeacherAccount(uid, email, photoURL = null) {
  await setDoc(doc(db, 'users', uid), {
    role: 'docente',
    email: email.trim().toLowerCase(),
    photoURL,
    profileComplete: false,
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

  sendWelcomeEmail({ email: email.trim().toLowerCase() }).catch(() => {})
}
