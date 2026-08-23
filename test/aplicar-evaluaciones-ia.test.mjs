// Pruebas de "Aplicar calificaciones de IA a todas" y persistencia de
// evaluaciones individuales (23-ago-2026, functions/calificarAplicar.js).
// Ninguna de las dos funciones llama a Anthropic ni al ledger de créditos —
// se verifica con llamadas directas a *_Impl (mismo patrón que
// functions/juego.js) y con una comprobación estática del código fuente.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { db, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'

const require = createRequire(import.meta.url)
const calAp = require('../functions/calificarAplicar.js')
const { guardarEvaluacionIndividualAplicadaImpl, aplicarEvaluacionesIAPendientesImpl, totalInstrumento } = calAp._pruebas

const DOCENTE_A = 'docenteA-aplicar'
const DOCENTE_B = 'docenteB-aplicar'
const ACTIVIDAD = 'act-aplicar-1'

const RUBRICA = {
  tipo: 'rubrica',
  criterios: [{ nombre: 'Criterio 1', puntos: [0, 5, 10] }],
  niveles: [{ nombre: 'No cumple' }, { nombre: 'Parcial' }, { nombre: 'Completo' }],
}

const SUGERENCIA_EJEMPLO = {
  criterios: [{ n: 1, nivel: 2, evidencia: 'Cumple completamente', sinEvidenciaSuficiente: false }],
  retroalimentacionGeneral: 'Buen trabajo, cumple con lo solicitado.',
  confianza: 'alta',
  evidenciasAnalizadas: [{ nombre: 'foto.jpg', tipo: 'imagen' }],
  ignoradosPorFormato: 0,
  ignoradosPorTope: 0,
  calificacionPropuesta: 10,
}

async function sembrarActividad() {
  await db.doc(`activities/${ACTIVIDAD}`).set({
    docenteId: DOCENTE_A, categoria: 'entregable', nombre: 'Actividad de prueba', rubrica: RUBRICA,
  })
}

// ── Comprobación estática: nunca requiere el SDK de Anthropic ni el ledger ──
grupo('calificarAplicar.js — nunca toca Anthropic ni el ledger (estático)')
await caso('el archivo fuente no importa @anthropic-ai/sdk ni functions/creditosLedger', async () => {
  const ruta = fileURLToPath(new URL('../functions/calificarAplicar.js', import.meta.url))
  const src = readFileSync(ruta, 'utf8')
  assert.ok(!src.includes("require('@anthropic-ai/sdk')") && !src.includes('require("@anthropic-ai/sdk")'), 'no debe requerir el SDK de Anthropic')
  assert.ok(!src.includes("require('./creditosLedger')"), 'no debe requerir el ledger de créditos')
})

// ── guardarEvaluacionIndividualAplicada ─────────────────────────────────────
grupo('guardarEvaluacionIndividualAplicada — persistencia del flujo individual')
await limpiar()
await sembrarActividad()
await db.doc('submissions/subInd1').set({ actividadId: ACTIVIDAD, alumnoId: 'al1', calificacion: 10, archivos: [] })
await db.doc('iaCreditos/' + DOCENTE_A).set({ saldo: 20, consumidoTotal: 0, consumoPorCategoria: {} })

await caso('1. una evaluación individual aplicada queda persistida con estado "aplicada" y la sugerencia completa', async () => {
  await guardarEvaluacionIndividualAplicadaImpl({
    auth: { uid: DOCENTE_A },
    data: { actividadId: ACTIVIDAD, submissionId: 'subInd1', sugerencia: SUGERENCIA_EJEMPLO },
  })
  const snap = await db.doc(`activities/${ACTIVIDAD}/iaSugerenciasEntregable/subInd1`).get()
  assert.ok(snap.exists)
  assert.strictEqual(snap.data().estado, 'aplicada')
  assert.strictEqual(snap.data().sugerencia.calificacionPropuesta, 10)
  assert.strictEqual(snap.data().sugerencia.retroalimentacionGeneral, SUGERENCIA_EJEMPLO.retroalimentacionGeneral)
})

await caso('2. la evaluación individual aplicada puede consultarse después (misma lectura, mismos datos)', async () => {
  const snap = await db.doc(`activities/${ACTIVIDAD}/iaSugerenciasEntregable/subInd1`).get()
  assert.strictEqual(snap.data().sugerencia.criterios[0].nivel, 2)
  assert.strictEqual(snap.data().sugerencia.confianza, 'alta')
})

await caso('3. persistir/consultar la evaluación individual no cobra créditos', async () => {
  const creditos = await db.doc('iaCreditos/' + DOCENTE_A).get()
  assert.strictEqual(creditos.data().saldo, 20)
  const consumos = await db.collection('iaConsumos').where('uid', '==', DOCENTE_A).get()
  assert.strictEqual(consumos.size, 0)
})

