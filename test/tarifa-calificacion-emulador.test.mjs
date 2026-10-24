// «Calificar con IA» con tarifa POR ENTREGA (oct-2026) — de punta a punta
// contra el emulador: estimación del servidor → confirmación → reserva →
// IA (falsa) → liquidación / reembolso → registro de movimientos.
//
// Regla definitiva: 0.25 si la entrega es solo texto; 0.50 si trae al menos
// una imagen o texto escaneado (foto, PDF escaneado aunque traiga capa de
// texto, PDF o Word con fotografías), una sola vez por entrega; si no se puede
// clasificar con fiabilidad, no se califica ni se cobra. Igual individual y en
// lote. El costo que se confirma es el que se reserva y, salvo entregas que
// fallen, el que se cobra.
//
// Sin red ni créditos reales: Anthropic falso, `fetch` falso que sirve PDF y
// Word REALES generados aquí (helpers/fixturesEvidencias.mjs), emulador.
//
//   firebase emulators:exec --only firestore,auth --project demo-test "node test/tarifa-calificacion-emulador.test.mjs"
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import { db, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'
import * as FX from './helpers/fixturesEvidencias.mjs'

const require = createRequire(import.meta.url)
const DOCENTE = 'docente-tarifa'
const ACTIVIDAD = 'act-tarifa'
const clave = () => crypto.randomUUID()
const codigoDe = (e) => String(e?.code || '')

// ── Anthropic falso: falla para las entregas cuyo id esté en `fallarPara` ──
const requireFn = createRequire(new URL('../functions/index.js', import.meta.url))
const rutaSdk = requireFn.resolve('@anthropic-ai/sdk')
requireFn(rutaSdk)
const pedidosIA = []
const fallarPara = new Set()
require.cache[rutaSdk].exports = class AnthropicFalso {
  constructor() {
    this.messages = {
      create: async (req) => {
        pedidosIA.push(req)
        const crudo = JSON.stringify(req)
        if (fallarPara.has('*')) throw new Error('IA caída (prueba)')
        // Las imágenes y los PDF viajan por URL (…/s1-foto.png): así se elige cuál falla.
        for (const id of fallarPara) if (crudo.includes(`/${id}-`)) throw new Error('IA caída (prueba)')
        const texto = JSON.stringify({
          criterios: [{ n: 1, nivel: 0, evidencia: 'Cumple', sinEvidenciaSuficiente: false }],
          retroalimentacionGeneral: 'Buen trabajo.', confianza: 'alta',
        })
        return { content: [{ type: 'text', text: texto }], usage: { input_tokens: 10, output_tokens: 10 } }
      },
    }
  }
}
process.env.ANTHROPIC_API_KEY_PROD ||= 'sk-ant-prueba-' + 'x'.repeat(40)
const IA_FN = require('../functions/ia.js')
const EVID = require('../functions/evidenciasEntrega.js')

// ── Archivos de prueba REALES, servidos según su nombre ────────────────────
const ARCHIVOS = {
  'texto.pdf': FX.pdf({ caracteresPorPagina: 600 }),
  'escaneado.pdf': FX.pdf({ imagen: [800, 1000] }),
  'ocr.pdf': FX.pdf({ imagen: [800, 1000], caracteresPorPagina: 600 }), // escaneo con capa de texto de la app
  'foto-texto.pdf': FX.pdf({ imagen: [400, 300], caracteresPorPagina: 600 }),
  'logo.pdf': FX.pdf({ imagen: [80, 80], caracteresPorPagina: 600 }),
  'blanco.pdf': FX.pdf({}),
  'danado.pdf': FX.pdfDanado(),
  'largo.pdf': FX.pdf({ paginas: 11, imagen: [800, 1000] }), // 11 páginas escaneadas: más de lo que la IA puede mirar
  'texto.docx': await FX.docx({ texto: 'Reporte de practica: instalacion de la impresora.' }),
  'foto.docx': await FX.docx({ texto: 'Reporte con fotografia', imagen: [600, 400] }),
  'icono.docx': await FX.docx({ texto: 'Reporte con icono', imagen: [48, 48] }),
}
function archivoPara(url) {
  // El nombre va después del id de la entrega: «…/c3-foto.docx» → «foto.docx».
  const nombre = url.split('/').pop().replace(/^[a-z]+\d+-/, '')
  if (ARCHIVOS[nombre]) return ARCHIVOS[nombre]
  if (nombre === 'no-existe.pdf') return null
  if (nombre.endsWith('.pdf')) return ARCHIVOS['texto.pdf']
  if (nombre.endsWith('.docx')) return ARCHIVOS['texto.docx']
  return null
}
const descargas = []
const fetchReal = globalThis.fetch
// `caso()` (helpers/entorno.mjs) vuelve a poner el fetch real al terminar cada
// caso, a propósito; por eso el stub se instala en cada `sembrar()`.
function pincharArchivos() {
  globalThis.fetch = async (url, ...resto) => {
    const u = String(url)
    if (!u.startsWith('https://archivos.test/')) return fetchReal(url, ...resto)
    descargas.push(u)
    const bytes = archivoPara(u)
    return bytes ? new Response(bytes, { status: 200 }) : new Response('no existe', { status: 404 })
  }
}

// Tarifas de prueba: SIN categoría para las claves «…_imagenes» (como estaba
// producción) — así se prueba que el ledger usa la de la operación base.
const TARIFAS = {
  version: 1,
  tarifas: {
    calificar_entregable_ia: 0.25, calificar_entregable_ia_imagenes: 0.5,
    calificar_entregable_ia_lote: 0.25, calificar_entregable_ia_lote_imagenes: 0.5,
  },
  categorias: {
    calificar_entregable_ia: 'Calificación de evidencias',
    calificar_entregable_ia_lote: 'Calificación de evidencias',
  },
  modeloPorOperacion: { calificar_entregable_ia: 'claude-haiku-4-5', calificar_entregable_ia_lote: 'claude-haiku-4-5' },
}
const RUBRICA = {
  tipo: 'rubrica',
  criterios: [{ nombre: 'Criterio 1', puntos: [10, 5, 0], descriptores: ['Completo', 'Parcial', 'No cumple'] }],
  niveles: [{ nombre: 'Completo' }, { nombre: 'Parcial' }, { nombre: 'No cumple' }],
}
const archivo = (sub, nombre) => ({ url: `https://archivos.test/${sub}-${nombre}`, nombre })
const IMAGENES = ['s1', 's2', 's3', 's4']
const DOCUMENTOS = ['s5', 's6', 's7', 's8', 's9', 's10']

async function sembrar({ saldo = 100, extra = {} } = {}) {
  await limpiar()
  pincharArchivos()
  EVID._pruebas.limpiarCache()
  pedidosIA.length = 0
  descargas.length = 0
  fallarPara.clear()
  await db.doc(`users/${DOCENTE}`).set({ role: 'docente', nombre: 'Prueba', escuelaId: 'E1' })
  await db.doc('config/iaTarifas').set(TARIFAS)
  await db.doc(`iaCreditos/${DOCENTE}`).set({ saldo, consumidoTotal: 0, consumoPorCategoria: {} })
  await db.doc('subjects/sub-tarifa').set({ docenteId: DOCENTE, nombre: 'Informática', parciales: 2 })
  // La actividad acepta «cualquier archivo»: antes eso cobraba 0.50 a todo el
  // lote aunque la pantalla anunciara 0.25. Ahora decide lo entregado.
  await db.doc(`activities/${ACTIVIDAD}`).set({
    docenteId: DOCENTE, asignaturaId: 'sub-tarifa', parcial: 1, categoria: 'entregable', nombre: 'Práctica',
    instrucciones: 'Entrega tu práctica', tiposArchivo: ['todos'], rubrica: RUBRICA,
  })
  const subs = {
    // Con imágenes (una, varias, mezcla con PDF, JPEG en mayúsculas).
    s1: [archivo('s1', 'foto.png')],
    s2: [archivo('s2', 'a.jpg'), archivo('s2', 'b.JPEG')],
    s3: [archivo('s3', 'reporte.pdf'), archivo('s3', 'evidencia.png')],
    s4: [archivo('s4', 'foto.JPG'), archivo('s4', 'nota.gif')],
    // Solo documentos (PDF, DOCX, mezcla de ambos).
    s5: [archivo('s5', 'tarea.pdf')],
    s6: [archivo('s6', 'tarea.docx')],
    s7: [archivo('s7', 'a.pdf'), archivo('s7', 'b.docx')],
    s8: [archivo('s8', 'tarea.pdf')],
    s9: [archivo('s9', 'tarea.pdf'), archivo('s9', 'gif-ignorado.gif')],
    s10: [archivo('s10', 'tarea.pdf')],
    ...extra,
  }
  for (const [id, archivos] of Object.entries(subs)) {
    await db.doc(`submissions/${id}`).set({ actividadId: ACTIVIDAD, alumnoId: `al-${id}`, calificacion: null, archivos })
  }
}

const correr = (data, uid = DOCENTE) => IA_FN.ejecutarOperacionIA.run({ auth: { uid }, data })
const estimar = (params, uid) => correr({ operacion: 'estimar_calificacion_evidencias', params }, uid).then((r) => r.estimacion)
const ejecutarLote = (costoConfirmado, { k = clave(), params = {} } = {}) => correr({
  operacion: 'calificar_entregable_ia_lote', idempotencyKey: k, unidades: costoConfirmado?.entregas || 1,
  params: { actividadId: ACTIVIDAD, ...params, ...(costoConfirmado !== undefined && { costoConfirmado }) },
})
const ejecutarIndividual = (submissionId, costoConfirmado, k = clave()) => correr({
  operacion: 'calificar_entregable_ia', idempotencyKey: k, unidades: 1,
  params: { actividadId: ACTIVIDAD, submissionId, ...(costoConfirmado !== undefined && { costoConfirmado }) },
})
const saldoDe = async () => (await db.doc(`iaCreditos/${DOCENTE}`).get()).data().saldo
const consumos = async () => (await db.collection('iaConsumos').get()).docs.map((d) => ({ id: d.id, ...d.data() }))
const movimientos = async () => (await db.collection('iaMovimientos').get()).docs.map((d) => ({ id: d.id, ...d.data() }))
const propuestas = async () => (await db.collection(`activities/${ACTIVIDAD}/iaSugerenciasEntregable`).get()).docs
async function falla(fn) { try { await fn() } catch (e) { return e } throw new Error('se esperaba un error') }
async function sinCobro(saldoEsperado = 100) {
  assert.strictEqual(await saldoDe(), saldoEsperado, 'el saldo no cambia')
  assert.strictEqual((await consumos()).length, 0, 'no se reservó nada')
  assert.strictEqual((await movimientos()).length, 0, 'no hay movimiento')
}

grupo('Estimación del servidor (lo que ve el docente antes de confirmar)')

await caso('lote de 4 con imágenes + 6 solo documentos: 3.50 exactos, con el desglose, sin cobrar ni llamar a la IA', async () => {
  await sembrar()
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  assert.deepStrictEqual(
    [e.entregas, e.conImagenes, e.soloDocumentos, e.tarifaImagenes, e.tarifaDocumentos, e.total],
    [10, 4, 6, 0.5, 0.25, 3.5])
  assert.ok(typeof e.firma === 'string' && e.firma.length >= 16, 'lleva firma')
  assert.strictEqual(pedidosIA.length, 0, 'estimar no llama a la IA')
  await sinCobro()
})

await caso('la misma entrega cuesta lo mismo sola que en el lote (imagen 0.50, documento 0.25, mezcla con imagen 0.50)', async () => {
  await sembrar()
  for (const [sub, esperado] of [['s1', 0.5], ['s3', 0.5], ['s4', 0.5], ['s5', 0.25], ['s6', 0.25], ['s7', 0.25], ['s9', 0.25]]) {
    const e = await estimar({ modo: 'individual', actividadId: ACTIVIDAD, submissionId: sub })
    assert.strictEqual(e.total, esperado, sub)
    assert.strictEqual(e.entregas, 1)
  }
  await sinCobro()
})

await caso('entregas no procesables no se anuncian: PDF de 11 páginas sin texto y entrega solo con formato no reconocido', async () => {
  await sembrar({ extra: { s11: [archivo('s11', 'largo.pdf')], s12: [archivo('s12', 'foto.gif')], s13: [archivo('s13', 'foto')] } })
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  assert.strictEqual(e.entregas, 10, 'las 3 sin evidencia procesable no cuentan')
  const individual = await falla(() => estimar({ modo: 'individual', actividadId: ACTIVIDAD, submissionId: 's11' }))
  assert.ok(codigoDe(individual).includes('failed-precondition'), codigoDe(individual))
  await sinCobro()
})

await caso('la estimación no descarga dos veces lo mismo: al ejecutar se reutiliza la lectura del PDF/DOCX', async () => {
  await sembrar({ extra: { s11: [archivo('s11', 'largo.pdf')] } })
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  const tras = descargas.length
  await ejecutarLote(e)
  const repetidas = descargas.slice(tras).filter((u) => u.includes('largo.pdf') || u.endsWith('.docx'))
  assert.strictEqual(repetidas.length, 0, `descargas repetidas: ${repetidas.join(', ')}`)
})

await caso('otro docente no puede estimar la actividad ajena', async () => {
  await sembrar()
  await db.doc('users/otro').set({ role: 'docente', nombre: 'Otro', escuelaId: 'E1' })
  const e = await falla(() => estimar({ modo: 'lote', actividadId: ACTIVIDAD }, 'otro'))
  assert.ok(codigoDe(e).includes('permission-denied'), codigoDe(e))
})

grupo('Confirmado = reservado = cobrado')

await caso('lote mixto: reserva y cobra 3.50, categoría «Calificación de evidencias», movimiento con desglose y saldo del ledger', async () => {
  await sembrar()
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  const r = await ejecutarLote(e)
  assert.strictEqual(r.resultado.generadas, 10)
  assert.strictEqual(r.creditosReales, 3.5)
  assert.strictEqual(await saldoDe(), 96.5)
  const [c] = await consumos()
  assert.deepStrictEqual([c.operacion, c.categoria, c.creditosReservados, c.creditosReales, c.estado],
    ['calificar_entregable_ia_lote', 'Calificación de evidencias', 3.5, 3.5, 'ejecutado'])
  const [m] = await movimientos()
  assert.strictEqual(m.delta, -3.5)
  assert.strictEqual(m.saldoDespues, await saldoDe(), 'el saldo del movimiento es el del ledger')
  assert.strictEqual(m.categoria, 'Calificación de evidencias')
  const d = m.detalle
  assert.deepStrictEqual(
    [d.modo, d.entregas, d.conImagenes, d.soloDocumentos, d.tarifaImagenes, d.tarifaDocumentos, d.reservado, d.cobrado, d.devuelto, d.noProcesadas],
    ['lote', 10, 4, 6, 0.5, 0.25, 3.5, 3.5, 0, 0])
  assert.strictEqual((await propuestas()).length, 10)
})

await caso('lote solo de imágenes: clave «…_lote_imagenes» y categoría correcta aunque esa clave no tenga categoría propia', async () => {
  await sembrar()
  for (const id of DOCUMENTOS) await db.doc(`submissions/${id}`).delete()
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  await ejecutarLote(e)
  const [c] = await consumos()
  assert.deepStrictEqual([c.operacion, c.categoria, c.creditosReales], ['calificar_entregable_ia_lote_imagenes', 'Calificación de evidencias', 2])
  const cred = (await db.doc(`iaCreditos/${DOCENTE}`).get()).data()
  assert.deepStrictEqual(cred.consumoPorCategoria, { 'Calificación de evidencias': 2 }, 'nada cae en «Otros»')
})

await caso('individual con imagen: reserva y cobra 0.50 con su desglose; con documento, 0.25', async () => {
  await sembrar()
  const e1 = await estimar({ modo: 'individual', actividadId: ACTIVIDAD, submissionId: 's1' })
  await ejecutarIndividual('s1', e1)
  const e5 = await estimar({ modo: 'individual', actividadId: ACTIVIDAD, submissionId: 's5' })
  await ejecutarIndividual('s5', e5)
  assert.strictEqual(await saldoDe(), 99.25)
  const cs = await consumos()
  const img = cs.find((c) => c.operacion === 'calificar_entregable_ia_imagenes')
  const doc = cs.find((c) => c.operacion === 'calificar_entregable_ia')
  assert.deepStrictEqual([img.creditosReales, img.categoria, img.detalle.conImagenes], [0.5, 'Calificación de evidencias', 1])
  assert.deepStrictEqual([doc.creditosReales, doc.categoria, doc.detalle.soloDocumentos], [0.25, 'Calificación de evidencias', 1])
})

grupo('Si algo cambió, se detiene ANTES de reservar y pide confirmar de nuevo')

await caso('sin estimación confirmada (pestaña vieja): no cobra y manda la estimación', async () => {
  await sembrar()
  const e = await falla(() => ejecutarLote(undefined))
  assert.strictEqual(e.details?.codigo, 'COSTO_SIN_CONFIRMAR')
  assert.strictEqual(e.details?.estimacion?.total, 3.5)
  assert.strictEqual(pedidosIA.length, 0)
  await sinCobro()
})

await caso('el cliente no puede bajar el precio: total, conteo o firma alterados se rechazan sin reservar', async () => {
  await sembrar()
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  for (const alterado of [{ ...e, total: 0.01 }, { ...e, tarifaImagenes: 0.25 }, { ...e, conImagenes: 0, soloDocumentos: 10 }, { ...e, firma: 'x'.repeat(32) }]) {
    const err = await falla(() => ejecutarLote(alterado))
    assert.strictEqual(err.details?.codigo, 'COSTO_CAMBIO', JSON.stringify(alterado))
  }
  assert.strictEqual(pedidosIA.length, 0)
  await sinCobro()
})

await caso('cambió la tarifa entre la estimación y la ejecución: rechazo con la estimación nueva, sin reservar', async () => {
  await sembrar()
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  await db.doc('config/iaTarifas').set({ tarifas: { ...TARIFAS.tarifas, calificar_entregable_ia_lote_imagenes: 0.6 } }, { merge: true })
  const err = await falla(() => ejecutarLote(e))
  assert.strictEqual(err.details?.codigo, 'COSTO_CAMBIO')
  assert.strictEqual(err.details?.estimacion?.total, 3.9, '4 × 0.60 + 6 × 0.25')
  await sinCobro()
})

await caso('cambió la cantidad (llegó otra entrega): rechazo sin reservar', async () => {
  await sembrar()
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  await db.doc('submissions/s11').set({ actividadId: ACTIVIDAD, alumnoId: 'al-s11', calificacion: null, archivos: [archivo('s11', 'f.png')] })
  const err = await falla(() => ejecutarLote(e))
  assert.strictEqual(err.details?.codigo, 'COSTO_CAMBIO')
  assert.strictEqual(err.details?.estimacion?.entregas, 11)
  await sinCobro()
})

await caso('cambió la composición con el mismo total (otra entrega en lugar de una): rechazo sin reservar', async () => {
  await sembrar()
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  // s10 se califica a mano y llega s11, también solo documento: mismos números, otras entregas.
  await db.doc('submissions/s10').update({ calificacion: 8 })
  await db.doc('submissions/s11').set({ actividadId: ACTIVIDAD, alumnoId: 'al-s11', calificacion: null, archivos: [archivo('s11', 'f.pdf')] })
  const err = await falla(() => ejecutarLote(e))
  assert.strictEqual(err.details?.codigo, 'COSTO_CAMBIO')
  assert.strictEqual(err.details?.estimacion?.total, 3.5, 'mismo total, distinta composición')
  await sinCobro()
})

grupo('Fallos, reintentos y concurrencia')

await caso('fallo total: se devuelve todo, el movimiento queda «sin cobro» con lo reservado y devuelto', async () => {
  await sembrar()
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  fallarPara.add('*')
  const err = await falla(() => ejecutarLote(e))
  assert.ok(codigoDe(err).includes('unavailable'), codigoDe(err))
  assert.strictEqual(await saldoDe(), 100)
  const [c] = await consumos()
  assert.deepStrictEqual([c.estado, c.creditosReales], ['fallido', 0])
  const [m] = await movimientos()
  assert.deepStrictEqual([m.estado, m.delta, m.saldoDespues, m.detalle.cobrado, m.detalle.devuelto], ['sin_cobro', 0, 100, 0, 3.5])
  assert.strictEqual((await propuestas()).length, 0, 'no quedan candados')
})

await caso('fallo parcial: cobra solo lo evaluado por tipo (3 × 0.50 + 5 × 0.25 = 2.75) y dice cuántas no se procesaron', async () => {
  await sembrar()
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  fallarPara.add('s1') // una con imagen
  fallarPara.add('s5') // una solo documento
  const r = await ejecutarLote(e)
  assert.deepStrictEqual([r.resultado.generadas, r.resultado.fallidas, r.creditosReales], [8, 2, 2.75])
  assert.strictEqual(await saldoDe(), 97.25)
  const [m] = await movimientos()
  const d = m.detalle
  assert.deepStrictEqual([m.delta, d.entregas, d.conImagenes, d.soloDocumentos, d.noProcesadas, d.reservado, d.cobrado, d.devuelto],
    [-2.75, 8, 3, 5, 2, 3.5, 2.75, 0.75])
  assert.strictEqual(m.saldoDespues, 97.25)
})

await caso('reintento con la misma clave (individual): un solo cobro', async () => {
  await sembrar()
  const e = await estimar({ modo: 'individual', actividadId: ACTIVIDAD, submissionId: 's1' })
  const k = clave()
  await ejecutarIndividual('s1', e, k)
  const r2 = await ejecutarIndividual('s1', e, k)
  assert.strictEqual(r2.repetida, true)
  assert.strictEqual(await saldoDe(), 99.5)
  assert.strictEqual((await consumos()).length, 1)
})

await caso('reintento del lote ya hecho: no vuelve a cobrar (las entregas ya tienen propuesta)', async () => {
  await sembrar()
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  const k = clave()
  await ejecutarLote(e, { k })
  await falla(() => ejecutarLote(e, { k }))
  assert.strictEqual(await saldoDe(), 96.5)
  assert.strictEqual((await consumos()).length, 1)
})

await caso('dos lotes simultáneos con la misma estimación: cada entrega se cobra UNA vez en total', async () => {
  await sembrar()
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  await Promise.allSettled([ejecutarLote(e), ejecutarLote(e)])
  const cobrado = (await consumos()).reduce((s, c) => s + (c.creditosReales || 0), 0)
  assert.strictEqual(Math.round(cobrado * 100) / 100, 3.5, `cobrado en total: ${cobrado}`)
  assert.strictEqual(await saldoDe(), 96.5)
  assert.strictEqual((await propuestas()).length, 10)
  const ult = (await movimientos()).sort((a, b) => b.actualizadoEn.toMillis() - a.actualizadoEn.toMillis())[0]
  assert.strictEqual(ult.saldoDespues, await saldoDe(), 'el último movimiento cuadra con el saldo')
})

await caso('saldo insuficiente con estimación válida: se rechaza ANTES de llamar a la IA', async () => {
  await sembrar({ saldo: 1 })
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  const err = await falla(() => ejecutarLote(e))
  assert.strictEqual(err.details?.codigo, 'SALDO_INSUFICIENTE')
  assert.strictEqual(pedidosIA.length, 0)
  await sinCobro(1)
})

grupo('Clasificación por CONTENIDO (regla definitiva): PDF y Word reales')

await caso('cada tipo de archivo tiene el precio de la regla (individual)', async () => {
  const esperados = {
    'texto.pdf': 0.25, 'escaneado.pdf': 0.5, 'ocr.pdf': 0.5, 'foto-texto.pdf': 0.5, 'logo.pdf': 0.25,
    'texto.docx': 0.25, 'foto.docx': 0.5, 'icono.docx': 0.25,
  }
  const extra = {}
  Object.keys(esperados).forEach((n, i) => { extra[`c${i + 1}`] = [archivo(`c${i + 1}`, n)] })
  await sembrar({ extra })
  const obtenido = {}
  for (const [i, n] of Object.keys(esperados).entries()) {
    obtenido[n] = (await estimar({ modo: 'individual', actividadId: ACTIVIDAD, submissionId: `c${i + 1}` })).total
  }
  assert.deepStrictEqual(obtenido, esperados)
  await sinCobro()
})

await caso('varios archivos de tipos distintos: una sola tarifa de 0.50 por la entrega (individual = lote)', async () => {
  await sembrar({ extra: { m1: [archivo('m1', 'texto.pdf'), archivo('m1', 'foto.docx'), archivo('m1', 'logo.pdf')] } })
  const ind = await estimar({ modo: 'individual', actividadId: ACTIVIDAD, submissionId: 'm1' })
  assert.deepStrictEqual([ind.entregas, ind.conImagenes, ind.total], [1, 1, 0.5])
  const lote = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  assert.strictEqual(lote.total, 3.5 + 0.5, 'el lote suma la misma tarifa para esa entrega')
})

await caso('la fotografía insertada en un Word SÍ llega a la IA (no se ignora por estar incrustada)', async () => {
  await sembrar({ extra: { w1: [archivo('w1', 'foto.docx')] } })
  const e = await estimar({ modo: 'individual', actividadId: ACTIVIDAD, submissionId: 'w1' })
  await ejecutarIndividual('w1', e)
  const bloques = pedidosIA.at(-1).messages[0].content
  assert.ok(bloques.some((b) => b.type === 'image' && b.source?.type === 'base64'), 'la foto del Word va como imagen')
  assert.strictEqual(await saldoDe(), 99.5)
})

await caso('PDF en blanco: no es evidencia (no se cobra); dañado o inaccesible: no clasificable, se bloquea ANTES de reservar', async () => {
  await sembrar({ extra: { b1: [archivo('b1', 'blanco.pdf')], d1: [archivo('d1', 'danado.pdf')], n1: [archivo('n1', 'no-existe.pdf')] } })
  const enBlanco = await falla(() => estimar({ modo: 'individual', actividadId: ACTIVIDAD, submissionId: 'b1' }))
  assert.ok(codigoDe(enBlanco).includes('failed-precondition'), codigoDe(enBlanco))
  for (const sub of ['d1', 'n1']) {
    const est = await falla(() => estimar({ modo: 'individual', actividadId: ACTIVIDAD, submissionId: sub }))
    assert.strictEqual(est.details?.codigo, 'ENTREGA_NO_CLASIFICABLE', `${sub}: ${est.message}`)
    // Aunque el cliente mandara una estimación inventada, no se reserva nada.
    const ej = await falla(() => ejecutarIndividual(sub, { modo: 'individual', entregas: 1, conImagenes: 0, soloDocumentos: 1, tarifaImagenes: 0.5, tarifaDocumentos: 0.25, total: 0.25, firma: 'x' }))
    assert.strictEqual(ej.details?.codigo, 'ENTREGA_NO_CLASIFICABLE')
  }
  assert.strictEqual(pedidosIA.length, 0)
  await sinCobro()
})

await caso('PDF escaneado de más de 10 páginas: no clasificable (la IA no podría mirarlo completo), sin cobro', async () => {
  await sembrar({ extra: { l1: [archivo('l1', 'largo.pdf')] } })
  const e = await falla(() => estimar({ modo: 'individual', actividadId: ACTIVIDAD, submissionId: 'l1' }))
  assert.strictEqual(e.details?.codigo, 'ENTREGA_NO_CLASIFICABLE')
  assert.ok(/11 páginas/.test(e.message), e.message)
  await sinCobro()
})

await caso('lote con entregas no clasificables: se excluyen (con su motivo), el resto se cobra exacto y sin llamadas a la IA para las excluidas', async () => {
  await sembrar({ extra: { x1: [archivo('x1', 'danado.pdf')], x2: [archivo('x2', 'no-existe.pdf')], x3: [archivo('x3', 'escaneado.pdf')] } })
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  assert.deepStrictEqual([e.entregas, e.conImagenes, e.soloDocumentos, e.total], [11, 5, 6, 4])
  assert.deepStrictEqual(e.noClasificables.map((n) => n.alumnoId).sort(), ['al-x1', 'al-x2'])
  assert.ok(e.noClasificables.every((n) => typeof n.motivo === 'string' && n.motivo.length > 5))
  const r = await ejecutarLote(e)
  assert.deepStrictEqual([r.resultado.generadas, r.creditosReales], [11, 4])
  assert.strictEqual(await saldoDe(), 96)
  assert.strictEqual(pedidosIA.length, 11, 'ninguna llamada a la IA por las excluidas')
  const ids = (await propuestas()).map((d) => d.id)
  assert.ok(!ids.includes('x1') && !ids.includes('x2'), 'las excluidas no quedan calificadas')
  const [c] = await consumos()
  assert.deepStrictEqual([c.creditosReservados, c.creditosReales, c.detalle.conImagenes, c.detalle.soloDocumentos], [4, 4, 5, 6])
})

await caso('cambió la CLASE de un archivo después del presupuesto (texto → escaneado): rechazo sin reservar', async () => {
  await sembrar()
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  await db.doc('submissions/s5').update({ archivos: [archivo('s5', 'escaneado.pdf')] })
  const err = await falla(() => ejecutarLote(e))
  assert.strictEqual(err.details?.codigo, 'COSTO_CAMBIO')
  assert.deepStrictEqual([err.details.estimacion.conImagenes, err.details.estimacion.total], [5, 3.75])
  await sinCobro()
})

await caso('una entrega antes no clasificable se volvió clasificable después del presupuesto: rechazo sin reservar', async () => {
  await sembrar({ extra: { x1: [archivo('x1', 'danado.pdf')] } })
  const e = await estimar({ modo: 'lote', actividadId: ACTIVIDAD })
  assert.strictEqual(e.noClasificables.length, 1)
  await db.doc('submissions/x1').update({ archivos: [archivo('x1', 'texto.pdf')] })
  const err = await falla(() => ejecutarLote(e))
  assert.strictEqual(err.details?.codigo, 'COSTO_CAMBIO')
  assert.strictEqual(err.details.estimacion.noClasificables.length, 0)
  await sinCobro()
})

await caso('saldo insuficiente para una entrega con fotografía: se rechaza antes de llamar a la IA', async () => {
  await sembrar({ saldo: 0.25, extra: { w1: [archivo('w1', 'foto.docx')] } })
  const e = await estimar({ modo: 'individual', actividadId: ACTIVIDAD, submissionId: 'w1' })
  assert.strictEqual(e.total, 0.5)
  const err = await falla(() => ejecutarIndividual('w1', e))
  assert.strictEqual(err.details?.codigo, 'SALDO_INSUFICIENTE')
  assert.strictEqual(pedidosIA.length, 0)
  await sinCobro(0.25)
})

await limpiar()
resumen('tarifa-calificacion-emulador.test.mjs')
