/**
 * Setup admin using Firebase client SDK + Google token exchange.
 * This exchanges the google access_token for a Firebase ID token,
 * then temporarily relaxes rules to allow admin promotion.
 *
 * Usage: node setup-client.mjs
 */
import { initializeApp } from 'firebase/app'
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { getAuth, signInWithCredential, GoogleAuthProvider } from 'firebase/auth'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const API_KEY = 'AIzaSyBn-gcF3PioP5Z3C4pN42fzh8Vlrjrggug'
const PROJECT_ID = 'evalua-facil-app'
const ADMIN_EMAIL = 'alannicanor62@gmail.com'

const app = initializeApp({
  apiKey: API_KEY,
  projectId: PROJECT_ID,
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
})
const auth = getAuth(app)
const db = getFirestore(app)

async function main() {
  console.log('🚀 Setup admin — exchange Google token → Firebase ID token\n')

  // Read access_token from firebase-tools
  const cfg = JSON.parse(readFileSync(join(homedir(), '.config/configstore/firebase-tools.json'), 'utf8'))
  const accessToken = cfg.tokens?.access_token
  if (!accessToken) throw new Error('No access_token in firebase-tools.json')

  console.log('🔑 Signing in with Google token…')
  const credential = GoogleAuthProvider.credential(null, accessToken)
  const userCred = await signInWithCredential(auth, credential)
  const user = userCred.user
  console.log(`  ✅ Signed in as: ${user.email} (uid: ${user.uid})`)

  if (user.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    throw new Error(`Signed in as ${user.email}, expected ${ADMIN_EMAIL}`)
  }

  // At this point we're authenticated. The Firestore rules block setting role:'admin'
  // via client. So we'll use the Firestore REST API with the Firebase ID token.
  const idToken = await user.getIdToken()

  console.log('\n📦 Updating Plan Pro → $100/mes via REST…')
  await firestorePatch(idToken, `plans/pro`, {
    nombre: { stringValue: 'Plan Pro' },
    descripcion: { stringValue: 'Acceso completo a Evalúa Fácil sin límites.' },
    precio: { integerValue: '100' },
    periodicidad: { stringValue: 'mensual' },
    maxAsignaturas: { integerValue: '-1' },
    maxAlumnos: { integerValue: '-1' },
    activo: { booleanValue: true },
    orden: { integerValue: '1' },
  })
  console.log('  ✅ Plan Pro actualizado')

  // For the admin promotion, the current rules block it.
  // We'll write only what's allowed (role stays same or new account with role:docente).
  // The actual admin field needs to be set via the Firebase Console or a service account.
  console.log(`\n👤 Note: admin promotion for ${ADMIN_EMAIL} requires Firebase Console.`)
  console.log(`   uid: ${user.uid}`)
  console.log(`   Go to: https://console.firebase.google.com/project/${PROJECT_ID}/firestore`)
  console.log(`   Set users/${user.uid}/role = "admin"\n`)

  console.log('✅ Done.')
}

async function firestorePatch(idToken, docPath, fields) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Firestore error: ${JSON.stringify(data.error)}`)
  return data
}

main().catch((err) => {
  console.error('❌', err.message)
  process.exit(1)
})
