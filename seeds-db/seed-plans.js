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
} catch { /* sin firebase-tools.json, sigue sin credential explícito */ }

try {
  admin.initializeApp({ projectId: 'evalua-facil-app', ...(credential ? { credential } : {}) })
} catch { /* ya inicializado */ }

const db = admin.firestore()

// Dos ofertas de "Asistente IA" (id interno `pro`, sin cambiar — para no
// romper ninguna suscripción que ya apunte a ese planId): mensual ($199
// MXN/mes desde la reestructuración de precios del 18-ago-2026 — antes $99;
// ver MONTHLY_PRICE_MXN en subscriptionHelpers.js) y anual ($990 MXN/año —
// pago único, 2 meses de regalo frente a pagar 12 meses sueltos, ver
// ANNUAL_PRICE_MXN). Mantener `precio` en sincronía con
// MONTHLY_PRICE_MXN/ANNUAL_PRICE_MXN en subscriptionHelpers.js. `plans/basico`
// y `plans/mayor` se siembran aparte, en seed-ia-tarifas.js.
const DEFAULT_PLANS = [
  {
    id: 'pro',
    nombre: 'Asistente IA',
    descripcion: 'IA en todas las funciones de Evalúa Fácil, sin límites de asignaturas ni alumnos.',
    precio: 199,
    periodicidad: 'mensual',
    maxAsignaturas: -1,
    maxAlumnos: -1,
    activo: true,
    orden: 2,
  },
  {
    id: 'anual',
    nombre: 'Asistente IA (anual)',
    descripcion: 'IA en todas las funciones de Evalúa Fácil, sin límites de asignaturas ni alumnos — paga 10 meses, disfruta 12.',
    precio: 990,
    periodicidad: 'anual',
    maxAsignaturas: -1,
    maxAlumnos: -1,
    activo: true,
    orden: 2,
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
