import { initializeApp } from 'firebase/app'
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

// App Check (docs/PLAN_GOOGLE_PLAY.md, S3): cada llamada a Firestore, Cloud
// Functions y /api lleva un token que demuestra que viene de esta app y no de
// un script con la clave pública. Con reCAPTCHA Enterprise, que también cubre
// la app de Android porque es un WebView de este mismo sitio.
//
// Solo se enciende si existe la clave del sitio
// (VITE_RECAPTCHA_ENTERPRISE_SITE_KEY, en Vercel): mientras no exista, la app
// se comporta igual que antes. Con los emuladores nunca, porque no la validan.
// En desarrollo contra el proyecto real se usa un token de depuración, que
// Firebase imprime en la consola y se registra en App Check › Apps.
const CLAVE_APP_CHECK = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY
export const appCheck = CLAVE_APP_CHECK && import.meta.env.VITE_EMULADORES !== '1'
  ? (() => {
      if (import.meta.env.DEV) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true
      return initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(CLAVE_APP_CHECK),
        isTokenAutoRefreshEnabled: true,
      })
    })()
  : null
// initializeAuth y no getAuth (rendimiento, oct-2026): getAuth trae el
// resolvedor de popups ya puesto, y ese resolvedor carga al arrancar el
// iframe de autenticación de firebaseapp.com y gapi (~130 KB) en TODAS las
// páginas, aunque nadie vaya a entrar con Google. Misma persistencia que
// getAuth; el resolvedor se pasa solo en las llamadas con popup
// (utils/googleAuth.js).
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
})
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
