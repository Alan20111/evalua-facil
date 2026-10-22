// Participación en vivo — SELLADO AUTOMÁTICO de preguntas vencidas (barrido programado de `recuperarAnalisisVivo`).
//
//   firebase emulators:exec --only firestore,auth --project demo-test "node test/participacion-vivo-sellado.test.mjs"
//
// Prueba solo este ajuste: que una pregunta vencida se selle aunque el docente no esté conectado, que una vigente no, que
// ejecuciones simultáneas no dupliquen el sellado y que no se toquen respuestas ni la hora límite.
import { createRequire } from 'node:module'
import { db, limpiar, caso, grupo, resumen, assert, llamar } from './helpers/entorno.mjs'
import { handleVivoResponder } from '../api/_lib/vivo.js'
import { ejecutarControl } from '../api/_lib/vivoControl.js'
import * as V from '../src/utils/participacionVivo.js'

const require = createRequire(import.meta.url)
const PV = require('../functions/participacionVivo.js')

const CODIGO = 'ABCDEFGHJK'
const DOCENTE = 'docente_sellado'
const PREGUNTAS = [{ id: 'p1', tipo: 'opcion_unica', formato: 'opcion', enunciado: '¿Gas?', puntos: 10, tiempo: 10, opciones: [{ id: 'a', texto: 'Oxígeno' }, { id: 'b', texto: 'Metano' }] }]
const ref = () => db.doc(`vivoSesiones/${CODIGO}`)
const leer = async () => (await ref().get()).data()
const responder = (cuerpo) => llamar(handleVivoResponder, { cuerpo })

async function sembrar({ ventana, estado = 'activa', acceso = 'grupo', estudiantes = ['est_a', 'est_b', 'est_c'], respondieron = ['est_a', 'est_b'] } = {}) {
  await limpiar()
  await ref().set({
    actividadId: 'act_s', asignaturaId: 'sub_s', docenteId: DOCENTE, titulo: 'Sellado', proposito: 'evaluacion', acceso, calificable: false,
    estado, preguntaIndex: 0, aceptando: true, preguntas: PREGUNTAS, analisisActivo: false,
    abreMs: ventana.abreMs, cierraMs: ventana.cierraMs ?? null, cerradaMs: ventana.cerradaMs ?? null,
    ventanas: { p1: { abreMs: ventana.abreMs, cierraMs: ventana.cierraMs ?? null, cerradaMs: ventana.cerradaMs ?? null, ...(ventana.motivo ? { motivo: ventana.motivo } : {}) } },
  })
  for (const id of estudiantes) await db.doc(`students/${id}`).set({ uid: `uid_${id}`, asignaturaId: 'sub_s', nombre: id })
  for (const id of respondieron) {
    await db.doc(`vivoRespuestas/${CODIGO}_p1_${id}`).set({ sesionId: CODIGO, actividadId: 'act_s', docenteId: DOCENTE, preguntaId: 'p1', preguntaTipo: 'opcion_unica', alumnoId: id, participanteKey: id, opcion: 'a', recibidaMs: ventana.abreMs + 1000 })
  }
}
const respuestasGuardadas = async () => (await db.collection('vivoRespuestas').get()).docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id))

const AHORA = Date.now()

grupo('Sellado automático de preguntas vencidas')

await caso('una pregunta VIGENTE no se sella', async () => {
  await sembrar({ ventana: { abreMs: AHORA - 1000, cierraMs: AHORA + 60000 } })
  const r = await PV.sellarSesionesVencidas({ ahora: AHORA + 20000 })
  assert.strictEqual(r.preguntasSelladas, 0)
  const s = await leer()
  assert.strictEqual(s.ventanas.p1.sellada, undefined)
  assert.strictEqual(s.aceptando, true)
})

await caso('una pregunta modo manual (sin límite) y abierta no se sella nunca por el barrido', async () => {
  await sembrar({ ventana: { abreMs: AHORA - 3_600_000, cierraMs: null } })
  assert.strictEqual((await PV.sellarSesionesVencidas({ ahora: AHORA + 10 * 3_600_000 })).preguntasSelladas, 0)
})

