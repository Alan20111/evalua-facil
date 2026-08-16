import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
// Cloud Functions invocables (región por omisión us-central1, igual que las
// desplegadas). Hoy solo las usa el sistema de créditos IA.
export const functions = getFunctions(app)

// SOLO desarrollo local: `npm run dev:emuladores` apunta la app a los
// emuladores (revisión visual y E2E sin tocar producción). En producción la
// variable no existe y este bloque no hace nada.
if (import.meta.env.VITE_EMULADORES === '1') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}

// Spanish for the email content and for Firebase's own hosted action-handler
// page (e.g. password reset) — its Action URL lives in Firebase Console >
// Authentication > Templates, outside this repo, so this is the only lever
// over its language available from the code.
auth.languageCode = 'es-MX'

export default app
