// Reto Exprés · etapa 2 — la operación `reactivos` con un reto como actividad madre, contra el emulador. Grupo Z
// (6-nov-2026): «Analizar resultados con IA» de una competencia (rama de Reto de `analizar_resultados`).
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

// ═════════════════════════════════════════════════════════════════════════════
grupo('E. Archivos de referencia: solo en Reto Exprés (4-nov-2026)')

// La lectura de documentos se simula: docExtract.clasificarDocumento es lo único que descarga y clasifica.
const docExtract = require('../functions/docExtract.js')
const clasificarReal = docExtract.clasificarDocumento
const leidos = []
const DOCS = {
  'https://res.cloudinary.com/demo/raw/upload/v1/celula.pdf': { tipo: 'texto', texto: 'La mitocondria produce energía (ATP) para la célula.', paginas: 2 },
  'https://res.cloudinary.com/demo/raw/upload/v1/esquema.pdf': { tipo: 'visual', texto: '', paginas: 5 },
  'https://res.cloudinary.com/demo/raw/upload/v1/libro.pdf': { tipo: 'visual', texto: '', paginas: 31 },
  'https://res.cloudinary.com/demo/raw/upload/v1/roto.pdf': { tipo: 'ilegible', motivo: 'El PDF está dañado.' },
}
docExtract.clasificarDocumento = async (url) => { leidos.push(url); return { ...(DOCS[url] || { tipo: 'ilegible', motivo: 'No existe.' }) } }
const [CELULA, ESQUEMA, LIBRO, ROTO] = Object.keys(DOCS)

await preparar()
await caso('reto con un archivo y SIN descripción: el texto del documento llega a la IA y se cobra lo de siempre', async () => {
  await crearReto('reto_arch')
  respuestaIA = () => reactivosFalsos(alternados(3))
  const k = clave()
  const r = await generar({ actividadId: 'reto_arch', cantidad: 3, tipos: ['opcion_multiple', 'verdadero_falso'], k, extra: { quiereEvaluar: '', fuentes: [CELULA] } })
  assert.strictEqual(r.resultado.reactivos.length, 3)
  const texto = textoDelPedido(pedidosIA.at(-1))
  assert.ok(texto.includes('La mitocondria produce energía'), 'el documento llega al prompt')
  assert.ok(texto.includes('EL DOCENTE NO DESCRIBIÓ EL CONTENIDO'))
  assert.ok(!texto.includes('QUÉ QUIERE EVALUAR EL DOCENTE'))
  assert.ok(/documentos de referencia/.test(pedidosIA.at(-1).system), 'el sistema autoriza usar los documentos')
  assert.strictEqual(await saldo(), 97, '1 crédito por reactivo, sin recargo por el archivo')
})

await caso('reto con descripción Y un PDF de imágenes: ambos llegan (el PDF como documento nativo)', async () => {
  await crearReto('reto_ambos')
  respuestaIA = () => reactivosFalsos(alternados(2))
  await generar({ actividadId: 'reto_ambos', cantidad: 2, tipos: ['opcion_multiple', 'verdadero_falso'], extra: { fuentes: [ESQUEMA] } })
  const req = pedidosIA.at(-1)
  assert.ok(textoDelPedido(req).includes(QUIERE))
  const docs = req.messages[0].content.filter((b) => b.type === 'document')
  assert.strictEqual(docs.length, 1)
  assert.strictEqual(docs[0].source.url, ESQUEMA)
})

await crearReto('reto_rech')
await caso('archivo ilegible: se rechaza ANTES de reservar, sin cobro ni llamada a la IA', async () => {
  await rechazaSinCobro({ actividadId: 'reto_rech', cantidad: 2, tipos: ['verdadero_falso'], extra: { fuentes: [ROTO] } }, null)
})

await caso('PDF de imágenes de más de 30 páginas: EXCEDE_PAGINAS_VISUALES, sin cobro', async () => {
  await rechazaSinCobro({ actividadId: 'reto_rech', cantidad: 2, tipos: ['verdadero_falso'], extra: { fuentes: [LIBRO] } }, 'EXCEDE_PAGINAS_VISUALES')
})

await caso('reto sin archivos y sin descripción: se sigue pidiendo describir (igual que antes)', async () => {
  await rechazaSinCobro({ actividadId: 'reto_rech', cantidad: 2, tipos: ['verdadero_falso'], extra: { quiereEvaluar: 'corto' } }, 'CONTEXTO_INSUFICIENTE')
})

