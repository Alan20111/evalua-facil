// Reto Exprés · etapa 3 — servidor en vivo contra el emulador (Firestore + Auth), sin red ni costo.
//
//   npm run test:reto
//   (= firebase emulators:exec --only firestore,auth --project demo-test "node test/reto-servidor.test.mjs")
//
// Llama a los handlers reales de /api/subject (reto-crear, reto-control, reto-unirse, reto-estado, reto-responder) y a la
// limpieza de functions/retoLimpieza.js. El reloj del servidor se sustituye (fijarRelojReto) para recorrer los 20 s de
// cada pregunta y pausas de días sin esperar. Las entradas y respuestas «simultáneas» se lanzan juntas con Promise.all,
// así que compiten de verdad por las mismas transacciones del emulador.
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import { db, limpiar, caso, grupo, resumen, assert, llamar, sesion } from './helpers/entorno.mjs'
import { handleRetoUnirse, handleRetoEstado, handleRetoResponder } from '../api/_lib/reto.js'
import { handleRetoCrear, handleRetoControl } from '../api/_lib/retoControl.js'
import { fijarRelojReto } from '../api/_lib/retoComun.js'
import examQuestions from '../api/exam/questions.js'
import { RETO_CFG, datosNuevoReto } from '../src/utils/retoExpres.js'

const require = createRequire(import.meta.url)
const { limpiarRetoDeSesion, limpiarRetoDeActividad } = require('../functions/retoLimpieza.js')

// ── Reloj ───────────────────────────────────────────────────────────────────
let AHORA = 1_800_000_000_000
fijarRelojReto(() => AHORA)
const TURNO = RETO_CFG.PREPARACION_MS + RETO_CFG.TIEMPO_RESPUESTA_MS
let INICIO = null
const abre = (i) => INICIO + i * TURNO + RETO_CFG.PREPARACION_MS
const cierra = (i) => INICIO + (i + 1) * TURNO
const DIA = 24 * 60 * 60 * 1000

// ── Datos ───────────────────────────────────────────────────────────────────
const DOC = 'doc_reto'
const DOC2 = 'doc_otro'
const S = 'sub_reto'
const ALUMNOS = {
  ana: { uid: 'u_ana', id: 'st_ana', nombre: 'Ana', apellidoPaterno: 'Pérez', apellidoMaterno: 'Luna' },
  beto: { uid: 'u_beto', id: 'st_beto', nombre: 'Beto', apellidoPaterno: 'Ramírez', apellidoMaterno: '' },
  zoe: { uid: 'u_zoe', id: 'st_zoe', nombre: 'Zoe', apellidoPaterno: 'Ortiz', apellidoMaterno: '', asignaturaId: 'otra' },
}
const tk = {}

async function crearReto(id, { modalidad, modoIdentidad = 'nombre', preguntas = 10 }) {
  const r = datosNuevoReto({ nombre: `Reto ${id}`, modalidad, modoIdentidad, parcial: 1, orden: 1, asignaturaId: S, docenteId: DOC })
  assert.ok(r.ok, r.codigo)
  await db.doc(`activities/${id}`).set(r.datos)
  for (let i = 0; i < preguntas; i++) {
    const om = i % 2 === 0
    await db.doc(`activities/${id}/preguntas/p${i}`).set({
      tipo: om ? 'opcion_multiple' : 'verdadero_falso', enunciado: `Pregunta ${i + 1}`, orden: i + 1, ponderacion: 1,
      opciones: om ? [{ id: 'a', texto: 'A' }, { id: 'b', texto: 'B' }, { id: 'c', texto: 'C' }] : [{ id: 'v', texto: 'Verdadero' }, { id: 'f', texto: 'Falso' }],
    })
    await db.doc(`activities/${id}/clave/p${i}`).set({ respuestaCorrecta: om ? 'b' : 'v', respuestaEsperada: null })
  }
}

async function preparar() {
  await limpiar()
  AHORA = 1_800_000_000_000
  INICIO = null
  await db.doc(`users/${DOC}`).set({ role: 'docente', nombre: 'Docente' })
  await db.doc(`users/${DOC2}`).set({ role: 'docente', nombre: 'Otro' })
  for (const a of Object.values(ALUMNOS)) {
    await db.doc(`students/${a.id}`).set({ uid: a.uid, asignaturaId: a.asignaturaId || S, nombre: a.nombre, apellidoPaterno: a.apellidoPaterno, apellidoMaterno: a.apellidoMaterno, activado: true })
  }
  await crearReto('r_ins', { modalidad: 'inscritos' })
  await crearReto('r_alias', { modalidad: 'inscritos', modoIdentidad: 'alias' })
  await crearReto('r_ext', { modalidad: 'externo' })
  await crearReto('r_incompleto', { modalidad: 'externo', preguntas: 9 })
  tk.doc = await sesion(DOC, { email: 'doc@prueba.test' })
  tk.doc2 = await sesion(DOC2, { email: 'otro@prueba.test' })
  for (const [k, a] of Object.entries(ALUMNOS)) tk[k] = await sesion(a.uid, { email: `${a.id}.esc@evalua.local` })
}