await caso('dentro del margen de 5 s tras el cierre todavía no se sella; pasado el margen sí', async () => {
  await sembrar({ ventana: { abreMs: AHORA - 20000, cierraMs: AHORA - 10000 } })
  assert.strictEqual((await PV.sellarSesionesVencidas({ ahora: AHORA - 10000 + 4999 })).preguntasSelladas, 0, 'a 4.9 s del cierre aún no')
  assert.strictEqual((await leer()).ventanas.p1.sellada, undefined)
  assert.strictEqual((await PV.sellarSesionesVencidas({ ahora: AHORA - 10000 + 5000 })).preguntasSelladas, 1, 'a 5 s ya')
})

await caso('el margen NO permite respuestas fuera de tiempo: vencida y sin sellar, el servidor igual rechaza', async () => {
  await sembrar({ ventana: { abreMs: Date.now() - 20000, cierraMs: Date.now() - 2000 }, acceso: 'externo', respondieron: [], estudiantes: [] })
  assert.strictEqual((await leer()).ventanas.p1.sellada, undefined, 'dentro del margen: sin sellar')
  const r = await responder({ codigo: CODIGO, preguntaId: 'p1', opcion: 'a', participanteKey: 'participante00000001' })
  assert.strictEqual(r.statusCode, 409); assert.ok(/terminó el tiempo/.test(r.cuerpo.error))
  assert.strictEqual((await db.collection('vivoRespuestas').get()).size, 0)
})

await caso('una pregunta VENCIDA se sella SIN el docente: sin respuesta registrada, aceptando apagado, respuestas y hora límite intactas', async () => {
  await sembrar({ ventana: { abreMs: AHORA - 30000, cierraMs: AHORA - 20000 } })
  const antes = await leer()
  const respuestasAntes = await respuestasGuardadas()
  const r = await PV.sellarSesionesVencidas({ ahora: AHORA })
  assert.deepStrictEqual(r, { sesionesRevisadas: 1, preguntasSelladas: 1 })
  const s = await leer()
  const v = s.ventanas.p1
  assert.strictEqual(v.sellada, true); assert.strictEqual(v.motivo, 'tiempo')
  assert.strictEqual(v.respondieron, 2); assert.strictEqual(v.esperados, 3)
  assert.deepStrictEqual(v.sinRespuesta, ['est_c'], 'quien no respondió queda como «sin respuesta»')
  assert.strictEqual(s.aceptando, false)
  assert.deepStrictEqual([s.abreMs, s.cierraMs, s.cerradaMs], [antes.abreMs, antes.cierraMs, antes.cerradaMs], 'la hora límite de la sesión no cambia')
  assert.strictEqual(v.cerradaMs, antes.cierraMs, 'el cierre registrado es el límite original')
  assert.deepStrictEqual(await respuestasGuardadas(), respuestasAntes, 'ninguna respuesta se crea, modifica ni borra (no se inventan respuestas incorrectas)')
  assert.strictEqual(V.estadoPreguntaVivo(s, AHORA), 'cerrada')
})

await caso('una pregunta cerrada A MANO que nadie selló también se sella', async () => {
  await sembrar({ ventana: { abreMs: AHORA - 30000, cierraMs: AHORA + 60000, cerradaMs: AHORA - 20000, motivo: 'manual' } })
  assert.strictEqual((await PV.sellarSesionesVencidas({ ahora: AHORA })).preguntasSelladas, 1)
  const v = (await leer()).ventanas.p1
  assert.strictEqual(v.sellada, true); assert.strictEqual(v.motivo, 'manual'); assert.strictEqual(v.cerradaMs, AHORA - 20000)
})

