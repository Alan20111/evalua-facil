// PR 2a — lectura de entregas del estudiante filtrada en el servidor, registro de
// versiones, push de calificación y solución de juegos, contra el emulador.
//
//   firebase emulators:exec --only firestore,auth --project demo-test \
//     "node test/mis-entregas.test.mjs"
//
// Se importa el handler real de api/student/[action].js y se le habla con un
// token de sesión real del emulador de Auth (mismo andamio que el resto de las
// pruebas de servidor: test/helpers/entorno.mjs).
//
// Notas centinela: 7.77 es la nota que el docente OCULTÓ; si aparece en CUALQUIER
// cuerpo de respuesta a un estudiante, hay una fuga.

import { createRequire } from 'node:module'
import {
  db, dbFn, funciones, respuestaFalsa, sesion, limpiar, caso, grupo, resumen, assert,
} from './helpers/entorno.mjs'

const require = createRequire(import.meta.url)
const { Timestamp } = require('firebase-admin/firestore')
const juegoFns = require('../functions/juego.js')
const { default: handler } = await import('../api/student/[action].js')

async function api(accion, { metodo = 'POST', cuerpo, token } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const req = { method: metodo, headers, body: cuerpo, query: { action: accion } }
  const res = respuestaFalsa()
  await handler(req, res)
  return res
}

const DOC = 'docente_uno'
const U_ALU = 'uid_alu', U_ALU2 = 'uid_alu2', U_OTRO = 'uid_otro'
const EMAIL_ALU = 'alu.e1@evalua.local', EMAIL_ALU2 = 'alu2.e1@evalua.local', EMAIL_OTRO = 'otro.e2@evalua.local'
const AHORA = Timestamp.now()
const PASADO = new Date(Date.now() - 40 * 86400000).toISOString()
const act = (extra) => ({ docenteId: DOC, asignaturaId: 'S1', parcial: 1, maxCalif: 10, oculta: false, publishedAt: PASADO, tipo: 'archivo', categoria: 'entregable', pesoCalificacion: null, ...extra })