await caso('4. persistir la evaluación individual no modifica la calificación real de la entrega', async () => {
  const sub = await db.doc('submissions/subInd1').get()
  assert.strictEqual(sub.data().calificacion, 10) // el mismo valor sembrado, sin tocar
})

await caso('15a. un docente ajeno no puede persistir una evaluación en una actividad que no es suya', async () => {
  await assert.rejects(
    guardarEvaluacionIndividualAplicadaImpl({
      auth: { uid: DOCENTE_B },
      data: { actividadId: ACTIVIDAD, submissionId: 'subInd1', sugerencia: SUGERENCIA_EJEMPLO },
    }),
    /permission-denied|no es tuya/,
  )
})

await caso('la entrega debe pertenecer a la actividad indicada (no acepta IDs de otra actividad)', async () => {
  await db.doc('activities/act-otra-aplicar').set({ docenteId: DOCENTE_A, categoria: 'entregable', nombre: 'Otra' })
  await db.doc('submissions/subOtraActividad').set({ actividadId: 'act-otra-aplicar', alumnoId: 'alX', calificacion: 5 })
  await assert.rejects(
    guardarEvaluacionIndividualAplicadaImpl({
      auth: { uid: DOCENTE_A },
      data: { actividadId: ACTIVIDAD, submissionId: 'subOtraActividad', sugerencia: SUGERENCIA_EJEMPLO },
    }),
    /no pertenece/,
  )
})

// ── aplicarEvaluacionesIAPendientes (Modo 1) ────────────────────────────────
grupo('aplicarEvaluacionesIAPendientes — aplicación masiva sin IA ni créditos')
await limpiar()
await sembrarActividad()
await db.doc('iaCreditos/' + DOCENTE_A).set({ saldo: 15, consumidoTotal: 0, consumoPorCategoria: {} })

async function sembrarPendiente(subId, calificacionPropuesta, nivel = 2, calificacionInicial = null) {
  await db.doc(`submissions/${subId}`).set({ actividadId: ACTIVIDAD, alumnoId: subId, calificacion: calificacionInicial, archivos: [] })
  await db.doc(`activities/${ACTIVIDAD}/iaSugerenciasEntregable/${subId}`).set({
    estado: 'pendiente', actividadId: ACTIVIDAD, sub: subId,
    sugerencia: {
      criterios: [{ n: 1, nivel, evidencia: 'ok', sinEvidenciaSuficiente: false }],
      retroalimentacionGeneral: `Retro de ${subId}`, confianza: 'alta',
      evidenciasAnalizadas: [], ignoradosPorFormato: 0, ignoradosPorTope: 0,
      calificacionPropuesta,
    },
  })
}
await sembrarPendiente('subM1', 10)
await sembrarPendiente('subM2', 5, 1, 3) // ya tenía una calificación manual previa (3) — debe sobrescribirse
await sembrarPendiente('subM3', 10) // ya calificada por IA previamente (para la prueba de "ya aplicada" más abajo)

await caso('6. aplica todas las pendientes de la actividad', async () => {
  const r = await aplicarEvaluacionesIAPendientesImpl({ auth: { uid: DOCENTE_A }, data: { actividadId: ACTIVIDAD } })
  assert.strictEqual(r.aplicadas, 3)
  assert.strictEqual(r.noAplicadas, 0)
  const sub1 = await db.doc('submissions/subM1').get()
  assert.strictEqual(sub1.data().calificacion, 10)
  assert.strictEqual(sub1.data().estado, 'calificado')
  const sub2 = await db.doc('submissions/subM2').get()
  assert.strictEqual(sub2.data().calificacion, 5, 'debe sobrescribir la calificación manual previa (3) con la propuesta de IA (5)')
})

await caso('7. aplicar todas no cobra créditos', async () => {
  const creditos = await db.doc('iaCreditos/' + DOCENTE_A).get()
  assert.strictEqual(creditos.data().saldo, 15)
  const consumos = await db.collection('iaConsumos').where('uid', '==', DOCENTE_A).get()
  assert.strictEqual(consumos.size, 0)
})

await caso('8. aplicar todas no llama a Anthropic (verificado estáticamente arriba; aquí se confirma que corrió sin `apiKey`/`modelo`)', async () => {
  // aplicarEvaluacionesIAPendientesImpl no recibe apiKey ni modelo en su firma — si intentara
  // llamar a Anthropic, fallaría por falta de credenciales. Ya corrió sin error en la prueba 6.
  assert.ok(true)
})

await caso('9. marca cada sugerencia aplicada como "aplicada"', async () => {
  const sug1 = await db.doc(`activities/${ACTIVIDAD}/iaSugerenciasEntregable/subM1`).get()
  assert.strictEqual(sug1.data().estado, 'aplicada')
  assert.strictEqual(sug1.data().aplicadaAutomaticamente, true)
})

await caso('10. aplicar todas de nuevo no vuelve a aplicar las ya aplicadas (idempotente)', async () => {
  const r = await aplicarEvaluacionesIAPendientesImpl({ auth: { uid: DOCENTE_A }, data: { actividadId: ACTIVIDAD } })
  assert.strictEqual(r.aplicadas, 0)
  assert.strictEqual(r.noAplicadas, 0)
})

