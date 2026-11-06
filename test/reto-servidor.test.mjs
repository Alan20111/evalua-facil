// Reto Exprés · etapa 3 — servidor en vivo contra el emulador (Firestore + Auth), sin red ni costo.
//
//   npm run test:reto
//   (= firebase emulators:exec --only firestore,auth --project demo-test "node test/reto-servidor.test.mjs")
//
// Grupo J (5-nov-2026): versión 2 — cierre anticipado sin perder respuestas (también en carrera con muchas a la vez),
// clasificación a pedido, el navegador no altera el tiempo, «Mostrar respuesta correcta» nunca filtra la clave y ranking en vivo.
//
// Llama a los handlers reales de /api/subject (reto-crear, reto-control, reto-unirse, reto-estado, reto-responder) y a la
// limpieza de functions/retoLimpieza.js. El reloj del servidor se sustituye (fijarRelojReto) para recorrer el tiempo de
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

// ═════════════════════════════════════════════════════════════════════════════
grupo('H. Tiempo por pregunta (4-nov-2026)')

// p0 = 5 min, p1 = 1 min, el resto sin tiempo propio (= 20 s, como los retos anteriores).
async function conTiempos(id, tiempos) {
  for (const [i, s] of Object.entries(tiempos)) await db.doc(`activities/${id}/preguntas/p${i}`).update({ tiempoSeg: s })
}

await caso('la sesión congela el tiempo de cada pregunta; sin tiempo propio = 20 s', async () => {
  await preparar()
  await conTiempos('r_ext', { 0: 300, 1: 60 })
  const c = await crear('r_ext')
  const s = (await db.doc(`retoSesiones/${c.cuerpo.codigo}`).get()).data()
  assert.deepStrictEqual(s.preguntas.map((q) => q.tiempoSeg), [300, 60, 20, 20, 20, 20, 20, 20, 20, 20])
  // Editar el tiempo después NO cambia la sesión ya creada.
  await conTiempos('r_ext', { 0: 30 })
  assert.strictEqual((await db.doc(`retoSesiones/${c.cuerpo.codigo}`).get()).data().preguntas[0].tiempoSeg, 300)
})

await caso('un tiempo fuera de la lista impide crear la sesión (TIEMPO_INVALIDO), sin crear nada', async () => {
  await preparar()
  await conTiempos('r_ext', { 3: 45 })
  const c = await crear('r_ext')
  assert.deepStrictEqual([c.statusCode, c.cuerpo.codigo], [409, 'TIEMPO_INVALIDO'])
  assert.strictEqual((await db.collection('retoSesiones').where('actividadId', '==', 'r_ext').get()).size, 0)
})