async function sembrar() {
  await limpiar()
  await db.doc(`users/${DOC}`).set({ role: 'docente', nombre: 'Uno', escuelaId: 'E1' })
  await db.doc('subjects/S1').set({
    docenteId: DOC, escuelaId: 'E1', parciales: 3, nombre: 'Mate',
    calificacionesOcultas: { actividades: { A_OCULTA: true, A_EX_OCULTO: true, A_JUEGO_OCULTO: true }, promedios: { 2: true } },
  })
  await db.doc('subjects/S2').set({ docenteId: DOC, escuelaId: 'E2', parciales: 3, nombre: 'Otra' })
  await db.doc('activities/A_VISIBLE').set(act({ nombre: 'Visible' }))
  await db.doc('activities/A_OCULTA').set(act({ nombre: 'Oculta' }))
  await db.doc('activities/A_P2').set(act({ nombre: 'Parcial 2', parcial: 2 }))
  for (const id of ['A_EX_OK', 'A_EX_OCULTO', 'A_EX_NUNCA']) {
    await db.doc(`activities/${id}`).set(act({ nombre: id, parcial: 3, tipo: 'evaluacion', categoria: 'examen', evaluacion: { intentosPermitidos: 3, publicarRespuestas: id === 'A_EX_NUNCA' ? 'nunca' : 'inmediato' } }))
  }
  await db.doc('activities/A_OTRA').set(act({ asignaturaId: 'S2', nombre: 'De otra asignatura' }))
  const juego = { tipo: 'crucigrama', size: 2, grid: [{ row: ['A', 'B'] }, { row: ['C', 'D'] }], palabras: [] }
  for (const id of ['A_JUEGO_OK', 'A_JUEGO_OCULTO']) {
    await db.doc(`activities/${id}`).set(act({ nombre: id, parcial: 3, categoria: 'juego', tipo: 'juego', tipoJuego: 'crucigrama', juego: { estado: 'juego_confirmado', estructura: juego }, evaluacion: { intentosPermitidos: 1, publicarSolucion: 'inmediato' } }))
  }

  const alumno = (id, uid, asignaturaId, escuelaId, usuario) => db.doc(`students/${id}`).set({ asignaturaId, escuelaId, username: usuario, uid, activado: true, createdAt: Timestamp.fromDate(new Date(Date.now() - 60 * 86400000)) })
  await alumno('ST_ALU', U_ALU, 'S1', 'E1', 'ALU')
  await alumno('ST_ALU2', U_ALU2, 'S1', 'E1', 'ALU2')
  await alumno('ST_OTRO', U_OTRO, 'S2', 'E2', 'OTRO')

  const sub = (actividadId, alumnoId, extra) => db.doc(`submissions/${actividadId}_${alumnoId}`).set({ actividadId, alumnoId, estado: 'calificado', comentario: '', fechaEntrega: AHORA, historial: [], tarde: false, ...extra })
  await sub('A_VISIBLE', 'ST_ALU', { calificacion: 8, completadoSinArchivo: true })
  await sub('A_OCULTA', 'ST_ALU', {
    calificacion: 7.77, comentario: 'COMENTARIO-SECRETO', rubricaEval: [3, 3, 1], notificadoCalificacion: true,
    motivoSinEntrega: 'MOTIVO-CERO', completadoSinArchivo: true,
  })
  await sub('A_P2', 'ST_ALU', { calificacion: 9, completadoSinArchivo: true })
  await sub('A_VISIBLE', 'ST_ALU2', { calificacion: 3.33, completadoSinArchivo: true })
  await sub('A_OTRA', 'ST_OTRO', { calificacion: 5.55, completadoSinArchivo: true })
  const examen = (id, extra = {}) => sub(id, 'ST_ALU', {
    calificacion: 6.66, estadoEvaluacion: 'finalizado', intentoActual: 1, tiempoInicio: AHORA, ordenSeed: 7,
    intentos: [{ numero: 1, calificacion: 6.66, tiempoSegundos: 30 }], ...extra,
  })
  await examen('A_EX_OK'); await examen('A_EX_OCULTO'); await examen('A_EX_NUNCA')
  const resp = (idSub, extra = {}) => db.doc(`submissions/${idSub}/respuestas/q1`).set({
    opcionSeleccionada: 'b', textoRespuesta: null, otraTexto: null, respondidaEn: AHORA,
    correcta: true, respuestaCorrecta: 'b', puntosObtenidos: 2.5, comentarioDocente: 'CLAVE-SECRETA', ...extra,
  })
  for (const id of ['A_EX_OK', 'A_EX_OCULTO', 'A_EX_NUNCA']) await resp(`${id}_ST_ALU`)
  await sub('A_JUEGO_OK', 'ST_ALU', { calificacion: 4.44, estadoEvaluacion: 'finalizado', intentoActual: 1, intentos: [{ numero: 1, calificacion: 4.44, tiempoSegundos: 20 }], respuestasJuego: { celdas: { '0-0': 'A' }, encontradas: [] } })
  await sub('A_JUEGO_OCULTO', 'ST_ALU', { calificacion: 4.44, estadoEvaluacion: 'finalizado', intentoActual: 1, intentos: [{ numero: 1, calificacion: 4.44, tiempoSegundos: 20 }], respuestasJuego: { celdas: { '0-0': 'A' }, encontradas: [] } })
}

const SECRETOS = ['7.77', 'COMENTARIO-SECRETO', 'MOTIVO-CERO']

// ═══════════════════════════════════════════════════════════════════════════
grupo('mis-entregas — quién puede preguntar')
await sembrar()
const tokAlu = await sesion(U_ALU, { email: EMAIL_ALU })
const tokAlu2 = await sesion(U_ALU2, { email: EMAIL_ALU2 })
const tokOtro = await sesion(U_OTRO, { email: EMAIL_OTRO })
const tokDocente = await sesion(DOC, { email: 'docente.uno@ejemplo.com' })

await caso('sin token → 401', async () => {
  assert.strictEqual((await api('mis-entregas', { cuerpo: {} })).statusCode, 401)
})
await caso('token inválido → 401', async () => {
  assert.strictEqual((await api('mis-entregas', { cuerpo: {}, token: 'no-es-un-token' })).statusCode, 401)
})
await caso('un docente (no es @evalua.local) → 403', async () => {
  assert.strictEqual((await api('mis-entregas', { cuerpo: {}, token: tokDocente })).statusCode, 403)
})
await caso('GET → 405', async () => {
  assert.strictEqual((await api('mis-entregas', { metodo: 'GET', token: tokAlu })).statusCode, 405)
})

