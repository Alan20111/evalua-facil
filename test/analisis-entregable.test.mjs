// Análisis con IA de UN entregable — «solo resultados» (Fase 1). Pruebas
// contra el emulador.
//
//   node scripts/sync-functions-shared.mjs
//   firebase emulators:exec --only firestore,auth --project demo-test \
//     "node test/analisis-entregable.test.mjs"
//
// Recorre el callable REAL (`ejecutarOperacionIA.run`) con el SDK de Anthropic
// sustituido por uno falso: precheck, cobro (reserva → liquidación →
// reembolso), idempotencia, guardado, historial y limpieza — sin red ni gasto.
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import { db, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'

const require = createRequire(import.meta.url)
const IA_FN = require('../functions/ia.js')
const AA_FN = require('../functions/analisisAcademico.js')
const FAA = AA_FN._pruebas

const DOCENTE = 'docente_entregable'
const OTRO = 'docente_ajeno_entregable'
const SUBJ = 'subj_entregable'
const ACT = 'act_entregable'
const clave = () => crypto.randomUUID()
const UMBRALES = {
  promedioMinimo: 6, minActividadesCalificadas: 2, faltantesPorcentaje: 30, minFaltantes: 2,
  asistenciaMinimaPorcentaje: 80, minSesiones: 5, proporcionPatronGrupal: 0.5, cambioRelevante: 1,
}
const TARIFAS = {
  version: 1,
  tarifas: { analizar_entregable: 10, analizar_asignatura: 1 },
  categorias: { analizar_entregable: 'Seguimiento', analizar_asignatura: 'Seguimiento' },
  modeloPorOperacion: { analizar_entregable: 'claude-haiku-4-5', analizar_asignatura: 'claude-haiku-4-5' },
  analisisAsignatura: { costoPorFuente: { entregables: 5, observacion: 3, evaluaciones: 4, interactivas: 3, asistencias: 3, sinEntrega: 2 }, umbrales: UMBRALES },
}

// Anthropic falso (mismo método que test/ia-creditos.test.mjs).
const requireFn = createRequire(new URL('../functions/index.js', import.meta.url))
const rutaSdk = requireFn.resolve('@anthropic-ai/sdk')
requireFn(rutaSdk)
const SDK_REAL = require.cache[rutaSdk].exports
const pedidosIA = []
const INFORME_OK = () => ({ resumenEjecutivo: 'La mitad del grupo entregó.', fortalezas: ['Buen promedio de quienes entregaron'], dificultades: ['Alumno 3 no entregó'], recomendaciones: ['Dar seguimiento'] })
let respuestaIA = INFORME_OK
require.cache[rutaSdk].exports = class AnthropicFalso {
  constructor() {
    this.messages = {
      create: async (req) => {
        pedidosIA.push(req)
        return { content: [{ type: 'text', text: JSON.stringify(respuestaIA(req)) }], usage: { input_tokens: 900, output_tokens: 400 } }
      },
    }
  }
}
process.env.ANTHROPIC_API_KEY_PROD ||= 'sk-ant-prueba-' + 'x'.repeat(40)

const textoDelPedido = (req) => `${req.system}\n${typeof req.messages[0].content === 'string' ? req.messages[0].content : JSON.stringify(req.messages[0].content)}`
const creditosDe = async (uid = DOCENTE) => (await db.doc(`iaCreditos/${uid}`).get()).data()
const consumoDe = async (k) => (await db.doc(`iaConsumos/${k}`).get()).data()
const historial = async (act = ACT) => (await db.collection(`activities/${act}/analisisActividadIA`).get()).docs
const rechazo = async (p) => p.then(() => null, (e) => e)

const ALUMNOS = [
  { id: 'al_a', nombre: 'ZULEMA', apellidoPaterno: 'QUIROGA', apellidoMaterno: 'XOCHITL', orden: 1 },
  { id: 'al_b', nombre: 'Wenceslao', apellidoPaterno: 'Yáñez', apellidoMaterno: 'Kuri', orden: 2 },
  { id: 'al_c', nombre: 'Hermenegildo', apellidoPaterno: 'Villaseñor', apellidoMaterno: 'Ibargüengoitia', orden: 3 },
  { id: 'al_d', nombre: 'Ximena', apellidoPaterno: 'Urquidi', apellidoMaterno: 'Zendejas', orden: 4 },
]
const pub = { oculta: false, publishedAt: '2020-01-01T08:00', docenteId: DOCENTE, asignaturaId: SUBJ, maxCalif: 10 }

async function sembrar({ saldo = 100, tarifas = TARIFAS } = {}) {
  await limpiar()
  pedidosIA.length = 0
  respuestaIA = INFORME_OK
  await db.doc(`users/${DOCENTE}`).set({ role: 'docente', escuelaId: 'E1' })
  await db.doc(`users/${OTRO}`).set({ role: 'docente', escuelaId: 'E1' })
  await db.doc('config/iaTarifas').set(tarifas)
  await db.doc(`iaCreditos/${DOCENTE}`).set({ saldo, consumidoTotal: 0, consumoPorCategoria: {} })
  await db.doc(`iaCreditos/${OTRO}`).set({ saldo: 100, consumidoTotal: 0, consumoPorCategoria: {} })
  await db.doc(`subjects/${SUBJ}`).set({ docenteId: DOCENTE, nombre: 'Física I', parciales: 2, parcialesFechas: [{ inicio: '2020-01-01', fin: '2020-01-31' }, { inicio: '2020-02-01', fin: '2099-12-31' }] })
  for (const a of ALUMNOS) await db.doc(`students/${a.id}`).set({ ...a, asignaturaId: SUBJ })
  await db.doc(`activities/${ACT}`).set({ ...pub, categoria: 'entregable', tipo: 'archivo', nombre: 'Reporte de laboratorio', parcial: 1, orden: 1, fechaLimite: '2020-01-20', instrucciones: '<p>Entrega tu reporte</p>',
    rubrica: { tipo: 'rubrica', niveles: [{ nombre: 'Excelente' }, { nombre: 'Suficiente' }], criterios: [{ nombre: 'Procedimiento' }] } })
  await db.doc('activities/act_obs').set({ ...pub, categoria: 'observacion', tipo: 'observacion', nombre: 'Exposición', parcial: 1, orden: 2 })
  await db.doc('activities/act_borrador').set({ ...pub, categoria: 'entregable', nombre: 'Borrador', parcial: 1, oculta: true, publishedAt: null })
  const sub = (al, d) => db.doc(`submissions/${ACT}_${al}`).set({ actividadId: ACT, alumnoId: al, ...d })
  await sub('al_a', { estado: 'calificado', calificacion: 9, archivos: [{ url: 'https://x/a.pdf', nombre: 'a.pdf' }], rubricaEval: [0], comentario: 'COMENTARIO-PRIVADO' })
  await sub('al_b', { estado: 'calificado', calificacion: 4, archivos: [{ url: 'https://x/b.pdf', nombre: 'b.pdf' }], rubricaEval: [1], tarde: true })
  await sub('al_d', { estado: 'calificado', calificacion: 8, sinEntrega: true, motivoSinEntrega: 'MOTIVO-PRIVADO' })
  // al_c: no entregó (vencida)
}

const ejecutar = ({ uid = DOCENTE, k = clave(), actividadId = ACT, costo = 10 } = {}) =>
  IA_FN.ejecutarOperacionIA.run({ auth: { uid }, data: { operacion: 'analizar_entregable', idempotencyKey: k, unidades: 1, params: { actividadId, asignaturaId: SUBJ, costoConfirmado: costo } } })

async function fotoAcademica() {
  const foto = {}
  for (const c of ['subjects', 'students', 'activities', 'submissions']) {
    foto[c] = (await db.collection(c).get()).docs.map((d) => [d.id, JSON.stringify(d.data())]).sort()
  }
  return JSON.stringify(foto)
}

// ═════════════════════════════════════════════════════════════════════════════
grupo('Revisión gratuita (prepararAnalisisEntregable)')
await sembrar()

await caso('devuelve conteos y costo sin tocar créditos ni llamar a la IA', async () => {
  const r = await FAA.prepararDatosEntregable({ uid: DOCENTE, actividadId: ACT, tarifas: TARIFAS })
  assert.strictEqual(r.costo, 10)
  assert.strictEqual(r.instrumento, 'Rúbrica')
  assert.strictEqual(r.calificados, 3)
  assert.strictEqual(r.actividad.etiqueta, '1.1')
  assert.deepStrictEqual([r.resultados.estudiantes, r.resultados.entregaron, r.resultados.entregasTardias, r.resultados.calificadasSinArchivo, r.resultados.noEntregaron], [4, 2, 1, 1, 1])
  assert.strictEqual((await creditosDe()).saldo, 100)
  assert.strictEqual((await db.collection('iaConsumos').get()).size, 0)
  assert.strictEqual(pedidosIA.length, 0)
})

await caso('el callable exige sesión, ser docente y ser el dueño; rechaza Observación y borradores', async () => {
  const run = (auth, actividadId = ACT) => rechazo(AA_FN.prepararAnalisisEntregable.run({ auth, data: { actividadId } }))
  assert.strictEqual((await run(undefined)).code, 'unauthenticated')
  assert.strictEqual((await run({ uid: OTRO })).code, 'permission-denied')
  await db.doc('users/alumno_x').set({ role: 'alumno' })
  assert.strictEqual((await run({ uid: 'alumno_x' })).code, 'permission-denied')
  assert.strictEqual((await run({ uid: DOCENTE }, 'act_obs')).code, 'failed-precondition')
  assert.strictEqual((await run({ uid: DOCENTE }, 'act_borrador')).code, 'failed-precondition')
  assert.strictEqual((await run({ uid: DOCENTE }, 'no_existe')).code, 'not-found')
  const ok = await AA_FN.prepararAnalisisEntregable.run({ auth: { uid: DOCENTE }, data: { actividadId: ACT } })
  assert.strictEqual(ok.costo, 10)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Ejecución y cobro (10 créditos fijos)')

await caso('una ejecución = exactamente 10 créditos, un solo consumo y el informe guardado por el servidor', async () => {
  await sembrar()
  const antes = await fotoAcademica()
  const k = clave()
  const r = await ejecutar({ k })
  assert.deepStrictEqual(r.resultado, { analisisId: k, actividadId: ACT })
  assert.strictEqual(r.creditosReales, 10)
  assert.strictEqual((await creditosDe()).saldo, 90)
  const consumos = (await db.collection('iaConsumos').get()).docs.map((d) => d.data())
  assert.strictEqual(consumos.length, 1)
  assert.deepStrictEqual([consumos[0].creditosReservados, consumos[0].creditosReales, consumos[0].estado, consumos[0].categoria], [10, 10, 'ejecutado', 'Seguimiento'])
  assert.strictEqual(pedidosIA.length, 1)
  assert.strictEqual(pedidosIA[0].model, 'claude-haiku-4-5')
  const doc = (await db.doc(`activities/${ACT}/analisisActividadIA/${k}`).get()).data()
  assert.deepStrictEqual([doc.tipo, doc.modalidad, doc.version, doc.docenteId, doc.actividadId, doc.idempotencyKey, doc.edicion], ['entregable', 'resultados', 1, DOCENTE, ACT, k, null])
  assert.ok(doc.generadoEn.toMillis() > 0)
  assert.strictEqual(doc.datos.resultados.entregaron, 2)
  assert.strictEqual(doc.informe.dificultades[0], 'Villaseñor Ibargüengoitia Hermenegildo no entregó', 'el servidor pone el nombre')
  assert.deepStrictEqual(doc.estudiantesRevisar.map((e) => [e.numeroLista, e.senales.map((s) => s.tipo)]), [[2, ['calificacion']], [3, ['sin_entrega']]])
  assert.strictEqual(await fotoAcademica(), antes, 'el análisis no modifica ningún dato académico')
  assert.ok(!JSON.stringify(await consumoDe(k)).includes('QUIROGA'), 'el registro de consumo no trae nombres')
})

await caso('privacidad: al modelo no llegan nombres, comentarios, motivos ni archivos', async () => {
  const texto = textoDelPedido(pedidosIA[0])
  for (const a of ALUMNOS) for (const p of [a.nombre, a.apellidoPaterno, a.apellidoMaterno]) assert.ok(!texto.toLowerCase().includes(p.toLowerCase()), p)
  for (const p of ['COMENTARIO-PRIVADO', 'MOTIVO-PRIVADO', 'https://x/', 'a.pdf']) assert.ok(!texto.includes(p), p)
  assert.ok(texto.includes('Alumno 2') && texto.includes('Entrega tu reporte'))
})

await caso('idempotencia y doble clic: la misma clave no cobra dos veces ni duplica el informe', async () => {
  await sembrar()
  const k = clave()
  await ejecutar({ k })
  const r2 = await ejecutar({ k })
  assert.strictEqual(r2.repetida, true)
  assert.strictEqual((await creditosDe()).saldo, 90)
  assert.strictEqual((await historial()).length, 1)
  assert.strictEqual(pedidosIA.length, 1)
})

await caso('saldo insuficiente: no reserva, no ejecuta, no guarda', async () => {
  await sembrar({ saldo: 9.5 })
  const e = await rechazo(ejecutar())
  assert.strictEqual(e.details.codigo, 'SALDO_INSUFICIENTE')
  assert.strictEqual(e.details.costo, 10)
  assert.strictEqual((await creditosDe()).saldo, 9.5)
  assert.strictEqual((await historial()).length, 0)
  assert.strictEqual(pedidosIA.length, 0)
})

await caso('el costo confirmado distinto del real: se rechaza antes de reservar', async () => {
  await sembrar()
  const k = clave()
  const e = await rechazo(ejecutar({ k, costo: 9 }))
  assert.strictEqual(e.details.codigo, 'COSTO_CAMBIO')
  assert.strictEqual(e.details.costo, 10)
  assert.strictEqual(await consumoDe(k), undefined)
  assert.strictEqual((await creditosDe()).saldo, 100)
})

await caso('fallo de la IA: reembolso íntegro y ningún informe', async () => {
  await sembrar()
  respuestaIA = () => { throw new Error('Anthropic caído') }
  const k = clave()
  const e = await rechazo(ejecutar({ k }))
  assert.strictEqual(e.code, 'unavailable')
  assert.strictEqual((await creditosDe()).saldo, 100)
  assert.strictEqual((await consumoDe(k)).estado, 'fallido')
  assert.strictEqual((await historial()).length, 0)
})

await caso('la IA responde sin resumen: no es un informe → reembolso', async () => {
  await sembrar()
  respuestaIA = () => ({ resumenEjecutivo: '', fortalezas: ['x'] })
  const e = await rechazo(ejecutar())
  assert.strictEqual(e.code, 'unavailable')
  assert.strictEqual((await creditosDe()).saldo, 100)
  assert.strictEqual((await historial()).length, 0)
})

await caso('otro docente, Observación, borrador o sin tarifa: rechazo sin cobro', async () => {
  await sembrar()
  assert.strictEqual((await rechazo(ejecutar({ uid: OTRO }))).code, 'permission-denied')
  assert.strictEqual((await creditosDe(OTRO)).saldo, 100)
  assert.strictEqual((await rechazo(ejecutar({ actividadId: 'act_obs' }))).code, 'failed-precondition')
  assert.strictEqual((await rechazo(ejecutar({ actividadId: 'act_borrador' }))).code, 'failed-precondition')
  const sinTarifa = JSON.parse(JSON.stringify(TARIFAS)); delete sinTarifa.tarifas.analizar_entregable
  await db.doc('config/iaTarifas').set(sinTarifa)
  assert.strictEqual((await rechazo(ejecutar())).details.codigo, 'ANALISIS_SIN_CONFIGURAR')
  assert.strictEqual((await creditosDe()).saldo, 100)
  assert.strictEqual(pedidosIA.length, 0)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Historial y datos actuales')

await caso('un segundo análisis usa los datos actuales y no toca el anterior', async () => {
  await sembrar()
  const k1 = clave()
  await ejecutar({ k: k1 })
  const viejo = JSON.stringify((await db.doc(`activities/${ACT}/analisisActividadIA/${k1}`).get()).data())
  await db.doc(`submissions/${ACT}_al_c`).set({ actividadId: ACT, alumnoId: 'al_c', estado: 'calificado', calificacion: 10, archivos: [{ url: 'https://x/c.pdf', nombre: 'c.pdf' }] })
  const k2 = clave()
  await ejecutar({ k: k2 })
  const d1 = (await db.doc(`activities/${ACT}/analisisActividadIA/${k1}`).get()).data()
  const d2 = (await db.doc(`activities/${ACT}/analisisActividadIA/${k2}`).get()).data()
  assert.strictEqual(JSON.stringify(d1), viejo)
  assert.strictEqual(d1.datos.resultados.entregaron, 2)
  assert.strictEqual(d2.datos.resultados.entregaron, 3)
  assert.ok(!textoDelPedido(pedidosIA[1]).includes('La mitad del grupo entregó.'), 'el nuevo no lee el informe anterior')
  assert.strictEqual((await historial()).length, 2)
  assert.strictEqual((await creditosDe()).saldo, 80)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Borrado de la actividad sin huérfanos')

await caso('al eliminar la actividad se elimina su historial de análisis; lo demás no se toca', async () => {
  await sembrar()
  await ejecutar()
  await db.doc(`activities/${ACT}/iaSugerenciasEntregable/s1`).set({ estado: 'aplicada' })
  await db.doc('activities/act_obs/analisisActividadIA/ajeno').set({ x: 1 })
  await db.doc(`activities/${ACT}`).delete()
  await AA_FN.limpiarAnalisisActividad.run({ params: { activityId: ACT } })
  assert.strictEqual((await historial()).length, 0)
  assert.ok((await db.doc(`activities/${ACT}/iaSugerenciasEntregable/s1`).get()).exists, 'otras subcolecciones: comportamiento de siempre')
  assert.strictEqual((await historial('act_obs')).length, 1, 'el historial de otra actividad no se toca')
  await FAA.borrarAnalisisDeActividad('no_existe')
})

require.cache[rutaSdk].exports = SDK_REAL

resumen('pruebas del análisis de un entregable')