await caso('cuestionario y examen: los archivos se siguen IGNORANDO (ni se leen ni llegan a la IA)', async () => {
  for (const actividadId of ['cuest_1', 'examen_1']) {
    leidos.length = 0
    respuestaIA = () => reactivosFalsos(['verdadero_falso', 'verdadero_falso'])
    await generar({ actividadId, cantidad: 2, tipos: ['verdadero_falso'], extra: { fuentes: [CELULA, ROTO] } })
    assert.deepStrictEqual(leidos, [], `${actividadId}: no se leyó ningún documento`)
    assert.ok(!textoDelPedido(pedidosIA.at(-1)).includes('mitocondria'))
  }
  // Y sin descripción siguen exigiéndola aunque traigan archivos.
  await rechazaSinCobro({ actividadId: 'cuest_1', cantidad: 2, tipos: ['verdadero_falso'], extra: { quiereEvaluar: '', fuentes: [CELULA] } }, 'CONTEXTO_INSUFICIENTE')
})
docExtract.clasificarDocumento = clasificarReal

// ═════════════════════════════════════════════════════════════════════════════
grupo('Z. Analizar resultados con IA de UNA competencia (6-nov-2026): rama de Reto de analizar_resultados')

const TARIFAS_ANALISIS = {
  version: 1, tarifas: { analizar_resultados: 5 }, categorias: { analizar_resultados: 'Evaluaciones' },
  modeloPorOperacion: { analizar_resultados: 'claude-haiku-4-5' },
}
const PREG_Z = Array.from({ length: 10 }, (_, i) => ({
  id: `q${i}`, tipo: i % 2 ? 'verdadero_falso' : 'opcion_multiple', enunciado: `Enunciado ${i + 1}`, tiempoSeg: 20,
  opciones: i % 2 ? [{ id: 'v', texto: 'Verdadero' }, { id: 'f', texto: 'Falso' }] : [{ id: 'a', texto: 'Mitocondria' }, { id: 'b', texto: 'Núcleo' }, { id: 'c', texto: 'Ribosoma' }],
}))
const CORRECTA_Z = (i) => (i % 2 ? 'v' : 'a')
const ERRADA_Z = (i) => (i % 2 ? 'f' : 'b')
// `aciertos[k]` = cuántas acierta el participante k (las primeras); el resto las falla con la opción errada.
function resultadosZ(nombres, aciertos, extra = {}) {
  const clasificacion = nombres.map((n, k) => ({ participanteId: `Z_${n}`, nombreVisible: n, aciertos: aciertos[k], respondidas: 10, posicion: k + 1 }))
  const detalle = Object.fromEntries(nombres.map((n, k) => [`Z_${n}`, PREG_Z.map((q, i) => ({
    preguntaId: q.id, opcionSeleccionada: i < aciertos[k] ? CORRECTA_Z(i) : ERRADA_Z(i), respuestaCorrecta: CORRECTA_Z(i), acerto: i < aciertos[k], tiempoDecimas: 50,
  }))]))
  return { ok: true, realizadas: 10, sinResultados: false, clasificacion, expulsados: [], detalle, descartadas: {}, criterio: 'aciertos_tiempo', ...extra }
}
async function sesionZ(codigo, { actividadId = 'reto_an', modalidad = 'inscritos', resultados, estado = 'finalizada' } = {}) {
  await db.doc(`retoSesiones/${codigo}`).set({ actividadId, asignaturaId: 'sub_reto', docenteId: DOCENTE, titulo: 'Reto Z', modalidad, modoIdentidad: 'alias', estado, preguntas: PREG_Z, totalPreguntas: 10, version: 2 })
  if (resultados) await db.doc(`retoResultados/${codigo}`).set({ ...resultados, sesionId: codigo, actividadId, docenteId: DOCENTE, modalidad })
}
const analizar = ({ sesionId, actividadId = 'reto_an', k = clave(), uid = DOCENTE }) => IA_FN.ejecutarOperacionIA.run({
  auth: { uid }, data: { operacion: 'analizar_resultados', idempotencyKey: k, unidades: 1, params: { actividadId, asignaturaId: 'sub_reto', sesionId } },
})
const ANALISIS_FALSO = () => ({
  resumenGeneral: 'El grupo domina las primeras preguntas y falla las últimas.', resumenEjecutivo: 'Repasar los últimos temas.',
  patrones: [{ observacion: 'Las preguntas 8 a 10 casi nadie las acierta', interpretacion: 'Tema visto al final' }],
  estudiantesAtencion: [{ anonId: 'Participante 4', senal: 'acertó 2 de 10' }, { anonId: 'Participante 99', senal: 'inventado' }],
  recomendaciones: ['Repasar organelos con un esquema'],
})
async function rechazaAnalisis(args, codigo) {
  const antes = await saldo()
  pedidosIA.length = 0
  let error = null
  await analizar(args).catch((e) => { error = e })
  assert.ok(error, 'debió rechazarse')
  assert.strictEqual(codigoDe(error), codigo, `código ${codigoDe(error)} ≠ ${codigo}`)
  assert.strictEqual(await saldo(), antes, 'no se cobró')
  assert.strictEqual(pedidosIA.length, 0, 'no se llamó a la IA')
}

