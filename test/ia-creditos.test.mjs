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
const IA = require('../functions/ia.js')._pruebas
const { Timestamp } = require('firebase-admin/firestore')

const DOCENTE = 'docente_ia'
const OTRO_DOCENTE = 'docente_ajeno'
const clave = () => crypto.randomUUID()

const TARIFAS = {
  version: 1,
  tarifas: { aviso: 1, examen: 10, analisis_programa: 45, reactivos: 1, analizar_resultados: 5 },
  categorias: { aviso: 'Avisos', examen: 'Evaluaciones', analisis_programa: 'Planeación', reactivos: 'Evaluaciones', analizar_resultados: 'Evaluaciones' },
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

// ═════════════════════════════════════════════════════════════════════════════
grupo('Rúbricas y listas de cotejo con IA — la actividad padre manda')

// La regla (PO, 10-ago-2026): una rúbrica o lista de cotejo SIEMPRE se deriva
// de una actividad padre, que solo puede ser un Entregable o una Actividad de
// Observación. Lo que se prueba aquí es el precheck: todo lo que decide si la
// operación puede correr ANTES de que se reserve un solo crédito.

const ENTREGABLE = {
  docenteId: DOCENTE, categoria: 'entregable', nombre: 'Ensayo sobre la Revolución',
  instrucciones: '<p>Escribe un ensayo de dos cuartillas sobre las causas de la Revolución Mexicana. Cita al menos tres fuentes.</p>',
  tiposArchivo: ['documento'], fechaLimite: '2026-09-01T23:59', recibirTarde: false,
  archivosAdjuntos: [{ nombre: 'guia.pdf' }],
}
const OBSERVACION = {
  docenteId: DOCENTE, categoria: 'observacion', nombre: 'Exposición por equipos',
  instrucciones: '<p>Observar claridad al hablar, dominio del tema, apoyo visual y participación de todos los integrantes del equipo.</p>',
  fechaLimite: null, recibirTarde: null,
}

await caso('entregable con contexto suficiente: pasa y arma el contexto real', () => {
  const ctx = IA.contextoDeActividad(ENTREGABLE)
  assert.strictEqual(ctx.clase, 'entregable')
  assert.deepStrictEqual(ctx.faltantes, [])
  assert.ok(ctx.instrucciones.includes('Revolución Mexicana'))
  assert.ok(!ctx.instrucciones.includes('<p>'), 'el HTML se convierte a texto plano')
  assert.deepStrictEqual(ctx.adjuntos, ['guia.pdf'])
})

await caso('observación con contexto suficiente: pasa y se clasifica como observación', () => {
  const ctx = IA.contextoDeActividad(OBSERVACION)
  assert.strictEqual(ctx.clase, 'observacion')
  assert.deepStrictEqual(ctx.faltantes, [])
})

await caso('las categorías viejas del entregable (actividad/tarea) siguen siendo padre válido', () => {
  assert.strictEqual(IA.contextoDeActividad({ ...ENTREGABLE, categoria: 'actividad' }).clase, 'entregable')
  assert.strictEqual(IA.contextoDeActividad({ ...ENTREGABLE, categoria: 'tarea' }).clase, 'entregable')
})

await caso('un examen o cuestionario NO puede ser padre de una rúbrica', () => {
  assert.strictEqual(IA.contextoDeActividad({ ...ENTREGABLE, categoria: 'examen' }).clase, null)
  assert.strictEqual(IA.contextoDeActividad({ ...ENTREGABLE, categoria: 'cuestionario' }).clase, null)
})

await caso('observación con instrucciones VACÍAS: falta lo que hay que observar', () => {
  const ctx = IA.contextoDeActividad({ ...OBSERVACION, instrucciones: '' })
  assert.strictEqual(ctx.faltantes.length, 1)
  assert.ok(ctx.faltantes[0].includes('observar'), 'el mensaje dice qué falta, no "información insuficiente"')
})

await caso('instrucciones de puro relleno HTML cuentan como vacías', () => {
  const ctx = IA.contextoDeActividad({ ...OBSERVACION, instrucciones: '<p>&nbsp;</p><p><br></p>' })
  assert.strictEqual(ctx.faltantes.length, 1)
})

await caso('entregable con instrucciones demasiado cortas: no alcanza para fundamentar criterios', () => {
  const ctx = IA.contextoDeActividad({ ...ENTREGABLE, instrucciones: '<p>Tarea 3</p>' })
  assert.strictEqual(ctx.faltantes.length, 1)
  assert.ok(ctx.faltantes[0].includes('instrucciones'))
})

await caso('sin nombre y sin instrucciones: se reportan las DOS cosas que faltan', () => {
  const ctx = IA.contextoDeActividad({ ...OBSERVACION, nombre: '', instrucciones: '' })
  assert.strictEqual(ctx.faltantes.length, 2)
})

await caso('las condiciones del ENTREGABLE salen de campos reales de la actividad', () => {
  const cond = IA.condicionesEntregable(ENTREGABLE).join(' | ')
  assert.ok(cond.includes('documento'), 'el tipo de archivo pedido es parte del contexto')
  assert.ok(cond.includes('fecha límite'))
  assert.ok(cond.includes('No se aceptan entregas'))
})

await caso('una OBSERVACIÓN no arrastra condiciones de entrega (no existen ahí)', () => {
  // condicionesEntregable solo se llama para la clase entregable; con los
  // campos de una observación (todo en null) no produce nada que contaminar.
  assert.deepStrictEqual(IA.condicionesEntregable(OBSERVACION), [])
})


// ── El precheck contra Firestore: seguridad y "no se cobra si no alcanza" ────

async function precheckFalla({ actividadId, uid = DOCENTE }) {
  try {
    await IA.precheckInstrumento({ uid, params: { actividadId } })
    return null
  } catch (e) {
    return { code: e.code || e.httpErrorCode?.canonicalName, message: e.message, details: e.details }
  }
}

await limpiar()
await sembrarDocente()
await db.doc('activities/act_entregable').set(ENTREGABLE)
await db.doc('activities/act_observacion').set(OBSERVACION)
await db.doc('activities/act_ajena').set({ ...ENTREGABLE, docenteId: OTRO_DOCENTE })
await db.doc('activities/act_examen').set({ ...ENTREGABLE, categoria: 'examen' })
await db.doc('activities/act_pelada').set({ ...OBSERVACION, instrucciones: '' })

await caso('actividad propia y suficiente: el precheck deja pasar con el contexto listo', async () => {
  const ctx = await IA.precheckInstrumento({ uid: DOCENTE, params: { actividadId: 'act_entregable' } })
  assert.strictEqual(ctx.clase, 'entregable')
  assert.ok(ctx.condiciones.length > 0)
})

await caso('una observación no trae condiciones de entrega en su contexto', async () => {
  const ctx = await IA.precheckInstrumento({ uid: DOCENTE, params: { actividadId: 'act_observacion' } })
  assert.strictEqual(ctx.clase, 'observacion')
  assert.deepStrictEqual(ctx.condiciones, [])
})

await caso('SEGURIDAD · actividad de OTRO docente → permission-denied', async () => {
  const e = await precheckFalla({ actividadId: 'act_ajena' })
  assert.ok(e, 'debe fallar')
  assert.ok(String(e.code).includes('permission-denied'), e.code)
})

await caso('SEGURIDAD · actividad inexistente → not-found', async () => {
  const e = await precheckFalla({ actividadId: 'no_existe' })
  assert.ok(String(e.code).includes('not-found'), e.code)
})

await caso('SEGURIDAD · sin actividadId → se pide guardar primero, no revienta', async () => {
  const e = await precheckFalla({ actividadId: '' })
  assert.ok(String(e.code).includes('invalid-argument'), e.code)
  assert.ok(e.message.includes('Guarda primero'), e.message)
})

await caso('SEGURIDAD · categoría no válida (examen) → failed-precondition', async () => {
  const e = await precheckFalla({ actividadId: 'act_examen' })
  assert.ok(String(e.code).includes('failed-precondition'), e.code)
  assert.ok(e.message.includes('observación'))
})

await caso('información insuficiente → se detiene, dice qué falta y NO cobra', async () => {
  const antes = await creditosDe()
  const e = await precheckFalla({ actividadId: 'act_pelada' })
  assert.ok(String(e.code).includes('failed-precondition'), e.code)
  assert.strictEqual(e.details.codigo, 'CONTEXTO_INSUFICIENTE')
  assert.ok(e.message.includes('observar'), 'dice exactamente qué agregar')
  assert.ok(e.message.includes('no se descontaron créditos'))
  // Y lo que de verdad importa: ni consumo ni saldo tocado.
  const consumos = await db.collection('iaConsumos').get()
  assert.strictEqual(consumos.size, 0, 'no debe existir NINGUNA reserva')
  const despues = await creditosDe()
  assert.deepStrictEqual(despues?.saldo ?? null, antes?.saldo ?? null)
})


// ═════════════════════════════════════════════════════════════════════════════
grupo('Reactivos con IA (OP-09) — el cuestionario/examen padre manda')

// La regla (ficha aprobada, 10-ago-2026): el reactivo se deriva de lo que el
// docente describe en "¿Qué quieres evaluar?"; el cuestionario/examen padre
// solo aporta contexto. Evalúa Fácil fija cantidad y tipo — nunca la IA.

const QUIERE_EVALUAR_OK =
  'Quiero evaluar que el estudiante comprenda qué es un algoritmo, identifique la estructura ' +
  'condicional Si...Entonces y sea capaz de elaborar un algoritmo sencillo.'

const CUESTIONARIO = { docenteId: DOCENTE, categoria: 'cuestionario', nombre: 'Algoritmos — parcial 1' }
const EXAMEN = { docenteId: DOCENTE, categoria: 'examen', nombre: 'Examen de algoritmos' }

await caso('tipo fijo: reparte exactamente ese tipo en TODAS las posiciones', () => {
  const tipos = IA.tiposParaLote('verdadero_falso', 6)
  assert.strictEqual(tipos.length, 6)
  assert.ok(tipos.every((t) => t === 'verdadero_falso'))
})

await caso('mixto: reparte round-robin entre los 4 tipos disponibles — nunca lo decide la IA', () => {
  const tipos = IA.tiposParaLote('mixto', 5)
  assert.deepStrictEqual(tipos, ['opcion_multiple', 'verdadero_falso', 'respuesta_corta', 'subir_archivo', 'opcion_multiple'])
})

await caso('normalizarReactivos: fuerza el tipo/orden de ctx.tipos aunque la IA devuelva otra cosa', () => {
  const ctx = { tipos: ['opcion_multiple', 'verdadero_falso'] }
  const datos = {
    reactivos: [
      { tipo: 'ignorado', enunciado: '¿Qué es un algoritmo?', opciones: ['A', 'B', 'C', 'D'], correcta: 2 },
      { tipo: 'ignorado', enunciado: 'Un algoritmo siempre termina.', correcta: 'f' },
    ],
  }
  const r = IA.normalizarReactivos(datos, ctx)
  assert.strictEqual(r.length, 2)
  assert.strictEqual(r[0].tipo, 'opcion_multiple')
  assert.strictEqual(r[0].correcta, 2)
  assert.strictEqual(r[0].opciones.length, 4)
  assert.strictEqual(r[1].tipo, 'verdadero_falso')
  assert.strictEqual(r[1].correcta, 'f')
})

await caso('normalizarReactivos: rellena huecos cuando la IA entrega menos reactivos de los pedidos', () => {
  const ctx = { tipos: ['opcion_multiple', 'respuesta_corta', 'subir_archivo'] }
  const r = IA.normalizarReactivos({ reactivos: [{ tipo: 'opcion_multiple', enunciado: 'Único' }] }, ctx)
  assert.strictEqual(r.length, 3)
  assert.strictEqual(r[1].enunciado, '')
  assert.strictEqual(r[2].tipo, 'subir_archivo')
})

await limpiar()
await sembrarDocente()
await db.doc('activities/act_cuestionario').set(CUESTIONARIO)
await db.doc('activities/act_examen_reactivos').set(EXAMEN)
await db.doc('activities/act_entregable_reactivos').set({ docenteId: DOCENTE, categoria: 'entregable', nombre: 'No es evaluación' })
await db.doc('activities/act_cuestionario_ajeno').set({ ...CUESTIONARIO, docenteId: OTRO_DOCENTE })

await caso('cuestionario propio + descripción suficiente: el precheck deja pasar y arma el contexto', async () => {
  const ctx = await IA.precheckReactivos({
    uid: DOCENTE,
    params: { actividadId: 'act_cuestionario', quiereEvaluar: QUIERE_EVALUAR_OK, cantidad: 4, tipoSolicitado: 'opcion_multiple' },
  })
  assert.strictEqual(ctx.clase, 'cuestionario')
  assert.strictEqual(ctx.cantidad, 4)
  assert.strictEqual(ctx.tipos.length, 4)
  assert.ok(ctx.tipos.every((t) => t === 'opcion_multiple'))
})

await caso('examen propio también es padre válido', async () => {
  const ctx = await IA.precheckReactivos({
    uid: DOCENTE,
    params: { actividadId: 'act_examen_reactivos', quiereEvaluar: QUIERE_EVALUAR_OK },
  })
  assert.strictEqual(ctx.clase, 'examen')
})

await caso('cantidad y tipo fuera de rango: se acotan en silencio, nunca rechazan la operación', async () => {
  const ctx = await IA.precheckReactivos({
    uid: DOCENTE,
    params: { actividadId: 'act_cuestionario', quiereEvaluar: QUIERE_EVALUAR_OK, cantidad: 999, tipoSolicitado: 'lo-que-sea' },
  })
  assert.strictEqual(ctx.cantidad, IA.MAX_REACTIVOS)
  assert.strictEqual(ctx.tipoSolicitado, 'mixto') // valor no reconocido → mixto por default
})

await caso('cantidad por default es 5 cuando el cliente no manda nada', async () => {
  const ctx = await IA.precheckReactivos({ uid: DOCENTE, params: { actividadId: 'act_cuestionario', quiereEvaluar: QUIERE_EVALUAR_OK } })
  assert.strictEqual(ctx.cantidad, 5)
})

await caso('SEGURIDAD · un entregable NO puede ser padre de reactivos', async () => {
  await assert.rejects(
    () => IA.precheckReactivos({ uid: DOCENTE, params: { actividadId: 'act_entregable_reactivos', quiereEvaluar: QUIERE_EVALUAR_OK } }),
    (e) => String(e.code).includes('failed-precondition')
  )
})

await caso('SEGURIDAD · actividad de otro docente → permission-denied', async () => {
  await assert.rejects(
    () => IA.precheckReactivos({ uid: DOCENTE, params: { actividadId: 'act_cuestionario_ajeno', quiereEvaluar: QUIERE_EVALUAR_OK } }),
    (e) => String(e.code).includes('permission-denied')
  )
})

await caso('SEGURIDAD · sin actividadId → se pide guardar primero', async () => {
  await assert.rejects(
    () => IA.precheckReactivos({ uid: DOCENTE, params: { actividadId: '', quiereEvaluar: QUIERE_EVALUAR_OK } }),
    (e) => String(e.code).includes('invalid-argument') && e.message.includes('Guarda primero')
  )
})

await caso('"qué quieres evaluar" insuficiente → se detiene, dice qué falta y NO cobra', async () => {
  const antes = await creditosDe()
  let err
  try {
    await IA.precheckReactivos({ uid: DOCENTE, params: { actividadId: 'act_cuestionario', quiereEvaluar: 'muy corto' } })
  } catch (e) { err = e }
  assert.ok(err, 'debe fallar')
  assert.strictEqual(err.details.codigo, 'CONTEXTO_INSUFICIENTE')
  assert.ok(err.message.includes(`${IA.MIN_QUIERE_EVALUAR}`), 'dice el mínimo de caracteres')
  const consumos = await db.collection('iaConsumos').get()
  assert.strictEqual(consumos.size, 0, 'no debe existir ninguna reserva')
  assert.deepStrictEqual((await creditosDe())?.saldo ?? null, antes?.saldo ?? null)
})

await caso('"qué quieres evaluar" vacío también se detiene (no solo corto)', async () => {
  await assert.rejects(
    () => IA.precheckReactivos({ uid: DOCENTE, params: { actividadId: 'act_cuestionario', quiereEvaluar: '' } }),
    (e) => e.details?.codigo === 'CONTEXTO_INSUFICIENTE'
  )
})

await caso('la tarifa de reactivos reserva y liquida exactamente 1 crédito', async () => {
  const k = clave()
  await L.reservar({ uid: DOCENTE, operacion: 'reactivos', idempotencyKey: k, tarifas: TARIFAS })
  const saldoTrasReserva = (await creditosDe()).saldo
  await L.liquidar({ uid: DOCENTE, idempotencyKey: k, creditosReales: 1 })
  const saldoFinal = (await creditosDe()).saldo
  assert.strictEqual(saldoTrasReserva, saldoFinal, 'la reserva de 1 y lo real de 1 no dejan diferencia que devolver')
  assert.strictEqual((await consumoDe(k)).creditosReales, 1)
})

await caso('fallo de la IA generando reactivos: reembolso completo (mismo mecanismo que rúbrica/cotejo)', async () => {
  const k = clave()
  const saldoAntes = (await creditosDe()).saldo
  await L.reservar({ uid: DOCENTE, operacion: 'reactivos', idempotencyKey: k, tarifas: TARIFAS })
  await L.reembolsar({ uid: DOCENTE, idempotencyKey: k, motivo: 'La IA no generó reactivos utilizables' })
  assert.strictEqual((await creditosDe()).saldo, saldoAntes)
  assert.strictEqual((await consumoDe(k)).estado, 'fallido')
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Análisis de resultados con IA (OP-10) — la aritmética siempre la pone EF')

// La regla (ficha aprobada, 11-ago-2026): la IA solo redacta interpretación y
// recomendaciones sobre una agregación que Evalúa Fácil calculó en código —
// nunca hace ella la aritmética, nunca inventa estudiantes fuera de los
// candidatos que el código ya filtró, y los estudiantes viajan anonimizados.

// Fixture: 3 reactivos (2 objetivos + 1 de revisión manual) y 5 entregas.
// p1 (opcion_multiple, correcta 'a'): aciertos e1,e4,e5 · falla e2('b'),e3('c') → 60%
// p2 (verdadero_falso, correcta 'v'): aciertos e1,e2,e5 · falla e3('f'),e4('f') → 60%
// p3 (respuesta_corta): sin calificar en ninguna entrega (revisión manual)
const PREGUNTAS_FIXTURE = [
  { id: 'p1', tipo: 'opcion_multiple', enunciado: '¿Qué es un algoritmo?', opciones: [{ id: 'a', texto: 'Correcta' }, { id: 'b', texto: 'Incorrecta B' }, { id: 'c', texto: 'Incorrecta C' }] },
  { id: 'p2', tipo: 'verdadero_falso', enunciado: 'Un algoritmo siempre termina', opciones: [{ id: 'v', texto: 'Verdadero' }, { id: 'f', texto: 'Falso' }] },
  { id: 'p3', tipo: 'respuesta_corta', enunciado: 'Explica con tus palabras qué es un algoritmo' },
]
const ENTREGAS_FIXTURE = [
  { alumnoId: 'al1', calificacion: 10, respuestas: { p1: { opcionSeleccionada: 'a', correcta: true }, p2: { opcionSeleccionada: 'v', correcta: true }, p3: { correcta: null } } },
  { alumnoId: 'al2', calificacion: 5, respuestas: { p1: { opcionSeleccionada: 'b', correcta: false }, p2: { opcionSeleccionada: 'v', correcta: true }, p3: { correcta: null } } },
  { alumnoId: 'al3', calificacion: 0, respuestas: { p1: { opcionSeleccionada: 'c', correcta: false }, p2: { opcionSeleccionada: 'f', correcta: false }, p3: { correcta: null } } },
  { alumnoId: 'al4', calificacion: 5, respuestas: { p1: { opcionSeleccionada: 'a', correcta: true }, p2: { opcionSeleccionada: 'f', correcta: false }, p3: { correcta: null } } },
  { alumnoId: 'al5', calificacion: 10, respuestas: { p1: { opcionSeleccionada: 'a', correcta: true }, p2: { opcionSeleccionada: 'v', correcta: true }, p3: { correcta: null } } },
]
const agregado = () => IA.agregarResultados({ nombre: 'Quiz 1', categoria: 'cuestionario', preguntas: PREGUNTAS_FIXTURE, entregas: ENTREGAS_FIXTURE })

await caso('agregarResultados: % de aciertos por reactivo — solo tipos objetivos', () => {
  const r = agregado()
  const p1 = r.reactivos.find((x) => x.id === 'p1')
  const p2 = r.reactivos.find((x) => x.id === 'p2')
  const p3 = r.reactivos.find((x) => x.id === 'p3')
  assert.strictEqual(p1.pctAciertos, 60)
  assert.strictEqual(p2.pctAciertos, 60)
  assert.strictEqual(p3.calificable, false)
  assert.strictEqual(p3.pctAciertos, null, 'respuesta_corta no tiene % automático confiable')
  assert.strictEqual(p3.pendientes, 5)
})

await caso('agregarResultados: porcentaje general es el promedio de los objetivos calificados', () => {
  assert.strictEqual(agregado().porcentajeAciertosGeneral, 60)
})

await caso('agregarResultados: distribución de errores por opción, ordenada de mayor a menor', () => {
  const p1 = agregado().reactivos.find((x) => x.id === 'p1')
  assert.strictEqual(p1.distribucionErrores.length, 2)
  assert.ok(p1.distribucionErrores.every((e) => e.pct === 50), 'b y c fallaron una vez cada una, de 2 falladas')
})

await caso('agregarResultados: candidatos a atención son SOLO quienes bajan de 60% en objetivas', () => {
  const cand = agregado().candidatosAtencion.map((c) => c.anonId)
  assert.deepStrictEqual(cand, ['Alumno 2', 'Alumno 3', 'Alumno 4'])
})

await caso('agregarResultados: el mapa anonId→alumnoId nunca se manda al modelo, solo regresa al final', () => {
  const r = agregado()
  assert.strictEqual(r.mapaAlumnos.length, 5)
  assert.strictEqual(r.mapaAlumnos[1].anonId, 'Alumno 2')
  assert.strictEqual(r.mapaAlumnos[1].alumnoId, 'al2')
})

await caso('agregarResultados: sin entregas no revienta (arrays vacíos, porcentajes null)', () => {
  const r = IA.agregarResultados({ nombre: 'X', categoria: 'examen', preguntas: PREGUNTAS_FIXTURE, entregas: [] })
  assert.strictEqual(r.totalEstudiantes, 0)
  assert.strictEqual(r.porcentajeAciertosGeneral, null)
  assert.deepStrictEqual(r.candidatosAtencion, [])
})

grupo('normalizarAnalisis — la IA nunca sustituye la aritmética ni inventa estudiantes')

await caso('los números finales SIEMPRE vienen de ctx, nunca de lo que devolvió la IA', () => {
  const ctx = agregado()
  const datos = { resumenGeneral: 'x', porcentajeAciertosGeneral: 999, resumenEjecutivo: 'y' } // la IA "intenta" mandar un número
  const r = IA.normalizarAnalisis(datos, ctx)
  assert.strictEqual(r.porcentajeAciertosGeneral, ctx.porcentajeAciertosGeneral, 'se ignora el 999 inventado')
  assert.deepStrictEqual(r.reactivosDificiles, ctx.reactivosDificiles.map((x) => ({ numero: x.numero, enunciado: x.enunciado, pctAciertos: x.pctAciertos })))
})

await caso('estudiantesAtencion se filtra contra los candidatos reales — un anonId inventado se descarta', () => {
  const ctx = agregado()
  const datos = {
    resumenGeneral: 'x',
    estudiantesAtencion: [
      { anonId: 'Alumno 2', senal: 'bajo desempeño real' },
      { anonId: 'Alumno 99', senal: 'inventado por la IA' },
    ],
  }
  const r = IA.normalizarAnalisis(datos, ctx)
  assert.strictEqual(r.estudiantesAtencion.length, 1)
  assert.strictEqual(r.estudiantesAtencion[0].anonId, 'Alumno 2')
})

await caso('sin candidatos reales, CUALQUIER estudiante que proponga la IA se descarta', () => {
  const ctxSinCandidatos = { ...agregado(), candidatosAtencion: [] }
  const r = IA.normalizarAnalisis({ estudiantesAtencion: [{ anonId: 'Alumno 1', senal: 'x' }] }, ctxSinCandidatos)
  assert.deepStrictEqual(r.estudiantesAtencion, [])
})

await caso('una respuesta basura de la IA no revienta el normalizador', () => {
  const ctx = agregado()
  assert.doesNotThrow(() => IA.normalizarAnalisis(null, ctx))
  assert.doesNotThrow(() => IA.normalizarAnalisis({ patrones: 'no soy un arreglo', recomendaciones: 42 }, ctx))
  const r = IA.normalizarAnalisis(null, ctx)
  assert.deepStrictEqual(r.patrones, [])
  assert.deepStrictEqual(r.recomendaciones, [])
  assert.strictEqual(r.resumenGeneral, '')
})

await caso('textos largos de la IA se acotan (no se mandan sin límite a la pantalla)', () => {
  const ctx = agregado()
  const r = IA.normalizarAnalisis({ resumenGeneral: 'x'.repeat(5000), resumenEjecutivo: 'y'.repeat(5000) }, ctx)
  assert.ok(r.resumenGeneral.length <= 1500)
  assert.ok(r.resumenEjecutivo.length <= 500)
})

grupo('El precheck contra Firestore — seguridad, umbral mínimo y "no se cobra si no alcanza"')

const OTRA_CATEGORIA = { docenteId: DOCENTE, categoria: 'entregable', nombre: 'No es evaluación' }

async function sembrarEvaluacionConEntregas({ actId, categoria = 'cuestionario', nEntregasFinalizadas = 3, docenteId = DOCENTE }) {
  await db.doc(`activities/${actId}`).set({ docenteId, categoria, nombre: 'Quiz de prueba' })
  await db.doc(`activities/${actId}/preguntas/p1`).set({ tipo: 'opcion_multiple', enunciado: '¿1+1?', opciones: [{ id: 'a', texto: '2' }, { id: 'b', texto: '3' }] })
  for (let i = 0; i < nEntregasFinalizadas; i++) {
    const subRef = await db.collection('submissions').add({
      actividadId: actId, alumnoId: `al${i}`, estadoEvaluacion: 'finalizado', calificacion: 8,
    })
    await db.doc(`submissions/${subRef.id}/respuestas/p1`).set({ opcionSeleccionada: 'a', correcta: true })
  }
  // Una entrega SIN finalizar — no debe contar para el umbral.
  await db.collection('submissions').add({ actividadId: actId, alumnoId: 'al_sin_finalizar', estadoEvaluacion: 'en_proceso' })
}

await limpiar()
await sembrarDocente()
await sembrarEvaluacionConEntregas({ actId: 'act_quiz_ok', nEntregasFinalizadas: IA.MIN_ENTREGAS_ANALISIS })
await sembrarEvaluacionConEntregas({ actId: 'act_quiz_pocas', nEntregasFinalizadas: IA.MIN_ENTREGAS_ANALISIS - 1 })
await db.doc('activities/act_examen_ok').set({ docenteId: DOCENTE, categoria: 'examen', nombre: 'Examen' })
await db.doc('activities/act_examen_ok/preguntas/p1').set({ tipo: 'verdadero_falso', enunciado: 'x', opciones: [{ id: 'v', texto: 'V' }, { id: 'f', texto: 'F' }] })
for (let i = 0; i < IA.MIN_ENTREGAS_ANALISIS; i++) {
  const subRef = await db.collection('submissions').add({ actividadId: 'act_examen_ok', alumnoId: `ex${i}`, estadoEvaluacion: 'finalizado' })
  await db.doc(`submissions/${subRef.id}/respuestas/p1`).set({ opcionSeleccionada: 'v', correcta: true })
}
await db.doc('activities/act_sin_preguntas').set({ docenteId: DOCENTE, categoria: 'cuestionario', nombre: 'Vacío' })
await db.doc('activities/act_otra_categoria').set(OTRA_CATEGORIA)
await db.doc('activities/act_quiz_ajena').set({ docenteId: OTRO_DOCENTE, categoria: 'cuestionario', nombre: 'Ajena' })

await caso('cuestionario con entregas suficientes: el precheck arma la agregación completa', async () => {
  const ctx = await IA.precheckAnalisisResultados({ uid: DOCENTE, params: { actividadId: 'act_quiz_ok' } })
  assert.strictEqual(ctx.categoria, 'cuestionario')
  assert.strictEqual(ctx.totalEstudiantes, IA.MIN_ENTREGAS_ANALISIS, 'la entrega sin finalizar no cuenta')
  assert.strictEqual(ctx.porcentajeAciertosGeneral, 100)
})

await caso('examen con entregas suficientes también es válido', async () => {
  const ctx = await IA.precheckAnalisisResultados({ uid: DOCENTE, params: { actividadId: 'act_examen_ok' } })
  assert.strictEqual(ctx.categoria, 'examen')
})

await caso('SEGURIDAD · una actividad que no es examen/cuestionario → failed-precondition', async () => {
  await assert.rejects(
    () => IA.precheckAnalisisResultados({ uid: DOCENTE, params: { actividadId: 'act_otra_categoria' } }),
    (e) => String(e.code).includes('failed-precondition')
  )
})

await caso('SEGURIDAD · actividad de otro docente → permission-denied', async () => {
  await assert.rejects(
    () => IA.precheckAnalisisResultados({ uid: DOCENTE, params: { actividadId: 'act_quiz_ajena' } }),
    (e) => String(e.code).includes('permission-denied')
  )
})

await caso('SEGURIDAD · sin actividadId → invalid-argument, pide guardar primero', async () => {
  await assert.rejects(
    () => IA.precheckAnalisisResultados({ uid: DOCENTE, params: { actividadId: '' } }),
    (e) => String(e.code).includes('invalid-argument')
  )
})

await caso('sin reactivos → failed-precondition, nada que analizar', async () => {
  await assert.rejects(
    () => IA.precheckAnalisisResultados({ uid: DOCENTE, params: { actividadId: 'act_sin_preguntas' } }),
    (e) => String(e.code).includes('failed-precondition')
  )
})

await caso('menos entregas que el mínimo → se detiene, dice cuántas hay y NO cobra', async () => {
  const antes = await creditosDe()
  let err
  try {
    await IA.precheckAnalisisResultados({ uid: DOCENTE, params: { actividadId: 'act_quiz_pocas' } })
  } catch (e) { err = e }
  assert.ok(err, 'debe fallar')
  assert.strictEqual(err.details.codigo, 'CONTEXTO_INSUFICIENTE')
  assert.ok(err.message.includes(String(IA.MIN_ENTREGAS_ANALISIS - 1)), 'dice cuántas entregas hay de verdad')
  const consumos = await db.collection('iaConsumos').get()
  assert.strictEqual(consumos.size, 0, 'no debe existir ninguna reserva')
  assert.deepStrictEqual((await creditosDe())?.saldo ?? null, antes?.saldo ?? null)
})

grupo('Tarifa y reembolso de OP-10')

await caso('la tarifa de analizar_resultados reserva y liquida exactamente 5 créditos', async () => {
  const k = clave()
  await L.reservar({ uid: DOCENTE, operacion: 'analizar_resultados', idempotencyKey: k, tarifas: TARIFAS })
  const saldoTrasReserva = (await creditosDe()).saldo
  await L.liquidar({ uid: DOCENTE, idempotencyKey: k, creditosReales: 5 })
  assert.strictEqual(saldoTrasReserva, (await creditosDe()).saldo)
  assert.strictEqual((await consumoDe(k)).creditosReales, 5)
})

await caso('fallo de la IA analizando resultados: reembolso completo de los 5 créditos', async () => {
  const k = clave()
  const saldoAntes = (await creditosDe()).saldo
  await L.reservar({ uid: DOCENTE, operacion: 'analizar_resultados', idempotencyKey: k, tarifas: TARIFAS })
  await L.reembolsar({ uid: DOCENTE, idempotencyKey: k, motivo: 'El asistente de IA no generó un análisis utilizable' })
  assert.strictEqual((await creditosDe()).saldo, saldoAntes)
  assert.strictEqual((await consumoDe(k)).estado, 'fallido')
})

// ── Diagnóstico del grupo (FASE 2-BIS, 12-ago-2026) — precheck compartido ──
grupo('Diagnóstico del grupo — precheck y tarifas')

const TARIFAS_DIAG = { ...TARIFAS, tarifas: { ...TARIFAS.tarifas, diagnostico_contexto: 5, diagnostico_conocimientos: 10 } }

const PERFIL_IA_COMPLETO = {
  estiloClase: 'Muy participativo', habilidades: 'Trabajo por proyectos', experiencia: '8 años en bachillerato',
}

async function precheckDiagnosticoFalla({ subjectId, uid = DOCENTE }) {
  try {
    await IA.precheckDiagnostico({ uid, params: { subjectId } })
    return null
  } catch (e) {
    return { code: e.code || e.httpErrorCode?.canonicalName, message: e.message, details: e.details }
  }
}

await limpiar()
await sembrarDocente()
await db.doc('subjects/sub_diag').set({ docenteId: DOCENTE, nombre: 'Matemáticas I' })
await db.doc('subjects/sub_diag_ajena').set({ docenteId: OTRO_DOCENTE, nombre: 'Ajena' })

await caso('SEGURIDAD · asignatura de OTRO docente → permission-denied', async () => {
  const e = await precheckDiagnosticoFalla({ subjectId: 'sub_diag_ajena' })
  assert.ok(e, 'debe fallar')
  assert.ok(String(e.code).includes('permission-denied'), e.code)
})

await caso('SEGURIDAD · asignatura inexistente → not-found', async () => {
  const e = await precheckDiagnosticoFalla({ subjectId: 'no_existe' })
  assert.ok(String(e.code).includes('not-found'), e.code)
})

await caso('SEGURIDAD · sin subjectId → invalid-argument, no revienta', async () => {
  const e = await precheckDiagnosticoFalla({ subjectId: '' })
  assert.ok(String(e.code).includes('invalid-argument'), e.code)
})

await caso('sin Perfil IA completo → failed-precondition PERFIL_IA_INCOMPLETO, no cobra', async () => {
  const antes = await creditosDe()
  const e = await precheckDiagnosticoFalla({ subjectId: 'sub_diag' })
  assert.ok(String(e.code).includes('failed-precondition'), e.code)
  assert.strictEqual(e.details.codigo, 'PERFIL_IA_INCOMPLETO')
  const consumos = await db.collection('iaConsumos').get()
  assert.strictEqual(consumos.size, 0, 'no debe existir ninguna reserva')
  assert.deepStrictEqual((await creditosDe())?.saldo ?? null, antes?.saldo ?? null)
})

await caso('Perfil IA completo pero SIN fuentes generales → failed-precondition SIN_FUENTES_GENERALES, no cobra', async () => {
  await db.doc(`users/${DOCENTE}`).set({ perfilIA: PERFIL_IA_COMPLETO }, { merge: true })
  const antes = await creditosDe()
  const e = await precheckDiagnosticoFalla({ subjectId: 'sub_diag' })
  assert.ok(String(e.code).includes('failed-precondition'), e.code)
  assert.strictEqual(e.details.codigo, 'SIN_FUENTES_GENERALES')
  assert.deepStrictEqual((await creditosDe())?.saldo ?? null, antes?.saldo ?? null)
})

await caso('una fuente de PARCIAL (no general) no cuenta para habilitar el diagnóstico', async () => {
  await db.collection('fuentesAsignatura').add({
    asignaturaId: 'sub_diag', docenteId: DOCENTE, nombre: 'parcial1.pdf',
    ubicacion: 'parcial', parcial: 1, url: 'https://res.cloudinary.com/demo/raw/upload/v1/x.pdf',
  })
  const e = await precheckDiagnosticoFalla({ subjectId: 'sub_diag' })
  assert.strictEqual(e.details.codigo, 'SIN_FUENTES_GENERALES')
})

await caso('con Perfil IA completo y una fuente general: pasa ambas validaciones (llega a intentar leer la fuente)', async () => {
  await db.collection('fuentesAsignatura').add({
    asignaturaId: 'sub_diag', docenteId: DOCENTE, nombre: 'programa.pdf',
    ubicacion: 'general', parcial: null, url: 'https://res.cloudinary.com/demo/raw/upload/v1/programa-de-prueba.pdf',
  })
  const e = await precheckDiagnosticoFalla({ subjectId: 'sub_diag' })
  // La URL de prueba no existe de verdad — falla al intentar LEERLA (llamada de
  // red, fuera del alcance de esta prueba), pero eso demuestra que ya pasó las
  // dos validaciones anteriores: el código de error YA NO es ninguno de los dos
  // de arriba.
  assert.ok(e, 'debe fallar (URL de prueba no descargable)')
  assert.notStrictEqual(e.details?.codigo, 'PERFIL_IA_INCOMPLETO')
  assert.notStrictEqual(e.details?.codigo, 'SIN_FUENTES_GENERALES')
})

await caso('diagnostico_contexto y diagnostico_conocimientos son operaciones independientes en el mapa de tarifas', async () => {
  assert.notStrictEqual(TARIFAS_DIAG.tarifas.diagnostico_contexto, undefined)
  assert.notStrictEqual(TARIFAS_DIAG.tarifas.diagnostico_conocimientos, undefined)
  assert.notStrictEqual(TARIFAS_DIAG.tarifas.diagnostico_contexto, TARIFAS_DIAG.tarifas.diagnostico_conocimientos)
})

await caso('la tarifa de diagnostico_contexto reserva y liquida exactamente 5 créditos fijos', async () => {
  const k = clave()
  await L.reservar({ uid: DOCENTE, operacion: 'diagnostico_contexto', idempotencyKey: k, tarifas: TARIFAS_DIAG })
  const saldoTrasReserva = (await creditosDe()).saldo
  await L.liquidar({ uid: DOCENTE, idempotencyKey: k, creditosReales: 5 })
  assert.strictEqual(saldoTrasReserva, (await creditosDe()).saldo)
  assert.strictEqual((await consumoDe(k)).creditosReales, 5)
})

await caso('la tarifa de diagnostico_conocimientos reserva y liquida exactamente 10 créditos fijos', async () => {
  const k = clave()
  await L.reservar({ uid: DOCENTE, operacion: 'diagnostico_conocimientos', idempotencyKey: k, tarifas: TARIFAS_DIAG })
  const saldoTrasReserva = (await creditosDe()).saldo
  await L.liquidar({ uid: DOCENTE, idempotencyKey: k, creditosReales: 10 })
  assert.strictEqual(saldoTrasReserva, (await creditosDe()).saldo)
  assert.strictEqual((await consumoDe(k)).creditosReales, 10)
})

await caso('fallo del diagnóstico de conocimientos: reembolso completo de los 10 créditos', async () => {
  const k = clave()
  const saldoAntes = (await creditosDe()).saldo
  await L.reservar({ uid: DOCENTE, operacion: 'diagnostico_conocimientos', idempotencyKey: k, tarifas: TARIFAS_DIAG })
  await L.reembolsar({ uid: DOCENTE, idempotencyKey: k, motivo: 'El asistente de IA no generó un diagnóstico de conocimientos utilizable' })
  assert.strictEqual((await creditosDe()).saldo, saldoAntes)
  assert.strictEqual((await consumoDe(k)).estado, 'fallido')
})

resumen('pruebas del ledger de créditos IA')
