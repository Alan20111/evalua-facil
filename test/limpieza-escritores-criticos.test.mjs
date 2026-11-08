// Escritores tardíos de IA (2.ª tanda; limpieza automática al eliminar actividades, functions/actividadLimpieza.js),
// contra el emulador de Firestore. Mismo patrón que limpieza-escritores-ia.test.mjs: Anthropic falso que puede
// BORRAR la actividad mientras «piensa», y la lógica invocada con `.run()` (o directo, cuando su precheck exige
// medio sistema: C-02 y los dos diagnósticos).
//
//   · crear_evaluacion_ia, diagnostico_contexto, diagnostico_conocimientos → preguntas + clave + documento de la
//     actividad (`set(merge)`): el riesgo crítico era RECREAR la actividad borrada.
//   · calificar_abierta (C-02) y calificar_entregable_ia_lote → candados «procesando» + propuestas.
//   · aplicarNotaIA (camino «Recalificar todas con IA» del lote) → nota + propuesta.
//   · analizar_entregable → analisisActividadIA.
//
//   firebase emulators:exec --only firestore,auth --project demo-test "node test/limpieza-escritores-criticos.test.mjs"
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import { db, dbFn, funciones, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'
import * as FX from './helpers/fixturesEvidencias.mjs'

const require = createRequire(import.meta.url)
const DOCENTE = 'docente-criticos'
const clave = () => crypto.randomUUID()
const existe = async (ruta) => (await db.doc(ruta).get()).exists
const tam = async (ruta) => (await db.collection(ruta).get()).size
const saldoDe = async () => (await db.doc(`iaCreditos/${DOCENTE}`).get()).data().saldo
const consumos = async () => (await db.collection('iaConsumos').get()).docs.map((d) => d.data())
async function falla(fn) { try { await fn() } catch (e) { return e } throw new Error('se esperaba un error') }
const codigo = (e) => String(e?.code || e?.httpErrorCode?.canonicalName || '')

// ── Anthropic falso ──
const requireFn = createRequire(new URL('../functions/index.js', import.meta.url))
const rutaSdk = requireFn.resolve('@anthropic-ai/sdk')
requireFn(rutaSdk)
const pedidosIA = []
let respuestaIA = () => ({})
let borrarEnPedido = null // { n, id }: en el pedido número n a la IA, se borra activities/{id}
require.cache[rutaSdk].exports = class AnthropicFalso {
  constructor() {
    this.messages = {
      create: async (req) => {
        pedidosIA.push(req)
        if (borrarEnPedido && pedidosIA.length === borrarEnPedido.n) await db.doc(`activities/${borrarEnPedido.id}`).delete()
        return { content: [{ type: 'text', text: JSON.stringify(await respuestaIA(req)) }], usage: { input_tokens: 10, output_tokens: 10 } }
      },
    }
  }
}
process.env.ANTHROPIC_API_KEY_PROD ||= 'sk-ant-prueba-' + 'x'.repeat(40)
const IA_FN = require('../functions/ia.js')
const IA = IA_FN._pruebas
const L = require('../functions/actividadLimpieza.js')
const { aplicarNotaIA } = require('../functions/aplicarNotaIA.js')
const EVID = require('../functions/evidenciasEntrega.js')
const correr = (data) => IA_FN.ejecutarOperacionIA.run({ auth: { uid: DOCENTE }, data })
const limpiarComoTrigger = (act, datos) => funciones.onActividadBorradaLimpiar.run({ params: { activityId: act }, data: { exists: true, data: () => datos } })
const datosDe = async (act) => (await db.doc(`activities/${act}`).get()).data()
// Borra la actividad la PRIMERA vez que alguien abre una transacción protegida sobre ella (después de leerla).
function borrarEnTransaccion(id, { despuesDe = 1 } = {}) {
  let vistas = 0
  let borrado = null
  L.fijarPruebasLimpieza({
    dentroDeTransaccion: async (act) => {
      if (act !== id || borrado) return
      vistas += 1
      if (vistas < despuesDe) return
      borrado = db.doc(`activities/${id}`).delete()
      await new Promise((r) => setTimeout(r, 300))
    },
  })
  return { esperar: async () => { await borrado; L.fijarPruebasLimpieza({}) } }
}
async function base({ saldo = 100, tarifas } = {}) {
  await limpiar()
  pedidosIA.length = 0
  borrarEnPedido = null
  L.fijarPruebasLimpieza({})
  await db.doc(`users/${DOCENTE}`).set({ role: 'docente', nombre: 'Prueba', escuelaId: 'E1', perfilIA: { estiloClase: 'Participativo', habilidades: 'Proyectos', experiencia: '8 años' } })
  if (tarifas) await db.doc('config/iaTarifas').set(tarifas)
  await db.doc(`iaCreditos/${DOCENTE}`).set({ saldo, consumidoTotal: 0, consumoPorCategoria: {} })
}
// Lo que hay bajo una actividad: el documento y las subcolecciones que estos escritores tocan.
async function rastroDe(act) {
  let n = (await existe(`activities/${act}`)) ? 1 : 0
  for (const c of ['preguntas', 'clave', 'iaSugerencias', 'iaSugerenciasEntregable', 'analisisActividadIA']) n += await tam(`activities/${act}/${c}`)
  return n
}
async function fotoDe(act) {
  const r = { doc: JSON.stringify((await db.doc(`activities/${act}`).get()).data() || null) }
  for (const c of ['preguntas', 'clave', 'iaSugerencias', 'iaSugerenciasEntregable', 'analisisActividadIA']) {
    r[c] = (await db.collection(`activities/${act}/${c}`).get()).docs.map((d) => [d.id, JSON.stringify(d.data())]).sort()
  }
  return JSON.stringify(r)
}

// ═════════════════════════════════════════════════════════════════════════════
grupo('crear_evaluacion_ia — preguntas, clave y documento de la actividad (riesgo: recrear la actividad)')
// ═════════════════════════════════════════════════════════════════════════════
const TARIFAS_EVAL = {
  version: 1, tarifas: { crear_evaluacion_ia: 1 }, categorias: { crear_evaluacion_ia: 'Evaluaciones' },
  modeloPorOperacion: { crear_evaluacion_ia: 'claude-haiku-4-5' },
}
const reactivos = (n) => () => ({
  reactivos: Array.from({ length: n }, (_, i) => ({ tipo: 'opcion_multiple', enunciado: `Pregunta ${i + 1}`, opciones: ['a', 'b', 'c', 'd'], correcta: 0 })),
  instruccionesHtml: '<p>Contesta con calma.</p>',
})
async function sembrarEval() {
  await base({ tarifas: TARIFAS_EVAL })
  await db.doc('subjects/sub_eval').set({ docenteId: DOCENTE, nombre: 'Informática', parciales: 2 })
  for (const id of ['EV', 'EV_OTRA']) {
    await db.doc(`activities/${id}`).set({ docenteId: DOCENTE, categoria: 'cuestionario', nombre: 'Windows', asignaturaId: 'sub_eval', parcial: 1 })
    await db.doc(`activities/${id}/preguntas/vieja`).set({ tipo: 'opcion_multiple', enunciado: 'vieja', ponderacion: 1 })
    await db.doc(`activities/${id}/clave/vieja`).set({ respuestaCorrecta: 'a' })
  }
  respuestaIA = reactivos(3)
}
const crearEval = (act = 'EV', k = clave()) => correr({
  operacion: 'crear_evaluacion_ia', idempotencyKey: k, unidades: 3,
  params: { actividadId: act, asignaturaId: 'sub_eval', asignaturaNombre: 'Informática', quiereEvaluar: 'Que el estudiante identifique las partes del escritorio de Windows y sus funciones', cantidad: 3, tipos: ['opcion_multiple'], fuentes: [] },
})

await caso('actividad viva: reemplaza los reactivos, escribe la clave y el contador, y cobra 3', async () => {
  await sembrarEval()
  await crearEval()
  assert.strictEqual(await tam('activities/EV/preguntas'), 3)
  assert.strictEqual(await tam('activities/EV/clave'), 3)
  assert.strictEqual(await existe('activities/EV/preguntas/vieja'), false, 'la generación reemplaza, no acumula')
  const act = await datosDe('EV')
  assert.strictEqual(act.evaluacion.numPreguntas, 3)
  assert.strictEqual(act.instrucciones, '<p>Contesta con calma.</p>')
  assert.strictEqual(act.nombre, 'Windows', 'el merge conserva lo demás')
  assert.strictEqual(await saldoDe(), 97)
})

await caso('borrada ANTES de empezar: se rechaza sin llamar a la IA, sin cobrar y sin recrearla', async () => {
  await sembrarEval()
  await db.doc('activities/EV').delete()
  const e = await falla(() => crearEval())
  assert.match(codigo(e), /not-found/)
  assert.strictEqual(pedidosIA.length, 0)
  assert.strictEqual(await saldoDe(), 100)
  assert.strictEqual(await existe('activities/EV'), false)
})

await caso('borrada MIENTRAS la IA genera: no recrea la actividad, no deja preguntas ni clave, no cobra; la otra intacta', async () => {
  await sembrarEval()
  const otra = await fotoDe('EV_OTRA')
  const datos = await datosDe('EV')
  borrarEnPedido = { n: 1, id: 'EV' }
  const e = await falla(() => crearEval())
  assert.match(codigo(e), /not-found/)
  assert.strictEqual(pedidosIA.length, 1, 'la IA sí trabajó')
  assert.strictEqual(await existe('activities/EV'), false, 'NO se recreó la actividad')
  assert.strictEqual(await tam('activities/EV/clave') + await tam('activities/EV/preguntas'), 0, 'ni preguntas ni clave nuevas (las viejas las borró la propia generación)')
  assert.strictEqual(await saldoDe(), 100, 'la reserva se devuelve como en cualquier falla')
  assert.ok((await consumos()).every((c) => c.estado !== 'ejecutado'), 'nada liquidado')
  await limpiarComoTrigger('EV', datos)
  assert.strictEqual(await rastroDe('EV'), 0)
  assert.strictEqual(await fotoDe('EV_OTRA'), otra, 'la otra actividad intacta')
})

await caso('borrada con la transacción de escritura abierta: o escribe antes del borrado (y la limpieza lo quita) o no escribe; nunca recrea', async () => {
  await sembrarEval()
  const datos = await datosDe('EV')
  const b = borrarEnTransaccion('EV')
  const salio = await crearEval().then(() => 'escribio', () => 'fallo')
  await b.esperar()
  // La transacción bloquea la actividad que leyó: el borrado espera su turno. Si la escritura confirmó primero, se
  // cobró lo que sí quedó escrito; si no, se devolvió la reserva.
  assert.strictEqual(await saldoDe(), salio === 'escribio' ? 97 : 100, salio)
  assert.strictEqual(await existe('activities/EV'), false, 'la actividad queda borrada: el merge no la recreó')
  await limpiarComoTrigger('EV', datos)
  assert.strictEqual(await rastroDe('EV'), 0, 'tras la limpieza no queda nada')
})

await caso('reintento después del borrado: se rechaza, no escribe nada y no cobra', async () => {
  const saldoAntes = await saldoDe()
  const e = await falla(() => crearEval())
  assert.match(codigo(e), /not-found/)
  assert.strictEqual(await rastroDe('EV'), 0)
  assert.strictEqual(await saldoDe(), saldoAntes)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('diagnóstico de contexto y de conocimientos — preguntas, clave, nombre e instrucciones')
// ═════════════════════════════════════════════════════════════════════════════
const PREGUNTAS_CONTEXTO = () => ({
  nombre: 'Diagnóstico de contexto', instruccionesHtml: '<p>Contesta con sinceridad.</p>',
  preguntas: Array.from({ length: 10 }, (_, i) => (i % 2
    ? { tipo: 'respuesta_corta', enunciado: `¿Qué opinas ${i}?` }
    : { tipo: 'opcion_multiple', enunciado: `¿Tienes computadora ${i}?`, opciones: ['Sí', 'No'] })),
})
const REACTIVOS_CONOCIMIENTOS = () => ({ nombre: 'Diagnóstico de conocimientos', instruccionesHtml: '<p>No es examen.</p>', ...reactivos(5)() })
const CTX = (actividadId) => ({
  actividadId, asignaturaNombre: 'Informática', perfilIATexto: 'Docente participativo', bloqueFuentes: '',
  comentariosGrupoTexto: '', queQuieresIndagar: 'Hábitos de estudio', fuentesBloques: [], cantidad: 5,
})
const DIAGNOSTICOS = [
  ['contexto', IA.ejecutarDiagnosticoContexto, PREGUNTAS_CONTEXTO, 10],
  ['conocimientos', IA.ejecutarDiagnosticoConocimientos, REACTIVOS_CONOCIMIENTOS, 5],
]
for (const [nombre, ejecutar, respuesta, esperadas] of DIAGNOSTICOS) {
  const correrDiag = (act) => ejecutar({ params: { __contexto: CTX(act) }, modelo: 'claude-haiku-4-5', apiKey: 'k' })
  const sembrarDiag = async () => {
    await base()
    for (const id of ['DG', 'DG_OTRA']) await db.doc(`activities/${id}`).set({ docenteId: DOCENTE, categoria: 'cuestionario', nombre: '', asignaturaId: 'S1', oculta: true })
    await db.doc('activities/DG_OTRA/preguntas/p').set({ enunciado: 'de la otra' })
    respuestaIA = respuesta
  }

  await caso(`${nombre} · actividad viva: preguntas, clave, nombre e instrucciones como siempre`, async () => {
    await sembrarDiag()
    const r = await correrDiag('DG')
    assert.strictEqual(r.resultado.cantidad, esperadas)
    assert.strictEqual(await tam('activities/DG/preguntas'), esperadas)
    assert.strictEqual(await tam('activities/DG/clave'), esperadas)
    const act = await datosDe('DG')
    assert.strictEqual(act.evaluacion.numPreguntas, esperadas)
    assert.ok(act.nombre.startsWith('Diagnóstico'))
    assert.strictEqual(act.categoria, 'cuestionario', 'el merge conserva lo demás')
  })

  await caso(`${nombre} · borrada antes de empezar: no escribe nada ni recrea la actividad`, async () => {
    await sembrarDiag()
    await db.doc('activities/DG').delete()
    const e = await falla(() => correrDiag('DG'))
    assert.match(codigo(e), /not-found/)
    assert.strictEqual(await rastroDe('DG'), 0)
  })

  await caso(`${nombre} · borrada MIENTRAS la IA genera: no recrea la actividad ni deja preguntas/clave; la otra intacta`, async () => {
    await sembrarDiag()
    const otra = await fotoDe('DG_OTRA')
    borrarEnPedido = { n: 1, id: 'DG' }
    const e = await falla(() => correrDiag('DG'))
    assert.match(codigo(e), /not-found/)
    assert.strictEqual(pedidosIA.length, 1)
    assert.strictEqual(await existe('activities/DG'), false, 'NO se recreó la actividad')
    assert.strictEqual(await rastroDe('DG'), 0)
    assert.strictEqual(await fotoDe('DG_OTRA'), otra)
  })

  await caso(`${nombre} · borrada con la transacción abierta y reintento posterior: nunca recrea; tras la limpieza no queda nada`, async () => {
    await sembrarDiag()
    const datos = await datosDe('DG')
    const b = borrarEnTransaccion('DG')
    await correrDiag('DG').catch(() => {})
    await b.esperar()
    assert.strictEqual(await existe('activities/DG'), false, 'el merge no la recreó')
    await limpiarComoTrigger('DG', datos)
    assert.strictEqual(await rastroDe('DG'), 0)
    const e2 = await falla(() => correrDiag('DG'))
    assert.match(codigo(e2), /not-found/)
    assert.strictEqual(await rastroDe('DG'), 0)
  })
}

// ═════════════════════════════════════════════════════════════════════════════
grupo('calificar_abierta (C-02) — candados «procesando» y propuestas en iaSugerencias')
// ═════════════════════════════════════════════════════════════════════════════
const C02_OK = () => ({ criterios: [{ n: 1, puntos: 1, evidencia: 'Menciona la barra de tareas' }], fortalezas: ['Claro'], errores: [], retroalimentacion: 'Bien.' })
async function sembrarC02() {
  await base()
  for (const id of ['AB', 'AB_OTRA']) {
    await db.doc(`activities/${id}`).set({ docenteId: DOCENTE, categoria: 'cuestionario', nombre: 'Windows', asignaturaId: 'S1' })
    await db.doc(`activities/${id}/preguntas/p1`).set({ tipo: 'respuesta_corta', enunciado: '¿Qué es la barra de tareas?', ponderacion: 2 })
    await db.doc(`activities/${id}/clave/p1`).set({ respuestaEsperada: 'La franja inferior con los programas abiertos' })
    for (const al of ['a1', 'a2', 'a3']) {
      await db.doc(`submissions/${id}_${al}`).set({ actividadId: id, alumnoId: al, estadoEvaluacion: 'finalizado', pendienteRevision: true })
      await db.doc(`submissions/${id}_${al}/respuestas/p1`).set({ textoRespuesta: `Respuesta de ${al}: la franja de abajo` })
    }
  }
  await db.doc('activities/AB_OTRA/iaSugerencias/previa').set({ estado: 'pendiente', sub: 'AB_OTRA_a1', preg: 'p1' })
  respuestaIA = C02_OK
}
const propuestasC02 = async (act) => ((await existe(`activities/${act}`)) ? 1 : 0) + await tam(`activities/${act}/iaSugerencias`)
const c02 = (act = 'AB') => IA.ejecutarCalificarAbierta({ params: { __uid: DOCENTE, actividadId: act, __idempotencyKey: clave() }, modelo: 'claude-haiku-4-5', apiKey: 'k', unidades: 10 })

await caso('actividad viva: una propuesta «pendiente» por respuesta, sin candados colgando', async () => {
  await sembrarC02()
  const r = await c02()
  assert.strictEqual(r.resultado.sugerencias.length, 3)
  const docs = (await db.collection('activities/AB/iaSugerencias').get()).docs.map((d) => d.data().estado)
  assert.deepStrictEqual(docs, ['pendiente', 'pendiente', 'pendiente'])
})

await caso('candado huérfano viejo (> 10 min) con la actividad viva: se retoma como siempre', async () => {
  await sembrarC02()
  const { Timestamp } = require('firebase-admin/firestore')
  await db.doc('activities/AB/iaSugerencias/AB_a1_p1').set({ estado: 'procesando', actividadId: 'AB', sub: 'AB_a1', preg: 'p1', creadoEn: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000) })
  const r = await c02()
  assert.strictEqual(r.resultado.sugerencias.length, 3)
  assert.strictEqual((await db.doc('activities/AB/iaSugerencias/AB_a1_p1').get()).data().estado, 'pendiente')
})

await caso('borrada antes de empezar: se rechaza sin IA ni candados', async () => {
  await sembrarC02()
  await db.doc('activities/AB').delete()
  const e = await falla(() => c02())
  assert.match(codigo(e), /not-found/)
  assert.strictEqual(pedidosIA.length, 0)
  assert.strictEqual(await propuestasC02('AB'), 0)
})

await caso('borrada al adquirir los candados: suelta los ya tomados, no llama a la IA y no deja nada', async () => {
  await sembrarC02()
  const b = borrarEnTransaccion('AB', { despuesDe: 2 }) // el 2.º candado ya no encuentra la actividad
  const e = await falla(() => c02())
  await b.esperar()
  assert.match(codigo(e), /not-found/)
  assert.strictEqual(pedidosIA.length, 0, 'no se llamó a la IA')
  assert.strictEqual(await propuestasC02('AB'), 0, 'ningún candado colgando')
})

await caso('borrada DURANTE el lote: ninguna propuesta ni candado queda; la otra actividad intacta', async () => {
  await sembrarC02()
  const otra = await fotoDe('AB_OTRA')
  borrarEnPedido = { n: 1, id: 'AB' }
  const e = await falla(() => c02())
  assert.match(codigo(e), /unavailable/, 'ninguna respuesta se pudo guardar: nada se cobra')
  assert.strictEqual(await propuestasC02('AB'), 0, 'sin propuestas ni candados (antes de la limpieza)')
  assert.strictEqual(await fotoDe('AB_OTRA'), otra)
  const e2 = await falla(() => c02())
  assert.match(codigo(e2), /not-found/, 'reintento rechazado')
  assert.strictEqual(await propuestasC02('AB'), 0)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('calificar_entregable_ia_lote — candados, propuestas y «Recalificar» (aplicarNotaIA)')
// ═════════════════════════════════════════════════════════════════════════════
const TARIFAS_LOTE = {
  version: 1,
  tarifas: { calificar_entregable_ia_lote: 0.25, calificar_entregable_ia_lote_imagenes: 0.5 },
  categorias: { calificar_entregable_ia_lote: 'Calificación de evidencias' },
  modeloPorOperacion: { calificar_entregable_ia_lote: 'claude-haiku-4-5' },
}
const RUBRICA = { tipo: 'rubrica', criterios: [{ nombre: 'Criterio 1', puntos: [10, 5, 0], descriptores: ['Completo', 'Parcial', 'No cumple'] }], niveles: [{ nombre: 'Completo' }, { nombre: 'Parcial' }, { nombre: 'No cumple' }] }
const OP11_OK = () => ({ criterios: [{ n: 1, nivel: 0, evidencia: 'Cumple', sinEvidenciaSuficiente: false }], retroalimentacionGeneral: 'Buen trabajo.', confianza: 'alta' })
const PDF = FX.pdf({ caracteresPorPagina: 600 })
const fetchReal = globalThis.fetch
async function sembrarLote() {
  await base({ tarifas: TARIFAS_LOTE })
  EVID._pruebas.limpiarCache()
  globalThis.fetch = async (url, ...resto) => (String(url).startsWith('https://archivos.test/') ? new Response(PDF, { status: 200 }) : fetchReal(url, ...resto))
  await db.doc('subjects/sub-lote').set({ docenteId: DOCENTE, nombre: 'Informática', parciales: 2 })
  for (const id of ['LT', 'LT_OTRA']) {
    await db.doc(`activities/${id}`).set({ docenteId: DOCENTE, asignaturaId: 'sub-lote', parcial: 1, categoria: 'entregable', nombre: 'Práctica', instrucciones: 'Entrega', tiposArchivo: ['todos'], rubrica: RUBRICA })
    for (const al of ['a1', 'a2', 'a3', 'a4', 'a5']) {
      await db.doc(`submissions/${id}_${al}`).set({ actividadId: id, alumnoId: al, calificacion: null, archivos: [{ url: `https://archivos.test/${id}-${al}.pdf`, nombre: 'tarea.pdf' }] })
    }
  }
  await db.doc('activities/LT_OTRA/iaSugerenciasEntregable/LT_OTRA_a1').set({ estado: 'pendiente', sub: 'LT_OTRA_a1' })
  respuestaIA = OP11_OK
}
async function lote(act = 'LT', extra = {}) {
  const costo = (await correr({ operacion: 'estimar_calificacion_evidencias', params: { modo: 'lote', actividadId: act, ...extra } })).estimacion
  return () => correr({ operacion: 'calificar_entregable_ia_lote', idempotencyKey: clave(), unidades: costo.entregas, params: { actividadId: act, costoConfirmado: costo, ...extra } })
}

await caso('actividad viva: cinco propuestas «pendiente», sin candados, y se cobra lo evaluado', async () => {
  await sembrarLote()
  const r = await (await lote())()
  assert.strictEqual(r.resultado.generadas, 5)
  const estados = (await db.collection('activities/LT/iaSugerenciasEntregable').get()).docs.map((d) => d.data().estado)
  assert.deepStrictEqual(estados, Array(5).fill('pendiente'))
  assert.strictEqual(await saldoDe(), 100 - 5 * 0.25)
})

await caso('borrada antes de empezar (después de estimar): se rechaza sin IA, sin cobro y sin candados', async () => {
  await sembrarLote()
  const ejecutar = await lote()
  await db.doc('activities/LT').delete()
  const e = await falla(ejecutar)
  assert.ok(e)
  assert.strictEqual(pedidosIA.length, 0)
  assert.strictEqual(await saldoDe(), 100)
  assert.strictEqual(await rastroDe('LT'), 0)
})

await caso('borrada al adquirir los candados: suelta los tomados, no llama a la IA, no cobra', async () => {
  await sembrarLote()
  const ejecutar = await lote()
  const b = borrarEnTransaccion('LT', { despuesDe: 3 })
  const e = await falla(ejecutar)
  await b.esperar()
  assert.match(codigo(e), /not-found/)
  assert.strictEqual(pedidosIA.length, 0)
  assert.strictEqual(await saldoDe(), 100)
  assert.strictEqual(await rastroDe('LT'), 0, 'ningún candado colgando')
})

await caso('borrada DURANTE el lote: ninguna propuesta parcial ni candado; no recrea la actividad; la otra intacta', async () => {
  await sembrarLote()
  const ejecutar = await lote()
  const otra = await fotoDe('LT_OTRA')
  const datos = await datosDe('LT')
  borrarEnPedido = { n: 1, id: 'LT' }
  const e = await falla(ejecutar)
  assert.match(codigo(e), /unavailable/, 'ninguna propuesta se pudo guardar')
  assert.strictEqual(await saldoDe(), 100, 'sin propuesta guardada no se cobra (regla de siempre del lote)')
  assert.strictEqual(await rastroDe('LT'), 0, 'sin propuestas parciales ni candados, aun antes de la limpieza')
  await limpiarComoTrigger('LT', datos)
  assert.strictEqual(await rastroDe('LT'), 0)
  assert.strictEqual(await fotoDe('LT_OTRA'), otra)
  const e2 = await falla(ejecutar)
  assert.ok(e2, 'reintento rechazado')
  assert.strictEqual(await rastroDe('LT'), 0)
})

await caso('«Recalificar» con la actividad viva: reemplaza las propuestas y aplica las notas como siempre', async () => {
  await sembrarLote()
  const r = await (await lote('LT', { recalificar: true }))()
  assert.strictEqual(r.resultado.generadas, 5)
  assert.strictEqual(r.resultado.aplicadasAuto, 5)
  assert.strictEqual((await db.doc('submissions/LT_a1').get()).data().calificacion, 10)
})

await caso('«Recalificar» con la actividad borrada al tomar los candados: suelta los tomados, sin IA ni cobro ni notas', async () => {
  await sembrarLote()
  const ejecutar = await lote('LT', { recalificar: true })
  const b = borrarEnTransaccion('LT', { despuesDe: 3 })
  const e = await falla(ejecutar)
  await b.esperar()
  assert.match(codigo(e), /not-found/)
  assert.strictEqual(pedidosIA.length, 0)
  assert.strictEqual(await saldoDe(), 100)
  assert.strictEqual(await rastroDe('LT'), 0, 'ningún candado colgando')
  assert.strictEqual((await db.doc('submissions/LT_a1').get()).data().calificacion, null, 'ninguna nota escrita')
})

await caso('aplicarNotaIA: actividad borrada → no escribe la nota ni la propuesta; viva → como siempre', async () => {
  await limpiar()
  await db.doc('submissions/RC_a1').set({ actividadId: 'RC', alumnoId: 'a1', calificacion: null })
  const args = (sub) => ({
    subRef: dbFn.doc(`submissions/${sub}`), sugRef: dbFn.doc(`activities/RC/iaSugerenciasEntregable/${sub}`),
    datos: { calificacion: 9, comentario: 'IA', rubricaEval: [0] }, origen: 'ia_recalificar',
    sugerenciaNueva: { estado: 'aplicada', aplicadaAutomaticamente: true },
  })
  assert.deepStrictEqual(await aplicarNotaIA(dbFn, args('RC_a1')), { aplicada: false, motivo: 'sin_actividad' })
  assert.strictEqual((await db.doc('submissions/RC_a1').get()).data().calificacion, null, 'la nota no cambia')
  assert.strictEqual(await rastroDe('RC'), 0, 'ni propuesta ni actividad recreada')
  await db.doc('activities/RC').set({ docenteId: DOCENTE })
  const r = await aplicarNotaIA(dbFn, args('RC_a1'))
  assert.strictEqual(r.aplicada, true)
  assert.strictEqual((await db.doc('submissions/RC_a1').get()).data().calificacion, 9)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('analizar_entregable — analisisActividadIA')
// ═════════════════════════════════════════════════════════════════════════════
const TARIFAS_AN = {
  version: 1, tarifas: { analizar_entregable: 10 }, categorias: { analizar_entregable: 'Seguimiento' },
  modeloPorOperacion: { analizar_entregable: 'claude-haiku-4-5' },
  analisisAsignatura: {
    costoPorFuente: { entregables: 5, observacion: 3, evaluaciones: 4, interactivas: 3, asistencias: 3, sinEntrega: 2 },
    umbrales: { promedioMinimo: 6, minActividadesCalificadas: 2, faltantesPorcentaje: 30, minFaltantes: 2, asistenciaMinimaPorcentaje: 80, minSesiones: 5, proporcionPatronGrupal: 0.5, cambioRelevante: 1 },
  },
}
const INFORME_OK = () => ({ resumenEjecutivo: 'La mitad del grupo entregó.', fortalezas: ['Buen promedio'], dificultades: ['Faltó uno'], recomendaciones: ['Seguimiento'] })
async function sembrarAnalisis() {
  await base({ tarifas: TARIFAS_AN })
  await db.doc('subjects/sub-an').set({ docenteId: DOCENTE, nombre: 'Física I', parciales: 2, parcialesFechas: [{ inicio: '2020-01-01', fin: '2020-01-31' }, { inicio: '2020-02-01', fin: '2099-12-31' }] })
  const pub = { oculta: false, publishedAt: '2020-01-01T08:00', docenteId: DOCENTE, asignaturaId: 'sub-an', maxCalif: 10 }
  for (const al of ['al_a', 'al_b', 'al_c']) await db.doc(`students/${al}`).set({ nombre: al, apellidoPaterno: 'X', asignaturaId: 'sub-an' })
  for (const id of ['AN', 'AN_OTRA']) {
    await db.doc(`activities/${id}`).set({ ...pub, categoria: 'entregable', tipo: 'archivo', nombre: 'Reporte', parcial: 1, orden: 1, fechaLimite: '2020-01-20', instrucciones: '<p>Entrega</p>', rubrica: { tipo: 'rubrica', niveles: [{ nombre: 'Excelente' }, { nombre: 'Suficiente' }], criterios: [{ nombre: 'Procedimiento' }] } })
    await db.doc(`submissions/${id}_al_a`).set({ actividadId: id, alumnoId: 'al_a', estado: 'calificado', calificacion: 9, archivos: [{ url: 'https://x/a.pdf', nombre: 'a.pdf' }], rubricaEval: [0] })
    await db.doc(`submissions/${id}_al_b`).set({ actividadId: id, alumnoId: 'al_b', estado: 'calificado', calificacion: 4, archivos: [{ url: 'https://x/b.pdf', nombre: 'b.pdf' }], rubricaEval: [1] })
  }
  await db.doc('activities/AN_OTRA/analisisActividadIA/previo').set({ resumen: 'de la otra' })
  respuestaIA = INFORME_OK
}
const analizar = (act = 'AN') => correr({ operacion: 'analizar_entregable', idempotencyKey: clave(), unidades: 1, params: { actividadId: act, asignaturaId: 'sub-an', costoConfirmado: 10 } })

await caso('actividad viva: el informe se guarda y se cobra como siempre', async () => {
  await sembrarAnalisis()
  const r = await analizar()
  assert.ok(r.resultado.analisisId)
  assert.strictEqual(await tam('activities/AN/analisisActividadIA'), 1)
  assert.strictEqual(await saldoDe(), 90)
})

await caso('borrada antes de empezar: se rechaza sin IA ni cobro', async () => {
  await sembrarAnalisis()
  await db.doc('activities/AN').delete()
  const e = await falla(() => analizar())
  assert.ok(e)
  assert.strictEqual(pedidosIA.length, 0)
  assert.strictEqual(await saldoDe(), 100)
  assert.strictEqual(await rastroDe('AN'), 0)
})

await caso('borrada MIENTRAS la IA analiza: no guarda el informe, no cobra, no recrea; la otra intacta; reintento rechazado', async () => {
  await sembrarAnalisis()
  const otra = await fotoDe('AN_OTRA')
  borrarEnPedido = { n: 1, id: 'AN' }
  const e = await falla(() => analizar())
  assert.match(codigo(e), /not-found/)
  assert.strictEqual(await saldoDe(), 100)
  assert.strictEqual(await rastroDe('AN'), 0)
  assert.strictEqual(await fotoDe('AN_OTRA'), otra)
  const e2 = await falla(() => analizar())
  assert.ok(e2)
  assert.strictEqual(await rastroDe('AN'), 0)
  assert.strictEqual(await saldoDe(), 100)
})

globalThis.fetch = fetchReal
await limpiar()
resumen('limpieza-escritores-criticos.test.mjs')
