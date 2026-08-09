// Ledger de créditos IA — pruebas contra el emulador de Firestore.
//
//   firebase emulators:exec --only firestore,auth --project demo-test \
//     "node test/ia-creditos.test.mjs"
//
// Mismo criterio que test/servidor.test.mjs: se prueba la LÓGICA llamándola
// directamente (sin emulador de Functions). Las pruebas afirman los
// invariantes del sistema de créditos que aprobó el PO el 9-ago-2026:
// idempotencia, concurrencia, saldo nunca negativo, reembolsos, huérfanas,
// renovación sin duplicar y sincronización de plan.

import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import { db, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'

const require = createRequire(import.meta.url)
// La copia de firebase-admin de functions/ ya quedó inicializada al importar
// el entorno (que carga functions/index.js).
const L = require('../functions/creditosLedger.js')
const { Timestamp } = require('firebase-admin/firestore')

const DOCENTE = 'docente_ia'
const clave = () => crypto.randomUUID()

const TARIFAS = {
  version: 1,
  tarifas: { aviso: 1, examen: 10, analisis_programa: 45 },
  categorias: { aviso: 'Avisos', examen: 'Evaluaciones', analisis_programa: 'Planeación' },
  capacidadPorPlan: { trial: 350, pro: 350, anual: 350, mayor: 1750 },
}

async function sembrarDocente({ uid = DOCENTE, status = 'trial', planId = '', suscripcionHasta = null } = {}) {
  const usuario = { role: 'docente', nombre: 'Prueba', escuelaId: 'E1' }
  if (suscripcionHasta) usuario.suscripcionHasta = Timestamp.fromDate(suscripcionHasta)
  await db.doc(`users/${uid}`).set(usuario)
  await db.collection('subscriptions').add({
    docenteId: uid, planId, status,
    updatedAt: Timestamp.now(),
  })
  await db.doc('config/iaTarifas').set(TARIFAS)
}

const creditosDe = async (uid = DOCENTE) => (await db.doc(`iaCreditos/${uid}`).get()).data()
const consumoDe = async (k) => (await db.doc(`iaConsumos/${k}`).get()).data()

// ═════════════════════════════════════════════════════════════════════════════
grupo('Reserva y liquidación — el ciclo feliz')

await limpiar()
await sembrarDocente()

await caso('primer uso: el doc de créditos nace con el plan del docente (trial → 350)', async () => {
  const k = clave()
  const r = await L.reservar({ uid: DOCENTE, operacion: 'aviso', idempotencyKey: k, tarifas: TARIFAS })
  assert.strictEqual(r.repetida, false)
  assert.strictEqual(r.saldoTrasReserva, 349)
  const c = await creditosDe()
  assert.strictEqual(c.plan, 'trial')
  assert.strictEqual(c.capacidad, 350)
  assert.strictEqual(c.saldo, 349)
  assert.ok(c.cicloFin.toDate() > new Date())
  const liq = await L.liquidar({ uid: DOCENTE, idempotencyKey: k, creditosReales: 1, resultado: { titulo: 'Hola' } })
  assert.strictEqual(liq.saldo, 349)
  const con = await consumoDe(k)
  assert.strictEqual(con.estado, 'ejecutado')
  assert.strictEqual(con.creditosReales, 1)
  assert.strictEqual((await creditosDe()).consumoPorCategoria['Avisos'], 1)
  assert.strictEqual((await creditosDe()).consumidoCiclo, 1)
})

await caso('la liquidación devuelve lo reservado de más (estimación máxima vs real)', async () => {
  const k = clave()
  await L.reservar({ uid: DOCENTE, operacion: 'examen', idempotencyKey: k, tarifas: TARIFAS })
  assert.strictEqual((await creditosDe()).saldo, 339) // 349 - 10 reservados
  await L.liquidar({ uid: DOCENTE, idempotencyKey: k, creditosReales: 7 }) // solo 7 reales
  assert.strictEqual((await creditosDe()).saldo, 342) // devolvió 3
  assert.strictEqual((await creditosDe()).consumidoCiclo, 8) // 1 + 7
})

await caso('lo real jamás excede lo reservado (se recorta y queda a la vista)', async () => {
  const k = clave()
  await L.reservar({ uid: DOCENTE, operacion: 'aviso', idempotencyKey: k, tarifas: TARIFAS })
  await L.liquidar({ uid: DOCENTE, idempotencyKey: k, creditosReales: 999 })
  assert.strictEqual((await consumoDe(k)).creditosReales, 1)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Idempotencia — una clave cobra a lo más una vez')

await caso('reintento con la misma clave: no vuelve a cobrar y entrega el resultado previo', async () => {
  const k = clave()
  await L.reservar({ uid: DOCENTE, operacion: 'aviso', idempotencyKey: k, tarifas: TARIFAS })
  await L.liquidar({ uid: DOCENTE, idempotencyKey: k, creditosReales: 1, resultado: { titulo: 'Original' } })
  const saldoAntes = (await creditosDe()).saldo
  const r = await L.reservar({ uid: DOCENTE, operacion: 'aviso', idempotencyKey: k, tarifas: TARIFAS })
  assert.strictEqual(r.repetida, true)
  assert.strictEqual(r.consumo.estado, 'ejecutado')
  assert.strictEqual(r.consumo.resultado.titulo, 'Original')
  assert.strictEqual((await creditosDe()).saldo, saldoAntes)
})

await caso('liquidar dos veces la misma clave: la segunda es inofensiva', async () => {
  const k = clave()
  await L.reservar({ uid: DOCENTE, operacion: 'aviso', idempotencyKey: k, tarifas: TARIFAS })
  await L.liquidar({ uid: DOCENTE, idempotencyKey: k, creditosReales: 1 })
  const saldoAntes = (await creditosDe()).saldo
  const r = await L.liquidar({ uid: DOCENTE, idempotencyKey: k, creditosReales: 1 })
  assert.strictEqual(r.repetida, true)
  assert.strictEqual((await creditosDe()).saldo, saldoAntes)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Saldo — insuficiente, concurrencia, nunca negativo')

await caso('saldo justo alcanza (costo == saldo) y termina exactamente en cero', async () => {
  await limpiar()
  await sembrarDocente()
  await db.doc(`iaCreditos/${DOCENTE}`).set({
    plan: 'trial', capacidad: 350, saldo: 10, consumidoCiclo: 340, consumoPorCategoria: {},
    activadoEn: Timestamp.now(), cicloInicio: Timestamp.now(),
    cicloFin: Timestamp.fromDate(L._unMesDespues(new Date())),
  })
  const k = clave()
  const r = await L.reservar({ uid: DOCENTE, operacion: 'examen', idempotencyKey: k, tarifas: TARIFAS })
  assert.strictEqual(r.saldoTrasReserva, 0)
  await L.liquidar({ uid: DOCENTE, idempotencyKey: k, creditosReales: 10 })
  assert.strictEqual((await creditosDe()).saldo, 0)
})

await caso('saldo insuficiente: NO se ejecuta, NO se descuenta, NO hay consumo', async () => {
  const k = clave()
  await assert.rejects(
    () => L.reservar({ uid: DOCENTE, operacion: 'aviso', idempotencyKey: k, tarifas: TARIFAS }),
    (e) => e.codigo === 'SALDO_INSUFICIENTE' && e.datos.saldo === 0 && e.datos.costo === 1
  )
  assert.strictEqual((await creditosDe()).saldo, 0)
  assert.strictEqual(await consumoDe(k), undefined)
})

await caso('dos operaciones SIMULTÁNEAS no pueden gastar los mismos créditos', async () => {
  await limpiar()
  await sembrarDocente()
  await db.doc(`iaCreditos/${DOCENTE}`).set({
    plan: 'trial', capacidad: 350, saldo: 10, consumidoCiclo: 0, consumoPorCategoria: {},
    activadoEn: Timestamp.now(), cicloInicio: Timestamp.now(),
    cicloFin: Timestamp.fromDate(L._unMesDespues(new Date())),
  })
  // Dos exámenes de 10 con saldo 10: exactamente UNO debe pasar.
  const resultados = await Promise.allSettled([
    L.reservar({ uid: DOCENTE, operacion: 'examen', idempotencyKey: clave(), tarifas: TARIFAS }),
    L.reservar({ uid: DOCENTE, operacion: 'examen', idempotencyKey: clave(), tarifas: TARIFAS }),
  ])
  const ok = resultados.filter((r) => r.status === 'fulfilled')
  const mal = resultados.filter((r) => r.status === 'rejected')
  assert.strictEqual(ok.length, 1, 'exactamente una debe lograr la reserva')
  assert.strictEqual(mal.length, 1)
  assert.strictEqual(mal[0].reason.codigo, 'SALDO_INSUFICIENTE')
  assert.strictEqual((await creditosDe()).saldo, 0)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Fallos — reembolso, interrupción y huérfanas')

await caso('fallo de la IA: reembolso completo y consumo marcado como fallido', async () => {
  await limpiar()
  await sembrarDocente()
  const k = clave()
  await L.reservar({ uid: DOCENTE, operacion: 'examen', idempotencyKey: k, tarifas: TARIFAS })
  assert.strictEqual((await creditosDe()).saldo, 340)
  const r = await L.reembolsar({ uid: DOCENTE, idempotencyKey: k, motivo: 'API caída' })
  assert.strictEqual(r.hecho, true)
  assert.strictEqual((await creditosDe()).saldo, 350)
  const con = await consumoDe(k)
  assert.strictEqual(con.estado, 'fallido')
  assert.strictEqual(con.creditosReales, 0)
})

await caso('reembolsar un consumo ya liquidado NO devuelve nada (sin doble devolución)', async () => {
  const k = clave()
  await L.reservar({ uid: DOCENTE, operacion: 'aviso', idempotencyKey: k, tarifas: TARIFAS })
  await L.liquidar({ uid: DOCENTE, idempotencyKey: k, creditosReales: 1 })
  const saldoAntes = (await creditosDe()).saldo
  const r = await L.reembolsar({ uid: DOCENTE, idempotencyKey: k })
  assert.strictEqual(r.hecho, false)
  assert.strictEqual((await creditosDe()).saldo, saldoAntes)
})

await caso('proceso interrumpido tras reservar: la reserva queda descontada y en estado reservado', async () => {
  const k = clave()
  globalThis.__claveInterrumpida = k
  await L.reservar({ uid: DOCENTE, operacion: 'examen', idempotencyKey: k, tarifas: TARIFAS })
  // ... y aquí el proceso "muere": nadie liquida.
  assert.strictEqual((await consumoDe(k)).estado, 'reservado')
  assert.strictEqual((await creditosDe()).saldo, 339) // 349 - 10
})

await caso('la limpieza recupera la reserva huérfana (y respeta las recientes)', async () => {
  const kFresca = clave()
  await L.reservar({ uid: DOCENTE, operacion: 'aviso', idempotencyKey: kFresca, tarifas: TARIFAS })
  // Con límite 0 minutos pero "ahora" en el futuro, la vieja ya expiró; la
  // fresca también entra al filtro — así que primero probamos el respeto:
  const r1 = await L.limpiarReservasHuerfanas({ minutos: 15 })
  assert.strictEqual(r1.recuperadas, 0, 'ninguna tiene 15 minutos todavía')
  // Y ahora la expiración (simulando el paso del tiempo con ahora futuro):
  const futuro = new Date(Date.now() + 60 * 60 * 1000)
  const r2 = await L.limpiarReservasHuerfanas({ minutos: 15, ahora: futuro })
  assert.strictEqual(r2.recuperadas, 2) // la interrumpida del caso anterior + la fresca
  const con = await consumoDe(globalThis.__claveInterrumpida)
  assert.strictEqual(con.estado, 'expirado')
  // 350 menos el único consumo LEGÍTIMO del grupo (el aviso liquidado dos
  // casos atrás): las dos reservas huérfanas (10 + 1) se devolvieron íntegras.
  assert.strictEqual((await creditosDe()).saldo, 349)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Renovación mensual — desde la fecha de activación, sin acumular, sin duplicar')

await caso('renovación perezosa al reservar: ciclo vencido → saldo = capacidad (no se acumula)', async () => {
  await limpiar()
  // Plan de PAGO: el trial no renueva (eso lo afirma su propio grupo abajo).
  await sembrarDocente({ status: 'activa', planId: 'pro' })
  const hace2Meses = new Date(); hace2Meses.setMonth(hace2Meses.getMonth() - 2)
  const hace1Mes = new Date(); hace1Mes.setMonth(hace1Mes.getMonth() - 1)
  await db.doc(`iaCreditos/${DOCENTE}`).set({
    plan: 'pro', capacidad: 350, saldo: 5, consumidoCiclo: 345,
    consumoPorCategoria: { Avisos: 345 },
    activadoEn: Timestamp.fromDate(hace2Meses),
    cicloInicio: Timestamp.fromDate(hace2Meses),
    cicloFin: Timestamp.fromDate(hace1Mes),
  })
  const r = await L.reservar({ uid: DOCENTE, operacion: 'aviso', idempotencyKey: clave(), tarifas: TARIFAS })
  assert.strictEqual(r.saldoTrasReserva, 349) // 350 nuevos - 1, NO 355 - 1
  const c = await creditosDe()
  assert.strictEqual(c.consumidoCiclo, 0)
  assert.deepStrictEqual(c.consumoPorCategoria, {})
  assert.ok(c.cicloFin.toDate() > new Date(), 'el ciclo avanzó hasta cubrir hoy')
})

await caso('renovación por cron: renueva al vencido y la segunda corrida no duplica', async () => {
  await limpiar()
  await sembrarDocente({ status: 'activa', planId: 'pro' })
  const hace1Mes = new Date(); hace1Mes.setMonth(hace1Mes.getMonth() - 1)
  const hace2Meses = new Date(); hace2Meses.setMonth(hace2Meses.getMonth() - 2)
  await db.doc(`iaCreditos/${DOCENTE}`).set({
    plan: 'pro', capacidad: 350, saldo: 12, consumidoCiclo: 338, consumoPorCategoria: {},
    activadoEn: Timestamp.fromDate(hace2Meses),
    cicloInicio: Timestamp.fromDate(hace2Meses),
    cicloFin: Timestamp.fromDate(hace1Mes),
  })
  const r1 = await L.renovarCiclosVencidos({ tarifas: TARIFAS })
  assert.strictEqual(r1.renovados, 1)
  const c1 = await creditosDe()
  assert.strictEqual(c1.saldo, 350)
  const finTrasRenovar = c1.cicloFin.toDate().getTime()
  const r2 = await L.renovarCiclosVencidos({ tarifas: TARIFAS })
  assert.strictEqual(r2.renovados, 0, 'la segunda corrida no encuentra nada que renovar')
  assert.strictEqual((await creditosDe()).cicloFin.toDate().getTime(), finTrasRenovar)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Planes — cambio, cortesía pendiente y suscripción vencida')

await caso('subida de plan: inmediata y conservando el saldo', async () => {
  await limpiar()
  await sembrarDocente()
  await db.doc(`iaCreditos/${DOCENTE}`).set({
    plan: 'pro', capacidad: 350, saldo: 120, consumidoCiclo: 230, consumoPorCategoria: {},
    activadoEn: Timestamp.now(), cicloInicio: Timestamp.now(),
    cicloFin: Timestamp.fromDate(L._unMesDespues(new Date())),
  })
  const r = await L.sincronizarPlan({ uid: DOCENTE, nivelNuevo: 'mayor', tarifas: TARIFAS })
  assert.strictEqual(r.modo, 'inmediato')
  const c = await creditosDe()
  assert.strictEqual(c.plan, 'mayor')
  assert.strictEqual(c.capacidad, 1750)
  assert.strictEqual(c.saldo, 120, 'no pierde los créditos que tenía')
})

await caso('bajada de plan: diferida — se aplica en la renovación con la capacidad nueva', async () => {
  const r = await L.sincronizarPlan({ uid: DOCENTE, nivelNuevo: 'pro', tarifas: TARIFAS })
  assert.strictEqual(r.modo, 'diferido')
  let c = await creditosDe()
  assert.strictEqual(c.plan, 'mayor', 'sigue en Mayor durante el ciclo contratado')
  assert.strictEqual(c.planSiguiente, 'pro')
  // Simular que el ciclo venció y renovarlo:
  const hace1Mes = new Date(); hace1Mes.setMonth(hace1Mes.getMonth() - 1)
  await db.doc(`iaCreditos/${DOCENTE}`).update({ cicloFin: Timestamp.fromDate(hace1Mes) })
  await L.renovarCiclosVencidos({ tarifas: TARIFAS })
  c = await creditosDe()
  assert.strictEqual(c.plan, 'pro')
  assert.strictEqual(c.capacidad, 350)
  assert.strictEqual(c.saldo, 350)
  assert.strictEqual(c.planSiguiente, undefined)
})

await caso('plan cortesía: la IA se rechaza con mensaje claro (pendiente por decisión)', async () => {
  await limpiar()
  await db.doc(`users/cortesia_1`).set({ role: 'docente', escuelaId: 'E1' })
  await db.collection('subscriptions').add({
    docenteId: 'cortesia_1', planId: 'cortesia', status: 'activa',
    cortesiaIndefinida: true, updatedAt: Timestamp.now(),
  })
  await db.doc('config/iaTarifas').set(TARIFAS)
  await assert.rejects(
    () => L.reservar({ uid: 'cortesia_1', operacion: 'aviso', idempotencyKey: clave(), tarifas: TARIFAS }),
    (e) => e.codigo === 'CORTESIA_PENDIENTE'
  )
})

await caso('suscripción vencida: la IA se rechaza (mismo criterio que el candado de escrituras)', async () => {
  await limpiar()
  const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000)
  await sembrarDocente({ suscripcionHasta: ayer })
  await assert.rejects(
    () => L.reservar({ uid: DOCENTE, operacion: 'aviso', idempotencyKey: clave(), tarifas: TARIFAS }),
    (e) => e.codigo === 'SUSCRIPCION_VENCIDA'
  )
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Trial — 350 una sola vez, registro interno y conversión')

await caso('el trial NO renueva créditos: ciclo vencido no rellena la bolsa', async () => {
  await limpiar()
  await sembrarDocente()
  const hace40Dias = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
  const hace10Dias = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
  await db.doc(`iaCreditos/${DOCENTE}`).set({
    plan: 'trial', capacidad: 350, saldo: 40, consumidoCiclo: 310, consumoPorCategoria: {},
    activadoEn: Timestamp.fromDate(hace40Dias),
    cicloInicio: Timestamp.fromDate(hace40Dias),
    cicloFin: Timestamp.fromDate(hace10Dias), // "venció" y aun así no debe rellenar
  })
  const r = await L.renovarCiclosVencidos({ tarifas: TARIFAS })
  assert.strictEqual(r.renovados, 0, 'el trial no entra a la renovación')
  const res = await L.reservar({ uid: DOCENTE, operacion: 'aviso', idempotencyKey: clave(), tarifas: TARIFAS })
  assert.strictEqual(res.saldoTrasReserva, 39, 'sigue con su bolsa original, sin recarga')
})

await caso('el registro interno del trial nace con el primer uso (sin costos visibles)', async () => {
  await limpiar()
  await sembrarDocente()
  await L.reservar({ uid: DOCENTE, operacion: 'aviso', idempotencyKey: clave(), tarifas: TARIFAS })
  const reg = (await db.doc(`iaTrialRegistro/${DOCENTE}`).get()).data()
  assert.strictEqual(reg.creditosAsignados, 350)
  assert.strictEqual(reg.agotoCreditos, false)
  assert.strictEqual(reg.convertidoAPago, false)
  assert.ok(reg.inicioTrial && reg.finTrial)
})

await caso('cada consumo queda etiquetado con el plan vigente (trial vs pago)', async () => {
  const k = clave()
  await L.reservar({ uid: DOCENTE, operacion: 'examen', idempotencyKey: k, tarifas: TARIFAS })
  assert.strictEqual((await consumoDe(k)).plan, 'trial')
})

await caso('agotar los 350 en trial marca el registro y suspende SOLO la IA', async () => {
  await limpiar()
  await sembrarDocente()
  await db.doc(`iaCreditos/${DOCENTE}`).set({
    plan: 'trial', capacidad: 350, saldo: 1, consumidoCiclo: 349, consumoPorCategoria: {},
    activadoEn: Timestamp.now(), cicloInicio: Timestamp.now(),
    cicloFin: Timestamp.fromDate(L._unMesDespues(new Date())),
  })
  const k = clave()
  await L.reservar({ uid: DOCENTE, operacion: 'aviso', idempotencyKey: k, tarifas: TARIFAS })
  await L.liquidar({ uid: DOCENTE, idempotencyKey: k, creditosReales: 1 })
  const reg = (await db.doc(`iaTrialRegistro/${DOCENTE}`).get()).data()
  assert.strictEqual(reg.agotoCreditos, true)
  assert.strictEqual(reg.creditosConsumidos, 350)
  // La IA se rechaza; el resto del producto no pasa por este ledger.
  await assert.rejects(
    () => L.reservar({ uid: DOCENTE, operacion: 'aviso', idempotencyKey: clave(), tarifas: TARIFAS }),
    (e) => e.codigo === 'SALDO_INSUFICIENTE'
  )
})

await caso('conversión trial → pago: inmediata, conserva saldo y queda medida en el registro', async () => {
  await limpiar()
  await sembrarDocente()
  await db.doc(`iaCreditos/${DOCENTE}`).set({
    plan: 'trial', capacidad: 350, saldo: 220, consumidoCiclo: 130, consumoPorCategoria: {},
    activadoEn: Timestamp.now(), cicloInicio: Timestamp.now(),
    cicloFin: Timestamp.fromDate(L._unMesDespues(new Date())),
  })
  await db.doc(`iaTrialRegistro/${DOCENTE}`).set({
    uid: DOCENTE, creditosAsignados: 350, agotoCreditos: false,
    terminoPorTiempo: false, convertidoAPago: false,
  })
  const r = await L.sincronizarPlan({ uid: DOCENTE, nivelNuevo: 'pro', tarifas: TARIFAS })
  assert.strictEqual(r.modo, 'inmediato')
  const c = await creditosDe()
  assert.strictEqual(c.plan, 'pro')
  assert.strictEqual(c.saldo, 220, 'conserva los créditos del trial')
  const reg = (await db.doc(`iaTrialRegistro/${DOCENTE}`).get()).data()
  assert.strictEqual(reg.convertidoAPago, true)
  assert.strictEqual(reg.planDestino, 'pro')
  assert.strictEqual(reg.creditosConsumidos, 130)
})

await caso('trial vencido por tiempo sin conversión: el cierre lo deja medido (y es idempotente)', async () => {
  await limpiar()
  await sembrarDocente()
  const hace40Dias = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
  const hace10Dias = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
  await db.doc(`iaCreditos/${DOCENTE}`).set({
    plan: 'trial', capacidad: 350, saldo: 275, consumidoCiclo: 75, consumoPorCategoria: {},
    activadoEn: Timestamp.fromDate(hace40Dias),
    cicloInicio: Timestamp.fromDate(hace40Dias),
    cicloFin: Timestamp.fromDate(hace10Dias),
  })
  const r1 = await L.cerrarTrialsVencidos({})
  assert.strictEqual(r1.cerrados, 1)
  const reg = (await db.doc(`iaTrialRegistro/${DOCENTE}`).get()).data()
  assert.strictEqual(reg.terminoPorTiempo, true)
  assert.strictEqual(reg.creditosConsumidos, 75)
  const r2 = await L.cerrarTrialsVencidos({})
  assert.strictEqual(r2.cerrados, 0, 'la segunda corrida no lo vuelve a cerrar')
})

resumen('pruebas del ledger de créditos IA')
