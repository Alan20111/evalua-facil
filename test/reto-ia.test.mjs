// Reto Exprés · etapa 2 — la operación `reactivos` con un reto como actividad madre, contra el emulador.
//
//   firebase emulators:exec --only firestore,auth --project demo-test "node test/reto-ia.test.mjs"
//
// Mismo mecanismo que test/ia-creditos.test.mjs: se llama a ejecutarOperacionIA con un Anthropic FALSO (sin costo
// real). Cubre: cobro de 1 crédito por reactivo entregado, etiqueta «Reto Exprés» en el movimiento, reintento sin
// doble cobro, rechazos SIN cobro (tipos, cantidad, reto completo) y que cuestionarios, exámenes y
// crear_evaluacion_ia sigan exactamente igual.

import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import { db, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'
import { RETO_CFG, TIPOS_RETO, datosNuevoReto } from '../src/utils/retoExpres.js'
import { tituloMovimiento } from '../src/utils/movimientosCreditos.js'

const require = createRequire(import.meta.url)
const IA_FN = require('../functions/ia.js')
const IA = IA_FN._pruebas

const DOCENTE = 'docente_reto'
const clave = () => crypto.randomUUID()
const TARIFAS = {
  version: 1,
  tarifas: { reactivos: 1, crear_evaluacion_ia: 1 },
  categorias: { reactivos: 'Evaluaciones', crear_evaluacion_ia: 'Evaluaciones' },
  modeloPorOperacion: { reactivos: 'claude-haiku-4-5', crear_evaluacion_ia: 'claude-haiku-4-5' },
}

// Anthropic falso (mismo mecanismo que ia-creditos.test.mjs).
const requireFn = createRequire(new URL('../functions/index.js', import.meta.url))
const rutaSdk = requireFn.resolve('@anthropic-ai/sdk')
requireFn(rutaSdk)
const pedidosIA = []
let respuestaIA = () => ({ reactivos: [] })
require.cache[rutaSdk].exports = class AnthropicFalso {
  constructor() {
    this.messages = {
      create: async (req) => {
        pedidosIA.push(req)
        return { content: [{ type: 'text', text: JSON.stringify(await respuestaIA(req)) }], usage: { input_tokens: 10, output_tokens: 10 } }
      },
    }
  }
}
process.env.ANTHROPIC_API_KEY_PROD ||= 'sk-ant-prueba-' + 'x'.repeat(40)

const textoDelPedido = (req) => (Array.isArray(req.messages[0].content)
  ? req.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  : req.messages[0].content)
const codigoDe = (e) => e?.details?.codigo || null

function reactivosFalsos(tipos, { vacios = 0 } = {}) {
  return {
    reactivos: tipos.map((tipo, i) => ({
      tipo,
      enunciado: i >= tipos.length - vacios ? '' : `Pregunta breve ${i + 1}`,
      opciones: tipo === 'opcion_multiple' ? ['A', 'B', 'C', 'D'] : undefined,
      correcta: tipo === 'opcion_multiple' ? 1 : 'v',
    })),
  }
}
const alternados = (n) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 'opcion_multiple' : 'verdadero_falso'))

const QUIERE = 'Las partes de la célula, sus funciones y la diferencia entre célula animal y vegetal.'
const generar = ({ actividadId, cantidad, tipos, k = clave(), extra = {} }) => IA_FN.ejecutarOperacionIA.run({
  auth: { uid: DOCENTE },
  data: {
    operacion: 'reactivos', idempotencyKey: k, unidades: cantidad,
    params: { actividadId, asignaturaId: 'sub_reto', asignaturaNombre: 'Biología', quiereEvaluar: QUIERE, cantidad, tipos, mismoTema: false, reactivosExistentes: [], ...extra },
  },
})
const saldo = async () => (await db.doc(`iaCreditos/${DOCENTE}`).get()).data()?.saldo
const consumoDe = async (k) => (await db.doc(`iaConsumos/${k}`).get()).data()
const movimientoDe = async (k) => (await db.doc(`iaMovimientos/${k}`).get()).data()

