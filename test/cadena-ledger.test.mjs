// Cadena de saldos del ledger — pruebas contra el emulador de Firestore (nov-2026).
//
//   firebase emulators:exec --only firestore,auth --project demo-test \
//     "node test/cadena-ledger.test.mjs"
//
// Regla que se comprueba después de CADA escenario, con la cuenta completa:
//   saldo nuevo = saldo anterior − gasto + abono, fila por fila en el orden de
//   `secuencia`; el número de orden no tiene huecos ni repetidos; la última fila
//   es el saldo real; cada consumo aparece una sola vez; lo cobrado suma
//   consumidoTotal y el desglose por categoría suma lo mismo.

import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import { db, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'

const require = createRequire(import.meta.url)
const L = require('../functions/creditosLedger.js')
const { Timestamp } = require('firebase-admin/firestore')

// Cada escenario usa su propia cuenta (borrar el emulador entre casos compite con
// las escrituras siguientes).
let U = 'docente_cadena'
let n = 0
const clave = () => crypto.randomUUID()
const r2 = (n) => Math.round(n * 100) / 100
const TARIFAS = {
  version: 1,
  tarifas: { aviso: 1, rubrica: 4, lote: 10, juego: 6 },
  categorias: { aviso: 'Avisos', rubrica: 'Actividades', lote: 'Calificación con IA', juego: 'Juegos' },
}

async function preparar(saldo = 0) {
  U = `docente_cadena_${++n}`
  await db.doc('config/iaTarifas').set(TARIFAS)
  await db.doc(`iaCreditos/${U}`).set({ saldo, consumidoTotal: 0, consumoPorCategoria: {} })
}

// Comprueba la cuenta completa y devuelve sus movimientos en orden.
async function verificarCadena({ saldoInicial = 0, uid = U } = {}) {
  const cr = (await db.doc(`iaCreditos/${uid}`).get()).data()
  const movs = (await db.collection('iaMovimientos').where('uid', '==', uid).get()).docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.secuencia - b.secuencia)
  let anterior = saldoInicial
  movs.forEach((m, i) => {
    assert.strictEqual(m.secuencia, i + 1, `secuencia sin huecos ni repetidos (fila ${m.id})`)
    assert.strictEqual(r2(m.saldoAntes), r2(anterior), `${m.id}: saldoAntes = saldo de la fila anterior`)
    assert.strictEqual(r2(m.saldoAntes + m.delta), r2(m.saldoDespues), `${m.id}: saldoAntes + delta = saldoDespues`)
    anterior = m.saldoDespues
  })
  assert.strictEqual(r2(anterior), r2(cr.saldo), 'la última fila es el saldo real')
  assert.strictEqual(cr.secuenciaMovimientos || 0, movs.length, 'el contador coincide con las filas')
  const consumos = (await db.collection('iaConsumos').where('uid', '==', uid).get()).docs.map((d) => ({ id: d.id, ...d.data() }))
  const cobrado = r2(consumos.filter((c) => c.estado === 'ejecutado').reduce((s, c) => s + c.creditosReales, 0))
  assert.strictEqual(r2(cr.consumidoTotal || 0), cobrado, 'consumidoTotal = lo cobrado')
  assert.strictEqual(r2(Object.values(cr.consumoPorCategoria || {}).reduce((s, v) => s + v, 0)), cobrado, 'categorías = lo cobrado')
  for (const c of consumos) {
    const filas = movs.filter((m) => m.id === c.id || m.consumoId === c.id)
    assert.ok(filas.filter((m) => m.id === c.id).length === 1, `el consumo ${c.id} tiene una sola fila`)
    const neto = r2(filas.reduce((s, m) => s + m.delta, 0))
    const esperado = c.estado === 'ejecutado' ? -c.creditosReales : c.estado === 'reservado' ? -c.creditosReservados : 0
    assert.strictEqual(neto, r2(esperado), `${c.id} (${c.estado}): sus filas suman lo cobrado`)
  }
  return movs
}

