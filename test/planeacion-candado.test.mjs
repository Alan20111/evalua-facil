// Candado "una sola Planeación en curso por asignatura" (29-sep-2026) —
// pruebas contra el emulador de Firestore, por el callable completo.
//
//   firebase emulators:exec --only firestore,auth --project demo-test \
//     "node test/planeacion-candado.test.mjs"
//
// Qué se afirma: la segunda Planeación simultánea de la misma asignatura se
// rechaza con PLANEACION_EN_CURSO ANTES de reservar (sin iaConsumos, sin tocar
// el saldo), y el candado se libera en todos los caminos de salida.
//
// Sin Anthropic ni créditos reales: el precheck y el ejecutor de
// `planeacion_didactica_inicial` se reemplazan por dobles que se controlan
// desde aquí (tiempo, éxito, fallo). Reserva, liquidación, reembolso,
// idempotencia y candado son el código de verdad.

import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import { db, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'

const require = createRequire(import.meta.url)
process.env.ANTHROPIC_API_KEY_PROD ||= 'sk-ant-prueba-' + 'x'.repeat(40)
const IA_FN = require('../functions/ia.js')
const IA = IA_FN._pruebas
const L = require('../functions/creditosLedger.js')
const { Timestamp } = require('firebase-admin/firestore')

const OP = 'planeacion_didactica_inicial'
const DOCENTE = 'docente_plan'
const AJENO = 'docente_ajeno'
const SUB = 'sub_candado'
const clave = () => crypto.randomUUID()

const TARIFAS = {
  version: 1,
  tarifas: { [OP]: 20, aviso: 1 },
  categorias: { [OP]: 'Planeación', aviso: 'Avisos' },
  modeloPorOperacion: { [OP]: 'claude-haiku-4-5', aviso: 'claude-haiku-4-5' },
}

// ── Dobles ───────────────────────────────────────────────────────────────────
const PRECHECK_REAL = IA.PRECHECKS[OP]
const EJECUTOR_REAL = IA.OPERACIONES[OP]
const EJECUTOR_AVISO_REAL = IA.OPERACIONES.aviso
const LIQUIDAR_REAL = L.liquidar

let llamadasEjecutor = 0
// Cada prueba decide qué hace el ejecutor; por omisión, lo mismo que el real:
// guarda la bitácora y devuelve 1 unidad.
let comportamiento = null

// Promesa que la prueba suelta a mano (para dejar una generación "colgada").
function diferido() {
  let soltar, fallar
  const p = new Promise((res, rej) => { soltar = res; fallar = rej })
  return { p, soltar, fallar }
}

const PRECHECK_DOBLE = async ({ uid, params }) => {
  // Lo mismo que el precheck real exige antes de todo: la asignatura es suya.
  const s = await db.doc(`subjects/${String(params.subjectId || '').trim()}`).get()
  if (!s.exists || s.data().docenteId !== uid) throw new Error('precheck: asignatura ajena')
  if (params.__fallarPrecheck) throw new Error('precheck falló')
  return { cantidadSolicitada: null }
}
IA.PRECHECKS[OP] = PRECHECK_DOBLE
IA.OPERACIONES[OP] = async ({ params }) => {
  llamadasEjecutor++
  if (comportamiento) return comportamiento({ params })
  return generacionNormal({ params })
}
async function generacionNormal({ params }) {
  await db.collection(`subjects/${params.subjectId}/planeacionesIA`).add({
    porParcial: [{ numero: 1, secuencias: [{}] }], docenteId: params.__uid, generadoEn: Timestamp.now(),
  })
  return { resultado: { porParcial: [{ numero: 1, secuencias: [{}] }] }, unidadesReales: 1, interno: {} }
}

const planear = ({ k = clave(), subjectId = SUB, uid = DOCENTE, extra = {} } = {}) =>
  IA_FN.ejecutarOperacionIA.run({
    auth: { uid },
    data: { operacion: OP, idempotencyKey: k, params: { subjectId, asignaturaId: subjectId, ...extra }, unidades: 1 },
  })

const codigoDe = (e) => e?.details?.codigo || null
const saldo = async (uid = DOCENTE) => (await db.doc(`iaCreditos/${uid}`).get()).data()?.saldo
const candado = async (subjectId = SUB) => (await db.doc(`subjects/${subjectId}/iaEnCurso/planeacion`).get()).data() || null
const consumos = async () => (await db.collection('iaConsumos').get()).docs.map((d) => ({ id: d.id, ...d.data() }))
const planeaciones = async (subjectId = SUB) => (await db.collection(`subjects/${subjectId}/planeacionesIA`).get()).size
const esperarA = async (cond, ms = 5000) => {
  const fin = Date.now() + ms
  while (Date.now() < fin) { if (await cond()) return; await new Promise((r) => setTimeout(r, 25)) }
  throw new Error('timeout esperando la condición')
}

async function reiniciar({ saldoInicial = 100 } = {}) {
  await limpiar()
  await db.doc(`users/${DOCENTE}`).set({ role: 'docente', nombre: 'Prueba', escuelaId: 'E1' })
  await db.doc(`users/${AJENO}`).set({ role: 'docente', nombre: 'Ajeno', escuelaId: 'E1' })
  await db.doc('config/iaTarifas').set(TARIFAS)
  await db.doc(`subjects/${SUB}`).set({ docenteId: DOCENTE, nombre: 'Cultura Digital I', parciales: 1 })
  await db.doc('subjects/sub_otra').set({ docenteId: DOCENTE, nombre: 'Otra', parciales: 1 })
  await db.doc('subjects/sub_ajena').set({ docenteId: AJENO, nombre: 'Ajena', parciales: 1 })
  await db.doc(`iaCreditos/${DOCENTE}`).set({ saldo: saldoInicial, consumidoTotal: 0, consumoPorCategoria: {} })
  llamadasEjecutor = 0
  comportamiento = null
  L.liquidar = LIQUIDAR_REAL
  IA.OPERACIONES.aviso = EJECUTOR_AVISO_REAL
}

// ═════════════════════════════════════════════════════════════════════════════
grupo('Candado de Planeación — camino normal')

await caso('1 · generación normal: una reserva, una liquidación, saldo 100 → 80, candado liberado', async () => {
  await reiniciar()
  const k = clave()
  const r = await planear({ k })
  assert.strictEqual(r.creditosReales, 20)
  const cs = await consumos()
  assert.strictEqual(cs.length, 1, 'exactamente una reserva')
  assert.strictEqual(cs[0].id, k)
  assert.strictEqual(cs[0].estado, 'ejecutado', 'liquidada')
  assert.strictEqual(await saldo(), 80)
  assert.strictEqual(await planeaciones(), 1)
  assert.strictEqual(await candado(), null, 'candado liberado al terminar')
})

await caso('mientras genera, el candado existe con uid, idempotencyKey, iniciadoEn y expiraEn = +10 min', async () => {
  await reiniciar()
  const d = diferido()
  comportamiento = async (x) => { await d.p; return generacionNormal(x) }
  const k = clave()
  const primera = planear({ k })
  try {
    await esperarA(async () => llamadasEjecutor === 1)
    const c = await candado()
    assert.ok(c, 'hay candado mientras genera')
    assert.strictEqual(c.uid, DOCENTE)
    assert.strictEqual(c.idempotencyKey, k)
    assert.ok(c.iniciadoEn instanceof Timestamp)
    assert.strictEqual(c.expiraEn.toMillis() - c.iniciadoEn.toMillis(), IA.CANDADO_PLANEACION_MS)
    assert.strictEqual(IA.CANDADO_PLANEACION_MS, 10 * 60 * 1000)
  } finally { d.soltar(); await primera.catch(() => {}) }
  await primera
  assert.strictEqual(await candado(), null)
})

await caso('3 · segunda generación DESPUÉS de terminar la primera: se permite normal (100 → 80 → 60)', async () => {
  await reiniciar()
  await planear()
  await planear()
  assert.strictEqual((await consumos()).length, 2)
  assert.strictEqual(await saldo(), 60)
  assert.strictEqual(await planeaciones(), 2)
  assert.strictEqual(await candado(), null)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Candado de Planeación — concurrencia')

await caso('2 · dos llamadas simultáneas con claves distintas: una sola reserva; la otra PLANEACION_EN_CURSO sin iaConsumos ni saldo', async () => {
  await reiniciar()
  const d = diferido()
  comportamiento = async (x) => { await d.p; return generacionNormal(x) }
  const [k1, k2] = [clave(), clave()]
  const salidas = []
  const seguir = (p) => p.then((v) => { salidas.push({ ok: v }); return { ok: v } }, (e) => { salidas.push({ e }); return { e } })
  const p1 = seguir(planear({ k: k1 }))
  const p2 = seguir(planear({ k: k2 }))
  try {
    // La perdedora sale sola (antes de reservar); la ganadora queda colgada.
    // Sin candado las dos llegarían al ejecutor y ninguna saldría.
    await esperarA(async () => (salidas.length === 1 && llamadasEjecutor === 1) || llamadasEjecutor === 2)
    await new Promise((r) => setTimeout(r, 200))
    assert.strictEqual(llamadasEjecutor, 1, 'la IA arrancó una sola vez')
    assert.strictEqual(salidas.length, 1)
    assert.strictEqual(codigoDe(salidas[0].e), 'PLANEACION_EN_CURSO')
    assert.ok(String(salidas[0].e.code).includes('failed-precondition'))
    assert.strictEqual((await consumos()).length, 1, 'la rechazada NO creó iaConsumos')
    assert.strictEqual(await saldo(), 80, 'solo la ganadora reservó (100 − 20)')
  } finally { d.soltar(); await Promise.all([p1, p2]) }
  const [r1, r2] = await Promise.all([p1, p2])
  assert.strictEqual([r1, r2].filter((r) => r.ok).length, 1, 'exactamente una obtiene el candado')
  assert.strictEqual((await consumos()).length, 1)
  assert.strictEqual(await saldo(), 80, 'saldo final: un solo cobro')
  assert.strictEqual(await planeaciones(), 1, 'una sola Planeación')
  assert.strictEqual(llamadasEjecutor, 1, 'la IA corrió una sola vez')
  assert.strictEqual(await candado(), null)
})

await caso('5 llamadas simultáneas: mientras la primera sigue en curso, las otras 4 salen con PLANEACION_EN_CURSO', async () => {
  await reiniciar()
  const d = diferido()
  comportamiento = async (x) => { await d.p; return generacionNormal(x) }
  const salidas = []
  const ps = Array.from({ length: 5 }, () => planear().then(
    (v) => { salidas.push({ ok: v }); return { ok: v } },
    (e) => { salidas.push({ e }); return { e } },
  ))
  try {
    // La primera queda colgada; las demás deben rechazarse SIN esperar a que
    // termine (la contención de la transacción puede demorarlas un poco).
    // (La ganadora puede tardar en llegar al ejecutor: todavía reserva.)
    await esperarA(async () => salidas.length === 4 && llamadasEjecutor === 1, 15000)
    await new Promise((r) => setTimeout(r, 200))
    assert.strictEqual(llamadasEjecutor, 1, 'la IA arrancó una sola vez')
    assert.strictEqual(salidas.length, 4)
    assert.ok(salidas.every((r) => codigoDe(r.e) === 'PLANEACION_EN_CURSO'), JSON.stringify(salidas.map((r) => codigoDe(r.e))))
    assert.strictEqual((await consumos()).length, 1)
    assert.strictEqual(await saldo(), 80)
  } finally { d.soltar(); await Promise.all(ps) }
  const rs = await Promise.all(ps)
  assert.strictEqual(rs.filter((r) => r.ok).length, 1)
  assert.strictEqual(await saldo(), 80)
  assert.strictEqual(await candado(), null)
})

await caso('timeout del cliente: el servidor sigue; un segundo clic (otra clave) mientras tanto se rechaza sin cobrar', async () => {
  // El cliente ya "dejó de esperar" la primera (deadline-exceeded): para el
  // servidor eso no cambia nada — la primera sigue viva con su candado.
  await reiniciar()
  const d = diferido()
  comportamiento = async (x) => { await d.p; return generacionNormal(x) }
  const primera = planear()
  try {
    await esperarA(async () => llamadasEjecutor === 1)
    const e = await Promise.race([
      planear().then(() => null, (x) => x),
      new Promise((r) => setTimeout(() => r({ details: { codigo: 'NO_RECHAZADA_A_TIEMPO' } }), 3000)),
    ])
    assert.strictEqual(codigoDe(e), 'PLANEACION_EN_CURSO')
    assert.strictEqual(await saldo(), 80)
  } finally { d.soltar(); await primera.catch(() => {}) }
  await primera
  assert.strictEqual(await planeaciones(), 1)
  assert.strictEqual(await saldo(), 80)
  assert.strictEqual(await candado(), null)
  // Y ahora sí se puede otra.
  comportamiento = null
  await planear()
  assert.strictEqual(await saldo(), 60)
})

await caso('asignaturas distintas no se bloquean entre sí', async () => {
  await reiniciar()
  const d = diferido()
  comportamiento = async (x) => { await d.p; return generacionNormal(x) }
  const a = planear({ subjectId: SUB })
  const b = planear({ subjectId: 'sub_otra' })
  try { await esperarA(async () => llamadasEjecutor === 2) } finally { d.soltar(); await Promise.allSettled([a, b]) }
  await Promise.all([a, b])
  assert.strictEqual(await saldo(), 60)
  assert.strictEqual(await candado(SUB), null)
  assert.strictEqual(await candado('sub_otra'), null)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Candado de Planeación — liberación en caminos de error')

await caso('4 · error de IA: reembolso íntegro, candado liberado, y se puede intentar de nuevo', async () => {
  await reiniciar()
  comportamiento = async () => { throw new Error('la IA se cayó') }
  const k = clave()
  const e = await planear({ k }).then(() => null, (x) => x)
  assert.ok(String(e?.code).includes('unavailable'), String(e?.code))
  const c = (await consumos()).find((x) => x.id === k)
  assert.strictEqual(c.estado, 'fallido', 'reembolsada por el mecanismo existente')
  assert.strictEqual(await saldo(), 100)
  assert.strictEqual(await candado(), null)
  comportamiento = null
  await planear()
  assert.strictEqual(await saldo(), 80)
})

await caso('5 · saldo insuficiente: SALDO_INSUFICIENTE, candado NO queda huérfano; al recargar saldo se puede', async () => {
  await reiniciar({ saldoInicial: 5 })
  const e = await planear().then(() => null, (x) => x)
  assert.strictEqual(codigoDe(e), 'SALDO_INSUFICIENTE')
  assert.strictEqual(await candado(), null)
  assert.strictEqual((await consumos()).length, 0)
  assert.strictEqual(llamadasEjecutor, 0)
  await db.doc(`iaCreditos/${DOCENTE}`).set({ saldo: 100 }, { merge: true })
  await planear()
  assert.strictEqual(await saldo(), 80)
})

await caso('error ANTES de reservar (precheck): no se crea candado ni reserva', async () => {
  await reiniciar()
  const e = await planear({ extra: { __fallarPrecheck: true } }).then(() => null, (x) => x)
  assert.ok(e)
  assert.strictEqual(await candado(), null)
  assert.strictEqual((await consumos()).length, 0)
  assert.strictEqual(await saldo(), 100)
})

await caso('error en la liquidación: se devuelve el resultado con advertencia y el candado se libera igual', async () => {
  await reiniciar()
  L.liquidar = async () => { throw new Error('liquidar falló') }
  try {
    const r = await planear()
    assert.strictEqual(r.advertencia, 'liquidacion-pendiente')
  } finally { L.liquidar = LIQUIDAR_REAL }
  assert.strictEqual(await candado(), null)
})

await caso('SEGURIDAD · asignatura AJENA (precheck real): permission-denied y NO se crea candado sobre ella', async () => {
  await reiniciar()
  IA.PRECHECKS[OP] = PRECHECK_REAL
  try {
    const e = await planear({ subjectId: 'sub_ajena' }).then(() => null, (x) => x)
    assert.ok(String(e?.code).includes('permission-denied'), String(e?.code))
  } finally {
    IA.PRECHECKS[OP] = PRECHECK_DOBLE
  }
  assert.strictEqual(await candado('sub_ajena'), null)
  assert.strictEqual((await consumos()).length, 0)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Candado de Planeación — expiración')

await caso('6a · candado VIGENTE de otra llamada (p. ej. otra pestaña): no se reemplaza, PLANEACION_EN_CURSO sin cobrar', async () => {
  await reiniciar()
  const ahora = Date.now()
  await db.doc(`subjects/${SUB}/iaEnCurso/planeacion`).set({
    uid: DOCENTE, idempotencyKey: 'otra-llamada-viva', iniciadoEn: Timestamp.fromMillis(ahora - 60_000),
    expiraEn: Timestamp.fromMillis(ahora + 9 * 60_000),
  })
  const e = await planear().then(() => null, (x) => x)
  assert.strictEqual(codigoDe(e), 'PLANEACION_EN_CURSO')
  assert.strictEqual((await candado()).idempotencyKey, 'otra-llamada-viva', 'intacto')
  assert.strictEqual((await consumos()).length, 0)
  assert.strictEqual(await saldo(), 100)
})

await caso('6b · candado VENCIDO (proceso muerto): se reemplaza, la generación pasa y al final se libera', async () => {
  await reiniciar()
  const ahora = Date.now()
  await db.doc(`subjects/${SUB}/iaEnCurso/planeacion`).set({
    uid: DOCENTE, idempotencyKey: 'proceso-muerto', iniciadoEn: Timestamp.fromMillis(ahora - 11 * 60_000),
    expiraEn: Timestamp.fromMillis(ahora - 60_000),
  })
  await planear()
  assert.strictEqual(await saldo(), 80)
  assert.strictEqual(await candado(), null)
})

await caso('6c · reemplazo atómico de uno vencido: de dos llamadas simultáneas solo una lo toma', async () => {
  await reiniciar()
  const ahora = Date.now()
  await db.doc(`subjects/${SUB}/iaEnCurso/planeacion`).set({
    uid: DOCENTE, idempotencyKey: 'proceso-muerto', iniciadoEn: Timestamp.fromMillis(ahora - 11 * 60_000),
    expiraEn: Timestamp.fromMillis(ahora - 60_000),
  })
  const rs = await Promise.all([
    IA.tomarCandadoPlaneacion({ subjectId: SUB, uid: DOCENTE, idempotencyKey: 'aaaaaaaa-1' }).then((v) => ({ ok: v }), (e) => ({ e })),
    IA.tomarCandadoPlaneacion({ subjectId: SUB, uid: DOCENTE, idempotencyKey: 'bbbbbbbb-2' }).then((v) => ({ ok: v }), (e) => ({ e })),
  ])
  assert.strictEqual(rs.filter((r) => r.ok).length, 1)
  assert.strictEqual(rs.filter((r) => codigoDe(r.e) === 'PLANEACION_EN_CURSO').length, 1)
  const ganadora = rs.find((r) => r.ok).ok.idempotencyKey
  assert.strictEqual((await candado()).idempotencyKey, ganadora)
})

await caso('liberar solo borra el candado propio: el de otra llamada que reemplazó uno vencido se respeta', async () => {
  await reiniciar()
  const hace11 = new Date(Date.now() - 11 * 60_000)
  const viejo = await IA.tomarCandadoPlaneacion({ subjectId: SUB, uid: DOCENTE, idempotencyKey: 'vieja-000', ahora: hace11 })
  const nuevo = await IA.tomarCandadoPlaneacion({ subjectId: SUB, uid: DOCENTE, idempotencyKey: 'nueva-000' })
  assert.ok(viejo && nuevo)
  await IA.liberarCandadoPlaneacion(viejo)
  assert.strictEqual((await candado()).idempotencyKey, 'nueva-000', 'la vieja no borra el de la nueva')
  await IA.liberarCandadoPlaneacion(nuevo)
  assert.strictEqual(await candado(), null)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Candado de Planeación — idempotencia existente intacta')

await caso('7a · reintento con la MISMA clave tras terminar: repetida, sin cobrar de nuevo, candado liberado', async () => {
  await reiniciar()
  const k = clave()
  await planear({ k })
  const r = await planear({ k })
  assert.strictEqual(r.repetida, true)
  assert.strictEqual(await saldo(), 80)
  assert.strictEqual((await consumos()).length, 1)
  assert.strictEqual(llamadasEjecutor, 1)
  assert.strictEqual(await candado(), null)
})

await caso('7b · reintento con la MISMA clave mientras sigue en curso: "ya está en proceso" (aborted) y NO suelta el candado ajeno', async () => {
  await reiniciar()
  const d = diferido()
  comportamiento = async (x) => { await d.p; return generacionNormal(x) }
  const k = clave()
  const primera = planear({ k })
  try {
    await esperarA(async () => llamadasEjecutor === 1)
    const e = await planear({ k }).then(() => null, (x) => x)
    assert.ok(String(e?.code).includes('aborted'), String(e?.code))
    assert.strictEqual((await candado())?.idempotencyKey, k, 'el candado sigue siendo de la primera')
    assert.strictEqual(await saldo(), 80)
  } finally { d.soltar(); await primera.catch(() => {}) }
  await primera
  assert.strictEqual(await candado(), null)
  assert.strictEqual(await saldo(), 80)
})

await caso('otras operaciones de IA no usan el candado: dos "aviso" simultáneos pasan los dos', async () => {
  await reiniciar()
  IA.OPERACIONES.aviso = async () => ({ resultado: { texto: 'ok' }, unidadesReales: 1, interno: {} })
  const llamarAviso = () => IA_FN.ejecutarOperacionIA.run({
    auth: { uid: DOCENTE },
    data: { operacion: 'aviso', idempotencyKey: clave(), params: { asignaturaId: SUB }, unidades: 1 },
  })
  await Promise.all([llamarAviso(), llamarAviso()])
  assert.strictEqual(await saldo(), 98)
  assert.strictEqual(await candado(), null)
  assert.strictEqual((await db.collection(`subjects/${SUB}/iaEnCurso`).get()).size, 0)
})

// ── Restaurar ───────────────────────────────────────────────────────────────
IA.PRECHECKS[OP] = PRECHECK_REAL
IA.OPERACIONES[OP] = EJECUTOR_REAL
IA.OPERACIONES.aviso = EJECUTOR_AVISO_REAL
L.liquidar = LIQUIDAR_REAL

resumen('pruebas del candado de Planeación')
