#!/usr/bin/env node

/**
 * Promote an existing user to admin or create a new admin account.
 *
 * Usage:
 *   node create-admin.js --email admin@ejemplo.com
 *   node create-admin.js --email admin@ejemplo.com --create --password MiClave123
 */

const admin = require('firebase-admin')
const os = require('os')
const path = require('path')

let credential
try {
  const firebaseCfg = require(path.join(os.homedir(), '.config/configstore/firebase-tools.json'))
  if (firebaseCfg.tokens) credential = admin.credential.refreshToken(firebaseCfg.tokens)
} catch (_) {}

try {
  admin.initializeApp({ projectId: 'evalua-facil-app', ...(credential ? { credential } : {}) })
} catch (_) {}

const db = admin.firestore()
const auth = admin.auth()

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--email') args.email = argv[++i]
    else if (arg === '--password') args.password = argv[++i]
    else if (arg === '--create') args.create = true
    else if (arg === '--help' || arg === '-h') args.help = true
  }
  return args
}

function printUsage() {
  console.log(`
Usage:
  node create-admin.js --email <correo>
  node create-admin.js --email <correo> --create --password <clave>

Options:
  --email      Correo del usuario a promover o crear (requerido)
  --create     Crear cuenta nueva si no existe en Firebase Auth
  --password   Contraseña para cuenta nueva (requerida con --create)
  --help       Mostrar esta ayuda
`)
}

async function promoteToAdmin(uid, email, existingData = {}) {
  const ref = db.collection('users').doc(uid)
  await ref.set(
    {
      ...existingData,
      role: 'admin',
      email: email.trim().toLowerCase(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  )
}

async function main() {
  const args = parseArgs(process.argv)

  if (args.help || !args.email) {
    printUsage()
    process.exit(args.help ? 0 : 1)
  }

  const email = args.email.trim().toLowerCase()
  console.log('\n👤 Admin account setup')
  console.log('='.repeat(40))
  console.log(`Email: ${email}\n`)

  let userRecord
  try {
    userRecord = await auth.getUserByEmail(email)
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
  }

  if (userRecord) {
    const snap = await db.collection('users').doc(userRecord.uid).get()
    const existing = snap.exists() ? snap.data() : {}

    if (existing.role === 'admin') {
      console.log(`✓ ${email} ya es administrador (uid: ${userRecord.uid}).\n`)
      await admin.app().delete()
      process.exit(0)
    }

    await promoteToAdmin(userRecord.uid, email, existing)
    console.log(`✅ Usuario existente promovido a admin (uid: ${userRecord.uid}).\n`)
    await admin.app().delete()
    process.exit(0)
  }

  if (!args.create) {
    console.error(`❌ No existe cuenta con ${email}.`)
    console.error('   Usa --create --password <clave> para crear una cuenta admin nueva.\n')
    process.exit(1)
  }

  if (!args.password || args.password.length < 6) {
    console.error('❌ Con --create debes indicar --password con al menos 6 caracteres.\n')
    process.exit(1)
  }

  const created = await auth.createUser({
    email,
    password: args.password,
    emailVerified: true,
  })

  await promoteToAdmin(created.uid, email, { photoURL: null })
  console.log(`✅ Cuenta admin creada (uid: ${created.uid}).\n`)
  await admin.app().delete()
  process.exit(0)
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message)
  process.exit(1)
})