// ═══════════════════════════════════════════════════════════════════════════
grupo('mis-entregas — la nota oculta no sale, en ninguna forma')
const todo = await api('mis-entregas', { cuerpo: {}, token: tokAlu })

await caso('responde 200, sin caché, y solo con SUS entregas', async () => {
  assert.strictEqual(todo.statusCode, 200)
  assert.strictEqual(todo.cabeceras['cache-control'], 'no-store')
  const ids = todo.cuerpo.entregas.map((e) => e.id).sort()
  assert.ok(ids.every((i) => i.endsWith('_ST_ALU')), `entregas ajenas: ${ids.join(',')}`)
  assert.ok(!ids.some((i) => i.includes('ST_ALU2') || i.includes('ST_OTRO')))
})
await caso('NINGÚN secreto aparece en todo el cuerpo (nota 7.77, comentario, motivo)', async () => {
  const json = JSON.stringify(todo.cuerpo)
  SECRETOS.forEach((s) => assert.ok(!json.includes(s), `se coló ${s}`))
})
await caso('la entrega oculta EXISTE, sin nota, y avisa que está calificada y oculta', async () => {
  const e = todo.cuerpo.entregas.find((x) => x.actividadId === 'A_OCULTA')
  assert.ok(e, 'la entrega no debe desaparecer')
  assert.strictEqual(e.calificada, true)
  assert.strictEqual(e.notaOculta, true)
  assert.strictEqual(e.estado, 'entregado')
  ;['calificacion', 'comentario', 'rubricaEval', 'notificadoCalificacion', 'motivoSinEntrega'].forEach((k) => assert.ok(!(k in e), k))
  assert.strictEqual(e.completadoSinArchivo, true, 'lo necesario para anular/ver su entrega sí sale')
  assert.strictEqual(e.asignaturaId, 'S1')
})
await caso('la entrega con la nota visible sale íntegra', async () => {
  const e = todo.cuerpo.entregas.find((x) => x.actividadId === 'A_VISIBLE')
  assert.strictEqual(e.calificacion, 8)
  assert.strictEqual(e.notaOculta, false)
  assert.strictEqual(e.calificada, true)
})
await caso('los intentos de un examen oculto conservan la cuenta y el tiempo, no la nota', async () => {
  const e = todo.cuerpo.entregas.find((x) => x.actividadId === 'A_EX_OCULTO')
  assert.deepStrictEqual(e.intentos, [{ numero: 1, tiempoSegundos: 30 }])
  assert.strictEqual(e.intentoActual, 1)
  assert.strictEqual(e.estadoEvaluacion, 'finalizado')
  assert.strictEqual(e.ordenSeed, 7)
  assert.ok(!JSON.stringify(e).includes('6.66'))
})
await caso('los Timestamps salen como { seconds, nanoseconds } (el cliente los rehidrata)', async () => {
  const e = todo.cuerpo.entregas.find((x) => x.actividadId === 'A_EX_OK')
  assert.strictEqual(typeof e.tiempoInicio.seconds, 'number')
  assert.strictEqual(typeof e.tiempoInicio.nanoseconds, 'number')
})

// ═══════════════════════════════════════════════════════════════════════════
grupo('mis-entregas — promedios (mismas fórmulas, lo oculto solo enmascara)')
await caso('promedio del parcial 1 usa la nota oculta de verdad: (8 + 7.8) / 2 = 7.9; avisa que incluye ocultas', async () => {
  const p1 = todo.cuerpo.promedios.S1.parciales[1]
  assert.strictEqual(p1.valor, 7.9)
  assert.strictEqual(p1.conOcultas, true)
  assert.strictEqual(p1.oculto, false)
  assert.strictEqual(p1.publicado, true)
})
await caso('el promedio del parcial 2 está oculto: valor null, y no se pierde el aviso de que existe', async () => {
  const p2 = todo.cuerpo.promedios.S1.parciales[2]
  assert.strictEqual(p2.valor, null)
  assert.strictEqual(p2.oculto, true)
  assert.ok(!JSON.stringify(todo.cuerpo.promedios).includes('"valor":9'), 'el 9 del parcial 2 no debe salir')
})
await caso('el final no está oculto: sale (con el parcial 2 real dentro)', async () => {
  const f = todo.cuerpo.promedios.S1.final
  assert.strictEqual(f.oculto, false)
  assert.strictEqual(typeof f.valor, 'number')
  assert.strictEqual(f.conOcultas, true)
})
await caso('con asignaturaId también llegan los promedios; con actividadId no', async () => {
  const r = await api('mis-entregas', { cuerpo: { asignaturaId: 'S1' }, token: tokAlu })
  assert.strictEqual(r.statusCode, 200)
  assert.ok(r.cuerpo.promedios.S1)
  const a = await api('mis-entregas', { cuerpo: { actividadId: 'A_VISIBLE' }, token: tokAlu })
  assert.deepStrictEqual(a.cuerpo.promedios, {})
  assert.strictEqual(a.cuerpo.entregas.length, 1)
})