const reservar = (k, op = 'aviso', extra = {}) => L.reservar({ uid: U, operacion: op, idempotencyKey: k, tarifas: TARIFAS, ...extra })

// ═════════════════════════════════════════════════════════════════════════════
grupo('Cadena de saldos — cada ruta del ledger')

await caso('compra: abono con saldo antes y después, secuencia 1', async () => {
  await limpiar()
  await preparar(0)
  await db.doc('creditPurchases/p1').set({ docenteId: U, creditos: 100, status: 'pendiente' })
  await L.acreditarCompraCreditos({ purchaseId: 'p1', adminUid: 'adm' })
  await L.acreditarCompraCreditos({ purchaseId: 'p1', adminUid: 'adm' }) // doble aprobación: no duplica
  const movs = await verificarCadena()
  assert.deepStrictEqual(movs.map((m) => [m.tipo, m.delta, m.saldoAntes, m.saldoDespues]), [['compra', 100, 0, 100]])
})

await caso('consumo normal (nada en medio): una sola fila, en su lugar, con lo real', async () => {
  await preparar(20)
  const k = clave()
  await reservar(k, 'lote')
  await L.liquidar({ uid: U, idempotencyKey: k, creditosReales: 7.5 })
  await L.liquidar({ uid: U, idempotencyKey: k, creditosReales: 7.5 }) // reintento: no duplica
  const movs = await verificarCadena({ saldoInicial: 20 })
  assert.deepStrictEqual(movs.map((m) => [m.id === k, m.delta, m.saldoAntes, m.saldoDespues, m.estado]), [[true, -7.5, 20, 12.5, 'aplicado']])
})

await caso('fallo (nada en medio): la fila queda en 0, sin cobro, y el saldo vuelve', async () => {
  await preparar(10)
  const k = clave()
  await reservar(k, 'rubrica')
  await L.reembolsar({ uid: U, idempotencyKey: k, motivo: 'error', estadoFinal: 'fallido' })
  await L.reembolsar({ uid: U, idempotencyKey: k, motivo: 'error', estadoFinal: 'fallido' })
  const movs = await verificarCadena({ saldoInicial: 10 })
  assert.deepStrictEqual(movs.map((m) => [m.delta, m.saldoAntes, m.saldoDespues, m.estado, m.motivoCodigo]), [[0, 10, 10, 'sin_cobro', 'fallido']], JSON.stringify(movs.map((m) => [m.delta, m.saldoAntes, m.saldoDespues, m.estado, m.motivoCodigo])))
})

await caso('operaciones cruzadas: la reserva se queda y lo no usado vuelve en su fila', async () => {
  await preparar(100)
  const a = clave()
  const b = clave()
  await reservar(a, 'lote') // 100 → 90
  await reservar(b, 'rubrica') // 90 → 86
  await L.liquidar({ uid: U, idempotencyKey: b, creditosReales: 4 }) // en su lugar
  await L.liquidar({ uid: U, idempotencyKey: a, creditosReales: 6 }) // devuelve 4 aparte
  const movs = await verificarCadena({ saldoInicial: 100 })
  assert.deepStrictEqual(movs.map((m) => [m.tipo, m.delta, m.saldoDespues]), [['consumo', -10, 90], ['consumo', -4, 86], ['devolucion', 4, 90]])
  assert.strictEqual(movs[0].devolucionAparte, true)
  assert.strictEqual(movs[0].estado, 'aplicado')
  assert.strictEqual(movs[2].consumoId, a)
  assert.strictEqual((await db.doc(`iaCreditos/${U}`).get()).data().consumidoTotal, 10)
})

await caso('fallo con otra operación en medio: devolución total en su fila', async () => {
  await preparar(30)
  const a = clave()
  await reservar(a, 'juego') // 30 → 24
  await L.ajustarSaldoManual({ uid: U, delta: 5, motivo: 'prueba', adminUid: 'adm' }) // 24 → 29
  await L.reembolsar({ uid: U, idempotencyKey: a, motivo: 'x', estadoFinal: 'cancelado' }) // +6 aparte
  const movs = await verificarCadena({ saldoInicial: 30 })
  assert.deepStrictEqual(movs.map((m) => [m.tipo, m.delta, m.saldoDespues]), [['consumo', -6, 24], ['ajuste', 5, 29], ['devolucion', 6, 35]])
  assert.strictEqual(movs[0].estado, 'sin_cobro')
  assert.strictEqual(movs[0].motivoCodigo, 'cancelado')
})