await preparar()
await db.doc('config/iaTarifas').set(TARIFAS_ANALISIS)
await crearReto('reto_an')
await crearReto('reto_ext', { modalidad: 'externo' })

await caso('cobra 5 una vez, guarda el análisis con su sesión y los números los pone el código (no la IA)', async () => {
  await sesionZ('ANALISIS01', { resultados: resultadosZ(['Zorro Plateado', 'Beto', 'Caro', 'Dani'], [9, 7, 5, 2]) })
  respuestaIA = ANALISIS_FALSO
  pedidosIA.length = 0
  const r = await analizar({ sesionId: 'ANALISIS01' })
  assert.strictEqual(await saldo(), 95)
  assert.strictEqual(pedidosIA.length, 1)
  const texto = textoDelPedido(pedidosIA[0])
  assert.ok(texto.includes('RETO EXPRÉS') && texto.includes('Participante 1: 9 de 10 aciertos'), 'desempeño anónimo')
  assert.ok(!texto.includes('Zorro Plateado') && !texto.includes('Z_'), 'ni alias ni ids viajan a la IA')
  assert.ok(texto.includes('"Núcleo"'), 'la respuesta incorrecta más elegida va con su texto')
  const res = r.resultado
  assert.strictEqual(res.porcentajeAciertosGeneral, 58) // (9+7+5+2) / 40
  assert.deepStrictEqual(res.estudiantesAtencion.map((e) => e.anonId), ['Participante 4'], 'solo candidatos (< 60 %); el inventado se descarta')
  assert.deepStrictEqual(res.reactivosDificiles.map((q) => q.pctAciertos), [0, 25, 25])
  const regs = (await db.doc('retoResultados/ANALISIS01').get()).data()
  assert.ok(regs.analisisId && !regs.analisisEnCurso, 'queda el id y se suelta el candado')
  const guardado = (await db.doc(`activities/reto_an/analisisIA/${regs.analisisId}`).get()).data()
  assert.strictEqual(guardado.sesionId, 'ANALISIS01')
  assert.deepStrictEqual(guardado.resultado.mapaAlumnos[0], { anonId: 'Participante 1', alumnoId: 'Z_Zorro Plateado' })
})

await caso('volver a pedirlo: se rechaza SIN cobro ni IA (YA_ANALIZADA); consultar el guardado es gratis', async () => {
  await rechazaAnalisis({ sesionId: 'ANALISIS01' }, 'YA_ANALIZADA')
})

await caso('dos pedidos a la vez: se cobra UNO; el otro se rechaza o se reembolsa', async () => {
  await sesionZ('ANALISIS02', { resultados: resultadosZ(['Ana', 'Beto', 'Caro'], [8, 6, 4]) })
  respuestaIA = async () => { await new Promise((ok) => setTimeout(ok, 150)); return ANALISIS_FALSO() }
  const antes = await saldo()
  const r = await Promise.allSettled([analizar({ sesionId: 'ANALISIS02' }), analizar({ sesionId: 'ANALISIS02' })])
  assert.strictEqual(r.filter((x) => x.status === 'fulfilled').length, 1)
  assert.strictEqual(await saldo(), antes - 5)
  const docs = await db.collection('activities/reto_an/analisisIA').where('sesionId', '==', 'ANALISIS02').get()
  assert.strictEqual(docs.size, 1)
})

await caso('si la IA falla: reembolso íntegro, sin análisis y el candado se suelta (se puede reintentar)', async () => {
  await sesionZ('ANALISIS03', { resultados: resultadosZ(['Ana', 'Beto', 'Caro'], [8, 6, 4]) })
  respuestaIA = () => ({ resumenGeneral: '', resumenEjecutivo: '' })
  const antes = await saldo()
  await assert.rejects(analizar({ sesionId: 'ANALISIS03' }))
  assert.strictEqual(await saldo(), antes)
  const regs = (await db.doc('retoResultados/ANALISIS03').get()).data()
  assert.ok(!regs.analisisId && !regs.analisisEnCurso)
  respuestaIA = ANALISIS_FALSO
  await analizar({ sesionId: 'ANALISIS03' })
  assert.strictEqual(await saldo(), antes - 5)
})