// ═══════════════════════════════════════════════════════════════════════════
grupo('mis-entregas — la identidad sale del token, nunca del cuerpo')
await caso('un cuerpo que pide las entregas de otro alumno se ignora: sigue viendo solo las suyas', async () => {
  const r = await api('mis-entregas', { cuerpo: { uid: U_ALU2, alumnoId: 'ST_ALU2', studentId: 'ST_ALU2' }, token: tokAlu })
  assert.strictEqual(r.statusCode, 200)
  assert.ok(r.cuerpo.entregas.every((e) => e.alumnoId === 'ST_ALU'))
  assert.ok(!JSON.stringify(r.cuerpo).includes('3.33'))
})
await caso('el otro alumno de la misma asignatura ve lo suyo y no lo de ALU', async () => {
  const r = await api('mis-entregas', { cuerpo: {}, token: tokAlu2 })
  assert.deepStrictEqual(r.cuerpo.entregas.map((e) => e.actividadId), ['A_VISIBLE'])
  assert.strictEqual(r.cuerpo.entregas[0].calificacion, 3.33)
})
await caso('pedir una asignatura donde no está inscrito → 403', async () => {
  assert.strictEqual((await api('mis-entregas', { cuerpo: { asignaturaId: 'S2' }, token: tokAlu })).statusCode, 403)
})
await caso('pedir una actividad de otra asignatura → 403; inexistente → 404', async () => {
  assert.strictEqual((await api('mis-entregas', { cuerpo: { actividadId: 'A_OTRA' }, token: tokAlu })).statusCode, 403)
  assert.strictEqual((await api('mis-entregas', { cuerpo: { actividadId: 'NO_EXISTE' }, token: tokAlu })).statusCode, 404)
})
await caso('ids mal formados → 400; respuestas sin actividadId → 400', async () => {
  assert.strictEqual((await api('mis-entregas', { cuerpo: { asignaturaId: 'a/b' }, token: tokAlu })).statusCode, 400)
  assert.strictEqual((await api('mis-entregas', { cuerpo: { actividadId: 42 }, token: tokAlu })).statusCode, 400)
  assert.strictEqual((await api('mis-entregas', { cuerpo: { respuestas: true }, token: tokAlu })).statusCode, 400)
})
await caso('un estudiante sin entregas ni inscripción recibe listas vacías, no un error', async () => {
  const tokNuevo = await sesion('uid_nuevo', { email: 'nuevo.e1@evalua.local' })
  const r = await api('mis-entregas', { cuerpo: {}, token: tokNuevo })
  assert.strictEqual(r.statusCode, 200)
  assert.deepStrictEqual(r.cuerpo, { ok: true, entregas: [], promedios: {} })
})

// ═══════════════════════════════════════════════════════════════════════════
grupo('mis-entregas — respuestas de un examen (reanudar, revisión y claves)')
const pedirResp = (actividadId) => api('mis-entregas', { cuerpo: { actividadId, respuestas: true }, token: tokAlu })