async function crearReto(id, { modalidad = 'inscritos', preguntas = 0 } = {}) {
  const r = datosNuevoReto({ nombre: `Reto ${id}`, modalidad, modoIdentidad: modalidad === 'externo' ? 'alias' : 'nombre', parcial: 1, orden: 1, asignaturaId: 'sub_reto', docenteId: DOCENTE })
  assert.ok(r.ok, r.codigo)
  await db.doc(`activities/${id}`).set(r.datos)
  for (let i = 0; i < preguntas; i++) {
    await db.doc(`activities/${id}/preguntas/p${i}`).set({ tipo: 'verdadero_falso', enunciado: `Previa ${i}`, orden: i + 1 })
    await db.doc(`activities/${id}/clave/p${i}`).set({ respuestaCorrecta: 'v', respuestaEsperada: null })
  }
}

async function preparar({ saldoInicial = 100 } = {}) {
  await limpiar()
  await db.doc(`users/${DOCENTE}`).set({ role: 'docente', nombre: 'Prueba', escuelaId: 'E1', perfilIA: { estiloClase: 'Participativo', habilidades: 'Proyectos', experiencia: '8 años' } })
  await db.doc('config/iaTarifas').set(TARIFAS)
  await db.doc(`iaCreditos/${DOCENTE}`).set({ saldo: saldoInicial, consumidoTotal: 0, consumoPorCategoria: {} })
  await db.doc('subjects/sub_reto').set({ docenteId: DOCENTE, nombre: 'Biología', parciales: [{ nombre: 'P1' }] })
  await db.doc('activities/cuest_1').set({ nombre: 'Cuestionario 1', categoria: 'cuestionario', tipo: 'evaluacion', asignaturaId: 'sub_reto', docenteId: DOCENTE, parcial: 1, oculta: true })
  await db.doc('activities/examen_1').set({ nombre: 'Examen 1', categoria: 'examen', tipo: 'evaluacion', asignaturaId: 'sub_reto', docenteId: DOCENTE, parcial: 1, oculta: true })
  pedidosIA.length = 0
}

// ═════════════════════════════════════════════════════════════════════════════
grupo('A. Instrucciones a la IA: solo cambian para Reto Exprés')

const ctxBase = (clase) => ({
  clase, nombre: 'Prueba', tema: '', quiereEvaluar: QUIERE, mismoTema: false, reactivosExistentes: [], cantidad: 2,
  tipos: ['opcion_multiple', 'verdadero_falso'], bloqueFuentes: null, fuentesBloques: [], fuentesAvisos: [],
})

await caso('cuestionario y examen: mismo encabezado y mismo límite de 400 caracteres, sin nada de Reto', async () => {
  for (const [clase, etiqueta] of [['cuestionario', 'CUESTIONARIO'], ['examen', 'EXAMEN']]) {
    const p = IA.promptReactivos(ctxBase(clase), 'Biología')
    assert.ok(p.includes(`${etiqueta}: "Prueba".`), etiqueta)
    assert.ok(p.includes('"enunciado": "<máx 400 caracteres>"'))
    assert.ok(!p.includes('RETO EXPRÉS') && !p.includes(IA.RETO_INSTRUCCION_BREVEDAD.trim()))
  }
})

await caso('reto: encabezado RETO EXPRÉS, instrucción de brevedad (S4) y enunciados de máximo 200 caracteres', async () => {
  const p = IA.promptReactivos(ctxBase('reto'), 'Biología')
  assert.ok(p.includes('RETO EXPRÉS: "Prueba".'))
  assert.ok(p.includes(IA.RETO_INSTRUCCION_BREVEDAD))
  assert.ok(p.includes('200 caracteres como máximo'))
  assert.ok(p.includes('"enunciado": "<máx 200 caracteres>"'))
  assert.ok(!p.includes('CUESTIONARIO:') && !p.includes('EXAMEN:'))
})