await caso('sin datos suficientes, en curso, sin terminar, de otro docente o de otro reto: rechazo sin cobro', async () => {
  await sesionZ('ANALISIS04', { resultados: resultadosZ(['Ana', 'Beto'], [8, 6]) })
  await rechazaAnalisis({ sesionId: 'ANALISIS04' }, 'CONTEXTO_INSUFICIENTE')
  await sesionZ('ANALISIS05', { resultados: { ok: true, realizadas: 0, sinResultados: true, clasificacion: [], detalle: {} } })
  await rechazaAnalisis({ sesionId: 'ANALISIS05' }, 'CONTEXTO_INSUFICIENTE')
  await sesionZ('ANALISIS06', { resultados: resultadosZ(['Ana', 'Beto', 'Caro'], [8, 6, 4], { analisisEnCurso: { clave: 'otro', hastaMs: Date.now() + 60000 } }) })
  await rechazaAnalisis({ sesionId: 'ANALISIS06' }, 'EN_CURSO')
  await sesionZ('ANALISIS07', { estado: 'en_curso' })
  await rechazaAnalisis({ sesionId: 'ANALISIS07' }, 'SIN_RESULTADOS')
  await rechazaAnalisis({ sesionId: 'ANALISIS01', actividadId: 'reto_ext' }, null) // la sesión es de otro reto
  await rechazaAnalisis({ sesionId: 'ANALISIS02', uid: 'otro_docente' }, null)
})

await caso('un candado vencido (análisis que nunca terminó) ya no bloquea', async () => {
  await sesionZ('ANALISIS08', { resultados: resultadosZ(['Ana', 'Beto', 'Caro'], [8, 6, 4], { analisisEnCurso: { clave: 'viejo', hastaMs: Date.now() - 1000 } }) })
  respuestaIA = ANALISIS_FALSO
  await analizar({ sesionId: 'ANALISIS08' })
  assert.ok((await db.doc('retoResultados/ANALISIS08').get()).data().analisisId)
})

await caso('reto externo: también se analiza, con identificadores anónimos', async () => {
  await sesionZ('ANALISIS09', { actividadId: 'reto_ext', modalidad: 'externo', resultados: resultadosZ(['Gato', 'Perro', 'Loro'], [10, 3, 1]) })
  pedidosIA.length = 0
  const r = await analizar({ sesionId: 'ANALISIS09', actividadId: 'reto_ext' })
  assert.ok(!textoDelPedido(pedidosIA[0]).includes('Gato'))
  assert.deepStrictEqual(r.resultado.estudiantesAtencion.map((e) => e.anonId), []) // «Participante 4» no existe aquí
})

await caso('con orden aleatorio: cada pregunta se mide sobre quienes la recibieron', async () => {
  // Terminó a la 2.ª pregunta: Ana recibió q0 y q1, Beto q2 y q3, Caro q0 y q2.
  const item = (q, acerto) => ({ preguntaId: q, opcionSeleccionada: acerto ? 'a' : 'b', respuestaCorrecta: 'a', acerto, tiempoDecimas: 30 })
  const resultados = {
    ok: true, realizadas: 2, sinResultados: false, criterio: 'aciertos_tiempo',
    clasificacion: [{ participanteId: 'A', aciertos: 2, posicion: 1 }, { participanteId: 'B', aciertos: 1, posicion: 2 }, { participanteId: 'C', aciertos: 0, posicion: 3 }],
    detalle: { A: [item('q0', true), item('q1', true)], B: [item('q2', true), item('q3', false)], C: [item('q0', false), item('q2', false)] },
  }
  const ctx = require('../functions/analisisReto.js').agregarResultadosReto({ nombre: 'X', preguntas: PREG_Z, resultados })
  const por = Object.fromEntries(ctx.reactivos.map((r) => [r.id, [r.recibieron, r.pctAciertos]]))
  assert.deepStrictEqual(por, { q0: [2, 50], q1: [1, 100], q2: [2, 50], q3: [1, 0] })
  assert.strictEqual(ctx.porcentajeAciertosGeneral, 50) // 3 de 6 recibidas
})

await caso('cuestionarios y exámenes siguen sin aceptar un reto como si fuera evaluación (rama aparte)', async () => {
  // Sin sesionId, un reto se rechaza antes de cobrar; un cuestionario sigue su camino de siempre (sus pruebas: test:ia).
  let error = null
  await analizar({ sesionId: '' }).catch((e) => { error = e })
  assert.ok(error && error.code === 'invalid-argument')
})

await limpiar()
resumen('Reto Exprés · reactivos con IA')