await caso('examen visible, finalizado y respuestas publicadas: viajan las claves y los puntos', async () => {
  const r = await pedirResp('A_EX_OK')
  const q = r.cuerpo.respuestas.find((x) => x.id === 'q1')
  assert.strictEqual(q.opcionSeleccionada, 'b')
  assert.strictEqual(q.correcta, true)
  assert.strictEqual(q.respuestaCorrecta, 'b')
  assert.strictEqual(q.puntosObtenidos, 2.5)
})
await caso('examen con la nota OCULTA: solo lo que escribió el alumno — sin claves ni puntos (se calcularía la nota)', async () => {
  const r = await pedirResp('A_EX_OCULTO')
  const q = r.cuerpo.respuestas.find((x) => x.id === 'q1')
  assert.strictEqual(q.opcionSeleccionada, 'b')
  ;['correcta', 'respuestaCorrecta', 'puntosObtenidos', 'comentarioDocente'].forEach((k) => assert.ok(!(k in q), k))
  assert.ok(!JSON.stringify(r.cuerpo).includes('CLAVE-SECRETA'))
  assert.ok(!JSON.stringify(r.cuerpo).includes('6.66'))
})
await caso('respuestas «nunca» publicadas: tampoco viajan las claves aunque la nota sea visible', async () => {
  const q = (await pedirResp('A_EX_NUNCA')).cuerpo.respuestas.find((x) => x.id === 'q1')
  assert.ok(!('correcta' in q) && !('puntosObtenidos' in q))
})
await caso('mientras el examen sigue en progreso nunca viajan las claves, y sí el id y respondidaEn para reanudar', async () => {
  await db.doc('submissions/A_EX_OK_ST_ALU').update({ estadoEvaluacion: 'en_progreso' })
  const q = (await pedirResp('A_EX_OK')).cuerpo.respuestas.find((x) => x.id === 'q1')
  assert.ok(!('correcta' in q) && !('puntosObtenidos' in q))
  assert.strictEqual(q.id, 'q1')
  assert.strictEqual(typeof q.respondidaEn.seconds, 'number')
  await db.doc('submissions/A_EX_OK_ST_ALU').update({ estadoEvaluacion: 'finalizado' })
})
await caso('una actividad sin entrega devuelve respuestas vacías', async () => {
  const r = await pedirResp('A_P2')
  assert.deepStrictEqual(r.cuerpo.respuestas.map((x) => x.id), [])
})

// ═══════════════════════════════════════════════════════════════════════════
grupo('mis-entregas — solo lee: entregas, autosave, reintentos y juegos no se tocan')
await caso('ninguna llamada modifica entregas ni respuestas', async () => {
  const foto = async () => JSON.stringify([
    (await db.collection('submissions').get()).docs.map((d) => [d.id, d.data()]).sort(),
    (await db.collection('submissions/A_EX_OK_ST_ALU/respuestas').get()).docs.map((d) => [d.id, d.data()]),
  ])
  const antes = await foto()
  await api('mis-entregas', { cuerpo: {}, token: tokAlu })
  await pedirResp('A_EX_OK'); await pedirResp('A_EX_OCULTO')
  assert.strictEqual(await foto(), antes)
})

