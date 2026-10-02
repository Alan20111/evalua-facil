// Análisis integral de asignatura con IA (PR 1) — pruebas contra el emulador.
//
//   node scripts/sync-functions-shared.mjs
//   firebase emulators:exec --only firestore,auth --project demo-test \
//     "node test/analisis-asignatura.test.mjs"
//
// Recorre el callable REAL (`ejecutarOperacionIA.run`) con el SDK de Anthropic
// sustituido por uno falso: se prueba la comprobación previa, el cobro
// (reserva → liquidación → reembolso), la idempotencia, el guardado del
// informe y la limpieza — sin red y sin gastar un solo token.
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import { db, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'

const require = createRequire(import.meta.url)
const IA_FN = require('../functions/ia.js')
const AA_FN = require('../functions/analisisAcademico.js')
const FAA = AA_FN._pruebas

const DOCENTE = 'docente_analisis'
const OTRO = 'docente_ajeno_analisis'
const SUBJ = 'subj_analisis'
const clave = () => crypto.randomUUID()

const COSTOS = { entregables: 5, observacion: 3, evaluaciones: 4, interactivas: 3, asistencias: 3, sinEntrega: 2 }
const UMBRALES = {
  promedioMinimo: 6, minActividadesCalificadas: 2, faltantesPorcentaje: 30, minFaltantes: 2,
  asistenciaMinimaPorcentaje: 80, minSesiones: 5, proporcionPatronGrupal: 0.5, cambioRelevante: 1,
}
const TARIFAS = {
  version: 1,
  tarifas: { analizar_asignatura: 1, analizar_resultados: 5 },
  categorias: { analizar_asignatura: 'Seguimiento', analizar_resultados: 'Evaluaciones' },
  modeloPorOperacion: { analizar_asignatura: 'claude-haiku-4-5', analizar_resultados: 'claude-haiku-4-5' },
  analisisAsignatura: { costoPorFuente: COSTOS, umbrales: UMBRALES },
}
const TODAS = ['entregables', 'observacion', 'evaluaciones', 'interactivas', 'asistencias', 'sinEntrega']

// Anthropic falso (mismo método que test/ia-creditos.test.mjs).
const requireFn = createRequire(new URL('../functions/index.js', import.meta.url))
const rutaSdk = requireFn.resolve('@anthropic-ai/sdk')
requireFn(rutaSdk)
const SDK_REAL = require.cache[rutaSdk].exports
const pedidosIA = []
const INFORME_OK = () => ({
  resumenEjecutivo: 'El grupo va bien en general.', fortalezas: ['Buen resultado en el reporte'], dificultades: ['Entregas faltantes'],
  evolucion: 'El promedio subió del parcial 1 al 2.', areasCriticas: ['El cuestionario'], recomendacionesGenerales: ['Repasar vectores'],
  recomendacionesEstudiantes: [{ anonId: 'Alumno 2', recomendacion: 'Dar seguimiento semanal' }, { anonId: 'Alumno 77', recomendacion: 'inventado' }],
  conclusion: 'Situación estable con focos de atención.',
})
let respuestaIA = INFORME_OK
require.cache[rutaSdk].exports = class AnthropicFalso {
  constructor() {
    this.messages = {
      create: async (req) => {
        pedidosIA.push(req)
        const r = respuestaIA(req)
        return { content: [{ type: 'text', text: JSON.stringify(r) }], usage: { input_tokens: 1000, output_tokens: 500 } }
      },
    }
  }
}
process.env.ANTHROPIC_API_KEY_PROD ||= 'sk-ant-prueba-' + 'x'.repeat(40)

const textoDelPedido = (req) => `${req.system}\n${typeof req.messages[0].content === 'string' ? req.messages[0].content : JSON.stringify(req.messages[0].content)}`
const creditosDe = async (uid = DOCENTE) => (await db.doc(`iaCreditos/${uid}`).get()).data()
const consumoDe = async (k) => (await db.doc(`iaConsumos/${k}`).get()).data()
const analisisDe = async (k, subj = SUBJ) => (await db.doc(`subjects/${subj}/analisisIA/${k}`).get())
const historial = async (subj = SUBJ) => (await db.collection(`subjects/${subj}/analisisIA`).get()).docs

const ALUMNOS = [
  { id: 'al_a', nombre: 'ZULEMA', apellidoPaterno: 'QUIROGA', apellidoMaterno: 'XOCHITL', orden: 1 },
  { id: 'al_b', nombre: 'Wenceslao', apellidoPaterno: 'Yáñez', apellidoMaterno: 'Kuri', orden: 2 },
  { id: 'al_c', nombre: 'Hermenegildo', apellidoPaterno: 'Villaseñor', apellidoMaterno: 'Ibargüengoitia', orden: 3 },
]
const pub = { oculta: false, publishedAt: '2026-08-01T08:00', docenteId: DOCENTE, asignaturaId: SUBJ, maxCalif: 10 }

async function sembrar({ saldo = 100, tarifas = TARIFAS } = {}) {
  await limpiar()
  pedidosIA.length = 0
  respuestaIA = INFORME_OK
  await db.doc(`users/${DOCENTE}`).set({ role: 'docente', nombre: 'Prueba', escuelaId: 'E1' })
  await db.doc(`users/${OTRO}`).set({ role: 'docente', nombre: 'Otro', escuelaId: 'E1' })
  await db.doc('config/iaTarifas').set(tarifas)
  await db.doc(`iaCreditos/${DOCENTE}`).set({ saldo, consumidoTotal: 0, consumoPorCategoria: {} })
  await db.doc(`iaCreditos/${OTRO}`).set({ saldo: 100, consumidoTotal: 0, consumoPorCategoria: {} })
  await db.doc(`subjects/${SUBJ}`).set({
    docenteId: DOCENTE, nombre: 'Física I', parciales: 2,
    parcialesFechas: [{ inicio: '2020-01-01', fin: '2020-01-31' }, { inicio: '2020-02-01', fin: '2020-02-29' }],
  })
  for (const a of ALUMNOS) await db.doc(`students/${a.id}`).set({ ...a, asignaturaId: SUBJ, username: `u_${a.id}` })
  await db.doc('activities/act_e1').set({ ...pub, categoria: 'entregable', tipo: 'archivo', nombre: 'Reporte de laboratorio', parcial: 1, orden: 1, fechaLimite: '2020-01-20' })
  await db.doc('activities/act_e2').set({ ...pub, categoria: 'entregable', tipo: 'archivo', nombre: 'Mapa conceptual', parcial: 1, orden: 2, fechaLimite: '2020-01-25' })
  await db.doc('activities/act_o1').set({ ...pub, categoria: 'observacion', tipo: 'observacion', nombre: 'Exposición oral', parcial: 1, orden: 3, instrucciones: 'Expón tu tema' })
  await db.doc('activities/act_q1').set({ ...pub, categoria: 'cuestionario', tipo: 'evaluacion', nombre: 'Cuestionario de vectores', parcial: 2, orden: 1, fechaLimite: '2020-02-10' })
  await db.doc('activities/act_j1').set({ ...pub, categoria: 'juego', tipoJuego: 'crucigrama', nombre: 'Crucigrama de unidades', parcial: 2, orden: 2, juego: { estado: 'juego_confirmado' } })
  const sub = (act, al, datos) => db.doc(`submissions/${act}_${al}`).set({ actividadId: act, alumnoId: al, ...datos })
  await sub('act_e1', 'al_a', { estado: 'calificado', calificacion: 9, archivos: [{ url: 'https://x/a.png', nombre: 'a.png' }], comentario: 'COMENTARIO-PRIVADO' })
  await sub('act_e1', 'al_b', { estado: 'calificado', calificacion: 4, archivos: [{ url: 'https://x/b.png', nombre: 'b.png' }] })
  await sub('act_e2', 'al_a', { estado: 'calificado', calificacion: 10, archivos: [{ url: 'https://x/c.png', nombre: 'c.png' }] })
  await sub('act_e2', 'al_b', { estado: 'calificado', calificacion: 5, archivos: [{ url: 'https://x/d.png', nombre: 'd.png' }] })
  for (const [al, cal] of [['al_a', 10], ['al_b', 5], ['al_c', 8]]) await sub('act_o1', al, { estado: 'calificado', calificacion: cal, sinEntrega: true })
  await sub('act_q1', 'al_a', { estado: 'calificado', estadoEvaluacion: 'finalizado', calificacion: 7, intentos: [{ numero: 1 }] })
  await sub('act_q1', 'al_b', { estado: 'calificado', estadoEvaluacion: 'finalizado', calificacion: 8, intentos: [{ numero: 1 }] })
  await sub('act_j1', 'al_a', { estado: 'calificado', estadoEvaluacion: 'finalizado', calificacion: 6 })
  // Asistencia: 6 sesiones en el Parcial 1. Nadie tiene attendanceSummaries.
  for (let i = 0; i < 6; i++) {
    await db.doc(`attendance/att_${i}`).set({
      asignaturaId: SUBJ, docenteId: DOCENTE, fecha: `2020-01-0${i + 2}`, slot: 1, parcial: 1,
      presentes: { al_a: true, al_b: i >= 3, al_c: true }, justificadas: {}, motivos: { al_b: 'MOTIVO-PRIVADO' },
    })
  }
}

const ejecutar = ({ uid = DOCENTE, k = clave(), parciales = [1, 2], fuentes = TODAS, costo, asignaturaId = SUBJ } = {}) =>
  IA_FN.ejecutarOperacionIA.run({
    auth: { uid },
    data: { operacion: 'analizar_asignatura', idempotencyKey: k, unidades: costo, params: { asignaturaId, parciales, fuentes, costoConfirmado: costo } },
  })
const rechazo = async (promesa) => promesa.then(() => null, (e) => e)

// Fotografía de TODO lo académico: debe ser idéntica antes y después.
async function fotoAcademica() {
  const foto = {}
  for (const c of ['subjects', 'students', 'activities', 'submissions', 'attendance', 'attendanceSummaries']) {
    const snap = await db.collection(c).get()
    foto[c] = snap.docs.map((d) => [d.id, JSON.stringify(d.data())]).sort()
  }
  return JSON.stringify(foto)
}

// ═════════════════════════════════════════════════════════════════════════════
grupo('Preparación gratuita (prepararAnalisisAsignatura)')
await sembrar()

await caso('devuelve parciales, disponibilidad por parcial y costo por fuente — sin tocar créditos ni llamar a la IA', async () => {
  const r = await FAA.prepararDatos({ uid: DOCENTE, asignaturaId: SUBJ, tarifas: TARIFAS })
  assert.deepStrictEqual(r.parciales.map((p) => p.numero), [1, 2])
  assert.strictEqual(r.totalEstudiantes, 3)
  assert.deepStrictEqual(r.costoPorFuente, COSTOS)
  assert.strictEqual(r.disponibilidadPorParcial['1'].entregables, 2)
  assert.strictEqual(r.disponibilidadPorParcial['1'].asistencias, 6)
  assert.strictEqual(r.disponibilidadPorParcial['1'].evaluaciones, 0)
  assert.strictEqual(r.disponibilidadPorParcial['2'].evaluaciones, 1)
  assert.strictEqual(r.disponibilidadPorParcial['2'].interactivas, 1)
  assert.strictEqual(r.disponibilidadPorParcial['2'].observacion, 0)
  assert.strictEqual((await creditosDe()).saldo, 100)
  assert.strictEqual((await db.collection('iaConsumos').get()).size, 0)
  assert.strictEqual(pedidosIA.length, 0)
})

await caso('el callable exige sesión, ser docente y ser el dueño de la asignatura', async () => {
  assert.strictEqual((await rechazo(AA_FN.prepararAnalisisAsignatura.run({ data: { asignaturaId: SUBJ } }))).code, 'unauthenticated')
  assert.strictEqual((await rechazo(AA_FN.prepararAnalisisAsignatura.run({ auth: { uid: OTRO }, data: { asignaturaId: SUBJ } }))).code, 'permission-denied')
  await db.doc('users/alumno_x').set({ role: 'alumno' })
  assert.strictEqual((await rechazo(AA_FN.prepararAnalisisAsignatura.run({ auth: { uid: 'alumno_x' }, data: { asignaturaId: SUBJ } }))).code, 'permission-denied')
  const ok = await AA_FN.prepararAnalisisAsignatura.run({ auth: { uid: DOCENTE }, data: { asignaturaId: SUBJ } })
  assert.strictEqual(ok.parciales.length, 2)
})

await caso('sin configuración de costos/umbrales se detiene y lo dice', async () => {
  const e = await rechazo(FAA.prepararDatos({ uid: DOCENTE, asignaturaId: SUBJ, tarifas: { tarifas: { analizar_asignatura: 1 } } }))
  assert.strictEqual(e.details.codigo, 'ANALISIS_SIN_CONFIGURAR')
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Ejecución y cobro (ejecutarOperacionIA → analizar_asignatura)')

await caso('todas las fuentes, todos los parciales: cobra exactamente 20 y guarda el informe', async () => {
  await sembrar()
  const antes = await fotoAcademica()
  const k = clave()
  const r = await ejecutar({ k, costo: 20 })
  assert.deepStrictEqual(r.resultado, { analisisId: k, asignaturaId: SUBJ })
  assert.strictEqual(r.creditosReales, 20)
  assert.strictEqual(r.saldo, 80)
  assert.strictEqual((await creditosDe()).saldo, 80)
  const consumo = await consumoDe(k)
  assert.strictEqual(consumo.estado, 'ejecutado')
  assert.strictEqual(consumo.creditosReales, 20)
  assert.strictEqual(consumo.categoria, 'Seguimiento')
  assert.strictEqual(consumo.asignaturaId, SUBJ)
  // El registro de consumo NO trae el informe ni nombres: solo la referencia.
  assert.ok(!JSON.stringify(consumo).includes('QUIROGA'))
  const doc = (await analisisDe(k)).data()
  assert.strictEqual(doc.docenteId, DOCENTE)
  assert.strictEqual(doc.asignaturaId, SUBJ)
  assert.deepStrictEqual(doc.parciales, [1, 2])
  assert.deepStrictEqual(doc.fuentes, TODAS)
  assert.ok(doc.generadoEn.toMillis() > 0)
  assert.strictEqual(doc.informe.resumenEjecutivo, 'El grupo va bien en general.')
  assert.strictEqual(doc.datos.totalEstudiantes, 3)
  // Nada académico cambió: el análisis solo lee.
  assert.strictEqual(await fotoAcademica(), antes)
  // Métrica interna de auditoría.
  const interno = (await db.doc(`iaConsumosInterno/${k}`).get()).data()
  assert.strictEqual(interno.operacion, 'analizar_asignatura')
  assert.strictEqual(interno.creditosReales, 20)
  assert.strictEqual(interno.tokensEntrada, 1000)
})

await caso('estudiantes que requieren atención: nombre completo guardado, señales reales y recomendación; el inventado por la IA se descarta', async () => {
  const docs = await historial()
  const doc = docs[0].data()
  const b = doc.estudiantesAtencion.find((e) => e.apellidoPaterno === 'Yáñez')
  assert.ok(b, 'Wenceslao Yáñez Kuri tiene promedio 4.7 y 50 % de asistencia')
  assert.strictEqual(b.nombre, 'Wenceslao')
  assert.strictEqual(b.apellidoMaterno, 'Kuri')
  assert.ok(b.senales.some((s) => s.tipo === 'desempeno'))
  assert.ok(b.senales.some((s) => s.tipo === 'asistencia' && s.texto.startsWith('50 %')))
  assert.strictEqual(b.recomendacion, 'Dar seguimiento semanal')
  assert.ok(!JSON.stringify(doc).includes('inventado'))
  // `al_c` no entregó E1 ni E2 (vencidas): 2 de 2 → señal de faltantes.
  const c = doc.estudiantesAtencion.find((e) => e.apellidoPaterno === 'Villaseñor')
  assert.ok(c.senales.some((s) => s.tipo === 'faltantes'))
})

await caso('asistencia calculada desde attendance: funciona sin ningún attendanceSummaries', async () => {
  assert.strictEqual((await db.collection('attendanceSummaries').get()).size, 0)
  const doc = (await historial())[0].data()
  assert.strictEqual(doc.datos.asistencia.total, 18)
  assert.strictEqual(doc.datos.asistencia.faltas, 3)
  assert.strictEqual(doc.datos.asistencia.debajoDelMinimo, 1)
})

await caso('privacidad: al modelo no llega ningún nombre, comentario ni motivo; sí los identificadores anónimos', async () => {
  assert.strictEqual(pedidosIA.length, 1)
  const texto = textoDelPedido(pedidosIA[0])
  for (const a of ALUMNOS) {
    for (const parte of [a.nombre, a.apellidoPaterno, a.apellidoMaterno]) assert.ok(!texto.toLowerCase().includes(parte.toLowerCase()), parte)
  }
  for (const privado of ['COMENTARIO-PRIVADO', 'MOTIVO-PRIVADO', 'https://x/', 'u_al_', 'al_a', 'al_b']) assert.ok(!texto.includes(privado), privado)
  assert.ok(texto.includes('Alumno 2'))
  assert.strictEqual(pedidosIA[0].model, 'claude-haiku-4-5')
})

await caso('Entregables + Cuestionarios/Exámenes + Asistencias = 12 créditos', async () => {
  await sembrar()
  const k = clave()
  const r = await ejecutar({ k, fuentes: ['entregables', 'evaluaciones', 'asistencias'], costo: 12 })
  assert.strictEqual(r.creditosReales, 12)
  assert.strictEqual((await creditosDe()).saldo, 88)
  const doc = (await analisisDe(k)).data()
  assert.deepStrictEqual(doc.fuentes, ['entregables', 'evaluaciones', 'asistencias'])
  assert.strictEqual(doc.datos.sinEntrega, null)
  assert.ok(doc.datos.actividades.every((a) => ['entregables', 'evaluaciones'].includes(a.fuente)))
  const texto = textoDelPedido(pedidosIA[0])
  assert.ok(!texto.includes('Exposición oral'), 'Observación desmarcada: fuera del prompt')
  assert.ok(!texto.includes('Crucigrama de unidades'), 'Interactivas desmarcada: fuera del prompt')
  assert.ok(!texto.includes('ENTREGAS NO REALIZADAS'))
})

await caso('una sola fuente y un solo parcial: Asistencias del Parcial 1 = 3 créditos, sin evolución', async () => {
  await sembrar()
  const k = clave()
  const r = await ejecutar({ k, parciales: [1], fuentes: ['asistencias'], costo: 3 })
  assert.strictEqual(r.creditosReales, 3)
  assert.strictEqual((await creditosDe()).saldo, 97)
  const doc = (await analisisDe(k)).data()
  assert.deepStrictEqual(doc.parciales, [1])
  assert.strictEqual(doc.datos.evolucion, null)
  assert.strictEqual(doc.informe.evolucion, '', 'la IA escribió una evolución, pero con un parcial no existe')
  assert.deepStrictEqual(doc.datos.parciales, [], 'sin fuentes de actividades no hay promedios')
  assert.ok(doc.estudiantesAtencion.every((e) => e.senales.every((s) => s.tipo === 'asistencia')))
  const texto = textoDelPedido(pedidosIA[0]).split('Responde SOLO')[0]
  assert.ok(!texto.includes('Reporte de laboratorio'))
  assert.ok(!texto.includes('EVOLUCIÓN ENTRE PARCIALES'))
})

await caso('el número de parciales no cambia el costo: un parcial con todas sus fuentes cuesta lo que suman', async () => {
  await sembrar()
  // Parcial 1 tiene Entregables, Observación, Asistencias y Sin entrega: 5+3+3+2.
  const r = await ejecutar({ parciales: [1], fuentes: ['entregables', 'observacion', 'asistencias', 'sinEntrega'], costo: 13 })
  assert.strictEqual(r.creditosReales, 13)
  await sembrar()
  const r2 = await ejecutar({ parciales: [1, 2], fuentes: ['entregables', 'observacion', 'asistencias', 'sinEntrega'], costo: 13 })
  assert.strictEqual(r2.creditosReales, 13)
})

await caso('idempotencia: la misma clave no cobra dos veces ni crea un segundo informe', async () => {
  await sembrar()
  const k = clave()
  await ejecutar({ k, costo: 20 })
  const r2 = await ejecutar({ k, costo: 20 })
  assert.strictEqual(r2.repetida, true)
  assert.deepStrictEqual(r2.resultado, { analisisId: k, asignaturaId: SUBJ })
  assert.strictEqual((await creditosDe()).saldo, 80)
  assert.strictEqual((await historial()).length, 1)
})

await caso('cada análisis nuevo usa los datos ACTUALES y no toca el anterior', async () => {
  await sembrar()
  const k1 = clave()
  await ejecutar({ k: k1, parciales: [1], fuentes: ['entregables'], costo: 5 })
  const viejo = JSON.stringify((await analisisDe(k1)).data())
  await db.doc('submissions/act_e1_al_b').update({ calificacion: 10 })
  const k2 = clave()
  await ejecutar({ k: k2, parciales: [1], fuentes: ['entregables'], costo: 5 })
  const d1 = (await analisisDe(k1)).data(), d2 = (await analisisDe(k2)).data()
  assert.strictEqual(JSON.stringify(d1), viejo, 'el informe anterior es una fotografía: no cambia')
  assert.notStrictEqual(d1.datos.parciales[0].promedioGrupo, d2.datos.parciales[0].promedioGrupo)
  assert.strictEqual((await historial()).length, 2)
  assert.strictEqual((await creditosDe()).saldo, 90)
  // El segundo prompt no menciona nada del informe anterior.
  assert.ok(!textoDelPedido(pedidosIA[1]).includes('El grupo va bien en general.'))
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Rechazos sin cobro')

const sinCobro = async (saldoEsperado = 100) => {
  assert.strictEqual((await creditosDe()).saldo, saldoEsperado)
  assert.strictEqual((await historial()).length, 0)
  assert.strictEqual(pedidosIA.length, 0)
}

await caso('el costo cambió entre la pantalla y la confirmación: se rechaza, no se cobra y se pide actualizar', async () => {
  await sembrar()
  const k = clave()
  const e = await rechazo(ejecutar({ k, costo: 12 })) // todas las fuentes cuestan 20, no 12
  assert.strictEqual(e.code, 'failed-precondition')
  assert.strictEqual(e.details.codigo, 'COSTO_CAMBIO')
  assert.strictEqual(e.details.costo, 20)
  assert.ok(e.message.includes('No se descontaron créditos'))
  assert.strictEqual(await consumoDe(k), undefined, 'ni siquiera se reservó')
  await sinCobro()
})

await caso('una fuente confirmada que ya no tiene datos: se rechaza igual (nunca se cobra distinto de lo confirmado)', async () => {
  await sembrar()
  // Alguien borró las calificaciones de Observación después de abrir el diálogo.
  for (const al of ['al_a', 'al_b', 'al_c']) await db.doc(`submissions/act_o1_${al}`).delete()
  const e = await rechazo(ejecutar({ costo: 20 }))
  assert.strictEqual(e.details.codigo, 'COSTO_CAMBIO')
  assert.strictEqual(e.details.costo, 17)
  await sinCobro()
})

await caso('todas las fuentes sin datos en el parcial elegido: nada que analizar, nada que cobrar', async () => {
  await sembrar()
  await db.doc(`subjects/${SUBJ}`).update({ parciales: 3 })
  const e = await rechazo(ejecutar({ parciales: [3], costo: 20 }))
  assert.strictEqual(e.details.codigo, 'CONTEXTO_INSUFICIENTE')
  await sinCobro()
})

await caso('asignatura sin estudiantes: se rechaza sin cobro', async () => {
  await sembrar()
  for (const a of ALUMNOS) await db.doc(`students/${a.id}`).delete()
  const e = await rechazo(ejecutar({ costo: 20 }))
  assert.strictEqual(e.details.codigo, 'CONTEXTO_INSUFICIENTE')
  await sinCobro()
})

await caso('sin parciales o sin fuentes: argumento inválido, sin cobro', async () => {
  await sembrar()
  assert.strictEqual((await rechazo(ejecutar({ parciales: [], costo: 20 }))).code, 'invalid-argument')
  assert.strictEqual((await rechazo(ejecutar({ parciales: [9], costo: 20 }))).code, 'invalid-argument')
  assert.strictEqual((await rechazo(ejecutar({ fuentes: [], costo: 20 }))).code, 'invalid-argument')
  assert.strictEqual((await rechazo(ejecutar({ fuentes: ['calificaciones'], costo: 20 }))).code, 'invalid-argument')
  await sinCobro()
})

await caso('saldo insuficiente: no se ejecuta, no se guarda y el saldo no cambia', async () => {
  await sembrar({ saldo: 12 })
  const e = await rechazo(ejecutar({ costo: 20 }))
  assert.strictEqual(e.details.codigo, 'SALDO_INSUFICIENTE')
  assert.strictEqual(e.details.costo, 20)
  await sinCobro(12)
})

await caso('la asignatura de otro docente: permiso denegado, sin cobro para nadie', async () => {
  await sembrar()
  const e = await rechazo(ejecutar({ uid: OTRO, costo: 20 }))
  assert.strictEqual(e.code, 'permission-denied')
  assert.strictEqual((await creditosDe(OTRO)).saldo, 100)
  await sinCobro()
})

await caso('configuración ausente: se detiene antes de reservar', async () => {
  const sinConfig = { ...TARIFAS }
  delete sinConfig.analisisAsignatura
  await sembrar({ tarifas: sinConfig })
  const e = await rechazo(ejecutar({ costo: 20 }))
  assert.strictEqual(e.details.codigo, 'ANALISIS_SIN_CONFIGURAR')
  await sinCobro()
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Fallo de la IA → devolución')

await caso('la IA falla: se reembolsa todo y no queda ningún informe', async () => {
  await sembrar()
  respuestaIA = () => { throw new Error('Anthropic caído') }
  const k = clave()
  const e = await rechazo(ejecutar({ k, costo: 20 }))
  assert.strictEqual(e.code, 'unavailable')
  assert.ok(e.message.includes('No se descontaron créditos'))
  assert.strictEqual((await creditosDe()).saldo, 100)
  assert.strictEqual((await consumoDe(k)).estado, 'fallido')
  assert.strictEqual((await consumoDe(k)).creditosReales, 0)
  assert.strictEqual((await historial()).length, 0)
})

await caso('la IA responde sin resumen ni conclusión: no es un informe utilizable → reembolso', async () => {
  await sembrar()
  respuestaIA = () => ({ resumenEjecutivo: '', conclusion: '', fortalezas: ['x'] })
  const k = clave()
  const e = await rechazo(ejecutar({ k, costo: 20 }))
  assert.strictEqual(e.code, 'unavailable')
  assert.strictEqual((await creditosDe()).saldo, 100)
  assert.strictEqual((await consumoDe(k)).estado, 'fallido')
  assert.strictEqual((await historial()).length, 0)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Análisis de examen ya guardado')

await caso('vigente (mismo número de entregas finalizadas): se cita con su fecha, sin volver a ejecutarlo', async () => {
  await sembrar()
  await db.collection('activities/act_q1/analisisIA').add({
    resultado: { resumenGeneral: 'RESUMEN-PREVIO-DEL-CUESTIONARIO', porcentajeAciertosGeneral: 71 },
    entregasConsideradas: 2, docenteId: DOCENTE, generadoEn: new Date('2020-02-12T12:00:00Z'),
  })
  await ejecutar({ parciales: [2], fuentes: ['evaluaciones'], costo: 4 })
  assert.strictEqual(pedidosIA.length, 1, 'una sola llamada: no se re-analiza el cuestionario')
  const texto = textoDelPedido(pedidosIA[0])
  assert.ok(texto.includes('RESUMEN-PREVIO-DEL-CUESTIONARIO'))
  assert.ok(texto.includes('2020-02-12'))
  assert.strictEqual((await creditosDe()).saldo, 96)
})

await caso('desactualizado (llegaron más entregas): no se usa', async () => {
  await sembrar()
  await db.collection('activities/act_q1/analisisIA').add({
    resultado: { resumenGeneral: 'RESUMEN-VIEJO', porcentajeAciertosGeneral: 50 },
    entregasConsideradas: 1, docenteId: DOCENTE, generadoEn: new Date('2020-02-12T12:00:00Z'),
  })
  await ejecutar({ parciales: [2], fuentes: ['evaluaciones'], costo: 4 })
  assert.ok(!textoDelPedido(pedidosIA[0]).includes('RESUMEN-VIEJO'))
})

await caso('el análisis de examen no se toca: sigue igual después del análisis integral', async () => {
  const snap = await db.collection('activities/act_q1/analisisIA').get()
  assert.strictEqual(snap.size, 1)
  assert.strictEqual(snap.docs[0].data().resultado.resumenGeneral, 'RESUMEN-VIEJO')
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Orden y presentación: número de lista y etiqueta de actividad')

// El orden de la tabla de Calificaciones (SubjectPage.jsx, ensureGroupStudents):
// lo que devuelve la consulta, ordenado de forma estable por `orden ?? 0`.
const ordenDeLaTabla = async () => (await db.collection('students').where('asignaturaId', '==', SUBJ).get()).docs
  .map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)).map((s) => s.id)

await caso('el servidor carga a los estudiantes en el MISMO orden que la tabla: números desordenados, repetidos y ausentes', async () => {
  await sembrar()
  const { getFirestore } = createRequire(new URL('../functions/index.js', import.meta.url))('firebase-admin/firestore')
  const cargar = async () => (await FAA.cargarEstudiantes(getFirestore(), SUBJ)).map((s) => s.id)
  // Números de lista que no siguen el orden de los ids.
  await db.doc('students/al_a').update({ orden: 3 }); await db.doc('students/al_b').update({ orden: 1 }); await db.doc('students/al_c').update({ orden: 2 })
  assert.deepStrictEqual(await cargar(), ['al_b', 'al_c', 'al_a'])
  assert.deepStrictEqual(await cargar(), await ordenDeLaTabla())
  // Repetidos y sin número: el desempate es el de la tabla, no uno propio.
  for (const [id, orden] of [['Zz_alumno', 5], ['aa_alumno', 5], ['MM_alumno', null], ['bb_alumno', 5]]) {
    const datos = { asignaturaId: SUBJ, nombre: id, apellidoPaterno: 'X', apellidoMaterno: '' }
    if (orden != null) datos.orden = orden
    await db.doc(`students/${id}`).set(datos)
  }
  assert.deepStrictEqual(await cargar(), await ordenDeLaTabla())
})

await caso('el informe nuevo guarda el número de lista de cada estudiante y la etiqueta de cada actividad', async () => {
  await sembrar()
  await db.doc('students/al_a').update({ orden: 12 }); await db.doc('students/al_b').update({ orden: 4 }); await db.doc('students/al_c').update({ orden: 30 })
  const k = clave()
  const r = await ejecutar({ k, costo: 20 })
  assert.strictEqual(r.creditosReales, 20, 'el costo no cambió')
  assert.strictEqual((await creditosDe()).saldo, 80)
  assert.strictEqual(pedidosIA.length, 1, 'sigue siendo UNA sola llamada a la IA')
  const doc = (await analisisDe(k)).data()
  // Por número de lista ascendente: 4 (Yáñez) y 30 (Villaseñor).
  assert.deepStrictEqual(doc.estudiantesAtencion.map((e) => [e.numeroLista, e.apellidoPaterno]), [[4, 'Yáñez'], [30, 'Villaseñor']])
  assert.deepStrictEqual(doc.datos.actividades.map((a) => `${a.etiqueta} ${a.nombre}`),
    ['1.1 Reporte de laboratorio', '1.2 Mapa conceptual', '1.3 Exposición oral', '2.1 Cuestionario de vectores', '2.2 Crucigrama de unidades'])
  assert.ok(doc.datos.mejores.every((a) => a.etiqueta) && doc.datos.criticas.every((a) => a.etiqueta))
  assert.ok(doc.datos.sinEntrega.actividades.every((a) => a.etiqueta))
  // Ni el número de lista ni la etiqueta viajan al modelo.
  const texto = textoDelPedido(pedidosIA[0])
  assert.ok(!/\d+\.\d+ — /.test(texto) && !texto.includes('numeroLista'))
})

await caso('con fuentes desmarcadas la etiqueta sigue siendo la de la plataforma (no se renumera)', async () => {
  await sembrar()
  const k = clave()
  await ejecutar({ k, parciales: [1], fuentes: ['observacion'], costo: 3 })
  assert.deepStrictEqual((await analisisDe(k)).data().datos.actividades.map((a) => a.etiqueta), ['1.3'])
  assert.strictEqual((await creditosDe()).saldo, 97)
})

await caso('un informe guardado ANTES de este cambio (sin número ni etiqueta) se lee y no se modifica', async () => {
  await sembrar()
  const viejo = { docenteId: DOCENTE, asignaturaId: SUBJ, parciales: [1], fuentes: ['entregables'], version: 1,
    datos: { totalEstudiantes: 3, parciales: [], actividades: [{ nombre: 'Reporte de laboratorio', fuente: 'entregables', tipo: 'Entregable', parcial: 1, promedio: 6.5 }], mejores: [], criticas: [], evolucion: null, asistencia: null, sinEntrega: null, patronGrupal: false },
    informe: { resumenEjecutivo: 'viejo', conclusion: 'viejo' }, estudiantesAtencion: [{ nombre: 'Wenceslao', apellidoPaterno: 'Yáñez', apellidoMaterno: 'Kuri', senales: [], recomendacion: '' }] }
  await db.doc(`subjects/${SUBJ}/analisisIA/historico`).set(viejo)
  await ejecutar({ costo: 20 })
  assert.deepStrictEqual((await analisisDe('historico')).data(), viejo, 'generar uno nuevo no toca los anteriores')
  assert.strictEqual((await historial()).length, 2)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('Borrado de la asignatura sin huérfanos')

await caso('al eliminar la asignatura, su historial de análisis se elimina; el de otra asignatura no', async () => {
  await sembrar()
  await ejecutar({ costo: 20 })
  await ejecutar({ parciales: [1], fuentes: ['asistencias'], costo: 3 })
  await db.doc('subjects/otra/analisisIA/x').set({ docenteId: DOCENTE, informe: {} })
  assert.strictEqual((await historial()).length, 2)
  await db.doc(`subjects/${SUBJ}`).delete()
  await AA_FN.limpiarAnalisisAsignatura.run({ params: { subjectId: SUBJ } })
  assert.strictEqual((await historial()).length, 0)
  assert.strictEqual((await historial('otra')).length, 1)
})

await caso('borrar una asignatura sin historial no falla', async () => {
  await FAA.borrarAnalisisDeAsignatura('no_existe')
})

require.cache[rutaSdk].exports = SDK_REAL

resumen('pruebas del análisis integral de asignatura')
