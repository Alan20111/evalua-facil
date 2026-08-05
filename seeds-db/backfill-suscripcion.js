#!/usr/bin/env node

/**
 * Respaldo inicial del candado de suscripción.
 *
 * Copia a `users/{docenteId}.suscripcionHasta` la fecha hasta la que cada
 * docente puede TRABAJAR, calculada desde su suscripción. De ahí en adelante lo
 * mantiene al día la Cloud Function `onSuscripcionEscrita`; esto es solo para
 * las cuentas que ya existían cuando se instaló el candado.
 *
 * Las reglas de Firestore dejan pasar a quien NO tenga el campo (un dato
 * faltante no debe dejar a nadie fuera de su propio trabajo), así que hasta que
 * esto corra, el candado del servidor no le aplica a nadie.
 *
 * Uso:
 *   cd seeds-db && npm install
 *   node backfill-suscripcion.js --dry-run   # solo dice qué haría
 *   node backfill-suscripcion.js             # escribe
 *
 * Requiere credenciales del Admin SDK (GOOGLE_APPLICATION_CREDENTIALS o
 * `firebase login` con firebase-cli), igual que el resto de scripts de esta
 * carpeta.
 */

const admin = require('firebase-admin')

try {
  admin.initializeApp({ projectId: 'evalua-facil-app' })
} catch {
  // ya inicializado
}

const db = admin.firestore()
const DIAS_PRUEBA = 30
const SOLO_SIMULAR = process.argv.includes('--dry-run')

// MISMO cálculo que functions/index.js (vigenciaDe) y que
// src/utils/subscriptionHelpers.js (effectiveVencimiento). Si cambia el
// criterio, cambia en los tres: son las tres caras de la misma regla.
function vigenciaDe(sub) {
  if (!sub) return null
  if (sub.status === 'vencida') return new Date(0)
  const inicio = sub.fechaInicio?.toDate?.() || (sub.fechaInicio ? new Date(sub.fechaInicio) : null)
  if (sub.status === 'trial' || !sub.planId) {
    if (!inicio) return null
    const fin = new Date(inicio)
    fin.setDate(fin.getDate() + DIAS_PRUEBA)
    return fin
  }
  if (sub.planId === 'cortesia' && sub.cortesiaIndefinida === true) {
    return new Date('2999-12-31T00:00:00Z')
  }
  const venc = sub.fechaVencimiento?.toDate?.() || (sub.fechaVencimiento ? new Date(sub.fechaVencimiento) : null)
  if (venc) return venc
  if (!inicio) return null
  const fin = new Date(inicio)
  fin.setMonth(fin.getMonth() + 1)
  return fin
}

async function main() {
  const snap = await db.collection('subscriptions').get()
  console.log(`${snap.size} suscripciones${SOLO_SIMULAR ? ' (simulación, no se escribe nada)' : ''}\n`)

  let escritas = 0
  let sinFecha = 0
  let sinDocente = 0

  // Una suscripción por docente, pero si hubiera dos, gana la más reciente
  // (mismo criterio que useSubscription en el cliente).
  const porDocente = new Map()
  snap.docs.forEach((d) => {
    const sub = d.data()
    if (!sub.docenteId) return
    const previa = porDocente.get(sub.docenteId)
    const ms = (s) => s.updatedAt?.toMillis?.() || 0
    if (!previa || ms(sub) > ms(previa)) porDocente.set(sub.docenteId, sub)
  })

  for (const [docenteId, sub] of porDocente) {
    const hasta = vigenciaDe(sub)
    if (!hasta) {
      sinFecha++
      console.log(`  · ${docenteId}: sin fecha calculable (status ${sub.status}, sin fechaInicio) — se deja sin candado`)
      continue
    }
    const ref = db.collection('users').doc(docenteId)
    const usuario = await ref.get()
    if (!usuario.exists) {
      sinDocente++
      continue
    }
    const vigente = hasta.getTime() > Date.now()
    console.log(`  · ${usuario.data().email || docenteId}: hasta ${hasta.toISOString().slice(0, 10)} ${vigente ? '(puede trabajar)' : '(bloqueado)'}`)
    if (!SOLO_SIMULAR) {
      await ref.update({ suscripcionHasta: admin.firestore.Timestamp.fromDate(hasta) })
    }
    escritas++
  }

  console.log(`\n${escritas} docente(s) ${SOLO_SIMULAR ? 'se actualizarían' : 'actualizados'}`)
  if (sinFecha) console.log(`${sinFecha} sin fecha calculable (siguen sin candado)`)
  if (sinDocente) console.log(`${sinDocente} con la cuenta ya eliminada (se omiten)`)
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Falló:', err.message)
  process.exit(1)
})