// ── Llamadas ────────────────────────────────────────────────────────────────
const crear = (actividadId, token = tk.doc) => llamar(handleRetoCrear, { cuerpo: { actividadId }, token })
const control = (codigo, accion, extra = {}, token = tk.doc) => llamar(handleRetoControl, { cuerpo: { codigo, accion, ...extra }, token })
const unirse = (codigo, cuerpo = {}, token) => llamar(handleRetoUnirse, { cuerpo: { codigo, ...cuerpo }, token })
const estado = (codigo, cuerpo = {}, token) => llamar(handleRetoEstado, { cuerpo: { codigo, ...cuerpo }, token })
const responder = (codigo, indice, opcion, cuerpo = {}, token) => llamar(handleRetoResponder, { cuerpo: { codigo, indice, opcion, ...cuerpo }, token })

async function sesionAbierta(actividadId) {
  const c = await crear(actividadId)
  assert.strictEqual(c.statusCode, 200, JSON.stringify(c.cuerpo))
  const codigo = c.cuerpo.codigo
  assert.strictEqual((await control(codigo, 'abrir-acceso')).statusCode, 200)
  return codigo
}
async function iniciar(codigo) {
  const r = await control(codigo, 'iniciar')
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.cuerpo))
  INICIO = (await db.doc(`retoSesiones/${codigo}`).get()).data().inicioMs
}
async function externo(codigo, alias) {
  const r = await unirse(codigo, { alias })
  assert.strictEqual(r.statusCode, 200, `${alias}: ${JSON.stringify(r.cuerpo)}`)
  return r.cuerpo.token
}
const contar = async (col, codigo) => (await db.collection(col).where('sesionId', '==', codigo).get()).size

// ═════════════════════════════════════════════════════════════════════════════
grupo('A. Crear la sesión')

await caso('el docente dueño crea la sesión: preguntas públicas sin clave y la clave congelada aparte', async () => {
  await preparar()
  const c = await crear('r_ext')
  assert.strictEqual(c.statusCode, 200)
  assert.match(c.cuerpo.codigo, /^[A-HJ-KM-NP-Z2-9]{10}$/)
  const s = (await db.doc(`retoSesiones/${c.cuerpo.codigo}`).get()).data()
  assert.deepStrictEqual([s.estado, s.accesoAbierto, s.modalidad, s.modoIdentidad, s.calificable, s.preguntas.length], ['espera', false, 'externo', 'alias', false, 10])
  assert.ok(!JSON.stringify(s).includes('respuestaCorrecta'))
  const k = (await db.doc(`retoClaves/${c.cuerpo.codigo}`).get()).data()
  assert.deepStrictEqual([k.claves.p0.respuestaCorrecta, k.claves.p1.respuestaCorrecta, k.docenteId, k.actividadId], ['b', 'v', DOC, 'r_ext'])
})

await caso('otro docente, sin sesión, un reto incompleto o una actividad que no es reto: no se crea', async () => {
  await preparar()
  assert.strictEqual((await crear('r_ext', tk.doc2)).statusCode, 403)
  assert.strictEqual((await crear('r_ext', null)).statusCode, 401)
  const inc = await crear('r_incompleto')
  assert.deepStrictEqual([inc.statusCode, inc.cuerpo.codigo], [409, 'PREGUNTAS_INCOMPLETAS'])
  await db.doc('activities/cuest').set({ categoria: 'cuestionario', docenteId: DOC, asignaturaId: S })
  assert.strictEqual((await crear('cuest')).statusCode, 404)
  assert.strictEqual((await db.collection('retoSesiones').get()).size, 0)
})

