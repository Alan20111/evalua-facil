#!/usr/bin/env node

/**
 * Da de alta en `config/iaTarifas` las dos operaciones de Participación en vivo
 * SIN tocar nada más del documento:
 *
 *   · generar_dinamica_vivo  — 6 créditos fijos por generar la dinámica.
 *   · activar_analisis_vivo  — 10 créditos fijos por sesión con análisis en vivo
 *                              (cubre hasta VIVO_CFG.TOPE_ANALISIS = 40 respuestas abiertas).
 *
 * Montos autorizados por Kike. Ambas usan claude-haiku-4-5 (el modelo vigente).
 *
 * Por qué no `seed-ia-tarifas.js`: hace `set()` sin merge y sustituye el documento
 * completo; si el documento vivo difiere del archivo, esa diferencia se pierde (a la fecha
 * de este script el seed trae `planeacion_didactica_inicial` en 40 y el vivo no). Aquí se
 * usa `update()` con TRES rutas de campo (una por mapa), dentro de una transacción, y luego
 * se relee el documento para comprobar que todo lo demás quedó idéntico.
 *
 * Uso:
 *   cd seeds-db && npm install
 *   node agregar-tarifas-participacion-vivo.js             # SIMULACIÓN: solo lee e informa
 *   node agregar-tarifas-participacion-vivo.js --aplicar   # escribe y verifica
 *
 * Por omisión NO escribe: añade precios que se cobran en producción.
 */

const assert = require('node:assert')
const admin = require('firebase-admin')

try {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'evalua-facil-app' })
} catch {
  // ya inicializado
}
const db = admin.firestore()

const NUEVAS = {
  generar_dinamica_vivo: { tarifa: 6, categoria: 'Actividades', modelo: 'claude-haiku-4-5' },
  activar_analisis_vivo: { tarifa: 10, categoria: 'Actividades', modelo: 'claude-haiku-4-5' },
}
const aplicar = process.argv.includes('--aplicar')
const ref = db.doc('config/iaTarifas')

// Copia del documento sin los campos que se agregan, para comparar el resto.
function sinNuevas(data) {
  const copia = JSON.parse(JSON.stringify(data))
  for (const op of Object.keys(NUEVAS)) {
    delete copia.tarifas?.[op]
    delete copia.categorias?.[op]
    delete copia.modeloPorOperacion?.[op]
  }
  return copia
}

async function main() {
  console.log(aplicar ? '— APLICANDO —' : '— SIMULACIÓN (no escribe nada; usa --aplicar para escribir) —')
  const antesSnap = await ref.get()
  if (!antesSnap.exists) throw new Error('config/iaTarifas no existe — no se crea desde aquí')
  const antes = antesSnap.data()
  for (const mapa of ['tarifas', 'modeloPorOperacion']) {
    if (!antes[mapa] || typeof antes[mapa] !== 'object') throw new Error(`config/iaTarifas no tiene el mapa \`${mapa}\``)
  }
  const mapaCategorias = antes.categorias ? 'categorias' : null

  console.log(`config/iaTarifas versión=${antes.version ?? '?'} actualizadoEl=${antes.actualizadoEl ?? '?'}`)
  for (const [op, n] of Object.entries(NUEVAS)) {
    console.log(`  ${op}: tarifa ${antes.tarifas[op] ?? '(ausente)'} → ${n.tarifa}; modelo ${antes.modeloPorOperacion[op] ?? '(ausente)'} → ${n.modelo}`)
  }
  if (!mapaCategorias) console.log('AVISO: el documento no tiene `categorias`; no se escribe categoría.')

  if (Object.entries(NUEVAS).every(([op, n]) => antes.tarifas[op] === n.tarifa && antes.modeloPorOperacion[op] === n.modelo)) {
    console.log('\nYa están dadas de alta. Nada que hacer.')
    return
  }
  if (!aplicar) {
    console.log('\nSimulación terminada. No se escribió nada.')
    return
  }

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const campos = {}
    for (const [op, n] of Object.entries(NUEVAS)) {
      campos[`tarifas.${op}`] = n.tarifa
      campos[`modeloPorOperacion.${op}`] = n.modelo
      if (mapaCategorias) campos[`${mapaCategorias}.${op}`] = n.categoria
    }
    assert.ok(snap.exists)
    tx.update(ref, campos)
  })

  const despues = (await ref.get()).data()
  assert.deepStrictEqual(sinNuevas(despues), sinNuevas(antes), 'Cambió algo más que las operaciones nuevas')
  for (const [op, n] of Object.entries(NUEVAS)) {
    assert.strictEqual(despues.tarifas[op], n.tarifa)
    assert.strictEqual(despues.modeloPorOperacion[op], n.modelo)
  }
  console.log('\nListo. Verificado: el resto del documento quedó idéntico.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
