// Limpieza automática al eliminar actividades (functions/actividadLimpieza.js) contra el emulador de Firestore.
// Mismo patrón que integridad-calificaciones.test.mjs: se invoca la lógica de los disparadores con `.run(event)`.
//
// Cubre: el rastro de entregas, la limpieza del árbol de entregas (incluidas las de estudiantes eliminados) y de la
// actividad, escrituras tardías (antes, durante y después del borrado), reintentos, anulaciones (no se borra nada),
// que no se toque lo ajeno y el script de backfill.
//
// Correr (JDK 21; antes node scripts/sync-functions-shared.mjs):
//   firebase emulators:exec --only firestore,auth --project demo-test "node test/limpieza-actividad.test.mjs"
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { db, dbFn, funciones, limpiar, caso, grupo, resumen, assert } from './helpers/entorno.mjs'

const require = createRequire(import.meta.url)
const L = require('../functions/actividadLimpieza.js')
const BACKFILL = fileURLToPath(new URL('../seeds-db/backfill-rastro-entregas.js', import.meta.url))

const snapDe = (data) => (data == null ? { exists: false, data: () => undefined } : { exists: true, data: () => data })
const SUB_ENTREGA = ['calificacionHistorial', 'respuestas', 'progresoVideo', 'intentosRespuestas']
const SUB_ACTIVIDAD = ['preguntas', 'clave', 'reactivosHistorial', 'configHistorial', 'rubricaHistorial', 'iaSugerencias', 'iaSugerenciasEntregable', 'propuestasVideo']
const tam = async (ruta) => (await db.collection(ruta).get()).size
const existe = async (ruta) => (await db.doc(ruta).get()).exists

// Árbol completo de una actividad: subcolecciones propias + entregas con todo lo que cuelga.
async function sembrarActividad(act, { asignaturaId = 'S1', docenteId = 'D1', categoria = 'entregable', tipo = 'archivo', alumnos = ['st1'] } = {}) {
  await db.doc(`activities/${act}`).set({ docenteId, asignaturaId, categoria, tipo, nombre: act, parcial: 1, maxCalif: 10 })
  for (const c of SUB_ACTIVIDAD) await db.doc(`activities/${act}/${c}/x`).set({ v: 1 })
  for (const st of alumnos) {
    const sid = `${act}_${st}`
    await db.doc(`submissions/${sid}`).set({ actividadId: act, alumnoId: st, calificacion: 8 })
    for (const c of SUB_ENTREGA) await db.doc(`submissions/${sid}/${c}/x`).set({ v: 1 })
    assert.strictEqual(await L.registrarEntrega(sid, { actividadId: act, alumnoId: st }), 'registrada')
  }
}
async function restosDe(act, alumnos) {
  let n = 0
  for (const c of SUB_ACTIVIDAD) n += await tam(`activities/${act}/${c}`)
  for (const st of alumnos) {
    if (await existe(`submissions/${act}_${st}`)) n += 1
    for (const c of SUB_ENTREGA) n += await tam(`submissions/${act}_${st}/${c}`)
    if (await existe(`rastroEntregas/${act}_${st}`)) n += 1
  }
  return n
}
// Lo que hace el navegador hoy: borra las entregas (solo el documento) y luego la actividad.
async function borrarComoElNavegador(act) {
  const datos = (await db.doc(`activities/${act}`).get()).data()
  const subs = await db.collection('submissions').where('actividadId', '==', act).get()
  await Promise.all(subs.docs.map((d) => d.ref.delete()))
  await db.doc(`activities/${act}`).delete()
  return datos
}
const limpiarComoTrigger = (act, datos) => funciones.onActividadBorradaLimpiar.run({ params: { activityId: act }, data: snapDe(datos) })

// ═════════════════════════════════════════════════════════════════════════════
grupo('rastro de entregas')
// ═════════════════════════════════════════════════════════════════════════════
await caso('una entrega nueva deja su rastro; un reintento no lo duplica ni lo cambia', async () => {
  await limpiar()
  await db.doc('activities/A1').set({ docenteId: 'D1', asignaturaId: 'S1' })
  await db.doc('submissions/A1_st1').set({ actividadId: 'A1', alumnoId: 'st1' })
  await funciones.onEntregaCreadaRastro.run({ params: { submissionId: 'A1_st1' }, data: snapDe({ actividadId: 'A1', alumnoId: 'st1' }) })
  const r = (await db.doc('rastroEntregas/A1_st1').get()).data()
  assert.deepStrictEqual([r.actividadId, r.alumnoId, r.submissionId], ['A1', 'st1', 'A1_st1'])
  assert.ok(r.registradoEn)
  assert.strictEqual(await L.registrarEntrega('A1_st1', { actividadId: 'A1', alumnoId: 'st1' }), 'existia')
  assert.strictEqual(await tam('rastroEntregas'), 1)
})