await caso('las constantes del servidor coinciden con las de la lógica del reto', async () => {
  assert.strictEqual(IA.RETO_TOTAL_PREGUNTAS, RETO_CFG.TOTAL_PREGUNTAS)
  assert.deepStrictEqual(IA.RETO_TIPOS_PERMITIDOS, TIPOS_RETO)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('B. Cobro con un reto como actividad madre')

await preparar()
await crearReto('reto_10')
await caso('10 reactivos entregados = 10 créditos; el movimiento dice «Reto Exprés»', async () => {
  const tipos = alternados(10)
  respuestaIA = () => reactivosFalsos(tipos)
  const k = clave()
  const r = await generar({ actividadId: 'reto_10', cantidad: 10, tipos: ['opcion_multiple', 'verdadero_falso'], k })
  assert.strictEqual(r.resultado.reactivos.length, 10)
  assert.ok(r.resultado.reactivos.every((x) => TIPOS_RETO.includes(x.tipo)))
  assert.strictEqual(await saldo(), 90)
  assert.strictEqual((await consumoDe(k)).creditosReales, 10)
  const mov = await movimientoDe(k)
  assert.strictEqual(mov.operacion, 'reactivos')
  assert.strictEqual(mov.detalle?.funcion, 'reto')
  assert.strictEqual(tituloMovimiento(mov), 'Reto Exprés')
  assert.ok(textoDelPedido(pedidosIA.at(-1)).includes('RETO EXPRÉS'))
})

await caso('reintento con la misma clave: no se cobra de nuevo', async () => {
  const consumos = (await db.collection('iaConsumos').get()).size
  const k = (await db.collection('iaConsumos').get()).docs[0].id
  await generar({ actividadId: 'reto_10', cantidad: 10, tipos: ['opcion_multiple', 'verdadero_falso'], k }).catch(() => null)
  assert.strictEqual(await saldo(), 90)
  assert.strictEqual((await db.collection('iaConsumos').get()).size, consumos)
})

await crearReto('reto_7')
await caso('si la IA entrega 7 de 10, se cobran 7 (lo demás se devuelve)', async () => {
  respuestaIA = () => reactivosFalsos(alternados(10), { vacios: 3 })
  const k = clave()
  const antes = await saldo()
  const r = await generar({ actividadId: 'reto_7', cantidad: 10, tipos: ['opcion_multiple', 'verdadero_falso'], k })
  assert.strictEqual(r.resultado.reactivos.length, 7)
  assert.strictEqual(await saldo(), antes - 7)
  assert.strictEqual((await consumoDe(k)).creditosReales, 7)
})

await crearReto('reto_ext', { modalidad: 'externo' })
await caso('un reto externo también puede generar sus preguntas, con la misma tarifa', async () => {
  respuestaIA = () => reactivosFalsos(alternados(2))
  const antes = await saldo()
  const k = clave()
  await generar({ actividadId: 'reto_ext', cantidad: 2, tipos: ['opcion_multiple', 'verdadero_falso'], k })
  assert.strictEqual(await saldo(), antes - 2)
  assert.strictEqual((await movimientoDe(k)).detalle?.funcion, 'reto')
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('C. Rechazos SIN cobro')

async function rechazaSinCobro(args, codigo) {
  const antes = await saldo()
  const consumos = (await db.collection('iaConsumos').get()).size
  pedidosIA.length = 0
  let error = null
  await generar(args).catch((e) => { error = e })
  assert.ok(error, 'debió rechazarse')
  assert.strictEqual(codigoDe(error), codigo, `código ${codigoDe(error)} ≠ ${codigo}`)
  assert.ok(/No se descontaron créditos/.test(error.message))
  assert.strictEqual(await saldo(), antes, 'no se cobró')
  assert.strictEqual((await db.collection('iaConsumos').get()).size, consumos, 'no hubo reserva')
  assert.strictEqual(pedidosIA.length, 0, 'no se llamó a la IA')
}

await crearReto('reto_vacio')
await caso('tipos no permitidos (respuesta corta, subir archivo, mezcla o sin arreglo)', async () => {
  for (const tipos of [['respuesta_corta'], ['subir_archivo'], ['opcion_multiple', 'respuesta_corta'], undefined, []]) {
    const codigo = Array.isArray(tipos) && tipos.length === 0 ? 'TIPOS_VACIOS' : 'RETO_TIPOS_NO_PERMITIDOS'
    await rechazaSinCobro({ actividadId: 'reto_vacio', cantidad: 3, tipos }, codigo)
  }
})

await crearReto('reto_8', { preguntas: 8 })
await caso('más de los que faltan para llegar a 10 (aquí faltan 2) o una cantidad inválida', async () => {
  for (const cantidad of [3, 10, 0, 2.5]) {
    await rechazaSinCobro({ actividadId: 'reto_8', cantidad, tipos: ['verdadero_falso'] }, 'RETO_CANTIDAD_INVALIDA')
  }
  await rechazaSinCobro({ actividadId: 'reto_vacio', cantidad: 11, tipos: ['verdadero_falso'] }, 'RETO_CANTIDAD_INVALIDA')
})

await crearReto('reto_lleno', { preguntas: 10 })
await caso('un reto que ya tiene sus 10 preguntas no genera más', async () => {
  await rechazaSinCobro({ actividadId: 'reto_lleno', cantidad: 1, tipos: ['verdadero_falso'] }, 'RETO_COMPLETO')
})

await caso('con los que faltan exactos sí se genera (8 + 2)', async () => {
  respuestaIA = () => reactivosFalsos(['verdadero_falso', 'verdadero_falso'])
  const antes = await saldo()
  await generar({ actividadId: 'reto_8', cantidad: 2, tipos: ['verdadero_falso'] })
  assert.strictEqual(await saldo(), antes - 2)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('D. Cuestionarios, exámenes y crear_evaluacion_ia no cambian')

await caso('cuestionario: acepta respuesta corta, cobra por entregado y su movimiento NO lleva la etiqueta del reto', async () => {
  respuestaIA = () => reactivosFalsos(['respuesta_corta', 'opcion_multiple', 'respuesta_corta'])
  const k = clave()
  const antes = await saldo()
  const r = await generar({ actividadId: 'cuest_1', cantidad: 3, tipos: ['respuesta_corta', 'opcion_multiple'], k })
  assert.strictEqual(r.resultado.clase, 'cuestionario')
  assert.strictEqual(await saldo(), antes - 3)
  const mov = await movimientoDe(k)
  assert.strictEqual(mov.detalle, undefined)
  assert.strictEqual(tituloMovimiento(mov), 'Reactivos con IA')
  assert.ok(textoDelPedido(pedidosIA.at(-1)).includes('CUESTIONARIO: "Cuestionario 1".'))
  assert.ok(!textoDelPedido(pedidosIA.at(-1)).includes('RETO EXPRÉS'))
})

await caso('examen: sigue sin límite de «faltan 10» (pide 10 aunque tenga reactivos) y sin etiqueta', async () => {
  for (let i = 0; i < 12; i++) await db.doc(`activities/examen_1/preguntas/q${i}`).set({ tipo: 'verdadero_falso', enunciado: `E${i}` })
  respuestaIA = () => reactivosFalsos(alternados(10))
  const k = clave()
  const antes = await saldo()
  await generar({ actividadId: 'examen_1', cantidad: 10, tipos: ['opcion_multiple', 'verdadero_falso'], k })
  assert.strictEqual(await saldo(), antes - 10)
  assert.strictEqual((await movimientoDe(k)).detalle, undefined)
})

await caso('crear_evaluacion_ia NO acepta un reto como madre (el mapa de padres no se compartió)', async () => {
  const antes = await saldo()
  let error = null
  await IA_FN.ejecutarOperacionIA.run({
    auth: { uid: DOCENTE },
    data: { operacion: 'crear_evaluacion_ia', idempotencyKey: clave(), unidades: 2, params: { actividadId: 'reto_vacio', quiereEvaluar: QUIERE, cantidad: 2, tipos: ['opcion_multiple'] } },
  }).catch((e) => { error = e })
  assert.ok(error && /Solo un cuestionario o un examen pueden generarse completos con IA/.test(error.message), error?.message)
  assert.strictEqual(await saldo(), antes)
})

await caso('un entregable sigue sin poder ser madre de reactivos', async () => {
  await db.doc('activities/entregable_1').set({ nombre: 'E', categoria: 'entregable', tipo: 'archivo', asignaturaId: 'sub_reto', docenteId: DOCENTE, parcial: 1 })
  let error = null
  await generar({ actividadId: 'entregable_1', cantidad: 2, tipos: ['opcion_multiple'] }).catch((e) => { error = e })
  assert.ok(error && /Solo un cuestionario o un examen pueden generar reactivos con IA/.test(error.message))
})

await limpiar()
resumen('Reto Exprés · reactivos con IA')