await caso('reserva expirada (limpieza de huérfanas) con algo en medio', async () => {
  await preparar(15)
  const a = clave()
  await reservar(a, 'rubrica', { ahora: new Date(Date.now() - 60 * 60 * 1000) }) // 15 → 11
  const b = clave()
  await reservar(b, 'aviso') // 11 → 10
  await L.liquidar({ uid: U, idempotencyKey: b, creditosReales: 1 })
  const r = await L.limpiarReservasHuerfanas({ minutos: 15 })
  assert.strictEqual(r.recuperadas, 1)
  const movs = await verificarCadena({ saldoInicial: 15 })
  assert.deepStrictEqual(movs.map((m) => [m.tipo, m.delta, m.saldoDespues]), [['consumo', -4, 11], ['consumo', -1, 10], ['devolucion', 4, 14]])
})

await caso('bienvenida y ajustes (positivo, negativo y recortado a cero)', async () => {
  U = `docente_cadena_${++n}`
  await db.doc(`iaTrialRegistro/${U}`).set({ uid: U, bienvenidaDisponible: true, bienvenidaActivada: false })
  await L.activarCreditosBienvenida({ uid: U })
  await L.activarCreditosBienvenida({ uid: U }) // doble clic: no duplica
  const B = L.CREDITOS_BIENVENIDA
  await L.ajustarSaldoManual({ uid: U, delta: -20, motivo: 'x', adminUid: 'adm' })
  await L.ajustarSaldoManual({ uid: U, delta: -500, motivo: 'x', adminUid: 'adm' }) // se recorta a 0
  const movs = await verificarCadena()
  assert.deepStrictEqual(movs.map((m) => [m.tipo, m.delta, m.saldoDespues]), [['bienvenida', B, B], ['ajuste', -20, B - 20], ['ajuste', -(B - 20), 0]], JSON.stringify(movs.map((m) => [m.tipo, m.delta, m.saldoDespues])))
})

await caso('reserva abierta ANTES de la numeración (sin secuenciaReserva): cierre por fila aparte', async () => {
  await preparar(0)
  const k = clave()
  // Así quedó en producción una reserva hecha por la versión anterior.
  await db.doc(`iaCreditos/${U}`).set({ saldo: 12, consumidoTotal: 0, consumoPorCategoria: {} })
  await db.doc(`iaConsumos/${k}`).set({ uid: U, operacion: 'lote', categoria: 'Calificación con IA', creditosReservados: 8, estado: 'reservado', createdAt: Timestamp.now() })
  await db.doc(`iaMovimientos/${k}`).set({ uid: U, tipo: 'consumo', operacion: 'lote', delta: -8, saldoDespues: 12, estado: 'en_proceso', fecha: Timestamp.now(), periodo: '2026-11', origen: 'ledger' })
  await L.liquidar({ uid: U, idempotencyKey: k, creditosReales: 5 })
  const fila = (await db.doc(`iaMovimientos/${k}`).get()).data()
  assert.deepStrictEqual([fila.delta, fila.saldoDespues, fila.estado, fila.devolucionAparte], [-8, 12, 'aplicado', true], 'la fila vieja no se reescribe')
  const dev = (await db.doc(`iaMovimientos/${k}_devolucion`).get()).data()
  assert.deepStrictEqual([dev.delta, dev.saldoAntes, dev.saldoDespues, dev.secuencia], [3, 12, 15, 1])
  assert.strictEqual((await db.doc(`iaCreditos/${U}`).get()).data().saldo, 15)
})

