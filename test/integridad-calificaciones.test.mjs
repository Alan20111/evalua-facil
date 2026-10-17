// Integridad de calificaciones (oct-2026) — lógica de las Cloud Functions contra
// el emulador de Firestore. Mismo patrón que servidor.test.mjs: no se prueba el
// cableado del disparador (Nivel 3), se invoca su lógica con `.run(event)`.
//
// Cubre: política aplicada al calificar, historial de notas (idempotente),
// historial de la política de intentos, la IA que NO reemplaza notas del
// docente, y que anular no destruya los snapshots de intentos.
//
// Correr:  npm run test:integridad
import { createRequire } from 'node:module'
import { db, dbFn, funciones, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'

const require = createRequire(import.meta.url)
const { aplicarNotaIA } = require('../functions/aplicarNotaIA.js')
const { Timestamp } = require('firebase-admin/firestore')

const DOCENTE = 'docente-integridad'
const snapDe = (data) => (data == null ? { exists: false, data: () => undefined } : { exists: true, data: () => data })

// ═════════════════════════════════════════════════════════════════════════════
grupo('onEvaluacionFinalizada — queda con qué política y quién puso la nota')
// ═════════════════════════════════════════════════════════════════════════════
const ACT = 'ACT-INT'
const SUB = 'SUB-INT'

async function sembrarEvaluacion(extra = {}, evaluacion = {}) {
  await db.doc(`activities/${ACT}`).set({
    docenteId: DOCENTE, asignaturaId: 'S1', tipo: 'evaluacion', categoria: 'cuestionario', maxCalif: 10,
    evaluacion: { publicarRespuestas: 'inmediato', ...evaluacion }, ...extra,
  })
  for (const p of ['p1', 'p2']) {
    await db.doc(`activities/${ACT}/preguntas/${p}`).set({ tipo: 'opcion_multiple', ponderacion: 1, enunciado: p, opciones: [{ id: 'a', texto: 'A' }, { id: 'b', texto: 'B' }] })
    await db.doc(`activities/${ACT}/clave/${p}`).set({ respuestaCorrecta: 'b' })
  }
}
async function cerrarIntento(n, opciones) {
  const antes = (await db.doc(`submissions/${SUB}`).get()).data() || {}
  await db.doc(`submissions/${SUB}`).set({ ...antes, actividadId: ACT, alumnoId: 'AL1', estadoEvaluacion: 'finalizado', intentoActual: n, intentos: antes.intentos || [], calificacion: antes.calificacion ?? null })
  await db.doc(`submissions/${SUB}/respuestas/p1`).set({ opcionSeleccionada: opciones[0] })
  await db.doc(`submissions/${SUB}/respuestas/p2`).set({ opcionSeleccionada: opciones[1] })
  const snap = await dbFn.doc(`submissions/${SUB}`).get()
  await funciones.onEvaluacionFinalizada.run({ data: { after: snap }, params: { submissionId: SUB } })
  return (await db.doc(`submissions/${SUB}`).get()).data()
}

await caso('«mejor»: cada nota nace con politicaAplicada y ultimaCalificacionPor «servidor»; los intentos se conservan', async () => {
  await limpiar()
  await sembrarEvaluacion({}, { conservar: 'mejor' })
  const s1 = await cerrarIntento(1, ['b', 'a'])
  assert.strictEqual(s1.calificacion, 5)
  assert.strictEqual(s1.politicaAplicada, 'mejor')
  assert.strictEqual(s1.ultimaCalificacionPor, 'servidor')
  const s2 = await cerrarIntento(2, ['a', 'a'])
  assert.deepStrictEqual(s2.intentos.map((i) => [i.numero, i.calificacion]), [[1, 5], [2, 0]])
  assert.strictEqual(s2.calificacion, 5, 'con «mejor» un segundo intento peor no baja la nota')
  const s3 = await cerrarIntento(3, ['b', 'b'])
  assert.strictEqual(s3.calificacion, 10)
  assert.strictEqual(s3.intentos.length, 3)
})

await caso('sin política guardada cae en «ultimo» y así queda registrado', async () => {
  await limpiar()
  await sembrarEvaluacion({}, {})
  const s = await cerrarIntento(1, ['b', 'b'])
  assert.strictEqual(s.politicaAplicada, 'ultimo')
})

await caso('instrumento «Sin calificación»: no hay nota, así que tampoco política ni origen', async () => {
  await limpiar()
  await sembrarEvaluacion({ sinCalificacion: true }, { conservar: 'mejor' })
  const s = await cerrarIntento(1, ['b', 'b'])
  assert.strictEqual(s.calificacion ?? null, null)
  assert.strictEqual(s.politicaAplicada, undefined)
  assert.strictEqual(s.ultimaCalificacionPor, undefined)
  assert.strictEqual(s.intentos.length, 1, 'el intento sí se registra')
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('onCalificacionCambiada — historial de notas')
// ═════════════════════════════════════════════════════════════════════════════
const correrHistorial = (id, antes, despues, evento) => funciones.onCalificacionCambiada.run({
  id: evento, params: { submissionId: id }, data: { before: snapDe(antes), after: snapDe(despues) },
})
const historial = async (id) => (await db.collection(`submissions/${id}/calificacionHistorial`).get()).docs.map((d) => ({ id: d.id, ...d.data() }))

await caso('cuando cambia la nota queda el valor anterior, el nuevo, el origen y la política', async () => {
  await limpiar()
  await correrHistorial('SUBH1', { calificacion: 7, estado: 'calificado' }, { calificacion: 10, estado: 'calificado', ultimaCalificacionPor: 'ia_recalificar', politicaAplicada: 'mejor', intentoActual: 1, intentos: [{ numero: 1 }] }, 'ev-1')
  const h = await historial('SUBH1')
  assert.strictEqual(h.length, 1)
  assert.strictEqual(h[0].id, 'ev-1')
  assert.strictEqual(h[0].calificacionAnterior, 7)
  assert.strictEqual(h[0].calificacionNueva, 10)
  assert.strictEqual(h[0].origen, 'ia_recalificar')
  assert.strictEqual(h[0].politicaAplicada, 'mejor')
  assert.ok(h[0].registradoEn, 'la fecha la pone el servidor')
})

await caso('reintento del MISMO evento: no se duplica; otro evento sí agrega una fila', async () => {
  await correrHistorial('SUBH1', { calificacion: 7, estado: 'calificado' }, { calificacion: 10 }, 'ev-1')
  assert.strictEqual((await historial('SUBH1')).length, 1)
  await correrHistorial('SUBH1', { calificacion: 10 }, { calificacion: 4, ultimaCalificacionPor: 'docente' }, 'ev-2')
  const h = await historial('SUBH1')
  assert.strictEqual(h.length, 2)
  assert.strictEqual(h.find((x) => x.id === 'ev-2').origen, 'docente')
  assert.strictEqual(h.find((x) => x.id === 'ev-1').calificacionNueva, 10, 'la fila anterior no se toca')
})

await caso('si la nota no cambia, o la entrega se borra, no se escribe nada', async () => {
  await correrHistorial('SUBH2', { calificacion: 6 }, { calificacion: 6, comentario: 'hola' }, 'ev-3')
  await correrHistorial('SUBH2', { calificacion: null }, { estadoEvaluacion: 'en_progreso' }, 'ev-4')
  await correrHistorial('SUBH2', { calificacion: 6 }, null, 'ev-5')
  assert.strictEqual((await historial('SUBH2')).length, 0)
})

await caso('la primera nota de una entrega nueva también queda (origen «sin_marca» si nadie la marcó)', async () => {
  await correrHistorial('SUBH3', null, { calificacion: 0 }, 'ev-6')
  const h = await historial('SUBH3')
  assert.strictEqual(h.length, 1)
  assert.strictEqual(h[0].creacion, true)
  assert.strictEqual(h[0].origen, 'sin_marca')
})

await caso('escribir el historial NO toca la entrega (ni su nota ni sus avisos)', async () => {
  await db.doc('submissions/SUBH4').set({ actividadId: 'X', alumnoId: 'A', calificacion: 5, notificadoCalificacion: true })
  await correrHistorial('SUBH4', { calificacion: 5 }, { calificacion: 9 }, 'ev-7')
  const s = (await db.doc('submissions/SUBH4').get()).data()
  assert.deepStrictEqual(s, { actividadId: 'X', alumnoId: 'A', calificacion: 5, notificadoCalificacion: true })
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('onPoliticaConservarCambiada — historial de la política de intentos')
// ═════════════════════════════════════════════════════════════════════════════
const correrPolitica = (id, antes, despues, evento) => funciones.onPoliticaConservarCambiada.run({
  id: evento, params: { activityId: id }, data: { before: snapDe(antes), after: snapDe(despues) },
})
const cambios = async (id) => (await db.collection(`activities/${id}/configHistorial`).get()).docs.map((d) => ({ id: d.id, ...d.data() }))

await caso('un cambio efectivo queda con el valor anterior, el nuevo y cuántas entregas ya tenían intentos', async () => {
  await limpiar()
  await db.doc('activities/ACTP').set({ docenteId: DOCENTE, tipo: 'evaluacion', evaluacion: { conservar: 'mejor' } })
  await db.doc('submissions/SP1').set({ actividadId: 'ACTP', alumnoId: 'A1', intentos: [{ numero: 1, calificacion: 0 }] })
  await db.doc('submissions/SP2').set({ actividadId: 'ACTP', alumnoId: 'A2', intentos: [{ numero: 1, calificacion: 0 }, { numero: 2, calificacion: 10 }] })
  await db.doc('submissions/SP3').set({ actividadId: 'ACTP', alumnoId: 'A3', estadoEvaluacion: 'en_progreso' })
  await db.doc('submissions/SP4').set({ actividadId: 'OTRA', alumnoId: 'A4', intentos: [{ numero: 1 }, { numero: 2 }] })
  await correrPolitica('ACTP', { tipo: 'evaluacion', evaluacion: { conservar: 'promedio' } }, { tipo: 'evaluacion', evaluacion: { conservar: 'mejor' } }, 'pol-1')
  const c = await cambios('ACTP')
  assert.strictEqual(c.length, 1)
  assert.strictEqual(c[0].anterior, 'promedio')
  assert.strictEqual(c[0].nuevo, 'mejor')
  assert.strictEqual(c[0].entregasConIntentos, 2)
  assert.strictEqual(c[0].entregasConVariosIntentos, 1)
  assert.ok(c[0].registradoEn)
})

await caso('reintento del mismo evento no duplica; cambiar otra cosa, o «ausente» → «ultimo», no registra nada', async () => {
  await correrPolitica('ACTP', { tipo: 'evaluacion', evaluacion: { conservar: 'promedio' } }, { tipo: 'evaluacion', evaluacion: { conservar: 'mejor' } }, 'pol-1')
  await correrPolitica('ACTP', { tipo: 'evaluacion', evaluacion: { conservar: 'mejor' } }, { tipo: 'evaluacion', evaluacion: { conservar: 'mejor', tiempoLimiteMin: 15 } }, 'pol-2')
  await correrPolitica('ACTP', { tipo: 'evaluacion', evaluacion: {} }, { tipo: 'evaluacion', evaluacion: { conservar: 'ultimo' } }, 'pol-3')
  assert.strictEqual((await cambios('ACTP')).length, 1)
})

await caso('una actividad que no es evaluación ni juego no genera historial de política', async () => {
  await correrPolitica('ACTE', { tipo: 'archivo', evaluacion: { conservar: 'mejor' } }, { tipo: 'archivo', evaluacion: { conservar: 'primero' } }, 'pol-4')
  assert.strictEqual((await cambios('ACTE')).length, 0)
})

await caso('un juego sí registra el cambio; no se recalcula ninguna nota', async () => {
  await db.doc('submissions/SJ1').set({ actividadId: 'ACTJ', alumnoId: 'A1', calificacion: 6, intentos: [{ numero: 1, calificacion: 6 }] })
  await correrPolitica('ACTJ', { categoria: 'juego', evaluacion: { conservar: 'mejor' } }, { categoria: 'juego', evaluacion: { conservar: 'primero' } }, 'pol-5')
  assert.strictEqual((await cambios('ACTJ')).length, 1)
  assert.strictEqual((await db.doc('submissions/SJ1').get()).data().calificacion, 6)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('aplicarNotaIA — la IA solo escribe donde puede')
// ═════════════════════════════════════════════════════════════════════════════
const DATOS = { calificacion: 9, comentario: 'IA', rubricaEval: [2] }
const SUG_NUEVA = { estado: 'aplicada', aplicadaAutomaticamente: true, sugerencia: { calificacionPropuesta: 9 } }
async function sembrarEntrega(id, extra) {
  await db.doc(`submissions/${id}`).set({ actividadId: 'ACT-IA', alumnoId: id, archivos: [], ...extra })
  await db.doc(`activities/ACT-IA/iaSugerenciasEntregable/${id}`).set({ estado: 'procesando', sub: id })
}
const aplicar = (id, opciones = {}) => aplicarNotaIA(dbFn, {
  subRef: dbFn.doc(`submissions/${id}`), sugRef: dbFn.doc(`activities/ACT-IA/iaSugerenciasEntregable/${id}`),
  datos: DATOS, origen: 'ia_recalificar', sugerenciaNueva: SUG_NUEVA, ...opciones,
})
const nota = async (id) => (await db.doc(`submissions/${id}`).get()).data()

await caso('entrega sin nota: la IA escribe nota, comentario, niveles, estado y origen; la sugerencia queda aplicada', async () => {
  await limpiar()
  await sembrarEntrega('IA1', { calificacion: null })
  const r = await aplicar('IA1')
  assert.deepStrictEqual(r, { aplicada: true, motivo: 'sin_calificacion' })
  const s = await nota('IA1')
  assert.strictEqual(s.calificacion, 9)
  assert.strictEqual(s.estado, 'calificado')
  assert.strictEqual(s.ultimaCalificacionPor, 'ia_recalificar')
  assert.deepStrictEqual(s.rubricaEval, [2])
  assert.strictEqual((await db.doc('activities/ACT-IA/iaSugerenciasEntregable/IA1').get()).data().estado, 'aplicada')
})

await caso('nota del DOCENTE: no se reemplaza por omisión; ni la nota, ni el comentario, ni la sugerencia cambian', async () => {
  await sembrarEntrega('IA2', { calificacion: 7, comentario: 'mío', ultimaCalificacionPor: 'docente', rubricaEval: [1] })
  const r = await aplicar('IA2')
  assert.deepStrictEqual(r, { aplicada: false, motivo: 'ya_calificada_por_docente' })
  const s = await nota('IA2')
  assert.strictEqual(s.calificacion, 7)
  assert.strictEqual(s.comentario, 'mío')
  assert.deepStrictEqual(s.rubricaEval, [1])
  assert.strictEqual((await db.doc('activities/ACT-IA/iaSugerenciasEntregable/IA2').get()).data().estado, 'procesando', 'la sugerencia no se marca aplicada')
})

await caso('nota antigua SIN marca y sin rastro de IA: se trata como del docente', async () => {
  await sembrarEntrega('IA3', { calificacion: 6 })
  assert.strictEqual((await aplicar('IA3')).aplicada, false)
  assert.strictEqual((await nota('IA3')).calificacion, 6)
})

await caso('con la casilla expresa (sobrescribirCalificadas) SÍ reemplaza la del docente y queda marcada como de la IA', async () => {
  const r = await aplicar('IA2', { sobrescribirCalificadas: true })
  assert.deepStrictEqual(r, { aplicada: true, motivo: 'confirmado_por_docente' })
  const s = await nota('IA2')
  assert.strictEqual(s.calificacion, 9)
  assert.strictEqual(s.ultimaCalificacionPor, 'ia_recalificar')
})

await caso('una nota que es de la propia IA se actualiza sin casilla (con marca, o reconocida por la sugerencia previa)', async () => {
  await sembrarEntrega('IA4', { calificacion: 5, ultimaCalificacionPor: 'ia_aplicar' })
  assert.strictEqual((await aplicar('IA4')).motivo, 'reemplaza_ia')
  await sembrarEntrega('IA5', { calificacion: 8 }) // sin marca…
  const previa = { aplicadaAutomaticamente: true, sugerencia: { calificacionPropuesta: 8 } } // …pero coincide con lo que la IA aplicó
  assert.strictEqual((await aplicar('IA5', { sugerenciaPrevia: previa })).motivo, 'reemplaza_ia')
  assert.strictEqual((await nota('IA5')).calificacion, 9)
})

await caso('si el docente califica entre que se generó la propuesta y se aplicó, la transacción ve su nota y no la pisa', async () => {
  await sembrarEntrega('IA6', { calificacion: null })
  await db.doc('submissions/IA6').update({ calificacion: 4, ultimaCalificacionPor: 'docente' }) // el docente gana la carrera
  assert.strictEqual((await aplicar('IA6')).aplicada, false)
  assert.strictEqual((await nota('IA6')).calificacion, 4)
})

await caso('una entrega que ya no existe no rompe nada', async () => {
  const r = await aplicarNotaIA(dbFn, { subRef: dbFn.doc('submissions/NOEXISTE'), sugRef: null, datos: DATOS, origen: 'ia_aplicar' })
  assert.deepStrictEqual(r, { aplicada: false, motivo: 'sin_entrega' })
})

await caso('aplicar dos veces la misma nota es estable (idempotente) y el historial registra solo el cambio real', async () => {
  await sembrarEntrega('IA7', { calificacion: null })
  await aplicar('IA7')
  const r2 = await aplicar('IA7') // ahora la nota ya es de la IA: se reescribe el mismo valor
  assert.strictEqual(r2.motivo, 'reemplaza_ia')
  assert.strictEqual((await nota('IA7')).calificacion, 9)
  // El disparador de historial NO registra una escritura que deja la nota igual.
  await correrHistorial('IA7', { calificacion: 9 }, { calificacion: 9, ultimaCalificacionPor: 'ia_recalificar' }, 'ev-ia-7')
  assert.strictEqual((await historial('IA7')).length, 0)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('anular una entrega — los snapshots de intentos no se pierden')
// ═════════════════════════════════════════════════════════════════════════════
const limpiarSnapshots = funciones._pruebas.limpiarIntentosRespuestasHuerfanos
const sembrarSnapshots = async (sid) => {
  await db.doc(`submissions/${sid}/intentosRespuestas/1`).set({ numero: 1, calificacion: 0, respuestas: { p1: { puntosObtenidos: 0 } } })
  await db.doc(`submissions/${sid}/intentosRespuestas/2`).set({ numero: 2, calificacion: 10, respuestas: { p1: { puntosObtenidos: 1 } } })
}

await caso('anulada por el DOCENTE (hay traza): los snapshots se archivan en la traza y se limpian de la entrega borrada', async () => {
  await limpiar()
  await sembrarSnapshots('SUB-AN1')
  await db.doc('entregasAnuladas/T-AN1').set({ submissionId: 'SUB-AN1', anuladaPor: 'docente', actividadId: 'X', fechaAnulacion: Timestamp.fromMillis(2_000) })
  assert.strictEqual(await limpiarSnapshots('SUB-AN1'), 2)
  assert.strictEqual((await db.collection('submissions/SUB-AN1/intentosRespuestas').get()).size, 0)
  const archivados = await db.collection('entregasAnuladas/T-AN1/intentosRespuestas').get()
  assert.deepStrictEqual(archivados.docs.map((d) => d.id).sort(), ['1', '2'])
  assert.strictEqual(archivados.docs.find((d) => d.id === '2').data().calificacion, 10)
})

await caso('con varias anulaciones de la misma entrega, se archiva en la MÁS RECIENTE', async () => {
  await sembrarSnapshots('SUB-AN2')
  await db.doc('entregasAnuladas/T-AN2-vieja').set({ submissionId: 'SUB-AN2', anuladaPor: 'docente', fechaAnulacion: Timestamp.fromMillis(1_000) })
  await db.doc('entregasAnuladas/T-AN2-nueva').set({ submissionId: 'SUB-AN2', anuladaPor: 'docente', fechaAnulacion: Timestamp.fromMillis(9_000) })
  await limpiarSnapshots('SUB-AN2')
  assert.strictEqual((await db.collection('entregasAnuladas/T-AN2-nueva/intentosRespuestas').get()).size, 2)
  assert.strictEqual((await db.collection('entregasAnuladas/T-AN2-vieja/intentosRespuestas').get()).size, 0)
})

await caso('sin traza del docente (baja de un estudiante, borrado en cascada, anulación del estudiante) se limpia como siempre', async () => {
  await sembrarSnapshots('SUB-AN3')
  await db.doc('entregasAnuladas/T-AN3').set({ submissionId: 'SUB-AN3', anuladaPor: 'estudiante', fechaAnulacion: Timestamp.fromMillis(1_000) })
  assert.strictEqual(await limpiarSnapshots('SUB-AN3'), 2)
  assert.strictEqual((await db.collection('entregasAnuladas/T-AN3/intentosRespuestas').get()).size, 0, 'no se archiva en una traza del estudiante')
})

await caso('si el estudiante ya volvió a presentar (la entrega existe de nuevo), no se toca ningún snapshot', async () => {
  await sembrarSnapshots('SUB-AN4')
  await db.doc('submissions/SUB-AN4').set({ actividadId: 'X', alumnoId: 'Y' })
  await db.doc('entregasAnuladas/T-AN4').set({ submissionId: 'SUB-AN4', anuladaPor: 'docente', fechaAnulacion: Timestamp.fromMillis(1_000) })
  assert.strictEqual(await limpiarSnapshots('SUB-AN4'), 0)
  assert.strictEqual((await db.collection('submissions/SUB-AN4/intentosRespuestas').get()).size, 2)
  assert.strictEqual((await db.collection('entregasAnuladas/T-AN4/intentosRespuestas').get()).size, 0)
})


// ═════════════════════════════════════════════════════════════════════════════
grupo('versión del cálculo — cada intento queda con la evaluación con la que se calificó')
// ═════════════════════════════════════════════════════════════════════════════
const snapshotDe = async (n) => (await db.doc(`submissions/${SUB}/intentosRespuestas/${n}`).get()).data()

await caso('5 · el intento queda con su versión: huella, tipo y puntos de cada reactivo, política y total', async () => {
  await limpiar()
  await sembrarEvaluacion({}, { conservar: 'mejor' })
  const s = await cerrarIntento(1, ['b', 'a'])
  const e = s.intentos[0]
  assert.strictEqual(e.calificacion, 5)
  assert.match(e.firmaEvaluacion, /^[0-9a-f]{14}$/)
  assert.strictEqual(e.politicaAplicada, 'mejor')
  assert.strictEqual(e.versionAlterada, undefined, 'sin cambios durante el intento no hay aviso')
  assert.strictEqual(e.respuestasSinGuardar, undefined)
  const snap = await snapshotDe(1)
  assert.deepStrictEqual(snap.estructura, { p1: { tipo: 'opcion_multiple', ponderacion: 1 }, p2: { tipo: 'opcion_multiple', ponderacion: 1 } })
  assert.strictEqual(snap.totalPonderacion, 2)
  assert.strictEqual(snap.maxCalif, 10)
  assert.strictEqual(snap.firmaEvaluacion, e.firmaEvaluacion)
  assert.strictEqual(snap.politicaAplicada, 'mejor')
})

await caso('6 · modificar la evaluación NO cambia los intentos anteriores; el siguiente nace con su propia versión', async () => {
  await limpiar()
  await sembrarEvaluacion({}, { conservar: 'ultimo' })
  const s1 = await cerrarIntento(1, ['b', 'a'])
  const firma1 = s1.intentos[0].firmaEvaluacion
  const snap1Antes = await snapshotDe(1)
  // El docente sube el peso de p1 a 3 y cambia la clave de p2.
  await db.doc(`activities/${ACT}/preguntas/p1`).update({ ponderacion: 3 })
  await db.doc(`activities/${ACT}/clave/p2`).set({ respuestaCorrecta: 'a' })
  const s2 = await cerrarIntento(2, ['b', 'a'])
  assert.strictEqual(s2.intentos[0].calificacion, 5, 'el intento 1 conserva su nota')
  assert.strictEqual(s2.intentos[0].firmaEvaluacion, firma1, 'y su huella')
  assert.deepStrictEqual(await snapshotDe(1), snap1Antes, 'la fotografía del intento 1 no se toca')
  assert.notStrictEqual(s2.intentos[1].firmaEvaluacion, firma1, 'el intento 2 se calificó con otra versión')
  assert.strictEqual(s2.intentos[1].calificacion, 10, 'p1 (3 pts) y p2 (clave nueva) correctas: 4/4')
  assert.deepStrictEqual((await snapshotDe(2)).estructura.p1, { tipo: 'opcion_multiple', ponderacion: 3 })
})

await caso('la huella no cambia por el orden de los reactivos ni por escribir lo mismo', async () => {
  await limpiar()
  await sembrarEvaluacion({}, {})
  const a = (await cerrarIntento(1, ['b', 'b'])).intentos[0].firmaEvaluacion
  await limpiar()
  await sembrarEvaluacion({}, {})
  await db.doc(`activities/${ACT}/preguntas/p1`).set({ tipo: 'opcion_multiple', ponderacion: 1, enunciado: 'otro texto', opciones: [{ id: 'a', texto: 'A' }, { id: 'b', texto: 'B' }] })
  const b = (await cerrarIntento(1, ['b', 'b'])).intentos[0].firmaEvaluacion
  assert.strictEqual(a, b, 'cambiar solo el enunciado no cambia lo que afecta la nota')
})

await caso('la evaluación cambió DURANTE el intento: el intento y su fotografía quedan marcados', async () => {
  await limpiar()
  await sembrarEvaluacion({}, {})
  const inicio = Date.now() - 10 * 60_000
  await db.doc(`submissions/${SUB}`).set({ actividadId: ACT, alumnoId: 'AL1', estadoEvaluacion: 'en_progreso', intentoActual: 1, intentos: [], tiempoInicio: Timestamp.fromMillis(inicio) })
  // Un cambio ANTES de empezar no cuenta; uno a mitad del intento sí.
  await db.doc(`activities/${ACT}/reactivosHistorial/antes`).set({ preguntaId: 'p2', fuente: 'pregunta', tipoCambio: 'modificado', cambioEn: Timestamp.fromMillis(inicio - 60_000) })
  await db.doc(`activities/${ACT}/reactivosHistorial/durante`).set({ preguntaId: 'p1', fuente: 'clave', tipoCambio: 'modificado', cambioEn: Timestamp.fromMillis(inicio + 120_000) })
  const s = await cerrarIntento(1, ['b', 'b'])
  assert.strictEqual(s.intentos[0].versionAlterada, true)
  assert.strictEqual((await snapshotDe(1)).versionAlterada, true)
})

await caso('sin cambios durante el intento (solo uno anterior) no hay marca', async () => {
  await limpiar()
  await sembrarEvaluacion({}, {})
  const inicio = Date.now() - 10 * 60_000
  await db.doc(`submissions/${SUB}`).set({ actividadId: ACT, alumnoId: 'AL1', estadoEvaluacion: 'en_progreso', intentoActual: 1, intentos: [], tiempoInicio: Timestamp.fromMillis(inicio) })
  await db.doc(`activities/${ACT}/reactivosHistorial/antes`).set({ preguntaId: 'p2', cambioEn: Timestamp.fromMillis(inicio - 60_000) })
  const s = await cerrarIntento(1, ['b', 'b'])
  assert.strictEqual(s.intentos[0].versionAlterada, undefined)
})

await caso('respuestas declaradas que no llegaron a guardarse: queda la señal con los ids', async () => {
  await limpiar()
  await sembrarEvaluacion({}, {})
  await db.doc(`submissions/${SUB}`).set({ actividadId: ACT, alumnoId: 'AL1', estadoEvaluacion: 'finalizado', intentoActual: 1, intentos: [], respuestasDeclaradas: ['p1', 'p2'] })
  await db.doc(`submissions/${SUB}/respuestas/p1`).set({ opcionSeleccionada: 'b' })
  await db.doc(`submissions/${SUB}/respuestas/p2`).set({ opcionSeleccionada: null })
  const snap = await dbFn.doc(`submissions/${SUB}`).get()
  await funciones.onEvaluacionFinalizada.run({ data: { after: snap }, params: { submissionId: SUB } })
  const s = (await db.doc(`submissions/${SUB}`).get()).data()
  assert.deepStrictEqual(s.intentos[0].respuestasSinGuardar, ['p2'])
  assert.deepStrictEqual((await snapshotDe(1)).respuestasSinGuardar, ['p2'])
  assert.strictEqual(s.intentos[0].calificacion, 5, 'se califica lo que hay; la señal es aparte')
})

await caso('sin declaración (clientes anteriores) no se inventa ninguna señal', async () => {
  await limpiar()
  await sembrarEvaluacion({}, {})
  const s = await cerrarIntento(1, ['b', 'a'])
  assert.strictEqual(s.intentos[0].respuestasSinGuardar, undefined)
})

await caso('operaciones simultáneas: el mismo cierre dos veces a la vez deja UN intento y UNA fotografía', async () => {
  await limpiar()
  await sembrarEvaluacion({}, {})
  await db.doc(`submissions/${SUB}`).set({ actividadId: ACT, alumnoId: 'AL1', estadoEvaluacion: 'finalizado', intentoActual: 1, intentos: [] })
  await db.doc(`submissions/${SUB}/respuestas/p1`).set({ opcionSeleccionada: 'b' })
  await db.doc(`submissions/${SUB}/respuestas/p2`).set({ opcionSeleccionada: 'b' })
  const snap = await dbFn.doc(`submissions/${SUB}`).get()
  await Promise.all([1, 2, 3, 4].map(() => funciones.onEvaluacionFinalizada.run({ data: { after: snap }, params: { submissionId: SUB } })))
  const s = (await db.doc(`submissions/${SUB}`).get()).data()
  assert.strictEqual(s.intentos.length, 1)
  assert.strictEqual(s.calificacion, 10)
  assert.strictEqual((await db.collection(`submissions/${SUB}/intentosRespuestas`).get()).size, 1)
})

await caso('cada intento conserva sus respuestas aunque lleguen cierres de varios intentos seguidos', async () => {
  await limpiar()
  await sembrarEvaluacion({}, { conservar: 'ultimo' })
  await cerrarIntento(1, ['b', 'a'])
  await cerrarIntento(2, ['a', 'a'])
  await cerrarIntento(3, ['b', 'b'])
  const snaps = (await db.collection(`submissions/${SUB}/intentosRespuestas`).get()).docs.map((d) => [d.id, d.data().calificacion]).sort()
  assert.deepStrictEqual(snaps, [['1', 5], ['2', 0], ['3', 10]])
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('historial de reactivos, clave y rúbrica — versiones anteriores archivadas por el servidor')
// ═════════════════════════════════════════════════════════════════════════════
const correrReactivo = (fn, act, id, antes, despues, evento) => funciones[fn].run({
  id: evento, time: '2026-10-16T12:00:00.000Z', params: { activityId: act, preguntaId: id }, data: { before: snapDe(antes), after: snapDe(despues) },
})
const histReactivos = async (act) => (await db.collection(`activities/${act}/reactivosHistorial`).get()).docs.map((d) => ({ id: d.id, ...d.data() }))

await caso('editar un reactivo archiva lo anterior y lo nuevo, con la hora del evento', async () => {
  await limpiar()
  const antes = { tipo: 'opcion_multiple', ponderacion: 1, enunciado: 'viejo' }
  const despues = { tipo: 'opcion_multiple', ponderacion: 3, enunciado: 'viejo' }
  await correrReactivo('onReactivoCambiado', 'ACTH', 'p1', antes, despues, 'ev-r1')
  const h = await histReactivos('ACTH')
  assert.strictEqual(h.length, 1)
  assert.strictEqual(h[0].id, 'ev-r1')
  assert.strictEqual(h[0].tipoCambio, 'modificado')
  assert.strictEqual(h[0].fuente, 'pregunta')
  assert.strictEqual(h[0].preguntaId, 'p1')
  assert.deepStrictEqual(h[0].antes, antes)
  assert.deepStrictEqual(h[0].despues, despues)
  assert.strictEqual(h[0].cambioEn.toMillis(), Date.parse('2026-10-16T12:00:00.000Z'))
  assert.ok(h[0].registradoEn)
})

await caso('cambiar la clave archiva la anterior; borrar un reactivo queda como «eliminado»', async () => {
  await limpiar()
  await correrReactivo('onClaveCambiada', 'ACTH', 'p1', { respuestaCorrecta: 'a' }, { respuestaCorrecta: 'b' }, 'ev-c1')
  await correrReactivo('onReactivoCambiado', 'ACTH', 'p2', { tipo: 'opcion_multiple', ponderacion: 2 }, null, 'ev-r2')
  const h = (await histReactivos('ACTH')).sort((a, b) => a.id.localeCompare(b.id))
  assert.deepStrictEqual(h.map((x) => [x.id, x.fuente, x.tipoCambio]), [['ev-c1', 'clave', 'modificado'], ['ev-r2', 'pregunta', 'eliminado']])
  assert.deepStrictEqual(h[0].antes, { respuestaCorrecta: 'a' })
})

await caso('crear un reactivo queda como «creado»; la clave que nace con él no duplica el registro', async () => {
  await limpiar()
  await correrReactivo('onReactivoCambiado', 'ACTH', 'p9', null, { tipo: 'opcion_multiple', ponderacion: 1 }, 'ev-n1')
  await correrReactivo('onClaveCambiada', 'ACTH', 'p9', null, { respuestaCorrecta: 'a' }, 'ev-n2')
  const h = await histReactivos('ACTH')
  assert.deepStrictEqual(h.map((x) => [x.id, x.tipoCambio]), [['ev-n1', 'creado']])
})

await caso('una escritura sin cambio real no archiva nada', async () => {
  await limpiar()
  const d = { tipo: 'opcion_multiple', ponderacion: 1, opciones: [{ id: 'a', texto: 'A' }] }
  await correrReactivo('onReactivoCambiado', 'ACTH', 'p1', d, { ...d, opciones: [{ texto: 'A', id: 'a' }] }, 'ev-s1')
  assert.strictEqual((await histReactivos('ACTH')).length, 0)
})

await caso('operaciones simultáneas: el MISMO evento reintentado 8 veces deja una fila; 8 eventos distintos, ocho', async () => {
  await limpiar()
  const antes = { ponderacion: 1 }
  const despues = { ponderacion: 2 }
  await Promise.all(Array.from({ length: 8 }, () => correrReactivo('onReactivoCambiado', 'ACTH', 'p1', antes, despues, 'ev-dup')))
  assert.strictEqual((await histReactivos('ACTH')).length, 1)
  await Promise.all(Array.from({ length: 8 }, (_, i) => correrReactivo('onReactivoCambiado', 'ACTH', 'p1', { ponderacion: i }, { ponderacion: i + 1 }, `ev-${i}`)))
  assert.strictEqual((await histReactivos('ACTH')).length, 9)
})

const correrRubrica = (act, antes, despues, evento) => funciones.onRubricaCambiada.run({
  id: evento, time: '2026-10-16T12:00:00.000Z', params: { activityId: act }, data: { before: snapDe(antes), after: snapDe(despues) },
})
const histRubrica = async (act) => (await db.collection(`activities/${act}/rubricaHistorial`).get()).docs.map((d) => ({ id: d.id, ...d.data() }))

await caso('cambiar la rúbrica archiva la anterior y la nueva; reintento del evento no duplica; otros cambios no registran', async () => {
  await limpiar()
  const r1 = { criterios: [{ nombre: 'Claridad', peso: 50 }] }
  const r2 = { criterios: [{ nombre: 'Claridad', peso: 70 }] }
  await correrRubrica('ACTR', { titulo: 'x', rubrica: r1 }, { titulo: 'x', rubrica: r2 }, 'ev-ru1')
  await correrRubrica('ACTR', { titulo: 'x', rubrica: r1 }, { titulo: 'x', rubrica: r2 }, 'ev-ru1')
  await correrRubrica('ACTR', { titulo: 'x', rubrica: r2 }, { titulo: 'y', rubrica: r2 }, 'ev-ru2')
  const h = await histRubrica('ACTR')
  assert.strictEqual(h.length, 1)
  assert.deepStrictEqual(h[0].rubricaAnterior, r1)
  assert.deepStrictEqual(h[0].rubricaNueva, r2)
  assert.strictEqual(h[0].cambioEn.toMillis(), Date.parse('2026-10-16T12:00:00.000Z'))
})

await caso('8 · cambiar la política NO recalcula notas ya puestas: solo deja constancia', async () => {
  await limpiar()
  await sembrarEvaluacion({}, { conservar: 'mejor' })
  await cerrarIntento(1, ['b', 'b'])
  const s2 = await cerrarIntento(2, ['a', 'a'])
  assert.strictEqual(s2.calificacion, 10, 'con «mejor» queda el 10 del primer intento')
  await correrPolitica(ACT, { tipo: 'evaluacion', evaluacion: { conservar: 'mejor' } }, { tipo: 'evaluacion', evaluacion: { conservar: 'ultimo' } }, 'pol-8')
  const despues = (await db.doc(`submissions/${SUB}`).get()).data()
  assert.strictEqual(despues.calificacion, 10, 'la nota guardada no se mueve')
  assert.strictEqual(despues.politicaAplicada, 'mejor', 'sigue diciendo con qué política se calculó')
  assert.deepStrictEqual(despues.intentos.map((i) => i.calificacion), [10, 0])
  assert.strictEqual((await cambios(ACT)).length, 1, 'el cambio queda en el historial de la política')
})

await limpiar()
resumen('integridad-calificaciones.test.mjs')