// ═══════════════════════════════════════════════════════════════════════════
grupo('cliente-ping — versión del cliente')
const ping = (cuerpo, token = tokAlu) => api('cliente-ping', { cuerpo, token })
await caso('sin token → 401; docente → 403', async () => {
  assert.strictEqual((await api('cliente-ping', { cuerpo: { plataforma: 'web' } })).statusCode, 401)
  assert.strictEqual((await ping({ plataforma: 'web' }, tokDocente)).statusCode, 403)
})
await caso('registra la versión bajo el uid del TOKEN, aunque el cuerpo pida otro', async () => {
  const r = await ping({ plataforma: 'android', versionName: '1.0.15', buildId: 'abc123', uid: U_ALU2 })
  assert.strictEqual(r.statusCode, 200)
  assert.deepStrictEqual(r.cuerpo, { ok: true, registrado: true })
  const d = (await db.doc(`clientesAlumno/${U_ALU}`).get()).data()
  assert.strictEqual(d.plataforma, 'android')
  assert.strictEqual(d.versionName, '1.0.15')
  assert.strictEqual(d.buildId, 'abc123')
  assert.ok(d.primeraVez && d.ultimaVez)
  assert.ok(!(await db.doc(`clientesAlumno/${U_ALU2}`).get()).exists, 'no se escribe a nombre de otro')
})
await caso('la misma versión dentro de 20 horas no vuelve a escribir', async () => {
  const antes = (await db.doc(`clientesAlumno/${U_ALU}`).get()).data().ultimaVez.toMillis()
  const r = await ping({ plataforma: 'android', versionName: '1.0.15', buildId: 'abc123' })
  assert.deepStrictEqual(r.cuerpo, { ok: true, registrado: false })
  assert.strictEqual((await db.doc(`clientesAlumno/${U_ALU}`).get()).data().ultimaVez.toMillis(), antes)
})
await caso('una versión nueva sí se registra y conserva la primera vez', async () => {
  const primera = (await db.doc(`clientesAlumno/${U_ALU}`).get()).data().primeraVez.toMillis()
  const r = await ping({ plataforma: 'android', versionName: '1.0.16', buildId: 'def456' })
  assert.strictEqual(r.cuerpo.registrado, true)
  const d = (await db.doc(`clientesAlumno/${U_ALU}`).get()).data()
  assert.strictEqual(d.versionName, '1.0.16')
  assert.strictEqual(d.primeraVez.toMillis(), primera)
})
await caso('datos inválidos → 400 y no se escribe nada (plataforma, texto raro, demasiado largo)', async () => {
  assert.strictEqual((await ping({ plataforma: 'windows' }, tokOtro)).statusCode, 400)
  assert.strictEqual((await ping({ plataforma: 'web', versionName: '<script>' }, tokOtro)).statusCode, 400)
  assert.strictEqual((await ping({ plataforma: 'web', buildId: 'x'.repeat(65) }, tokOtro)).statusCode, 400)
  assert.strictEqual((await ping({ plataforma: 'web', versionName: 12 }, tokOtro)).statusCode, 400)
  assert.ok(!(await db.doc(`clientesAlumno/${U_OTRO}`).get()).exists)
})
await caso('la web (sin versionName) también se registra', async () => {
  const r = await ping({ plataforma: 'web', buildId: 'f511e459' }, tokOtro)
  assert.strictEqual(r.statusCode, 200)
  assert.strictEqual((await db.doc(`clientesAlumno/${U_OTRO}`).get()).data().plataforma, 'web')
})

// ═══════════════════════════════════════════════════════════════════════════
grupo('push «Te calificaron» — no se envía si la nota está oculta')
const F = funciones._pruebas
await caso('notaOcultaAlEstudiante: true en la oculta, false en la visible y en una actividad desconocida', async () => {
  assert.strictEqual(await F.notaOcultaAlEstudiante('A_OCULTA'), true)
  assert.strictEqual(await F.notaOcultaAlEstudiante('A_VISIBLE'), false)
  assert.strictEqual(await F.notaOcultaAlEstudiante('NO_EXISTE'), false)
})
const dispararPush = async (idSub) => {
  const snap = await dbFn.doc(`submissions/${idSub}`).get()
  await funciones.onSubmissionActualizada.run({ data: { after: snap }, params: { submissionId: idSub } })
  return (await db.doc(`submissions/${idSub}`).get()).data()
}
await caso('nota oculta: no se notifica NI se marca (un aviso posterior sigue siendo posible)', async () => {
  await db.doc('submissions/A_OCULTA_ST_ALU').update({ notificadoCalificacion: false })
  const d = await dispararPush('A_OCULTA_ST_ALU')
  assert.ok(!d.notificadoCalificacion, 'no debe marcarse como notificada')
})
await caso('nota visible: se notifica y se marca, como siempre', async () => {
  await db.doc('submissions/A_VISIBLE_ST_ALU').update({ notificadoCalificacion: false })
  const d = await dispararPush('A_VISIBLE_ST_ALU')
  assert.strictEqual(d.notificadoCalificacion, true)
})

// ═══════════════════════════════════════════════════════════════════════════
grupo('obtenerSolucionJuego — no se entrega si la nota del juego está oculta')
const pedirSolucion = (actividadId) => juegoFns._pruebas.obtenerSolucionJuegoImpl({ auth: { uid: U_ALU }, data: { actividadId } })
await caso('juego con la nota oculta → failed-precondition y sin tablero en el mensaje', async () => {
  await assert.rejects(() => pedirSolucion('A_JUEGO_OCULTO'), (e) => {
    assert.strictEqual(e.code, 'failed-precondition')
    assert.ok(/no publica el resultado/.test(e.message))
    assert.ok(!/celdas|palabra/.test(JSON.stringify(e.message)))
    return true
  })
})
await caso('juego con la nota visible → se entrega la solución como siempre', async () => {
  const r = await pedirSolucion('A_JUEGO_OK')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.celdas['0-0'], 'A')
})

resumen('mis-entregas')