await caso('validación: un movimiento que no cuadra se rechaza', async () => {
  assert.throws(() => L.validarMovimiento({ saldoAntes: 10, delta: -3, saldoDespues: 8 }), /inconsistente/i)
  assert.throws(() => L.validarMovimiento({ saldoAntes: 1, delta: -3, saldoDespues: -2 }), /inconsistente/i, 'nunca negativo')
  assert.throws(() => L.validarMovimiento({ saldoAntes: NaN, delta: 1, saldoDespues: 1 }), /inconsistente/i)
  L.validarMovimiento({ saldoAntes: 0.1, delta: 0.2, saldoDespues: 0.3 }) // redondeo a centavos
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Concurrencia — muchas operaciones a la vez')

// El emulador bloquea el documento mientras dura cada transacción y, con decenas
// a la vez sobre la misma cuenta, aborta algunas por tiempo («Transaction lock
// timeout»); Firestore real las reintenta. Una transacción abortada no escribe
// NADA, así que la cadena tiene que cuadrar igual con las que sí pasaron.
const abortada = (x) => x.status === 'rejected' && /ABORTED|contention|lock timeout/i.test(x.reason?.message || '')

await caso('40 operaciones cruzadas, en oleadas de 5 simultáneas (cobros, fallos, devoluciones, ajustes y compras): la cadena cuadra', async () => {
  await preparar(500)
  const tareas = []
  for (let i = 0; i < 30; i++) {
    const k = clave()
    const op = ['aviso', 'rubrica', 'lote', 'juego'][i % 4]
    tareas.push(async () => {
      await reservar(k, op)
      if (i % 5 === 0) return L.reembolsar({ uid: U, idempotencyKey: k, motivo: 'x', estadoFinal: 'fallido' })
      const reservado = TARIFAS.tarifas[op]
      return L.liquidar({ uid: U, idempotencyKey: k, creditosReales: i % 3 === 0 ? r2(reservado / 2) : reservado })
    })
  }
  for (let i = 0; i < 5; i++) tareas.splice(i * 7, 0, () => L.ajustarSaldoManual({ uid: U, delta: i % 2 ? 3 : -2, motivo: 'x', adminUid: 'adm' }))
  for (let i = 0; i < 5; i++) {
    tareas.splice(i * 7 + 3, 0, () => db.doc(`creditPurchases/${U}_c${i}`).set({ docenteId: U, creditos: 10, status: 'pendiente' })
      .then(() => L.acreditarCompraCreditos({ purchaseId: `${U}_c${i}`, adminUid: 'adm' })))
  }
  // Oleadas de 5 a la vez: dentro de cada una las reservas y liquidaciones se
  // cruzan de verdad (devoluciones aparte), sin saturar el emulador.
  const r = []
  for (let i = 0; i < tareas.length; i += 5) r.push(...await Promise.allSettled(tareas.slice(i, i + 5).map((t) => t())))
  const otrosErrores = r.filter((x) => x.status === 'rejected' && !abortada(x)).map((x) => x.reason?.message)
  assert.deepStrictEqual(otrosErrores, [], 'solo se aceptan transacciones abortadas por el emulador')
  const movs = await verificarCadena({ saldoInicial: 500 })
  assert.ok(movs.length >= 30, `filas: ${movs.length} (abortadas: ${r.filter(abortada).length})`)
  const aparte = movs.filter((m) => m.tipo === 'devolucion').length
  console.log(`      ${movs.length} filas (${aparte} devoluciones aparte), ${r.filter(abortada).length} transacciones abortadas por el emulador`)
})

await caso('reintentos simultáneos de la misma operación: un solo cobro, una sola fila', async () => {
  await preparar(50)
  const k = clave()
  await Promise.allSettled([1, 2, 3, 4].map(() => reservar(k, 'rubrica')))
  await Promise.allSettled([1, 2, 3].map(() => L.liquidar({ uid: U, idempotencyKey: k, creditosReales: 4 })))
  const movs = await verificarCadena({ saldoInicial: 50 })
  assert.strictEqual(movs.length, 1)
  assert.strictEqual((await db.doc(`iaCreditos/${U}`).get()).data().saldo, 46)
})

resumen('cadena de saldos del ledger')
