#!/usr/bin/env node

/**
 * Seed default subscription plans into Firestore.
 * Usage: node seed-plans.js
 *
 * Idempotent: uses fixed document IDs and overwrites with defaults.
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

const DEFAULT_PLANS = [
  {
    id: 'pro',
    nombre: 'Plan Pro',
    descripcion: 'Acceso completo a Evalúa Fácil sin límites de asignaturas ni alumnos.',
    precio: 100,
    periodicidad: 'mensual',
    maxAsignaturas: -1,
    maxAlumnos: -1,
    activo: true,
    orden: 1,
  },
]

async function main() {
  console.log('\n📦 Seeding subscription plans')
  console.log('='.repeat(40))
  console.log(`Project: evalua-facil-app`)
  console.log(`Plans to upsert: ${DEFAULT_PLANS.length}\n`)

  const batch = db.batch()
  const now = admin.firestore.FieldValue.serverTimestamp()

  for (const plan of DEFAULT_PLANS) {
    const { id, ...data } = plan
    const ref = db.collection('plans').doc(id)
    batch.set(ref, { ...data, updatedAt: now, createdAt: now }, { merge: true })
    console.log(`  • ${data.nombre} — $${data.precio}/${data.periodicidad}`)
  }

  await batch.commit()

  console.log('\n✅ Plans seeded successfully.\n')
  await admin.app().delete()
  process.exit(0)
}

main().catch((err) => {
  console.error('\n❌ Error seeding plans:', err.message)
  process.exit(1)
})