await caso('T6: una sola sesión sin finalizar por reto, también con dos pedidos a la vez; finalizada, se crea otra', async () => {
  await preparar()
  const [a, b] = await Promise.all([crear('r_ext'), crear('r_ext')])
  assert.deepStrictEqual([a.statusCode, b.statusCode].sort(), [200, 409])
  const codigo = (a.statusCode === 200 ? a : b).cuerpo.codigo
  assert.strictEqual((await crear('r_ext')).cuerpo.codigo, 'SESION_ABIERTA')
  assert.strictEqual((await control(codigo, 'terminar', { confirmado: true })).statusCode, 200) // terminar sin empezar
  assert.strictEqual((await db.doc(`retoSesiones/${codigo}`).get()).data().estado, 'finalizada')
  assert.strictEqual((await crear('r_ext')).statusCode, 200)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('B. Acceso, códigos y tokens')

await caso('código mal formado o inexistente: 404 sin más datos', async () => {
  await preparar()
  for (const codigo of ['XYZ', '', 'ABCDEFGHJK', 'abcdefghjk0']) {
    const r = await unirse(codigo, { alias: 'Tigre' })
    assert.strictEqual(r.statusCode, 404, codigo)
    assert.deepStrictEqual(Object.keys(r.cuerpo), ['error'])
  }
})

await caso('acceso cerrado: nadie nuevo entra; abierto, el externo recibe un token que el servidor no guarda', async () => {
  await preparar()
  const c = (await crear('r_ext')).cuerpo.codigo
  const cerrado = await unirse(c, { alias: 'Tigre' })
  assert.deepStrictEqual([cerrado.statusCode, cerrado.cuerpo.codigo], [409, 'ACCESO_CERRADO'])
  await control(c, 'abrir-acceso')
  const r = await unirse(c, { alias: 'Tigre' })
  assert.strictEqual(r.statusCode, 200)
  assert.match(r.cuerpo.token, /^[0-9a-f]{64}$/)
  const [p] = (await db.collection('retoParticipantes').where('sesionId', '==', c).get()).docs.map((d) => d.data())
  assert.ok(!JSON.stringify(p).includes(r.cuerpo.token), 'el token quedó guardado')
  assert.strictEqual(p.tokenHash, crypto.createHash('sha256').update(r.cuerpo.token).digest('hex'))
  for (const campo of ['alumnoId', 'nombre']) assert.ok(!(campo in p), `el externo lleva ${campo}`)
  assert.deepStrictEqual([p.alias, p.modalidad, p.expulsado, p.docenteId, p.actividadId], ['Tigre', 'externo', false, DOC, 'r_ext'])
})

await caso('reconexión con el acceso cerrado: el que ya estaba vuelve con su token; uno nuevo no entra', async () => {
  await preparar()
  const c = await sesionAbierta('r_ext')
  const token = await externo(c, 'Tigre')
  await control(c, 'cerrar-acceso')
  const vuelta = await unirse(c, { token })
  assert.deepStrictEqual([vuelta.statusCode, vuelta.cuerpo.nuevo, vuelta.cuerpo.nombreVisible, vuelta.cuerpo.token], [200, false, 'Tigre', undefined])
  assert.strictEqual((await unirse(c, { alias: 'León' })).cuerpo.codigo, 'ACCESO_CERRADO')
  assert.strictEqual(await contar('retoParticipantes', c), 1)
})

await caso('token falso o de otra competencia: no actúa como nadie', async () => {
  await preparar()
  const c1 = await sesionAbierta('r_ext')
  const t1 = await externo(c1, 'Tigre')
  await iniciar(c1)
  AHORA = abre(0) + 100
  const falso = crypto.randomBytes(32).toString('hex')
  for (const token of [falso, 'no-es-token', 'a'.repeat(64)]) {
    const e = await estado(c1, { token })
    assert.deepStrictEqual([e.statusCode, e.cuerpo.participante, e.cuerpo.pregunta], [200, null, null])
    assert.strictEqual((await responder(c1, 0, 'b', { token })).statusCode, 403)
  }
  // El token de c1 no sirve en otra competencia.
  await crearReto('r_ext2', { modalidad: 'externo' })
  const c2 = await sesionAbierta('r_ext2')
  assert.strictEqual((await estado(c2, { token: t1 })).cuerpo.participante, null)
  assert.strictEqual(await contar('retoRespuestas', c1), 0)
})

await caso('45 externos entran a la vez: exactamente 40 dentro, contador en 40 y 5 rechazados por cupo', async () => {
  await preparar()
  const c = await sesionAbierta('r_ext')
  const rs = await Promise.all(Array.from({ length: 45 }, (_, i) => unirse(c, { alias: `Jugador ${i + 1}` })))
  const ok = rs.filter((r) => r.statusCode === 200).length
  const llenos = rs.filter((r) => r.cuerpo.codigo === 'CUPO_LLENO').length
  assert.deepStrictEqual([ok, llenos], [40, 5], JSON.stringify(rs.filter((r) => r.statusCode !== 200 && r.cuerpo.codigo !== 'CUPO_LLENO').map((r) => r.cuerpo)))
  const lugares = (await db.collection('retoCupos').where('sesionId', '==', c).get()).docs.map((d) => d.data().lugar).sort((a, b) => a - b)
  assert.deepStrictEqual(lugares, Array.from({ length: 40 }, (_, i) => i + 1)) // los lugares 1 a 40, ninguno repetido ni de más
  assert.strictEqual(await contar('retoParticipantes', c), 40)
  assert.strictEqual(await contar('retoAlias', c), 40)
})

await caso('alias: el mismo a la vez entra una sola vez; ofensivo, reservado o sin letras no entra', async () => {
  await preparar()
  const c = await sesionAbierta('r_ext')
  const rs = await Promise.all(Array.from({ length: 10 }, () => unirse(c, { alias: 'Tigre' })))
  assert.strictEqual(rs.filter((r) => r.statusCode === 200).length, 1)
  assert.ok(rs.filter((r) => r.statusCode !== 200).every((r) => r.cuerpo.codigo === 'OCUPADO'))
  assert.strictEqual((await unirse(c, { alias: 'tigre' })).cuerpo.codigo, 'OCUPADO') // sin distinguir mayúsculas
  assert.strictEqual((await unirse(c, { alias: 'ElIdiota' })).cuerpo.codigo, 'OFENSIVO')
  assert.strictEqual((await unirse(c, { alias: 'Profe Juan' })).cuerpo.codigo, 'RESERVADO')
  assert.strictEqual((await unirse(c, { alias: '123' })).cuerpo.codigo, 'SIN_LETRAS')
  assert.strictEqual(await contar('retoCupos', c), 1) // los rechazados no gastan lugar
})

await caso('inscritos: sin sesión 401; docente u otra asignatura 403; el inscrito entra con su nombre y reconecta en otro dispositivo', async () => {
  await preparar()
  const c = await sesionAbierta('r_ins')
  assert.strictEqual((await unirse(c, {}, null)).statusCode, 401)
  assert.strictEqual((await unirse(c, {}, tk.doc)).statusCode, 403)
  assert.strictEqual((await unirse(c, {}, tk.zoe)).statusCode, 403)
  const a = await unirse(c, {}, tk.ana)
  assert.deepStrictEqual([a.statusCode, a.cuerpo.nuevo, a.cuerpo.nombreVisible, a.cuerpo.token], [200, true, 'Ana Pérez Luna', undefined])
  await control(c, 'cerrar-acceso')
  const otroDispositivo = await sesion(ALUMNOS.ana.uid) // nuevo token de la misma cuenta
  assert.deepStrictEqual([(await unirse(c, {}, otroDispositivo)).cuerpo.nuevo], [false])
  assert.strictEqual((await unirse(c, {}, tk.beto)).cuerpo.codigo, 'ACCESO_CERRADO')
  const p = (await db.doc(`retoParticipantes/${c}_st_ana`).get()).data()
  assert.deepStrictEqual([p.alumnoId, p.nombre, p.modalidad], ['st_ana', 'Ana Pérez Luna', 'inscritos'])
})

await caso('inscritos con alias (T4): no puede ser el nombre real de ningún inscrito, incluido el propio', async () => {
  await preparar()
  const c = await sesionAbierta('r_alias')
  assert.strictEqual((await unirse(c, { alias: 'Beto Ramírez' }, tk.ana)).cuerpo.codigo, 'SUPLANTACION') // compañero que aún no entra
  assert.strictEqual((await unirse(c, { alias: 'Ana Perez' }, tk.ana)).cuerpo.codigo, 'SUPLANTACION') // el propio
  const ok = await unirse(c, { alias: 'Estrella' }, tk.ana)
  assert.deepStrictEqual([ok.statusCode, ok.cuerpo.nombreVisible], [200, 'Estrella'])
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('C. Tiempo, respuestas y pausas')

await caso('la pregunta solo se envía abierta, sin clave; una respuesta por pregunta aunque lleguen 20 a la vez', async () => {
  await preparar()
  const c = await sesionAbierta('r_ext')
  const t = await externo(c, 'Tigre')
  await iniciar(c)
  AHORA = abre(0) - 1 // preparación
  const prep = await estado(c, { token: t })
  assert.deepStrictEqual([prep.cuerpo.sesion.fase, prep.cuerpo.pregunta], ['preparando', null])
  assert.strictEqual((await responder(c, 0, 'b', { token: t })).cuerpo.codigo, 'FUERA_DE_TIEMPO')
  AHORA = abre(0) + 500
  const e = await estado(c, { token: t })
  assert.deepStrictEqual([e.cuerpo.sesion.fase, e.cuerpo.pregunta.indice, e.cuerpo.pregunta.enunciado, e.cuerpo.yaRespondio], ['abierta', 0, 'Pregunta 1', false])
  assert.ok(!JSON.stringify(e.cuerpo).includes('respuestaCorrecta'))
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => responder(c, 0, i % 2 ? 'a' : 'b', { token: t })))
  assert.ok(rs.every((r) => r.statusCode === 200), JSON.stringify(rs.map((r) => r.cuerpo)))
  assert.strictEqual(rs.filter((r) => r.cuerpo.yaRespondio === false).length, 1)
  assert.strictEqual(await contar('retoRespuestas', c), 1)
  assert.strictEqual((await estado(c, { token: t })).cuerpo.yaRespondio, true)
  assert.strictEqual((await responder(c, 0, 'z', { token: t })).statusCode, 400) // opción inexistente
  AHORA = cierra(0) + 1
  assert.strictEqual((await responder(c, 1, 'v', { token: t })).cuerpo.codigo, 'FUERA_DE_TIEMPO') // la 2 aún prepara
  AHORA = cierra(1) + 1
  assert.strictEqual((await responder(c, 1, 'v', { token: t })).cuerpo.codigo, 'FUERA_DE_TIEMPO') // la 2 ya cerró
})

await caso('pausa de días: nadie responde, nada termina; al reanudar sigue con el tiempo que faltaba', async () => {
  await preparar()
  const c = await sesionAbierta('r_ext')
  const t = await externo(c, 'Tigre')
  await iniciar(c)
  AHORA = abre(2) + 1000
  await control(c, 'pausar')
  for (const espera of [1, 3 * DIA, 40 * DIA]) {
    AHORA = abre(2) + 1000 + espera
    const e = await estado(c, { token: t })
    assert.deepStrictEqual([e.cuerpo.sesion.fase, e.cuerpo.sesion.estado, e.cuerpo.pregunta], ['pausada', 'en_curso', null])
    assert.strictEqual((await responder(c, 2, 'b', { token: t })).cuerpo.codigo, 'PAUSADA')
  }
  await control(c, 'reanudar')
  const e = await estado(c, { token: t })
  assert.deepStrictEqual([e.cuerpo.sesion.fase, e.cuerpo.pregunta.indice, e.cuerpo.sesion.restanteMs], ['abierta', 2, RETO_CFG.TIEMPO_RESPUESTA_MS - 1000])
  assert.strictEqual((await responder(c, 2, 'b', { token: t })).statusCode, 200)
  assert.strictEqual((await db.doc(`retoSesiones/${c}`).get()).data().estado, 'en_curso')
})

await caso('ingreso tardío: entra en la pregunta 4, no responde las anteriores y sí la actual', async () => {
  await preparar()
  const c = await sesionAbierta('r_ext')
  await iniciar(c)
  AHORA = abre(3) + 200
  const t = await externo(c, 'Tarde')
  assert.strictEqual((await responder(c, 2, 'b', { token: t })).cuerpo.codigo, 'FUERA_DE_TIEMPO')
  assert.strictEqual((await responder(c, 3, 'v', { token: t })).statusCode, 200)
})

await caso('expulsar: el expulsado no responde ni vuelve con su token; con otro dispositivo entra como nuevo (E4); el cupo no se libera', async () => {
  await preparar()
  const c = await sesionAbierta('r_ext')
  const t = await externo(c, 'Tigre')
  await iniciar(c)
  const [p] = (await db.collection('retoParticipantes').where('sesionId', '==', c).get()).docs
  assert.strictEqual((await control(c, 'expulsar', { participanteId: p.id }, tk.doc2)).statusCode, 403) // otro docente
  assert.strictEqual((await control(c, 'expulsar', { participanteId: p.id })).statusCode, 200)
  AHORA = abre(0) + 100
  assert.deepStrictEqual([(await responder(c, 0, 'b', { token: t })).statusCode], [403])
  assert.strictEqual((await unirse(c, { token: t })).cuerpo.codigo, 'EXPULSADO')
  const e = await estado(c, { token: t })
  assert.deepStrictEqual([e.cuerpo.participante.expulsado, e.cuerpo.pregunta], [true, null])
  assert.strictEqual((await unirse(c, { alias: 'Tigre Dos' })).statusCode, 200) // otro dispositivo, acceso abierto
  assert.strictEqual(await contar('retoCupos', c), 2)
})

await caso('inscrito expulsado no vuelve desde ningún dispositivo', async () => {
  await preparar()
  const c = await sesionAbierta('r_ins')
  await unirse(c, {}, tk.ana)
  await control(c, 'expulsar', { participanteId: `${c}_st_ana` })
  assert.strictEqual((await unirse(c, {}, await sesion(ALUMNOS.ana.uid))).cuerpo.codigo, 'EXPULSADO')
})

await caso('renombrar: el docente cambia un alias; no a uno ocupado, ofensivo ni en una competencia con nombre real', async () => {
  await preparar()
  const c = await sesionAbierta('r_ext')
  await externo(c, 'Tigre')
  await externo(c, 'León')
  const tigre = `${c}_x` // prefijo
  const [pTigre] = (await db.collection('retoParticipantes').where('alias', '==', 'Tigre').get()).docs
  assert.ok(pTigre.id.startsWith(tigre))
  assert.strictEqual((await control(c, 'renombrar', { participanteId: pTigre.id, alias: 'León' })).cuerpo.codigo, 'OCUPADO')
  assert.strictEqual((await control(c, 'renombrar', { participanteId: pTigre.id, alias: 'Imbécil' })).cuerpo.codigo, 'OFENSIVO')
  assert.strictEqual((await control(c, 'renombrar', { participanteId: pTigre.id, alias: 'Puma' })).statusCode, 200)
  assert.strictEqual((await db.doc(`retoParticipantes/${pTigre.id}`).get()).data().alias, 'Puma')
  assert.strictEqual((await unirse(c, { alias: 'Tigre' })).statusCode, 200) // el alias viejo quedó libre
  const ci = await sesionAbierta('r_ins')
  await unirse(ci, {}, tk.ana)
  assert.strictEqual((await control(ci, 'renombrar', { participanteId: `${ci}_st_ana`, alias: 'Puma' })).cuerpo.codigo, 'SIN_ALIAS')
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('D. Fin de la competencia y registro definitivo')

// Escenario completo: 2 externos responden las 10 preguntas; Tigre acierta todo, León solo las pares.
async function jugarCompleto(codigo, tokens) {
  for (let i = 0; i < 10; i++) {
    AHORA = abre(i) + 300
    const correcta = i % 2 === 0 ? 'b' : 'v'
    const otra = i % 2 === 0 ? 'a' : 'f'
    await responder(codigo, i, correcta, { token: tokens.tigre })
    await responder(codigo, i, i % 2 === 0 ? correcta : otra, { token: tokens.leon })
  }
}

await caso('fin natural: la primera consulta tras la última pregunta genera el registro, una sola vez aunque consulten 15 a la vez', async () => {
  await preparar()
  const c = await sesionAbierta('r_ext')
  const tokens = { tigre: await externo(c, 'Tigre'), leon: await externo(c, 'León') }
  await iniciar(c)
  await jugarCompleto(c, tokens)
  AHORA = cierra(9) + 10
  assert.strictEqual((await db.doc(`retoResultados/${c}`).get()).exists, false) // nadie lo calculó todavía
  const rs = await Promise.all(Array.from({ length: 15 }, (_, i) => estado(c, { token: i % 2 ? tokens.tigre : tokens.leon })))
  assert.ok(rs.every((r) => r.statusCode === 200))
  const s = (await db.doc(`retoSesiones/${c}`).get()).data()
  assert.deepStrictEqual([s.estado, s.accesoAbierto, Number.isInteger(s.finalizadaMs), 'finalizandoMarca' in s], ['finalizada', false, true, false])
  const r = (await db.doc(`retoResultados/${c}`).get()).data()
  assert.deepStrictEqual(r.clasificacion.map((f) => [f.nombreVisible, f.aciertos, f.posicion]), [['Tigre', 10, 1], ['León', 5, 2]])
  assert.deepStrictEqual([r.realizadas, r.descartadas.duplicadas, r.docenteId, r.modalidad], [10, 0, DOC, 'externo'])
  const fin = (await estado(c, { token: tokens.leon })).cuerpo.resultados
  assert.deepStrictEqual([fin.propia.posicion, fin.propia.aciertos, fin.top.length, 'correccion' in fin], [2, 5, 2, false])
  assert.ok(!JSON.stringify(fin).includes('respuestaCorrecta'), 'un externo recibió la clave')
})

await caso('inscritos: al final cada uno ve su corrección; durante la competencia, nunca la clave', async () => {
  await preparar()
  const c = await sesionAbierta('r_ins')
  await unirse(c, {}, tk.ana)
  await iniciar(c)
  for (let i = 0; i < 10; i++) {
    AHORA = abre(i) + 300
    const e = await estado(c, {}, tk.ana)
    assert.ok(!JSON.stringify(e.cuerpo).includes('respuestaCorrecta'))
    await responder(c, i, i % 2 === 0 ? 'b' : 'v', {}, tk.ana)
  }
  AHORA = cierra(9) + 1
  const cuerpoFin = (await estado(c, {}, tk.ana)).cuerpo
  const fin = cuerpoFin.resultados
  assert.deepStrictEqual([fin.propia.aciertos, fin.correccion.length, fin.correccion[0].respuestaCorrecta], [10, 10, 'b'])
  // Etapa 4: el texto de las preguntas realizadas, para leer la corrección.
  assert.deepStrictEqual([cuerpoFin.preguntas.length, cuerpoFin.preguntas[0].enunciado], [10, 'Pregunta 1'])
})

await caso('corrección del inscrito tras terminar antes: solo el texto de las preguntas realizadas; externos, ninguno', async () => {
  await preparar()
  const c = await sesionAbierta('r_ins')
  await unirse(c, {}, tk.ana)
  await iniciar(c)
  AHORA = abre(2) + 100 // la 3 está abierta: no cuenta ni se muestra
  await control(c, 'terminar', { confirmado: true })
  const cuerpo = (await estado(c, {}, tk.ana)).cuerpo
  assert.deepStrictEqual(cuerpo.preguntas.map((q) => q.enunciado), ['Pregunta 1', 'Pregunta 2'])
  const ce = await sesionAbierta('r_ext')
  const t = await externo(ce, 'Tigre')
  await control(ce, 'terminar', { confirmado: true })
  assert.strictEqual('preguntas' in (await estado(ce, { token: t })).cuerpo, false)
})

await caso('terminar: sin confirmar no hace nada; confirmado, la pregunta en curso no cuenta y el registro sale al momento', async () => {
  await preparar()
  const c = await sesionAbierta('r_ext')
  const tokens = { tigre: await externo(c, 'Tigre'), leon: await externo(c, 'León') }
  await iniciar(c)
  AHORA = abre(0) + 300
  await responder(c, 0, 'b', { token: tokens.tigre })
  AHORA = abre(1) + 300
  await responder(c, 1, 'v', { token: tokens.tigre }) // la 2 está abierta cuando el docente termina
  assert.strictEqual((await control(c, 'terminar')).cuerpo.codigo, 'SIN_CONFIRMACION')
  assert.strictEqual((await db.doc(`retoSesiones/${c}`).get()).data().estado, 'en_curso')
  assert.strictEqual((await control(c, 'terminar', { confirmado: true })).statusCode, 200)
  const r = (await db.doc(`retoResultados/${c}`).get()).data()
  assert.deepStrictEqual([r.realizadas, r.descartadas.noRealizada, r.clasificacion[0].aciertos], [1, 1, 1])
  assert.strictEqual(await contar('retoRespuestas', c), 2) // la respuesta de la pregunta interrumpida se conserva
})

await caso('ya terminada: no se responde, no entra nadie, no se reanuda ni se expulsa', async () => {
  await preparar()
  const c = await sesionAbierta('r_ext')
  const t = await externo(c, 'Tigre')
  await iniciar(c)
  AHORA = cierra(9) + 1
  await control(c, 'finalizar')
  assert.strictEqual((await responder(c, 9, 'v', { token: t })).statusCode, 409)
  assert.strictEqual((await unirse(c, { alias: 'Nuevo' })).cuerpo.codigo, 'TERMINADA')
  assert.strictEqual((await control(c, 'reanudar')).cuerpo.codigo, 'FINALIZADA')
  assert.strictEqual((await control(c, 'abrir-acceso')).cuerpo.codigo, 'FINALIZADA')
  const [p] = (await db.collection('retoParticipantes').where('sesionId', '==', c).get()).docs
  assert.strictEqual((await control(c, 'expulsar', { participanteId: p.id })).cuerpo.codigo, 'FINALIZADA')
  assert.strictEqual((await unirse(c, { token: t })).cuerpo.codigo, 'TERMINADA')
})

await caso('nada se borra solo: meses después siguen la sesión, participantes, alias, respuestas y resultados', async () => {
  await preparar()
  const c = await sesionAbierta('r_ext')
  const tokens = { tigre: await externo(c, 'Tigre'), leon: await externo(c, 'León') }
  await iniciar(c)
  await jugarCompleto(c, tokens)
  AHORA = cierra(9) + 400 * DIA
  await estado(c, { token: tokens.tigre })
  assert.deepStrictEqual(await Promise.all(['retoParticipantes', 'retoRespuestas', 'retoAlias'].map((col) => contar(col, c))), [2, 20, 2])
  for (const col of ['retoSesiones', 'retoClaves', 'retoResultados']) assert.ok((await db.doc(`${col}/${c}`).get()).exists, col)
  assert.strictEqual(await contar('retoCupos', c), 2)
})

await caso('control solo para el docente dueño; acción desconocida 400', async () => {
  await preparar()
  const c = (await crear('r_ext')).cuerpo.codigo
  for (const accion of ['iniciar', 'abrir-acceso', 'terminar', 'finalizar']) {
    assert.strictEqual((await control(c, accion, { confirmado: true }, tk.doc2)).statusCode, 403, accion)
    assert.strictEqual((await control(c, accion, { confirmado: true }, tk.ana)).statusCode, 403, accion)
    assert.strictEqual((await control(c, accion, { confirmado: true }, null)).statusCode, 401, accion)
  }
  assert.strictEqual((await control(c, 'borrar-todo')).statusCode, 400)
  assert.strictEqual((await db.doc(`retoSesiones/${c}`).get()).data().estado, 'espera')
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('E. Preguntas fuera de la competencia (T3)')

await caso('/api/exam/questions no da las preguntas de un reto a un estudiante (al docente dueño sí)', async () => {
  await preparar()
  await db.doc('submissions/r_ins_st_ana').set({ alumnoId: 'st_ana', actividadId: 'r_ins', estadoEvaluacion: 'en_progreso' }) // aunque existiera
  const alumno = await llamar(examQuestions, { cuerpo: { activityId: 'r_ins' }, token: tk.ana })
  assert.strictEqual(alumno.statusCode, 403)
  assert.ok(!JSON.stringify(alumno.cuerpo).includes('Pregunta 1'))
  const docente = await llamar(examQuestions, { cuerpo: { activityId: 'r_ins' }, token: tk.doc })
  assert.deepStrictEqual([docente.statusCode, docente.cuerpo.questions.length], [200, 10])
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('F. Borrado a pedido del docente (sin borrado automático)')

await caso('borrar UNA sesión limpia solo sus datos; el reto, sus preguntas y la otra sesión quedan', async () => {
  await preparar()
  const c1 = await sesionAbierta('r_ext')
  const tokens = { tigre: await externo(c1, 'Tigre'), leon: await externo(c1, 'León') }
  await iniciar(c1)
  await jugarCompleto(c1, tokens)
  AHORA = cierra(9) + 1
  await control(c1, 'finalizar')
  const c2 = await sesionAbierta('r_ext')
  await externo(c2, 'Otro')
  await db.doc(`retoSesiones/${c1}`).delete() // lo que hace el docente; la Cloud Function corre lo siguiente
  await limpiarRetoDeSesion({ sesionId: c1 })
  assert.deepStrictEqual(await Promise.all(['retoParticipantes', 'retoRespuestas', 'retoAlias'].map((col) => contar(col, c1))), [0, 0, 0])
  for (const col of ['retoClaves', 'retoResultados']) assert.strictEqual((await db.doc(`${col}/${c1}`).get()).exists, false, col)
  assert.strictEqual(await contar('retoCupos', c1), 0)
  assert.strictEqual(await contar('retoParticipantes', c2), 1)
  assert.ok((await db.doc(`retoSesiones/${c2}`).get()).exists)
  assert.strictEqual((await db.collection('activities/r_ext/preguntas').get()).size, 10)
  assert.deepStrictEqual(await limpiarRetoDeSesion({ sesionId: c1 }), { borrados: 0 }) // idempotente
})

await caso('borrar el reto limpia todas sus sesiones y sus preguntas; los demás retos no se tocan', async () => {
  await preparar()
  const c1 = await sesionAbierta('r_ext')
  await externo(c1, 'Tigre')
  await control(c1, 'terminar', { confirmado: true })
  const c2 = await sesionAbierta('r_ext')
  await externo(c2, 'León')
  const ci = await sesionAbierta('r_ins')
  await unirse(ci, {}, tk.ana)
  await db.doc('activities/r_ext').delete()
  await limpiarRetoDeActividad({ activityId: 'r_ext' })
  for (const col of ['retoSesiones', 'retoClaves', 'retoCupos', 'retoResultados', 'retoParticipantes', 'retoAlias', 'retoRespuestas']) {
    assert.strictEqual((await db.collection(col).where('actividadId', '==', 'r_ext').get()).size, 0, col)
  }
  assert.strictEqual((await db.collection('activities/r_ext/preguntas').get()).size, 0)
  assert.strictEqual((await db.collection('activities/r_ext/clave').get()).size, 0)
  assert.ok((await db.doc(`retoSesiones/${ci}`).get()).exists)
  assert.strictEqual((await db.collection('activities/r_ins/preguntas').get()).size, 10)
})

await caso('todos los documentos del reto llevan docenteId y actividadId (borrado de cuenta y de reto)', async () => {
  await preparar()
  const c = await sesionAbierta('r_ext')
  const tokens = { tigre: await externo(c, 'Tigre'), leon: await externo(c, 'León') }
  await iniciar(c)
  await jugarCompleto(c, tokens)
  AHORA = cierra(9) + 1
  await control(c, 'finalizar')
  for (const col of ['retoSesiones', 'retoClaves', 'retoCupos', 'retoResultados', 'retoParticipantes', 'retoAlias', 'retoRespuestas']) {
    const docs = (await db.collection(col).where('docenteId', '==', DOC).get()).docs
    assert.ok(docs.length > 0, col)
    assert.ok(docs.every((d) => d.data().actividadId === 'r_ext'), `${col} sin actividadId`)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('G. Etapa 4 (D1): un inscrito encuentra su sesión desde la lista de actividades')

await caso('por actividad: sin sesiones, null; con una abierta, esa; finalizada, la más reciente con sus resultados', async () => {
  await preparar()
  const porActividad = (token, actividadId = 'r_ins') => estado(undefined, { actividadId }, token)
  const vacio = await porActividad(tk.ana)
  assert.deepStrictEqual([vacio.statusCode, vacio.cuerpo.sesion], [200, null])
  const c1 = await sesionAbierta('r_ins')
  const e1 = await porActividad(tk.ana)
  assert.deepStrictEqual([e1.cuerpo.sesion.codigo, e1.cuerpo.participante], [c1, null])
  assert.strictEqual((await unirse(c1, {}, tk.ana)).statusCode, 200)
  await iniciar(c1)
  AHORA = abre(0) + 200
  assert.strictEqual((await porActividad(tk.ana)).cuerpo.pregunta.indice, 0)
  await responder(c1, 0, 'b', {}, tk.ana)
  AHORA = cierra(9) + 1
  const fin = await porActividad(tk.ana)
  assert.deepStrictEqual([fin.cuerpo.sesion.codigo, fin.cuerpo.sesion.estado, fin.cuerpo.resultados.propia.aciertos], [c1, 'finalizada', 1])
  AHORA += 60_000
  const c2 = await sesionAbierta('r_ins') // una nueva: ahora la abierta es la que se encuentra
  assert.strictEqual((await porActividad(tk.ana)).cuerpo.sesion.codigo, c2)
})

await caso('por actividad: sin sesión, de otra asignatura, docente o reto externo → no revela nada', async () => {
  await preparar()
  const c = await sesionAbierta('r_ins')
  await sesionAbierta('r_ext')
  const porActividad = (token, actividadId = 'r_ins') => estado(undefined, { actividadId }, token)
  assert.strictEqual((await porActividad(null)).statusCode, 401)
  assert.strictEqual((await porActividad(tk.zoe)).statusCode, 403)
  assert.strictEqual((await porActividad(tk.doc)).statusCode, 403)
  const ext = await porActividad(tk.ana, 'r_ext')
  assert.strictEqual(ext.statusCode, 404)
  assert.ok(!JSON.stringify([ext.cuerpo, (await porActividad(tk.zoe)).cuerpo]).includes(c))
  for (const id of ['no_existe', 'a/b', 'cuest']) assert.strictEqual((await porActividad(tk.ana, id)).statusCode, 404, id)
})

fijarRelojReto(null)
resumen('RETO SERVIDOR')
