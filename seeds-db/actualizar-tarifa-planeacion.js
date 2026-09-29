#!/usr/bin/env node

/**
 * Pone `config/iaTarifas.tarifas.planeacion_didactica_inicial` en 40 créditos
 * ($40 MXN) SIN tocar nada más del documento (29-sep-2026).
 *
 * Por qué no `seed-ia-tarifas.js`: ese seed hace `set()` sin merge y
 * sustituye el documento completo — cualquier valor vivo que difiera del
 * archivo se perdería. Aquí se usa `update()` con la ruta de UN campo, dentro
 * de una transacción, y después se relee el documento para comprobar que
 * todo lo demás (otras tarifas, categorías, modelos, paquetes, versión…)
 * quedó exactamente igual.
 *
 * Uso:
 *   cd seeds-db && npm install
 *   node actualizar-tarifa-planeacion.js             # SIMULACIÓN: solo lee e informa
 *   node actualizar-tarifa-planeacion.js --aplicar   # escribe el campo y verifica
 *
 * Por omisión NO escribe (al revés que los seeds, que escriben salvo
 * --dry-run): cambia un precio que se cobra en producción.
 *
 * Requiere credenciales del Admin SDK (GOOGLE_APPLICATION_CREDENTIALS o
 * `firebase login`), igual que el resto de scripts de esta carpeta.
 */

const assert = require('node:assert')
const admin = require('firebase-admin')

try {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'evalua-facil-app' })
} catch {
  // ya inicializado
}
const db = admin.firestore()

const OPERACION = 'planeacion_didactica_inicial'
const TARIFA_NUEVA = 40
const aplicar = process.argv.includes('--aplicar')
const ref = db.doc('config/iaTarifas')

// Copia del documento sin el campo que se cambia, para comparar el resto.
function sinCampo(data) {
  const copia = JSON.parse(JSON.stringify(data))
  delete copia.tarifas[OPERACION]
  return copia
}

// Diferencias entre las tarifas vivas y las del seed (solo informativo: este
// script NO las corrige, solo las enseña para que nadie corra el seed a
// ciegas encima de ellas).
function diferenciasConSeed(tarifasVivas) {
  let seed
  try {
    seed = require('./seed-ia-tarifas.js').TARIFAS.tarifas
  } catch {
    return null
  }
  const claves = new Set([...Object.keys(tarifasVivas), ...Object.keys(seed)])
  return [...claves].sort()
    .filter((k) => k !== OPERACION && tarifasVivas[k] !== seed[k])
    .map((k) => `${k}: vivo=${tarifasVivas[k] ?? '(ausente)'} seed=${seed[k] ?? '(ausente)'}`)
}

async function main() {
  console.log(aplicar ? '— APLICANDO —' : '— SIMULACIÓN (no escribe nada; usa --aplicar para escribir) —')

  const antesSnap = await ref.get()
  if (!antesSnap.exists) throw new Error('config/iaTarifas no existe — no se crea desde aquí')
  const antes = antesSnap.data()
  if (!antes.tarifas || typeof antes.tarifas !== 'object') throw new Error('config/iaTarifas no tiene el mapa `tarifas`')

  console.log(`config/iaTarifas versión=${antes.version ?? '?'} actualizadoEl=${antes.actualizadoEl ?? '?'}`)
  console.log('Tarifas vivas:')
  for (const [op, cr] of Object.entries(antes.tarifas).sort()) console.log(`  ${op.padEnd(40)}${cr}`)
  console.log(`\n${OPERACION}: ${antes.tarifas[OPERACION] ?? '(ausente)'} → ${TARIFA_NUEVA}`)

  const difs = diferenciasConSeed(antes.tarifas)
  if (difs?.length) {
    console.log(`\nAVISO: ${difs.length} tarifa(s) viva(s) distintas de seed-ia-tarifas.js (NO se tocan):`)
    for (const d of difs) console.log(`  ${d}`)
  }

  if (antes.tarifas[OPERACION] === TARIFA_NUEVA) {
    console.log('\nYa está en 40. Nada que hacer.')
    return
  }
  if (!aplicar) {
    console.log('\nSimulación terminada. No se escribió nada.')
    return
  }

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new Error('config/iaTarifas desapareció')
    // Ruta de campo: `update` solo toca esta clave del mapa `tarifas`.
    tx.update(ref, new admin.firestore.FieldPath('tarifas', OPERACION), TARIFA_NUEVA)
  })

  const despues = (await ref.get()).data()
  assert.strictEqual(despues.tarifas[OPERACION], TARIFA_NUEVA, `${OPERACION} no quedó en ${TARIFA_NUEVA}`)
  assert.deepStrictEqual(sinCampo(despues), sinCampo(antes), 'el resto del documento cambió')
  console.log(`\nVerificado: ${OPERACION} = ${despues.tarifas[OPERACION]}; el resto del documento está idéntico.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERROR:', e.message || e); process.exit(1) })