await caso('un id que no es {actividad}_{alumno} no deja rastro ni borra nada', async () => {
  await db.doc('submissions/raro/calificacionHistorial/x').set({ v: 1 })
  assert.strictEqual(await L.registrarEntrega('raro', { actividadId: 'A1', alumnoId: 'st9' }), 'ignorada')
  assert.strictEqual(await L.registrarEntrega('A1_st2', { actividadId: 'A1' }), 'ignorada')
  assert.strictEqual(await existe('rastroEntregas/raro'), false)
  assert.strictEqual(await tam('submissions/raro/calificacionHistorial'), 1)
})

await caso('entrega que llega cuando la actividad ya no existe: sin rastro y su árbol se borra ahí mismo', async () => {
  await db.doc('submissions/A9_st1').set({ actividadId: 'A9', alumnoId: 'st1' })
  await db.doc('submissions/A9_st1/calificacionHistorial/x').set({ v: 1 })
  assert.strictEqual(await L.registrarEntrega('A9_st1', { actividadId: 'A9', alumnoId: 'st1' }), 'sin_actividad')
  assert.strictEqual(await existe('rastroEntregas/A9_st1'), false)
  assert.strictEqual(await existe('submissions/A9_st1'), false)
  assert.strictEqual(await tam('submissions/A9_st1/calificacionHistorial'), 0)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('eliminar una actividad: no queda nada suyo y nada ajeno se toca')
// ═════════════════════════════════════════════════════════════════════════════
for (const [categoria, tipo] of [['entregable', 'archivo'], ['examen', 'evaluacion'], ['juego', 'juego'], ['video', 'evaluacion'], ['ruleta', 'archivo']]) {
  await caso(`actividad «${categoria}»: sin historial, respuestas, avance del video, intentos ni subcolecciones`, async () => {
    await limpiar()
    await sembrarActividad('ACT', { categoria, tipo, alumnos: ['st1', 'st2'] })
    const datos = await borrarComoElNavegador('ACT')
    assert.ok((await restosDe('ACT', ['st1', 'st2'])) > 0, 'antes de la limpieza quedan huérfanos (el defecto)')
    await limpiarComoTrigger('ACT', datos)
    assert.strictEqual(await restosDe('ACT', ['st1', 'st2']), 0)
  })
}

await caso('estudiante eliminado ANTES que la actividad: su historial también se borra (por el rastro)', async () => {
  await limpiar()
  await sembrarActividad('ACT', { alumnos: ['st1', 'st2'] })
  await db.doc('students/st1').set({ asignaturaId: 'S1' })
  // st2 se borró antes: ni su documento de estudiante ni su entrega existen; solo su historial y su rastro.
  await db.doc('submissions/ACT_st2').delete()
  const datos = await borrarComoElNavegador('ACT')
  await limpiarComoTrigger('ACT', datos)
  assert.strictEqual(await restosDe('ACT', ['st1', 'st2']), 0)
  assert.strictEqual(await existe('students/st1'), true, 'los estudiantes no se tocan')
})

await caso('ruta sin rastro de un estudiante actual (red de seguridad) y entrega que el navegador no alcanzó a borrar', async () => {
  await limpiar()
  await db.doc('activities/ACT').set({ docenteId: 'D1', asignaturaId: 'S1' })
  await db.doc('students/st5').set({ asignaturaId: 'S1' })
  await db.doc('submissions/ACT_st5/calificacionHistorial/x').set({ v: 1 }) // sin rastro (anterior al despliegue)
  await db.doc('submissions/ACT_st6').set({ actividadId: 'ACT', alumnoId: 'st6' }) // quedó viva
  await db.doc('submissions/ACT_st6/respuestas/x').set({ v: 1 })
  const datos = (await db.doc('activities/ACT').get()).data()
  await db.doc('activities/ACT').delete()
  await limpiarComoTrigger('ACT', datos)
  assert.strictEqual(await tam('submissions/ACT_st5/calificacionHistorial'), 0)
  assert.strictEqual(await existe('submissions/ACT_st6'), false)
  assert.strictEqual(await tam('submissions/ACT_st6/respuestas'), 0)
})

await caso('lo ajeno queda intacto: otra actividad, una con id que empieza igual, otra asignatura y otro docente', async () => {
  await limpiar()
  await sembrarActividad('ACT', { alumnos: ['st1'] })
  await sembrarActividad('OTRA', { alumnos: ['st1'] })
  await sembrarActividad('ACT_x', { alumnos: ['st1'] }) // su entrega es ACT_x_st1: empieza con «ACT_»
  await sembrarActividad('S2ACT', { asignaturaId: 'S2', alumnos: ['st1'] })
  await sembrarActividad('D2ACT', { asignaturaId: 'S3', docenteId: 'D2', alumnos: ['st1'] })
  await db.doc('students/st1').set({ asignaturaId: 'S1' })
  await db.doc('students/intruso').set({ asignaturaId: 'S1' }) // así la red de estudiantes llega a ACT_intruso
  // Un documento con id de ACT pero de OTRA actividad (no debería existir; se respeta igual).
  await db.doc('submissions/ACT_intruso').set({ actividadId: 'OTRA', alumnoId: 'intruso' })
  await db.doc('submissions/ACT_intruso/calificacionHistorial/x').set({ v: 1 })
  const antes = {}
  for (const a of ['OTRA', 'ACT_x', 'S2ACT', 'D2ACT']) antes[a] = await restosDe(a, ['st1'])
  const datos = await borrarComoElNavegador('ACT')
  await limpiarComoTrigger('ACT', datos)
  assert.strictEqual(await restosDe('ACT', ['st1']), 0)
  for (const a of ['OTRA', 'ACT_x', 'S2ACT', 'D2ACT']) {
    assert.strictEqual(await restosDe(a, ['st1']), antes[a], `${a} sin cambios`)
    assert.strictEqual(await existe(`activities/${a}`), true)
  }
  assert.strictEqual(await existe('submissions/ACT_intruso'), true)
  assert.strictEqual(await tam('submissions/ACT_intruso/calificacionHistorial'), 1)
  assert.strictEqual(await existe('students/st1'), true)
})

await caso('si la actividad existe (no se borró), la limpieza no toca nada', async () => {
  await limpiar()
  await sembrarActividad('ACT', { alumnos: ['st1'] })
  const antes = await restosDe('ACT', ['st1'])
  const r = await L.limpiarActividadBorrada('ACT', { asignaturaId: 'S1' })
  assert.strictEqual(r.omitida, 'existe')
  assert.strictEqual(await restosDe('ACT', ['st1']), antes)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('escrituras tardías')
// ═════════════════════════════════════════════════════════════════════════════
const historialRun = (sid, act, ev) => funciones.onCalificacionCambiada.run({
  id: ev, params: { submissionId: sid }, data: { before: snapDe({ actividadId: act, calificacion: 5 }), after: snapDe({ actividadId: act, alumnoId: 'st1', calificacion: 9 }) },
})
const reactivoRun = (act, ev) => funciones.onReactivoCambiado.run({
  id: ev, time: '2026-11-08T12:00:00.000Z', params: { activityId: act, preguntaId: 'p1' }, data: { before: snapDe({ ponderacion: 1 }), after: snapDe(null) },
})
const rubricaRun = (act, ev) => funciones.onRubricaCambiada.run({
  id: ev, time: '2026-11-08T12:00:00.000Z', params: { activityId: act }, data: { before: snapDe({ rubrica: [1] }), after: snapDe({ rubrica: [2] }) },
})
const politicaRun = (act, ev) => funciones.onPoliticaConservarCambiada.run({
  id: ev, params: { activityId: act }, data: { before: snapDe({ tipo: 'evaluacion', evaluacion: { conservar: 'mejor' } }), after: snapDe({ tipo: 'evaluacion', evaluacion: { conservar: 'ultimo' } }) },
})

await caso('después del borrado: historial de notas, de reactivos, de rúbrica y de política NO se escriben', async () => {
  await limpiar()
  await historialRun('ACT_st1', 'ACT', 'ev-1')
  await reactivoRun('ACT', 'ev-2')
  await rubricaRun('ACT', 'ev-3')
  await politicaRun('ACT', 'ev-4')
  assert.strictEqual(await tam('submissions/ACT_st1/calificacionHistorial'), 0)
  for (const c of ['reactivosHistorial', 'rubricaHistorial', 'configHistorial']) assert.strictEqual(await tam(`activities/ACT/${c}`), 0, c)
})

await caso('con la actividad viva sí se escriben (y un reintento del mismo evento no duplica)', async () => {
  await db.doc('activities/ACT').set({ docenteId: 'D1', asignaturaId: 'S1', tipo: 'evaluacion' })
  for (let i = 0; i < 2; i += 1) {
    await historialRun('ACT_st1', 'ACT', 'ev-1')
    await reactivoRun('ACT', 'ev-2')
    await rubricaRun('ACT', 'ev-3')
    await politicaRun('ACT', 'ev-4')
  }
  assert.strictEqual(await tam('submissions/ACT_st1/calificacionHistorial'), 1)
  for (const c of ['reactivosHistorial', 'rubricaHistorial', 'configHistorial']) assert.strictEqual(await tam(`activities/ACT/${c}`), 1, c)
})

await caso('escritura confirmada ANTES del borrado: la limpieza la encuentra', async () => {
  await limpiar()
  await sembrarActividad('ACT', { alumnos: ['st1'] })
  await historialRun('ACT_st1', 'ACT', 'ev-tarde')
  const datos = await borrarComoElNavegador('ACT')
  await limpiarComoTrigger('ACT', datos)
  assert.strictEqual(await restosDe('ACT', ['st1']), 0)
})

await caso('borrado DURANTE la escritura (transacción abierta): al final no queda nada', async () => {
  for (let vuelta = 0; vuelta < 3; vuelta += 1) {
    await limpiar()
    await sembrarActividad('ACT', { alumnos: ['st1'] })
    await db.doc('submissions/ACT_st1').delete()
    const datos = (await db.doc('activities/ACT').get()).data()
    let borrado = null
    L.fijarPruebasLimpieza({
      dentroDeTransaccion: async () => {
        if (borrado) return
        borrado = db.doc('activities/ACT').delete() // otro cliente borra mientras la transacción está abierta
        await new Promise((r) => setTimeout(r, 300))
      },
    })
    try {
      await historialRun('ACT_st1', 'ACT', `ev-carrera-${vuelta}`)
    } finally {
      L.fijarPruebasLimpieza({})
    }
    await borrado
    assert.strictEqual(await existe('activities/ACT'), false)
    await limpiarComoTrigger('ACT', datos)
    assert.strictEqual(await restosDe('ACT', ['st1']), 0, `vuelta ${vuelta}`)
  }
})

await caso('rastro que llega tarde (la limpieza ya pasó): la entrega se borra sola', async () => {
  await limpiar()
  await db.doc('activities/ACT').set({ docenteId: 'D1', asignaturaId: 'S1' })
  await db.doc('submissions/ACT_st1').set({ actividadId: 'ACT', alumnoId: 'st1' })
  await db.doc('submissions/ACT_st1/calificacionHistorial/x').set({ v: 1 })
  const datos = (await db.doc('activities/ACT').get()).data()
  await db.doc('activities/ACT').delete()
  await L.limpiarActividadBorrada('ACT', { ...datos, asignaturaId: null }) // sin red de estudiantes: no la conoce
  await db.doc('submissions/ACT_st1/calificacionHistorial/y').set({ v: 1 }) // escribió alguien antes del rastro
  assert.strictEqual(await L.registrarEntrega('ACT_st1', { actividadId: 'ACT', alumnoId: 'st1' }), 'sin_actividad')
  assert.strictEqual(await restosDe('ACT', ['st1']), 0)
})

await caso('onEvaluacionFinalizada: si la actividad se borra mientras califica, no deja respuestas ni intentos huérfanos', async () => {
  await limpiar()
  await db.doc('activities/EV').set({ docenteId: 'D1', asignaturaId: 'S1', tipo: 'evaluacion', maxCalif: 10, evaluacion: { publicarRespuestas: 'inmediato' } })
  await db.doc('activities/EV/preguntas/p1').set({ tipo: 'opcion_multiple', ponderacion: 1, enunciado: 'p1', opciones: [{ id: 'a', texto: 'A' }] })
  await db.doc('activities/EV/clave/p1').set({ respuestaCorrecta: 'a' })
  await db.doc('submissions/EV_st1').set({ actividadId: 'EV', alumnoId: 'st1', estadoEvaluacion: 'finalizado', intentoActual: 1, intentos: [] })
  await db.doc('submissions/EV_st1/respuestas/p1').set({ opcionSeleccionada: 'a' })
  await L.registrarEntrega('EV_st1', { actividadId: 'EV', alumnoId: 'st1' })
  const snap = await dbFn.doc('submissions/EV_st1').get()
  const datos = (await db.doc('activities/EV').get()).data()
  let borrado = null
  L.fijarPruebasLimpieza({
    dentroDeTransaccion: async () => {
      if (borrado) return
      borrado = (async () => {
        await db.doc('submissions/EV_st1').delete()
        await db.doc('activities/EV').delete()
      })()
      await new Promise((r) => setTimeout(r, 300))
    },
  })
  try {
    await funciones.onEvaluacionFinalizada.run({ data: { after: snap }, params: { submissionId: 'EV_st1' } })
  } finally {
    L.fijarPruebasLimpieza({})
  }
  await borrado
  await limpiarComoTrigger('EV', datos)
  assert.strictEqual(await existe('submissions/EV_st1'), false)
  for (const c of SUB_ENTREGA) assert.strictEqual(await tam(`submissions/EV_st1/${c}`), 0, c)
  for (const c of ['preguntas', 'clave', 'reactivosHistorial']) assert.strictEqual(await tam(`activities/EV/${c}`), 0, c)
})

await caso('onEvaluacionFinalizada con la actividad viva: califica y marca respuestas como siempre', async () => {
  await limpiar()
  await db.doc('activities/EV').set({ docenteId: 'D1', asignaturaId: 'S1', tipo: 'evaluacion', maxCalif: 10, evaluacion: { publicarRespuestas: 'inmediato' } })
  await db.doc('activities/EV/preguntas/p1').set({ tipo: 'opcion_multiple', ponderacion: 1, enunciado: 'p1', opciones: [{ id: 'a', texto: 'A' }] })
  await db.doc('activities/EV/clave/p1').set({ respuestaCorrecta: 'a' })
  await db.doc('submissions/EV_st1').set({ actividadId: 'EV', alumnoId: 'st1', estadoEvaluacion: 'finalizado', intentoActual: 1, intentos: [] })
  await db.doc('submissions/EV_st1/respuestas/p1').set({ opcionSeleccionada: 'a' })
  await funciones.onEvaluacionFinalizada.run({ data: { after: await dbFn.doc('submissions/EV_st1').get() }, params: { submissionId: 'EV_st1' } })
  const s = (await db.doc('submissions/EV_st1').get()).data()
  assert.strictEqual(s.calificacion, 10)
  assert.strictEqual((await db.doc('submissions/EV_st1/respuestas/p1').get()).data().correcta, true)
  assert.strictEqual(await tam('submissions/EV_st1/intentosRespuestas'), 1)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('reintentos e idempotencia')
// ═════════════════════════════════════════════════════════════════════════════
await caso('si la limpieza falla a la mitad, el rastro sigue y el reintento termina el trabajo', async () => {
  await limpiar()
  await sembrarActividad('ACT', { alumnos: ['st1', 'st2', 'st3'] })
  const datos = await borrarComoElNavegador('ACT')
  L.fijarPruebasLimpieza({ fallarLimpieza: async () => { throw new Error('caída simulada') } })
  await assert.rejects(limpiarComoTrigger('ACT', datos), /caída simulada/)
  L.fijarPruebasLimpieza({})
  assert.strictEqual(await tam('rastroEntregas'), 3, 'el rastro no se borra si la limpieza no terminó')
  await limpiarComoTrigger('ACT', datos)
  assert.strictEqual(await restosDe('ACT', ['st1', 'st2', 'st3']), 0)
  await limpiarComoTrigger('ACT', datos) // otra vez, ya sin nada: no falla
  await Promise.all([limpiarComoTrigger('ACT', datos), limpiarComoTrigger('ACT', datos)]) // dos a la vez
  assert.strictEqual(await restosDe('ACT', ['st1', 'st2', 'st3']), 0)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('anular una entrega no borra su historial')
// ═════════════════════════════════════════════════════════════════════════════
await caso('anular (borrar la entrega, la actividad sigue) conserva historial y rastro; volver a entregar no duplica', async () => {
  await limpiar()
  await sembrarActividad('ACT', { alumnos: ['st1'] })
  await db.doc('submissions/ACT_st1').delete()
  await funciones.onEntregaBorradaLimpiarIntentos.run({ params: { submissionId: 'ACT_st1' }, data: snapDe({ actividadId: 'ACT', alumnoId: 'st1' }) })
  assert.strictEqual(await tam('submissions/ACT_st1/calificacionHistorial'), 1, 'el historial se conserva')
  assert.strictEqual(await existe('rastroEntregas/ACT_st1'), true)
  await db.doc('submissions/ACT_st1').set({ actividadId: 'ACT', alumnoId: 'st1' })
  assert.strictEqual(await L.registrarEntrega('ACT_st1', { actividadId: 'ACT', alumnoId: 'st1' }), 'existia')
  await historialRun('ACT_st1', 'ACT', 'ev-nueva')
  assert.strictEqual(await tam('submissions/ACT_st1/calificacionHistorial'), 2)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('backfill-rastro-entregas.js')
// ═════════════════════════════════════════════════════════════════════════════
const correrBackfill = (...args) => execFileSync(process.execPath, [BACKFILL, ...args], {
  env: { ...process.env, GCLOUD_PROJECT: 'demo-test' }, encoding: 'utf8',
})

await caso('--dry-run no escribe; --escribir registra lo recuperable, reporta lo viejo y lo ambiguo; repetirlo no cambia nada', async () => {
  await limpiar()
  await db.doc('activities/B1').set({ asignaturaId: 'S1' })
  await db.doc('activities/B1_x').set({ asignaturaId: 'S1' })
  await db.doc('submissions/B1_st1').set({ actividadId: 'B1', alumnoId: 'st1' }) // viva
  await db.doc('submissions/B1_st2/calificacionHistorial/x').set({ v: 1 }) // estudiante borrado
  await db.doc('submissions/GONE_st1/calificacionHistorial/x').set({ v: 1 }) // actividad ya borrada
  await db.doc('submissions/B1_x_st3/calificacionHistorial/x').set({ v: 1 }) // ¿B1 + «x_st3» o B1_x + «st3»?
  await db.doc('submissions/B1_st4').set({ actividadId: 'B1', alumnoId: 'st4' })
  await db.doc('rastroEntregas/B1_st4').set({ actividadId: 'B1', alumnoId: 'st4', submissionId: 'B1_st4', previo: true })

  const simulado = correrBackfill('--dry-run')
  assert.match(simulado, /SIMULACIÓN/)
  assert.match(simulado, /"porRegistrar": 2/)
  assert.match(simulado, /"huerfanasViejas": 1/)
  assert.match(simulado, /"ambiguas": 1/)
  assert.strictEqual(await tam('rastroEntregas'), 1, 'en simulación no se escribe')
  assert.match(correrBackfill(), /SIMULACIÓN/)
  assert.strictEqual(await tam('rastroEntregas'), 1, 'sin opciones también simula')

  const real = correrBackfill('--escribir')
  assert.match(real, /"registradas": 2/)
  const r2 = (await db.doc('rastroEntregas/B1_st2').get()).data()
  assert.deepStrictEqual([r2.actividadId, r2.alumnoId, r2.origen], ['B1', 'st2', 'backfill'])
  assert.strictEqual(await existe('rastroEntregas/B1_st1'), true)
  assert.strictEqual(await existe('rastroEntregas/GONE_st1'), false)
  assert.strictEqual(await existe('rastroEntregas/B1_x_st3'), false)
  assert.strictEqual((await db.doc('rastroEntregas/B1_st4').get()).data().previo, true, 'un rastro previo no se toca')
  assert.strictEqual(await tam('submissions/GONE_st1/calificacionHistorial'), 1, 'el backfill no borra nada')

  const otra = correrBackfill('--escribir')
  assert.match(otra, /"registradas": 0/)
  assert.strictEqual(await tam('rastroEntregas'), 3)

  // Y con el rastro del backfill, borrar B1 limpia también al estudiante ya eliminado.
  await db.doc('submissions/B1_st1').delete()
  await db.doc('submissions/B1_st4').delete()
  await db.doc('activities/B1').delete()
  await limpiarComoTrigger('B1', { asignaturaId: 'S1' })
  assert.strictEqual(await tam('submissions/B1_st2/calificacionHistorial'), 0)
  assert.strictEqual(await existe('activities/B1_x'), true)
})

await limpiar()
resumen('limpieza-actividad.test.mjs')