await caso('modalidad externa: se sella con el conteo y sin lista de personas', async () => {
  await sembrar({ ventana: { abreMs: AHORA - 30000, cierraMs: AHORA - 20000 }, acceso: 'externo', respondieron: [], estudiantes: [] })
  await db.doc(`vivoRespuestas/${CODIGO}_p1_ext1`).set({ sesionId: CODIGO, preguntaId: 'p1', alumnoId: null, participanteKey: 'ext1', opcion: 'a', docenteId: DOCENTE })
  await PV.sellarSesionesVencidas({ ahora: AHORA })
  const v = (await leer()).ventanas.p1
  assert.deepStrictEqual([v.respondieron, v.esperados, v.sinRespuesta], [1, null, null])
})

await caso('EJECUCIONES SIMULTÁNEAS (dos barridos + el control del docente): se sella UNA vez y «aceptando» cambia una sola vez', async () => {
  await sembrar({ ventana: { abreMs: AHORA - 30000, cierraMs: AHORA - 20000 } })
  const cambios = { selladas: 0, aceptandoApagado: 0 }
  let previo = await leer()
  const detener = ref().onSnapshot((snap) => {
    const s = snap.data()
    if (s.ventanas?.p1?.sellada && !previo.ventanas?.p1?.sellada) cambios.selladas += 1
    if (previo.aceptando === true && s.aceptando === false) cambios.aceptandoApagado += 1
    previo = s
  })
  await new Promise((r) => setTimeout(r, 300))
  const resultados = await Promise.all([
    PV.sellarSesionesVencidas({ ahora: AHORA }),
    PV.sellarSesionesVencidas({ ahora: AHORA + 1 }),
    ejecutarControl(db, CODIGO, DOCENTE, 'sellar', {}, AHORA + 2),
    PV.sellarSesionesVencidas({ ahora: AHORA + 3 }),
  ])
  await new Promise((r) => setTimeout(r, 500))
  detener()
  const selladas = resultados.slice(0, 2).concat(resultados[3]).reduce((a, r) => a + r.preguntasSelladas, 0)
  assert.ok(selladas <= 1, 'a lo sumo un barrido selló (' + selladas + ')')
  assert.strictEqual(cambios.selladas, 1, 'la ventana pasó a «sellada» exactamente una vez')
  assert.strictEqual(cambios.aceptandoApagado, 1, '«aceptando» se apagó una sola vez (un solo disparo del diagnóstico)')
  const v = (await leer()).ventanas.p1
  assert.strictEqual(v.respondieron, 2); assert.deepStrictEqual(v.sinRespuesta, ['est_c'])
  assert.ok([AHORA, AHORA + 1, AHORA + 2, AHORA + 3].includes(v.selladaMs), 'una sola marca de sellado')
})

await caso('idempotente: repetir el barrido no cambia nada', async () => {
  await sembrar({ ventana: { abreMs: AHORA - 30000, cierraMs: AHORA - 20000 } })
  await PV.sellarSesionesVencidas({ ahora: AHORA })
  const uno = await leer()
  const r = await PV.sellarSesionesVencidas({ ahora: AHORA + 600000 })
  assert.strictEqual(r.preguntasSelladas, 0); assert.strictEqual(r.sesionesRevisadas, 0, 'una sesión toda sellada ni se revisa')
  assert.deepStrictEqual(await leer(), uno)
})

await caso('no toca sesiones finalizadas ni sesiones sin ventanas (sesiones anteriores)', async () => {
  await sembrar({ ventana: { abreMs: AHORA - 30000, cierraMs: AHORA - 20000 }, estado: 'finalizada' })
  assert.strictEqual((await PV.sellarSesionesVencidas({ ahora: AHORA })).preguntasSelladas, 0)
  assert.strictEqual((await leer()).ventanas.p1.sellada, undefined)
  await limpiar()
  await ref().set({ actividadId: 'act_s', asignaturaId: 'sub_s', docenteId: DOCENTE, acceso: 'externo', estado: 'activa', preguntaIndex: 0, aceptando: true, preguntas: PREGUNTAS })
  assert.deepStrictEqual(await PV.sellarSesionesVencidas({ ahora: AHORA }), { sesionesRevisadas: 0, preguntasSelladas: 0 })
})

resumen('participacion-vivo-sellado')
