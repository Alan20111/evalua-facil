#!/usr/bin/env node
/**
 * Setup admin account + seed Firestore data using firebase-tools OAuth credentials.
 * Run: node setup-admin-data.js
 */
const admin = require('firebase-admin')
const os = require('os')
const path = require('path')

// Firebase CLI public OAuth credentials
const FIREBASE_CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com'
const FIREBASE_CLI_CLIENT_SECRET = 'j9iVZfS8hhqkLNL0r1IOdia1'

let credential
try {
  const cfg = require(path.join(os.homedir(), '.config/configstore/firebase-tools.json'))
  const tokens = cfg.tokens || {}
  if (tokens.refresh_token) {
    credential = admin.credential.refreshToken({
      type: 'authorized_user',
      client_id: FIREBASE_CLI_CLIENT_ID,
      client_secret: FIREBASE_CLI_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
    })
  }
} catch (_) {}

admin.initializeApp({
  projectId: 'evalua-facil-app',
  ...(credential ? { credential } : {}),
})

const db = admin.firestore()
const auth = admin.auth()
const now = admin.firestore.FieldValue.serverTimestamp()

const ADMIN_EMAIL = 'alannicanor62@gmail.com'

async function getOrCreateFirebaseUser(email) {
  try {
    return await auth.getUserByEmail(email)
  } catch (err) {
    if (err.code === 'auth/user-not-found') return null
    throw err
  }
}

async function makeAdmin(email) {
  console.log(`\n👤 Promoviendo ${email} a admin…`)
  const user = await getOrCreateFirebaseUser(email)
  if (!user) {
    console.log(`  ⚠ No existe cuenta Firebase Auth para ${email}.`)
    console.log(`    Pide al usuario que inicie sesión en la app con Google primero,`)
    console.log(`    luego corre este script de nuevo.`)
    return null
  }
  const ref = db.collection('users').doc(user.uid)
  const snap = await ref.get()
  const existing = snap.exists ? snap.data() : {}
  await ref.set({ ...existing, role: 'admin', email: email.toLowerCase(), updatedAt: now }, { merge: true })
  console.log(`  ✅ Admin listo — uid: ${user.uid}`)
  return user.uid
}

async function seedPlan() {
  console.log('\n📦 Actualizando Plan Pro → $100/mes…')
  await db.collection('plans').doc('pro').set({
    nombre: 'Plan Pro',
    descripcion: 'Acceso completo a Evalúa Fácil sin límites.',
    precio: 100,
    periodicidad: 'mensual',
    maxAsignaturas: -1,
    maxAlumnos: -1,
    activo: true,
    orden: 1,
    updatedAt: now,
    createdAt: now,
  }, { merge: true })
  console.log('  ✅ Plan Pro — $100/mes')
}

async function main() {
  console.log('🚀 Evalúa Fácil — Setup Admin + Datos Demo')
  console.log('='.repeat(45))

  await seedPlan()
  await makeAdmin(ADMIN_EMAIL)

  console.log('\n✅ Listo. Entra a la app con Google (alannicanor62@gmail.com)')
  console.log('   y navega a /Admin para ver el dashboard.\n')

  await admin.app().delete()
  process.exit(0)
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message)
  if (err.message.includes('getaddrinfo') || err.message.includes('ENOTFOUND')) {
    console.error('   Problema de credenciales. Intenta: firebase login --reauth')
  }
  process.exit(1)
})