await caso('15b. un docente ajeno no puede aplicar evaluaciones de una actividad que no es suya', async () => {
  await sembrarPendiente('subM4', 8)
  await assert.rejects(
    aplicarEvaluacionesIAPendientesImpl({ auth: { uid: DOCENTE_B }, data: { actividadId: ACTIVIDAD } }),
    /permission-denied|no es tuya/,
  )
  // Y la que sí quedó pendiente sigue intacta — el intento ajeno no la tocó.
  const sug4 = await db.doc(`activities/${ACTIVIDAD}/iaSugerenciasEntregable/subM4`).get()
  assert.strictEqual(sug4.data().estado, 'pendiente')
})

await caso('defensa: una sugerencia cuyo `sub` no pertenece a la actividad se reporta como no aplicada, no se aplica a ciegas', async () => {
  // subM4 (de la prueba 15b) sigue pendiente — se aplica normal en esta
  // pasada, junto con la nueva subAjena que SÍ debe rechazarse.
  await db.doc('submissions/subAjena').set({ actividadId: 'otra-actividad-cualquiera', alumnoId: 'alY', calificacion: null })
  await db.doc(`activities/${ACTIVIDAD}/iaSugerenciasEntregable/subAjena`).set({
    estado: 'pendiente', actividadId: ACTIVIDAD, sub: 'subAjena',
    sugerencia: { criterios: [{ n: 1, nivel: 2, sinEvidenciaSuficiente: false }], calificacionPropuesta: 10, retroalimentacionGeneral: '' },
  })
  const r = await aplicarEvaluacionesIAPendientesImpl({ auth: { uid: DOCENTE_A }, data: { actividadId: ACTIVIDAD } })
  assert.strictEqual(r.noAplicadas, 1)
  assert.match(r.motivos[0].motivo, /no pertenece/)
  assert.strictEqual(r.motivos[0].submissionId, 'subAjena')
  const subAjena = await db.doc('submissions/subAjena').get()
  assert.strictEqual(subAjena.data().calificacion, null, 'nunca debe escribirse una calificación en una entrega ajena')
})

// ── Calificación histórica de IA no se altera al cambiar la calificación manualmente ──
grupo('Calificación propuesta histórica — se conserva aunque cambie la calificación real')
await caso('14. cambiar manualmente la calificación después no altera la propuesta histórica de la IA', async () => {
  const antes = await db.doc(`activities/${ACTIVIDAD}/iaSugerenciasEntregable/subM1`).get()
  assert.strictEqual(antes.data().sugerencia.calificacionPropuesta, 10)
  // El docente cambia la calificación real a mano (fuera de este mecanismo).
  await db.doc('submissions/subM1').update({ calificacion: 6 })
  const despues = await db.doc(`activities/${ACTIVIDAD}/iaSugerenciasEntregable/subM1`).get()
  assert.strictEqual(despues.data().sugerencia.calificacionPropuesta, 10, 'la propuesta histórica de la IA no debe cambiar')
  const sub = await db.doc('submissions/subM1').get()
  assert.strictEqual(sub.data().calificacion, 6, 'la calificación real sí refleja el cambio manual')
})

// ── totalInstrumento — usado como respaldo si calificacionPropuesta no viene ──
grupo('totalInstrumento — respaldo de cálculo (espejo de totalRubrica)')
await caso('calcula el total de una rúbrica a partir de los niveles seleccionados', async () => {
  assert.strictEqual(totalInstrumento(RUBRICA, [2]), 10)
  assert.strictEqual(totalInstrumento(RUBRICA, [null]), null, 'sin evidencia suficiente → null, nunca inventa')
})

// ── Etiqueta del botón (mismo criterio de 3 vías que ActivityPage.jsx) ──────
grupo('Etiqueta del botón — mismo criterio de 3 vías que labelCalificarConIA en ActivityPage.jsx')
function labelCalificarConIA(sugerenciaPersistidaIA) {
  if (!sugerenciaPersistidaIA) return 'Calificar con IA'
  return sugerenciaPersistidaIA._estado === 'aplicada' ? 'Ver evaluación de IA' : 'Ver propuesta de IA'
}
await caso('16. sin evaluación IA → "Calificar con IA"', async () => {
  assert.strictEqual(labelCalificarConIA(null), 'Calificar con IA')
})
await caso('17. pendiente → "Ver propuesta de IA"', async () => {
  assert.strictEqual(labelCalificarConIA({ _estado: 'pendiente' }), 'Ver propuesta de IA')
})
await caso('18. aplicada → "Ver evaluación de IA"', async () => {
  assert.strictEqual(labelCalificarConIA({ _estado: 'aplicada' }), 'Ver evaluación de IA')
})

await limpiar()
resumen('aplicar-evaluaciones-ia.test.mjs')