await caso('con tiempos distintos: el estado y las respuestas siguen el turno real de cada pregunta', async () => {
  await preparar()
  await conTiempos('r_ext', { 0: 300, 1: 60 })
  const codigo = await sesionAbierta('r_ext')
  const token = await externo(codigo, 'Tigre Azul')
  await iniciar(codigo)
  const PREP = RETO_CFG.PREPARACION_MS
  const cierre0 = INICIO + PREP + 300000
  AHORA = cierre0 - 1000 // queda 1 s de la pregunta de 5 min
  let e = await estado(codigo, { token })
  assert.deepStrictEqual([e.cuerpo.sesion.fase, e.cuerpo.pregunta.indice, e.cuerpo.pregunta.tiempoSeg, e.cuerpo.sesion.restanteMs], ['abierta', 0, 300, 1000])
  assert.deepStrictEqual(e.cuerpo.sesion.tiemposSeg, [300, 60, 20, 20, 20, 20, 20, 20, 20, 20])
  assert.strictEqual((await responder(codigo, 0, 'b', { token })).statusCode, 200)
  // La pregunta 2 (1 min) abre 4 s después de cerrar la 1 y cierra 60 s después.
  AHORA = cierre0 + PREP + 30000
  e = await estado(codigo, { token })
  assert.deepStrictEqual([e.cuerpo.sesion.fase, e.cuerpo.pregunta.indice, e.cuerpo.sesion.restanteMs], ['abierta', 1, 30000])
  AHORA = cierre0 + PREP + 60000 // ya cerró
  const tarde = await responder(codigo, 1, 'v', { token })
  assert.strictEqual(tarde.statusCode, 409, 'fuera de tiempo')
  // Fin: 5 min + 1 min + 8 × 20 s, más 4 s de preparación por pregunta.
  AHORA = INICIO + 10 * PREP + 300000 + 60000 + 8 * 20000
  e = await estado(codigo, { token })
  assert.strictEqual(e.cuerpo.sesion.estado, 'finalizada')
  const res = (await db.doc(`retoResultados/${codigo}`).get()).data()
  assert.deepStrictEqual([res.realizadas, res.clasificacion[0].aciertos], [10, 1])
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('I. Clasificación provisional durante la competencia (4-nov-2026)')

const MARGEN = 1500 // MARGEN_PARCIAL_MS: se espera tras el cierre antes de calcular

await caso('externos: tras cada cierre, su lugar, puntos, total y qué le falta; nada de claves, ids ni respuestas', async () => {
  await preparar()
  const codigo = await sesionAbierta('r_ext')
  const [ta, tb, tc] = [await externo(codigo, 'Tigre Azul'), await externo(codigo, 'Puma Rojo'), await externo(codigo, 'Lince Gris')]
  await iniciar(codigo)
  AHORA = abre(0) + 1000
  assert.strictEqual((await responder(codigo, 0, 'b', { token: ta })).statusCode, 200) // acierta
  assert.strictEqual((await responder(codigo, 0, 'a', { token: tb })).statusCode, 200) // falla
  // Mientras la pregunta está abierta, y justo al cerrar (dentro del margen), todavía no hay clasificación.
  let e = await estado(codigo, { token: ta, parcialVisto: 0 })
  assert.strictEqual(e.cuerpo.parcial, undefined)
  AHORA = cierra(0) + 500
  e = await estado(codigo, { token: ta, parcialVisto: 0 })
  assert.strictEqual(e.cuerpo.parcial, undefined)
  AHORA = cierra(0) + MARGEN + 100
  const a = (await estado(codigo, { token: ta, parcialVisto: 0 })).cuerpo.parcial
  assert.deepStrictEqual([a.cerradas, a.propia.posicion, a.propia.aciertos, a.totalParticipantes], [1, 1, 1, 3])
  assert.deepStrictEqual(a.siguiente, { primero: true, empatados: 0 })
  const b = (await estado(codigo, { token: tb, parcialVisto: 0 })).cuerpo.parcial
  assert.deepStrictEqual([b.propia.posicion, b.propia.aciertos], [2, 0])
  assert.deepStrictEqual(b.siguiente, { primero: false, posicion: 1, faltan: 1 })
  const c = (await estado(codigo, { token: tc, parcialVisto: 0 })).cuerpo.parcial // no respondió: 0 puntos, empatado
  assert.deepStrictEqual([c.propia.posicion, c.propia.aciertos], [2, 0])
  assert.deepStrictEqual(c.top.map((f) => [f.posicion, f.nombreVisible, f.aciertos]), [[1, 'Tigre Azul', 1], [2, 'Lince Gris', 0], [2, 'Puma Rojo', 0]])
  for (const v of [a, b, c]) {
    const texto = JSON.stringify(v)
    for (const prohibido of ['participanteId', codigo, 'respuestaCorrecta', 'opcionSeleccionada', 'correccion', 'claves']) assert.ok(!texto.includes(prohibido), prohibido)
  }
  // Ya la tiene: no se vuelve a mandar.
  assert.strictEqual((await estado(codigo, { token: ta, parcialVisto: 1 })).cuerpo.parcial, undefined)
})

await caso('la pregunta abierta nunca entra; al cerrarse, sí', async () => {
  await preparar()
  const codigo = await sesionAbierta('r_ext')
  const ta = await externo(codigo, 'Tigre Azul')
  const tb = await externo(codigo, 'Puma Rojo')
  await iniciar(codigo)
  AHORA = abre(0) + 1000
  await responder(codigo, 0, 'b', { token: ta })
  AHORA = abre(1) + 1000 // ya cerró la 1; la 2 está abierta
  await responder(codigo, 1, 'v', { token: tb }) // Puma acierta la abierta
  let p = (await estado(codigo, { token: tb, parcialVisto: 0 })).cuerpo.parcial
  assert.deepStrictEqual([p.cerradas, p.propia.aciertos, p.propia.posicion], [1, 0, 2])
  AHORA = cierra(1) + MARGEN + 100
  p = (await estado(codigo, { token: tb, parcialVisto: 1 })).cuerpo.parcial
  assert.deepStrictEqual([p.cerradas, p.propia.aciertos, p.propia.posicion], [2, 1, 1])
  assert.deepStrictEqual(p.siguiente, { primero: true, empatados: 1 })
})

await caso('40 consultas a la vez tras un cierre: se calcula una sola vez y queda guardada sin marca pendiente', async () => {
  await preparar()
  const codigo = await sesionAbierta('r_ext')
  const tokens = []
  for (let i = 0; i < 5; i++) tokens.push(await externo(codigo, `Jugador ${String.fromCharCode(65 + i)}`))
  await iniciar(codigo)
  AHORA = abre(0) + 1000
  await responder(codigo, 0, 'b', { token: tokens[0] })
  AHORA = cierra(0) + MARGEN + 100
  const todas = await Promise.all(Array.from({ length: 40 }, (_, i) => estado(codigo, { token: tokens[i % 5], parcialVisto: 0 })))
  assert.ok(todas.every((r) => r.statusCode === 200))
  const doc = (await db.doc(`retoParcial/${codigo}`).get()).data()
  assert.deepStrictEqual([doc.cerradas, doc.clasificacion.length, doc.docenteId, doc.actividadId, doc.sesionId], [1, 5, DOC, 'r_ext', codigo])
  assert.strictEqual(doc.calculandoMarca, undefined)
  const calculado = doc.calculadoMs
  AHORA += 3000 // más consultas de la misma pregunta: no se recalcula
  await Promise.all(tokens.map((token) => estado(codigo, { token, parcialVisto: 0 })))
  assert.strictEqual((await db.doc(`retoParcial/${codigo}`).get()).data().calculadoMs, calculado)
})

await caso('inscritos: el nombre visible, el expulsado deja de verla y sale de la lista; final con TODOS los lugares', async () => {
  await preparar()
  const codigo = await sesionAbierta('r_ins')
  assert.strictEqual((await unirse(codigo, {}, tk.ana)).statusCode, 200)
  assert.strictEqual((await unirse(codigo, {}, tk.beto)).statusCode, 200)
  await iniciar(codigo)
  AHORA = abre(0) + 1000
  await responder(codigo, 0, 'b', {}, tk.beto)
  AHORA = cierra(0) + MARGEN + 100
  let p = (await estado(codigo, { parcialVisto: 0 }, tk.ana)).cuerpo.parcial
  assert.deepStrictEqual(p.top.map((f) => [f.posicion, f.nombreVisible, f.aciertos]), [[1, 'Beto Ramírez', 1], [2, 'Ana Pérez Luna', 0]])
  assert.strictEqual(JSON.stringify(p).includes('respuestaCorrecta'), false) // ni a un inscrito, hasta el final
  await control(codigo, 'expulsar', { participanteId: `${codigo}_st_beto` })
  AHORA = cierra(1) + MARGEN + 100
  assert.strictEqual((await estado(codigo, { parcialVisto: 1 }, tk.beto)).cuerpo.parcial, undefined)
  p = (await estado(codigo, { parcialVisto: 1 }, tk.ana)).cuerpo.parcial
  assert.deepStrictEqual([p.cerradas, p.totalParticipantes, p.propia.posicion], [2, 1, 1])
  AHORA = cierra(9) + 1
  const fin = (await estado(codigo, {}, tk.ana)).cuerpo
  assert.strictEqual(fin.parcial, undefined) // terminada: ya no hay provisional
  assert.deepStrictEqual([fin.resultados.totalParticipantes, fin.resultados.top.length, fin.resultados.top[0].esPropia], [1, 1, true])
})

await caso('borrar la sesión también borra su clasificación provisional', async () => {
  await preparar()
  const codigo = await sesionAbierta('r_ext')
  const ta = await externo(codigo, 'Tigre Azul')
  await iniciar(codigo)
  AHORA = cierra(0) + MARGEN + 100
  await estado(codigo, { token: ta, parcialVisto: 0 })
  assert.ok((await db.doc(`retoParcial/${codigo}`).get()).exists)
  await db.doc(`retoSesiones/${codigo}`).delete()
  await limpiarRetoDeSesion({ sesionId: codigo })
  assert.strictEqual((await db.doc(`retoParcial/${codigo}`).get()).exists, false)
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('J. Versión 2: el docente marca el ritmo (5-nov-2026)')

const PREP_MS = RETO_CFG.PREPARACION_MS
const leerSes = async (codigo) => (await db.doc(`retoSesiones/${codigo}`).get()).data()
const respuestasDe = async (codigo, indice) => (await db.collection('retoRespuestas').where('sesionId', '==', codigo).where('indice', '==', indice).get()).docs.map((d) => d.data())
const conRevelar = (id, valor) => db.doc(`activities/${id}`).update({ 'reto.mostrarRespuestaCorrecta': valor })

await caso('la sesión nace en la versión 2 y congela «Mostrar respuesta correcta» de la actividad (sí / no / sin la opción)', async () => {
  await preparar()
  const s0 = await leerSes((await crear('r_ins')).cuerpo.codigo)
  assert.deepStrictEqual([s0.version, s0.cortes, s0.clasificacionPendiente, s0.revelar], [2, [], null, null])
  await conRevelar('r_ext', false)
  await conRevelar('r_alias', true)
  assert.strictEqual((await leerSes((await crear('r_ext')).cuerpo.codigo)).revelar, 'no')
  const cAlias = (await crear('r_alias')).cuerpo.codigo
  assert.strictEqual((await leerSes(cAlias)).revelar, 'si')
  // Cambiarla en la actividad después no toca una competencia ya creada.
  await conRevelar('r_alias', false)
  assert.strictEqual((await leerSes(cAlias)).revelar, 'si')
})

await caso('cerrar antes de tiempo: se conserva lo recibido, se rechaza lo posterior y todos pasan a la siguiente', async () => {
  await preparar()
  const codigo = await sesionAbierta('r_ext')
  const [ta, tb, tc] = [await externo(codigo, 'Tigre Azul'), await externo(codigo, 'Puma Rojo'), await externo(codigo, 'Lince Gris')]
  await iniciar(codigo)
  AHORA = abre(0) + 2000
  assert.strictEqual((await responder(codigo, 0, 'b', { token: ta })).statusCode, 200)
  AHORA = abre(0) + 3000
  assert.strictEqual((await responder(codigo, 0, 'a', { token: tb })).statusCode, 200)
  AHORA = abre(0) + 5000
  assert.strictEqual((await control(codigo, 'cerrar-pregunta', { indice: 0 }, tk.doc2)).statusCode, 403) // otro docente
  const r = await control(codigo, 'cerrar-pregunta', { indice: 0 })
  assert.deepStrictEqual([r.statusCode, r.cuerpo.fase, r.cuerpo.indice], [200, 'preparando', 1])
  const tarde = await responder(codigo, 0, 'b', { token: tc })
  assert.deepStrictEqual([tarde.statusCode, tarde.cuerpo.codigo], [409, 'FUERA_DE_TIEMPO'])
  // Doble clic: no salta la segunda pregunta.
  assert.strictEqual((await control(codigo, 'cerrar-pregunta', { indice: 0 })).statusCode, 200)
  assert.strictEqual((await leerSes(codigo)).cortes.length, 1)
  assert.strictEqual((await control(codigo, 'cerrar-pregunta', { indice: 1 })).cuerpo.codigo, 'NO_ABIERTA')
  // Todos los celulares ven lo mismo: la siguiente pregunta, 4 s después del cierre.
  for (const t of [ta, tb, tc]) {
    const e = (await estado(codigo, { token: t })).cuerpo
    assert.deepStrictEqual([e.sesion.fase, e.sesion.indice, e.pregunta], ['preparando', 1, null])
  }
  AHORA = abre(0) + 5000 + PREP_MS
  for (const t of [ta, tb, tc]) assert.strictEqual((await estado(codigo, { token: t })).cuerpo.pregunta.indice, 1)
  // Las dos respuestas recibidas antes cuentan; la provisional ya lo refleja con su tiempo.
  AHORA += 1600
  const p = (await estado(codigo, { token: ta, parcialVisto: 0 })).cuerpo.parcial
  assert.deepStrictEqual(p.top.map((f) => [f.nombreVisible, f.aciertos, f.tiempoDecimas]), [['Tigre Azul', 1, 20], ['Lince Gris', 0, 0], ['Puma Rojo', 0, 0]])
})

await caso('CIERRE CON RESPUESTAS SIMULTÁNEAS: ninguna respuesta aceptada se pierde y ninguna rechazada entra (10 preguntas)', async () => {
  await preparar()
  const codigo = await sesionAbierta('r_ext')
  const tokens = []
  for (let i = 0; i < 14; i++) tokens.push(await externo(codigo, `Jugador ${String.fromCharCode(65 + i)}`))
  await iniciar(codigo)
  // Reloj que avanza 1 ms en cada lectura: las transacciones del docente y de los celulares se intercalan de verdad.
  fijarRelojReto(() => AHORA++)
  let apertura = abre(0)
  const aceptadas = new Map() // indice → número de respuestas aceptadas
  let enCarrera = 0
  for (let i = 0; i < 10; i++) {
    AHORA = apertura + 3000
    const llamadas = tokens.map((t, k) => () => responder(codigo, i, k % 3 === 0 ? (i % 2 === 0 ? 'a' : 'f') : (i % 2 === 0 ? 'b' : 'v'), { token: t }))
    llamadas.splice(7, 0, () => control(codigo, 'cerrar-pregunta', { indice: i }))
    const res = await Promise.all(llamadas.map((f) => f()))
    const corte = res[7]
    assert.strictEqual(corte.statusCode, 200, JSON.stringify(corte.cuerpo))
    const resp = res.filter((_, k) => k !== 7)
    for (const x of resp) assert.ok(x.statusCode === 200 || (x.statusCode === 409 && x.cuerpo.codigo === 'FUERA_DE_TIEMPO'), JSON.stringify(x.cuerpo))
    const guardadas = await respuestasDe(codigo, i)
    assert.strictEqual(guardadas.length, resp.filter((x) => x.statusCode === 200).length, `pregunta ${i + 1}: guardadas ≠ aceptadas`)
    aceptadas.set(i, guardadas.length)
    const c = (await leerSes(codigo)).cortes.find((x) => x.indice === i)
    enCarrera += guardadas.filter((g) => g.recibidaMs >= c.cerradaMs).length
    apertura = c.cerradaMs + PREP_MS
  }
  fijarRelojReto(() => AHORA)
  AHORA += 2000
  assert.strictEqual((await control(codigo, 'finalizar')).statusCode, 200)
  const final = (await db.doc(`retoResultados/${codigo}`).get()).data()
  assert.strictEqual(final.descartadas.fueraDeTiempo, 0, 'se perdió una respuesta aceptada')
  assert.strictEqual(final.realizadas, 10)
  for (const [i, n] of aceptadas) {
    const contadas = Object.values(final.detalle).filter((d) => d[i].opcionSeleccionada != null).length
    assert.strictEqual(contadas, n, `pregunta ${i + 1}: ${n} aceptadas, ${contadas} contadas`)
  }
  console.log(`    (respuestas aceptadas con hora igual o posterior a la del clic, en carrera con el cierre: ${enCarrera}; total aceptadas ${[...aceptadas.values()].reduce((a, b) => a + b, 0)})`)
})

await caso('el navegador no puede alterar el tiempo: recibidaMs y el sello los pone el servidor', async () => {
  await preparar()
  const codigo = await sesionAbierta('r_ext')
  const ta = await externo(codigo, 'Tigre Azul')
  await iniciar(codigo)
  AHORA = abre(0) + 7300
  const r = await responder(codigo, 0, 'b', { token: ta, recibidaMs: abre(0), tiempoDecimas: 1, vistos: { cortes: 0, pausas: 99 }, tiempoMs: 5 })
  assert.strictEqual(r.statusCode, 200)
  const [g] = await respuestasDe(codigo, 0)
  assert.deepStrictEqual([g.recibidaMs, g.vistos, g.tiempoDecimas, g.tiempoMs], [abre(0) + 7300, { cortes: 0, pausas: 0 }, undefined, undefined])
  AHORA = cierra(0) + 1600
  assert.strictEqual((await estado(codigo, { token: ta, parcialVisto: 0 })).cuerpo.parcial.top[0].tiempoDecimas, 73)
})

await caso('clasificación a pedido: se muestra al cerrar, nadie responde mientras tanto y «Continuar» sigue con la siguiente', async () => {
  await preparar()
  const codigo = await sesionAbierta('r_ext')
  const ta = await externo(codigo, 'Tigre Azul')
  await iniciar(codigo)
  AHORA = abre(0) - 1000 // «Prepárense» de la primera
  assert.strictEqual((await control(codigo, 'mostrar-clasificacion')).cuerpo.codigo, 'SIN_CERRADAS')
  AHORA = abre(1) + 1000
  const m = await control(codigo, 'mostrar-clasificacion')
  assert.deepStrictEqual([m.statusCode, m.cuerpo.clasificacionPendiente, m.cuerpo.fase], [200, 1, 'abierta'])
  AHORA = cierra(1) + 60_000 // un minuto después del cierre: sigue la clasificación
  const e = (await estado(codigo, { token: ta })).cuerpo
  assert.deepStrictEqual([e.sesion.fase, e.sesion.trasIndice, e.pregunta], ['clasificacion', 1, null])
  assert.strictEqual((await responder(codigo, 2, 'b', { token: ta })).cuerpo.codigo, 'FUERA_DE_TIEMPO')
  assert.strictEqual((await control(codigo, 'pausar')).cuerpo.codigo, 'NO_PAUSABLE')
  const c = await control(codigo, 'continuar')
  assert.deepStrictEqual([c.statusCode, c.cuerpo.fase, c.cuerpo.indice, c.cuerpo.faltaParaAbrirMs], [200, 'preparando', 2, PREP_MS])
  assert.strictEqual((await control(codigo, 'continuar')).statusCode, 200) // doble clic
  AHORA += PREP_MS
  assert.strictEqual((await responder(codigo, 2, 'b', { token: ta })).statusCode, 200)
  // Cerrar y mostrar de una vez; cancelar una pedida.
  AHORA += 1000
  assert.strictEqual((await control(codigo, 'cerrar-pregunta', { indice: 2, mostrarClasificacion: true })).cuerpo.fase, 'clasificacion')
  await control(codigo, 'continuar')
  AHORA += PREP_MS + 500
  assert.strictEqual((await control(codigo, 'mostrar-clasificacion')).cuerpo.clasificacionPendiente, 3)
  assert.strictEqual((await control(codigo, 'cancelar-clasificacion')).cuerpo.clasificacionPendiente, null)
  const s = await leerSes(codigo)
  assert.deepStrictEqual(s.pausas.map((x) => x.motivo), ['clasificacion', 'clasificacion'])
})

await caso('una sesión de antes (sin versión) no acepta las acciones nuevas y no recibe ranking', async () => {
  await preparar()
  const codigo = await sesionAbierta('r_ext')
  const ta = await externo(codigo, 'Tigre Azul')
  const datos = await leerSes(codigo)
  for (const k of ['version', 'cortes', 'clasificacionPendiente', 'revelar']) delete datos[k]
  await db.doc(`retoSesiones/${codigo}`).set(datos)
  await iniciar(codigo)
  AHORA = abre(0) + 1000
  for (const accion of ['cerrar-pregunta', 'mostrar-clasificacion', 'continuar']) {
    const r = await control(codigo, accion, { indice: 0 })
    assert.deepStrictEqual([r.statusCode, r.cuerpo.codigo], [409, 'NO_DISPONIBLE'], accion)
  }
  const e = (await estado(codigo, { token: ta, ranking: true })).cuerpo
  assert.deepStrictEqual([e.ranking, e.revision, e.sesion.mostrarRespuestaCorrecta], [undefined, undefined, undefined])
})

// Recorre la competencia guardando TODO lo que el servidor manda a los celulares, para buscar en ello la clave.
async function competenciaConRevelar(actividadId, valor, { inscritos = false } = {}) {
  await preparar()
  await conRevelar(actividadId, valor)
  const codigo = await sesionAbierta(actividadId)
  let ta, tb
  if (inscritos) { await unirse(codigo, {}, tk.ana); await unirse(codigo, {}, tk.beto) } else { ta = await externo(codigo, 'Tigre Azul'); tb = await externo(codigo, 'Puma Rojo') }
  const quien = inscritos ? [{ cuerpo: {}, token: tk.ana }, { cuerpo: {}, token: tk.beto }] : [{ cuerpo: { token: ta } }, { cuerpo: { token: tb } }]
  const visto = []
  const consultar = async (q, extra = {}) => {
    const r = await estado(codigo, { ...q.cuerpo, ...extra }, q.token)
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.cuerpo))
    visto.push(JSON.stringify(r.cuerpo))
    return r.cuerpo
  }
  const contestar = (q, i, op) => responder(codigo, i, op, q.cuerpo, q.token)
  await iniciar(codigo)
  const revisiones = [[], []]
  for (let i = 0; i < 10; i++) {
    AHORA = abre(i) + 1000
    // A: acierta todo. B: falla las de opción múltiple y acierta las verdadero/falso.
    await contestar(quien[0], i, i % 2 === 0 ? 'b' : 'v')
    await contestar(quien[1], i, i % 2 === 0 ? 'a' : 'v')
    for (const q of quien) {
      const e = await consultar(q, { ranking: true, parcialVisto: 0, revisionVista: 0 })
      // Con la pregunta abierta nunca hay revisión de ESA pregunta.
      if (e.revision) assert.ok(e.revision.indice < i, `revisión de la pregunta abierta ${i + 1}`)
    }
    AHORA = cierra(i) + 1600
    for (const [k, q] of quien.entries()) {
      const e = await consultar(q, { ranking: true, parcialVisto: 0, revisionVista: i })
      if (i < 9) revisiones[k].push(e.revision)
    }
  }
  AHORA = cierra(9) + 2000
  const finales = []
  for (const q of quien) finales.push(await consultar(q))
  return { codigo, visto, revisiones, finales }
}

for (const [actividadId, inscritos, etiqueta] of [['r_ext', false, 'externos'], ['r_ins', true, 'inscritos']]) {
  await caso(`«Mostrar respuesta correcta» = No (${etiqueta}): el servidor NUNCA manda la respuesta correcta; en V/F ni si acertó hasta el final`, async () => {
    const { visto, revisiones, finales } = await competenciaConRevelar(actividadId, false, { inscritos })
    for (const t of visto) assert.ok(!t.includes('respuestaCorrecta'), 'salió respuestaCorrecta')
    // Opción múltiple (índices pares): sabe si acertó al cerrar. Verdadero/falso: diferida, sin «acerto».
    for (const [k, revs] of revisiones.entries()) {
      for (const r of revs) {
        if (r.indice % 2 === 0) assert.strictEqual(r.acerto, k === 0)
        else assert.deepStrictEqual([r.diferida, 'acerto' in r], [true, false])
      }
    }
    // El ranking en vivo tampoco deja deducir las V/F: B (que solo acertó V/F) queda con 0 hasta el final, también con
    // una V/F abierta ya respondida (la última consulta es con la pregunta 10, V/F, abierta); las de opción múltiple
    // sí suman al instante (A llega a 5).
    const rankings = visto.map((t) => JSON.parse(t)).filter((e) => e.ranking)
    const ultimoRanking = rankings.pop().ranking
    assert.strictEqual(ultimoRanking.abierta, 9)
    assert.deepStrictEqual(ultimoRanking.filas.map((f) => f.aciertos).sort(), [0, 5])
    assert.ok(ultimoRanking.filas.every((f) => f.respondioActual === true && Number.isInteger(f.tiempos[9])))
    const conOMAbierta = rankings.find((e) => e.ranking.abierta === 0) // pregunta 1 (opción múltiple) abierta y respondida
    assert.deepStrictEqual(conOMAbierta.ranking.filas.map((f) => f.aciertos).sort(), [0, 1])
    // Al final: la clasificación completa y su corrección (si acertó), sin la respuesta correcta.
    const fa = finales[0].resultados
    assert.deepStrictEqual([fa.propia.aciertos, fa.correccion.length, fa.correccion.every((c) => c.acerto === true)], [10, 10, true])
    assert.strictEqual(finales[1].resultados.propia.aciertos, 5)
  })
}

await caso('«Mostrar respuesta correcta» = Sí (externos): al cerrar cada pregunta sabe si acertó y cuál era; al final, corrección completa', async () => {
  const { revisiones, finales } = await competenciaConRevelar('r_ext', true)
  assert.deepStrictEqual(revisiones[1][0], { indice: 0, preguntaId: 'p0', respondio: true, opcionSeleccionada: 'a', acerto: false, respuestaCorrecta: 'b' })
  assert.deepStrictEqual(revisiones[1][1], { indice: 1, preguntaId: 'p1', respondio: true, opcionSeleccionada: 'v', acerto: true, respuestaCorrecta: 'v' })
  assert.strictEqual(finales[1].resultados.correccion[0].respuestaCorrecta, 'b')
  assert.strictEqual(finales[1].preguntas.length, 10)
})

await caso('ranking en vivo (externos e inscritos): el puesto cambia al aceptarse cada respuesta, sin ids, opciones ni clave, y abrirlo no cambia nada', async () => {
  for (const [actividadId, modo] of [['r_ext', 'externo'], ['r_alias', 'inscritos']]) {
    await preparar()
    const codigo = await sesionAbierta(actividadId)
    let qa, qb, qc
    if (modo === 'externo') {
      qa = { cuerpo: { token: await externo(codigo, 'Tigre Azul') } }
      qb = { cuerpo: { token: await externo(codigo, 'Puma Rojo') } }
      qc = { cuerpo: { token: await externo(codigo, 'Lince Gris') } }
    } else {
      for (const [t, alias] of [[tk.ana, 'Tigre Azul'], [tk.beto, 'Puma Rojo']]) assert.strictEqual((await unirse(codigo, { alias }, t)).statusCode, 200)
      qa = { cuerpo: {}, token: tk.ana }
      qb = { cuerpo: {}, token: tk.beto }
      qc = null
    }
    const ver = async (q) => (await estado(codigo, { ...q.cuerpo, ranking: true }, q.token)).cuerpo.ranking
    await iniciar(codigo)
    AHORA = abre(0) + 2500
    const antesSes = await leerSes(codigo)
    let rk = await ver(qa)
    assert.strictEqual(rk.filas.length, qc ? 3 : 2)
    assert.ok(rk.filas.every((f) => f.respondioActual === false && f.tiempos.every((t) => t === null)))
    await responder(codigo, 0, 'b', qa.cuerpo, qa.token)
    AHORA += 2100 // el ranking se recalcula a lo más cada 2 s
    rk = await ver(qb) // Tigre acertó con la pregunta todavía abierta: ya suma su acierto, su tiempo y sube al primer lugar
    const tigre = rk.filas.find((f) => f.nombreVisible === 'Tigre Azul')
    assert.deepStrictEqual([tigre.respondioActual, tigre.tiempos[0], tigre.aciertos, tigre.tiempoDecimas, tigre.posicion], [true, 25, 1, 25, 1])
    assert.ok(rk.filas.filter((f) => f !== tigre).every((f) => f.posicion === 2 && f.aciertos === 0 && f.respondioActual === false))
    assert.ok(rk.filas.find((f) => f.esPropia).nombreVisible === 'Puma Rojo')
    // Puma responde mal: aparece su tiempo y que ya respondió, pero no suma.
    await responder(codigo, 0, 'a', qb.cuerpo, qb.token)
    AHORA += 2100
    rk = await ver(qa)
    const puma = rk.filas.find((f) => f.nombreVisible === 'Puma Rojo')
    assert.deepStrictEqual([puma.respondioActual, puma.tiempos[0], puma.aciertos, puma.tiempoDecimas, puma.posicion], [true, 46, 0, 0, 2])
    const texto = JSON.stringify(rk)
    for (const prohibido of ['participanteId', 'respuestaCorrecta', 'opcionSeleccionada', 'opciones', 'Ana', 'Pérez', 'Beto', 'st_', 'u_', codigo]) assert.ok(!texto.includes(prohibido), prohibido)
    for (const f of rk.filas) assert.deepStrictEqual(Object.keys(f).filter((k) => k !== 'esPropia').sort(), ['aciertos', 'nombreVisible', 'posicion', 'respondioActual', 'tiempoDecimas', 'tiempos'])
    // Justo después del cierre (antes de que la provisional la incluya) no hay salto: se sigue contando igual.
    AHORA = cierra(0) + 300
    rk = await ver(qb)
    assert.deepStrictEqual(rk.filas.find((f) => f.nombreVisible === 'Tigre Azul').aciertos, 1)
    // Abrir el ranking no escribe nada en la sesión (el proyector y los demás siguen igual).
    assert.deepStrictEqual(await leerSes(codigo), antesSes)
    // Ya con la provisional al día, el mismo resultado (sin contar dos veces).
    AHORA = cierra(0) + 1600
    rk = await ver(qb)
    assert.deepStrictEqual([rk.filas[0].posicion, rk.filas[0].nombreVisible, rk.filas[0].aciertos, rk.filas[0].tiempoDecimas], [1, 'Tigre Azul', 1, 25])
    assert.deepStrictEqual(rk.filas.filter((f) => f.nombreVisible !== 'Tigre Azul').map((f) => [f.posicion, f.aciertos]), qc ? [[2, 0], [2, 0]] : [[2, 0]])
    // Se recalcula a lo más cada 2 s aunque muchos lo tengan abierto.
    AHORA = abre(1) + 500
    await Promise.all(Array.from({ length: 20 }, () => ver(qa)))
    const p = (await db.doc(`retoParcial/${codigo}`).get()).data()
    assert.deepStrictEqual([p.vivo.abierta, p.vivo.hasta, p.vivoMarca, p.vivoHastaMs], [1, 1, undefined, undefined])
  }
})

// ═════════════════════════════════════════════════════════════════════════════
grupo('K. Orden aleatorio por participante (6-nov-2026)')

const correctaK = (preguntaId) => (Number(preguntaId.slice(1)) % 2 === 0 ? 'b' : 'v')
const ajenaK = (preguntaId) => (Number(preguntaId.slice(1)) % 2 === 0 ? 'v' : 'b') // opción que su pregunta no tiene

await caso('solo con tiempos iguales: la sesión se congela aleatoria; con uno distinto, todos reciben el orden del docente', async () => {
  await preparar()
  await db.doc('activities/r_ins').update({ 'reto.aleatorizar': true })
  const a = await crear('r_ins')
  assert.strictEqual((await db.doc(`retoSesiones/${a.cuerpo.codigo}`).get()).data().aleatorizar, true)
  await control(a.cuerpo.codigo, 'terminar', { confirmado: true })
  await db.doc('activities/r_ins/preguntas/p3').update({ tiempoSeg: 60 })
  const b = await crear('r_ins')
  assert.strictEqual((await db.doc(`retoSesiones/${b.cuerpo.codigo}`).get()).data().aleatorizar, undefined)
  // Sin pedirlo, tampoco (aunque los tiempos sean iguales).
  const c = await crear('r_ext')
  assert.strictEqual((await db.doc(`retoSesiones/${c.cuerpo.codigo}`).get()).data().aleatorizar, undefined)
})

await caso('inscritos: cada quien su orden fijo (también al reconectarse), su pregunta y la calificación por la original', async () => {
  await preparar()
  await db.doc('activities/r_ins').update({ 'reto.aleatorizar': true })
  const codigo = await sesionAbierta('r_ins')
  for (const k of ['ana', 'beto']) assert.strictEqual((await unirse(codigo, {}, tk[k])).statusCode, 200)
  const ordenDeK = async (k) => (await db.doc(`retoParticipantes/${codigo}_${ALUMNOS[k].id}`).get()).data().orden
  const oAna = await ordenDeK('ana')
  const oBeto = await ordenDeK('beto')
  for (const o of [oAna, oBeto]) assert.deepStrictEqual([...o].sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.strictEqual((await unirse(codigo, {}, tk.ana)).statusCode, 200) // reconexión
  assert.deepStrictEqual(await ordenDeK('ana'), oAna, 'reconectarse no cambia el orden')
  await iniciar(codigo)
  for (let t = 0; t < 10; t++) {
    AHORA = abre(t) + 1000
    for (const [k, o] of [['ana', oAna], ['beto', oBeto]]) {
      const e = await estado(codigo, {}, tk[k])
      assert.deepStrictEqual([e.cuerpo.pregunta.indice, e.cuerpo.pregunta.id], [t, `p${o[t]}`], `${k} turno ${t}`)
      // Una opción que su pregunta no tiene se rechaza (no se puede contestar la de otro).
      assert.strictEqual((await responder(codigo, t, ajenaK(`p${o[t]}`), {}, tk[k])).statusCode, 400)
      // Ana acierta todas; Beto solo las preguntas originales pares (en las de verdadero/falso elige «f»).
      const opcion = k === 'ana' || o[t] % 2 === 0 ? correctaK(`p${o[t]}`) : 'f'
      assert.strictEqual((await responder(codigo, t, opcion, {}, tk[k])).statusCode, 200)
    }
    const r = (await db.doc(`retoRespuestas/${codigo}_${ALUMNOS.ana.id}_${t}`).get()).data()
    assert.deepStrictEqual([r.indice, r.preguntaId], [t, `p${oAna[t]}`], 'la respuesta guarda el turno y la pregunta original')
  }
  AHORA = cierra(9) + 100
  await estado(codigo, {}, tk.ana)
  const res = (await db.doc(`retoResultados/${codigo}`).get()).data()
  assert.ok(res.aleatorio)
  const fila = (k) => res.clasificacion.find((f) => f.participanteId === `${codigo}_${ALUMNOS[k].id}`)
  assert.deepStrictEqual([fila('ana').aciertos, fila('beto').aciertos], [10, 5])
  assert.deepStrictEqual(res.detalle[`${codigo}_${ALUMNOS.beto.id}`].map((d) => [d.preguntaId, d.acerto]),
    Array.from({ length: 10 }, (_, i) => [`p${i}`, i % 2 === 0]))
  const fin = await estado(codigo, {}, tk.beto)
  assert.strictEqual(fin.cuerpo.resultados.propia.aciertos, 5)
})

await caso('externos: también reciben su orden con el token y lo conservan al reconectarse', async () => {
  await preparar()
  await db.doc('activities/r_ext').update({ 'reto.aleatorizar': true })
  const codigo = await sesionAbierta('r_ext')
  const token = await externo(codigo, 'Gato Veloz')
  const p = (await db.collection('retoParticipantes').where('sesionId', '==', codigo).get()).docs[0]
  const orden = p.data().orden
  assert.strictEqual(orden.length, 10)
  assert.strictEqual((await unirse(codigo, { token })).statusCode, 200)
  assert.deepStrictEqual((await db.doc(`retoParticipantes/${p.id}`).get()).data().orden, orden)
  await iniciar(codigo)
  AHORA = abre(3) + 500
  const e = await estado(codigo, { token })
  assert.strictEqual(e.cuerpo.pregunta.id, `p${orden[3]}`)
  assert.strictEqual((await responder(codigo, 3, correctaK(`p${orden[3]}`), { token })).statusCode, 200)
})

await caso('ranking en vivo del celular con orden aleatorio: casillas por pregunta original y estado propio por fila', async () => {
  await preparar()
  await db.doc('activities/r_ins').update({ 'reto.aleatorizar': true })
  const codigo = await sesionAbierta('r_ins')
  for (const k of ['ana', 'beto']) await unirse(codigo, {}, tk[k])
  const oAna = (await db.doc(`retoParticipantes/${codigo}_${ALUMNOS.ana.id}`).get()).data().orden
  await iniciar(codigo)
  AHORA = abre(0) + 2500
  await responder(codigo, 0, correctaK(`p${oAna[0]}`), {}, tk.ana)
  AHORA += 2100
  const rk = (await estado(codigo, { ranking: true }, tk.beto)).cuerpo.ranking
  const ana = rk.filas.find((f) => f.nombreVisible.startsWith('Ana'))
  assert.deepStrictEqual([ana.aciertos, ana.tiempos[oAna[0]], ana.estados[oAna[0]], ana.respondioActual], [1, 25, 'abierta', true])
  assert.ok(!JSON.stringify(rk).includes('orden'), 'el orden de cada quien no viaja a los celulares')
})

await caso('Pausar y Terminar con orden aleatorio: la pausa congela a todos; terminar no cuenta el turno en curso de nadie', async () => {
  await preparar()
  await db.doc('activities/r_ins').update({ 'reto.aleatorizar': true })
  const codigo = await sesionAbierta('r_ins')
  for (const k of ['ana', 'beto']) await unirse(codigo, {}, tk[k])
  const oDe = async (k) => (await db.doc(`retoParticipantes/${codigo}_${ALUMNOS[k].id}`).get()).data().orden
  const o = { ana: await oDe('ana'), beto: await oDe('beto') }
  await iniciar(codigo)
  // Turno 0: los dos aciertan su pregunta.
  AHORA = abre(0) + 1000
  for (const k of ['ana', 'beto']) assert.strictEqual((await responder(codigo, 0, correctaK(`p${o[k][0]}`), {}, tk[k])).statusCode, 200)
  // Turno 1: pausa larga. Nadie recibe su pregunta ni puede responder; nada termina.
  AHORA = abre(1) + 1000
  assert.strictEqual((await control(codigo, 'pausar')).statusCode, 200)
  AHORA = abre(1) + 1000 + 3 * DIA
  for (const k of ['ana', 'beto']) {
    const e = await estado(codigo, {}, tk[k])
    assert.deepStrictEqual([e.cuerpo.sesion.fase, e.cuerpo.pregunta], ['pausada', null])
    assert.strictEqual((await responder(codigo, 1, correctaK(`p${o[k][1]}`), {}, tk[k])).cuerpo.codigo, 'PAUSADA')
  }
  // Reanudar: cada quien vuelve a SU pregunta del turno 1, con el tiempo que faltaba.
  assert.strictEqual((await control(codigo, 'reanudar')).statusCode, 200)
  for (const k of ['ana', 'beto']) {
    const e = await estado(codigo, {}, tk[k])
    assert.deepStrictEqual([e.cuerpo.sesion.fase, e.cuerpo.pregunta.indice, e.cuerpo.pregunta.id, e.cuerpo.sesion.restanteMs],
      ['abierta', 1, `p${o[k][1]}`, RETO_CFG.TIEMPO_RESPUESTA_MS - 1000])
  }
  assert.strictEqual((await responder(codigo, 1, correctaK(`p${o.ana[1]}`), {}, tk.ana)).statusCode, 200) // Beto no responde el 1
  // Turno 2 (desplazado por la pausa): Ana responde y el docente termina con el turno abierto.
  AHORA = abre(2) + 3 * DIA + 1000
  assert.strictEqual((await responder(codigo, 2, correctaK(`p${o.ana[2]}`), {}, tk.ana)).statusCode, 200)
  assert.strictEqual((await control(codigo, 'terminar')).cuerpo.codigo, 'SIN_CONFIRMACION')
  assert.strictEqual((await db.doc(`retoSesiones/${codigo}`).get()).data().estado, 'en_curso')
  assert.strictEqual((await control(codigo, 'terminar', { confirmado: true })).statusCode, 200)
  const r = (await db.doc(`retoResultados/${codigo}`).get()).data()
  const fila = (k) => r.clasificacion.find((f) => f.participanteId === `${codigo}_${ALUMNOS[k].id}`)
  assert.deepStrictEqual([r.aleatorio, r.realizadas, r.descartadas.noRealizada], [true, 2, 1])
  assert.deepStrictEqual([fila('ana').aciertos, fila('beto').aciertos], [2, 1])
  // Cada quien quedó medido solo con SUS dos preguntas recibidas (las de sus turnos 0 y 1), por pregunta original.
  for (const k of ['ana', 'beto']) {
    assert.deepStrictEqual(r.detalle[`${codigo}_${ALUMNOS[k].id}`].map((d) => d.preguntaId).sort(), [`p${o[k][0]}`, `p${o[k][1]}`].sort())
  }
  assert.strictEqual(await contar('retoRespuestas', codigo), 4) // la del turno interrumpido se conserva
  // Ya terminada: no se reanuda ni se responde.
  assert.strictEqual((await control(codigo, 'reanudar')).statusCode, 409)
  assert.strictEqual((await responder(codigo, 2, correctaK(`p${o.beto[2]}`), {}, tk.beto)).statusCode, 409)
})

await caso('sin orden aleatorio, nada cambia: todos la misma pregunta en cada turno', async () => {
  await preparar()
  const codigo = await sesionAbierta('r_ins')
  for (const k of ['ana', 'beto']) await unirse(codigo, {}, tk[k])
  assert.strictEqual((await db.doc(`retoParticipantes/${codigo}_${ALUMNOS.ana.id}`).get()).data().orden, undefined)
  await iniciar(codigo)
  AHORA = abre(4) + 500
  for (const k of ['ana', 'beto']) assert.strictEqual((await estado(codigo, {}, tk[k])).cuerpo.pregunta.id, 'p4')
})

fijarRelojReto(null)
resumen('RETO SERVIDOR')
