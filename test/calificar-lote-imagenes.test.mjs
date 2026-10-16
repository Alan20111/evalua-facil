// "Calificar todas con IA" en una actividad de IMÁGENES respondía «Esta operación de IA aún no está
// disponible» (HTTP 501) aunque la rúbrica existiera.
//
// Causa: el cliente manda como `operacion` la CLAVE DE TARIFA (`calificar_entregable_ia_lote_imagenes`,
// y `calificar_entregable_ia_imagenes` en el flujo individual) para mostrar el costo correcto, pero el
// servidor solo conoce la operación base y deriva él mismo la tarifa según el tipo de evidencia. Una clave
// que no estaba en OPERACIONES se rechazaba antes de mirar la rúbrica, sin cobrar.
//
//   firebase emulators:exec --only firestore,auth --project demo-test "node test/calificar-lote-imagenes.test.mjs"
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import { db, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'

const require = createRequire(import.meta.url)
const DOCENTE = 'docente-lote-img'
const ACTIVIDAD = 'act-lote-img'
const clave = () => crypto.randomUUID()
const codigoDe = (e) => String(e?.code || '')

// Anthropic falso (los ejecutores lo piden con require() en cada llamada).
const requireFn = createRequire(new URL('../functions/index.js', import.meta.url))
const rutaSdk = requireFn.resolve('@anthropic-ai/sdk')
requireFn(rutaSdk)
const pedidosIA = []
require.cache[rutaSdk].exports = class AnthropicFalso {
  constructor() {
    this.messages = {
      create: async (req) => {
        pedidosIA.push(req)
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

// Las tarifas centrales: la operación base NO tiene tarifa propia diferenciada, la efectiva sí.
const TARIFAS = {
  version: 1,
  tarifas: {
    calificar_entregable_ia: 0.25, calificar_entregable_ia_imagenes: 0.5,
    calificar_entregable_ia_lote: 0.25, calificar_entregable_ia_lote_imagenes: 0.5,
  },
  categorias: {
    calificar_entregable_ia: 'Calificación de evidencias', calificar_entregable_ia_imagenes: 'Calificación de evidencias',
    calificar_entregable_ia_lote: 'Calificación de evidencias', calificar_entregable_ia_lote_imagenes: 'Calificación de evidencias',
  },
  modeloPorOperacion: {
    calificar_entregable_ia: 'claude-haiku-4-5', calificar_entregable_ia_lote: 'claude-haiku-4-5',
  },
}
const RUBRICA = {
  tipo: 'rubrica',
  // El nivel 0 es el más alto, igual que en la rúbrica real del docente.
  criterios: [{ nombre: 'Criterio 1', puntos: [10, 5, 0], descriptores: ['Completo', 'Parcial', 'No cumple'] }],
  niveles: [{ nombre: 'Completo' }, { nombre: 'Parcial' }, { nombre: 'No cumple' }],
}

async function sembrar({ rubrica = RUBRICA, saldo = 100 } = {}) {
  await limpiar()
  pedidosIA.length = 0
  await db.doc(`users/${DOCENTE}`).set({ role: 'docente', nombre: 'Prueba', escuelaId: 'E1' })
  await db.doc('config/iaTarifas').set(TARIFAS)
  await db.doc(`iaCreditos/${DOCENTE}`).set({ saldo, consumidoTotal: 0, consumoPorCategoria: {} })
  await db.doc('subjects/sub-lote-img').set({ docenteId: DOCENTE, nombre: 'Informática', parciales: 2 })
  await db.doc(`activities/${ACTIVIDAD}`).set({
    docenteId: DOCENTE, asignaturaId: 'sub-lote-img', parcial: 1, categoria: 'entregable', nombre: 'Evidencia fotográfica',
    instrucciones: 'Sube una foto de tu trabajo', tiposArchivo: ['imagenes'],
    ...(rubrica ? { rubrica } : {}),
  })
  for (const id of ['sub1', 'sub2', 'sub3']) {
    await db.doc(`submissions/${id}`).set({
      actividadId: ACTIVIDAD, alumnoId: `al-${id}`, calificacion: null,
      archivos: [{ url: `https://res.cloudinary.com/demo/image/upload/v1/${id}.png`, nombre: `${id}.png` }],
    })
  }
}
const saldoDe = async () => (await db.doc(`iaCreditos/${DOCENTE}`).get()).data().saldo
const consumos = async () => (await db.collection('iaConsumos').get()).docs.map((d) => d.data())
const propuestas = async () => (await db.collection(`activities/${ACTIVIDAD}/iaSugerenciasEntregable`).get()).docs

const lote = ({ operacion, k = clave(), unidades = 3, params = {} }) =>
  IA_FN.ejecutarOperacionIA.run({ auth: { uid: DOCENTE }, data: { operacion, idempotencyKey: k, unidades, params: { actividadId: ACTIVIDAD, ...params } } })

grupo('Calificar todas con IA (actividad de imágenes) — la clave de tarifa que manda el cliente ya no rompe la operación')

await caso('lote con la clave que manda el cliente (…_lote_imagenes) y rúbrica existente: califica las 3 y cobra 3 × 0.5 UNA vez', async () => {
  await sembrar()
  const r = await lote({ operacion: 'calificar_entregable_ia_lote_imagenes' })
  assert.strictEqual(r.resultado.generadas, 3)
  assert.strictEqual(r.resultado.fallidas, 0)
  assert.strictEqual((await propuestas()).length, 3, 'una propuesta por entrega')
  assert.strictEqual(pedidosIA.length, 3, 'una llamada a la IA por entrega')
  assert.strictEqual(await saldoDe(), 98.5)
  const c = await consumos()
  assert.strictEqual(c.length, 1, 'un solo cobro por operación')
  assert.strictEqual(c[0].operacion, 'calificar_entregable_ia_lote_imagenes', 'se registra con la tarifa de imágenes')
})

await caso('lote con la operación base: la tarifa de imágenes la sigue decidiendo el servidor (no el cliente)', async () => {
  await sembrar()
  const r = await lote({ operacion: 'calificar_entregable_ia_lote' })
  assert.strictEqual(r.resultado.generadas, 3)
  assert.strictEqual(await saldoDe(), 98.5, 'igual: 0.5 por entrega, no 0.25')
})

await caso('el mismo clic reintentado (misma idempotencyKey) no cobra dos veces', async () => {
  await sembrar()
  const k = clave()
  await lote({ operacion: 'calificar_entregable_ia_lote_imagenes', k })
  await lote({ operacion: 'calificar_entregable_ia_lote_imagenes', k }).catch(() => {})
  assert.strictEqual(await saldoDe(), 98.5)
  assert.strictEqual((await consumos()).length, 1)
})

await caso('flujo individual con su clave (…_imagenes): acepta la misma clave y cobra 0.5', async () => {
  await sembrar()
  const r = await IA_FN.ejecutarOperacionIA.run({
    auth: { uid: DOCENTE },
    data: { operacion: 'calificar_entregable_ia_imagenes', idempotencyKey: clave(), unidades: 1, params: { actividadId: ACTIVIDAD, submissionId: 'sub1' } },
  })
  assert.ok(r.resultado, 'devuelve un resultado')
  assert.strictEqual(await saldoDe(), 99.5)
})

grupo('Los errores reales siguen informándose como lo que son')

await caso('sin rúbrica: failed-precondition con el mensaje de rúbrica (no «no disponible»), sin cobrar ni llamar a la IA', async () => {
  await sembrar({ rubrica: null })
  let err = null
  try { await lote({ operacion: 'calificar_entregable_ia_lote_imagenes' }) } catch (e) { err = e }
  assert.ok(codigoDe(err).includes('failed-precondition'), codigoDe(err))
  assert.ok(err.message.includes('rúbrica'), err.message)
  assert.strictEqual(await saldoDe(), 100)
  assert.strictEqual(pedidosIA.length, 0)
  assert.strictEqual((await consumos()).length, 0)
})

await caso('una operación inexistente SIGUE rechazándose como no implementada (la tolerancia es solo para las dos claves de tarifa)', async () => {
  await sembrar()
  for (const operacion of ['calificar_entregable_ia_lote_pdf', 'calificar_entregable_ia_imagenes_x', 'inventada']) {
    let err = null
    try { await lote({ operacion }) } catch (e) { err = e }
    assert.ok(codigoDe(err).includes('unimplemented'), `${operacion}: ${codigoDe(err)}`)
  }
  assert.strictEqual(await saldoDe(), 100)
})

await caso('saldo insuficiente: se rechaza ANTES de llamar a la IA', async () => {
  await sembrar({ saldo: 0.25 })
  let err = null
  try { await lote({ operacion: 'calificar_entregable_ia_lote_imagenes' }) } catch (e) { err = e }
  assert.ok(err, 'debe rechazar')
  assert.strictEqual(err.details?.codigo, 'SALDO_INSUFICIENTE')
  assert.strictEqual(pedidosIA.length, 0)
  assert.strictEqual(await saldoDe(), 0.25)
})

await caso('un docente ajeno no puede calificar la actividad de otro, ni con la clave de tarifa', async () => {
  await sembrar()
  await db.doc('users/otro-docente').set({ role: 'docente', nombre: 'Otro', escuelaId: 'E1' })
  await db.doc('iaCreditos/otro-docente').set({ saldo: 100, consumidoTotal: 0, consumoPorCategoria: {} })
  let err = null
  try {
    await IA_FN.ejecutarOperacionIA.run({
      auth: { uid: 'otro-docente' },
      data: { operacion: 'calificar_entregable_ia_lote_imagenes', idempotencyKey: clave(), unidades: 3, params: { actividadId: ACTIVIDAD } },
    })
  } catch (e) { err = e }
  assert.ok(codigoDe(err).includes('permission-denied'), codigoDe(err))
  assert.strictEqual(pedidosIA.length, 0)
})

await limpiar()
resumen('calificar-lote-imagenes.test.mjs')
