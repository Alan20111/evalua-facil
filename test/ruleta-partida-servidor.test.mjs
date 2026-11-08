// La Ruleta del Destino · fases 4 y 5 (individual) — partida del estudiante contra el emulador (Firestore + Auth).
//
//   firebase emulators:exec --only firestore,auth --project demo-test "node test/ruleta-partida-servidor.test.mjs"
//
// Llama al handler real de /api/subject/ruleta-partida (api/_lib/ruletaPartida.js). El reloj del servidor se sustituye
// (fijarRelojRuleta) para recorrer los 15 s sin esperar. Las respuestas «simultáneas» se lanzan juntas con Promise.all.
import { db, limpiar, caso, grupo, resumen, assert, llamar, sesion } from './helpers/entorno.mjs'
import { handleRuletaPartida, fijarRelojRuleta } from '../api/_lib/ruletaPartida.js'
import { handleRuletaBanco, huellaEnunciado } from '../api/_lib/ruletaBanco.js'
import { datosNuevaRuleta } from '../src/utils/ruletaDestino.js'

const DOC = 'doc_rp', S = 'sub_rp', S_OTRA = 'sub_otra', E = 'e1'
const tk = {}
let ahora = 1_800_000_000_000
fijarRelojRuleta(() => ahora)

const op = (operacion, cuerpo = {}, token = tk.a1) => llamar(handleRuletaPartida, { cuerpo: { operacion, ...cuerpo }, token })
const banco = (operacion, cuerpo = {}) => llamar(handleRuletaBanco, { cuerpo: { operacion, ...cuerpo }, token: tk.doc })
const participante = async (act, alumnoId) => (await db.doc(`ruletaParticipantes/${act}_${alumnoId}`).get()).data()
const respuestasDe = async (act) => (await db.collection('ruletaRespuestas').where('actividadId', '==', act).get()).docs.map((d) => d.data())
const sinClave = (cuerpo) => !JSON.stringify(cuerpo).includes('"correcta"')

async function crearRuleta(id, { n = 5, modalidad = 'individual', acceso = 'interno', publicada = true, parcial = 1, aprobado = true, reactivos = null } = {}) {
  const r = datosNuevaRuleta({ nombre: `Ruleta ${id}`, tema: 'La célula', modalidad, acceso, preguntasPorPartida: n, ranking: false, parcial, orden: 1, asignaturaId: S, docenteId: DOC })
  assert.ok(r.ok, r.codigo)
  const visible = publicada && acceso === 'interno' ? { oculta: false, publishedAt: '2026-11-01T08:00' } : {}
  await db.doc(`activities/${id}`).set({ ...r.datos, ...visible })
  const total = reactivos ?? n * 10
  const lote = db.batch()
  const huellas = {}
  for (let i = 0; i < total; i++) {
    const enunciado = `¿Pregunta ${id} número ${i}?`
    const rid = `${id}_r${String(i).padStart(3, '0')}`
    huellas[huellaEnunciado(enunciado)] = rid
    lote.set(db.doc(`ruletaReactivos/${rid}`), { docenteId: DOC, actividadId: id, enunciado, opciones: [`A${i}`, `B${i}`, `C${i}`, `D${i}`], correcta: i % 4, huella: huellaEnunciado(enunciado) })
  }
  lote.set(db.doc(`ruletaBancos/${id}`), { docenteId: DOC, actividadId: id, origen: 'manual', total, huellas, aprobado, aprobadoEn: null, version: total })
  await lote.commit()
}

// Clave de la pregunta abierta, leída por el admin (el estudiante nunca la recibe).
async function claveAbierta(act, alumnoId) {
  const p = await participante(act, alumnoId)
  return p.preguntas[p.partida.abierta.reactivoId].correcta
}

async function preparar() {
  await limpiar()
  await db.doc(`users/${DOC}`).set({ role: 'docente', nombre: 'Docente', escuelaId: E })
  await db.doc(`subjects/${S}`).set({ docenteId: DOC, nombre: 'Biología', parcialesOcultos: [3] })
  await db.doc(`subjects/${S_OTRA}`).set({ docenteId: DOC, nombre: 'Química' })
  for (const [sid, uid, asig] of [['st_a1', 'u_a1', S], ['st_a2', 'u_a2', S], ['st_a3', 'u_a3', S], ['st_a4', 'u_a4', S], ['st_x', 'u_x', S_OTRA]]) {
    await db.doc(`students/${sid}`).set({ uid, asignaturaId: asig, escuelaId: E, username: sid.toUpperCase(), activado: true })
  }
  tk.doc = await sesion(DOC, { email: 'doc@prueba.test' })
  for (const [k, uid] of [['a1', 'u_a1'], ['a2', 'u_a2'], ['a3', 'u_a3'], ['a4', 'u_a4'], ['x', 'u_x']]) tk[k] = await sesion(uid, { email: `${k}.${E}@evalua.local` })
  await crearRuleta('ru_ok')
}
await preparar()

// ── A · Identidad ───────────────────────────────────────────────────────────
grupo('A · identidad del participante')

await caso('A · sin sesión 401; docente 403; estudiante de otra asignatura 403; operación desconocida 400', async () => {
  assert.strictEqual((await op('estado', { actividadId: 'ru_ok' }, null)).statusCode, 401)
  assert.strictEqual((await op('estado', { actividadId: 'ru_ok' }, tk.doc)).statusCode, 403)
  const x = await op('estado', { actividadId: 'ru_ok' }, tk.x)
  assert.deepStrictEqual([x.statusCode, x.cuerpo.codigo], [403, 'NO_INSCRITO'])
  assert.strictEqual((await op('trampa', { actividadId: 'ru_ok' })).statusCode, 400)
  assert.strictEqual((await op('estado', {})).statusCode, 400)
  assert.strictEqual((await op('estado', { actividadId: 'no_existe' })).statusCode, 404)
  assert.strictEqual((await db.collection('ruletaParticipantes').get()).size, 0)
})

// ── B · Disponibilidad ──────────────────────────────────────────────────────
grupo('B · solo una ruleta individual, interna, visible y con el banco aprobado')

await caso('B · oculta, en vivo, externa, parcial oculto o banco sin aprobar: no se crea partida ni se congela nada', async () => {
  await crearRuleta('ru_oculta', { publicada: false })
  await crearRuleta('ru_vivo', { modalidad: 'vivo' })
  await crearRuleta('ru_ext', { acceso: 'externo' })
  await crearRuleta('ru_p3', { parcial: 3 })
  await crearRuleta('ru_sin', { aprobado: false })
  await crearRuleta('ru_corto', { reactivos: 49 })
  const casos = [['ru_oculta', 403, 'NO_PUBLICADA'], ['ru_vivo', 409, 'MODALIDAD_NO_DISPONIBLE'], ['ru_ext', 409, 'MODALIDAD_NO_DISPONIBLE'],
    ['ru_p3', 403, 'NO_PUBLICADA'], ['ru_sin', 409, 'BANCO_NO_LISTO'], ['ru_corto', 409, 'BANCO_NO_LISTO']]
  for (const [id, st, cod] of casos) {
    const r = await op('estado', { actividadId: id })
    assert.deepStrictEqual([r.statusCode, r.cuerpo.codigo], [st, cod], id)
    assert.notStrictEqual((await db.doc(`activities/${id}`).get()).data().ruleta.preguntasCongeladas, true, id)
  }
  assert.strictEqual((await db.collection('ruletaParticipantes').get()).size, 0)
})

// ── C · Inicio y recuperación ───────────────────────────────────────────────
grupo('C · inicio, sorteo sin repetir y recuperación')

await caso('C · la primera vez sortea 5 preguntas DISTINTAS del banco, guarda su copia y congela las preguntas por partida', async () => {
  const r = await op('estado', { actividadId: 'ru_ok' })
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.cuerpo))
  assert.deepStrictEqual([r.cuerpo.nueva, r.cuerpo.estado, r.cuerpo.total, r.cuerpo.respondidas], [true, 'lista', 5, 0])
  assert.ok(sinClave(r.cuerpo))
  const p = await participante('ru_ok', 'st_a1')
  assert.strictEqual(new Set(p.partida.orden).size, 5)
  assert.ok(p.partida.orden.every((id) => id.startsWith('ru_ok_r')))
  assert.deepStrictEqual(Object.keys(p.preguntas).sort(), [...p.partida.orden].sort())
  assert.strictEqual((await db.doc('activities/ru_ok').get()).data().ruleta.preguntasCongeladas, true)
})
await caso('C · volver a entrar recupera la MISMA partida (una sola partida por estudiante)', async () => {
  const antes = (await participante('ru_ok', 'st_a1')).partida.orden
  const r = await op('estado', { actividadId: 'ru_ok' })
  assert.deepStrictEqual([r.statusCode, r.cuerpo.nueva], [200, false])
  assert.deepStrictEqual((await participante('ru_ok', 'st_a1')).partida.orden, antes)
  assert.strictEqual((await db.collection('ruletaParticipantes').where('actividadId', '==', 'ru_ok').get()).size, 1)
})
await caso('C · dos inicios simultáneos del mismo estudiante crean UNA partida', async () => {
  const rs = await Promise.all([op('estado', { actividadId: 'ru_ok' }, tk.a2), op('estado', { actividadId: 'ru_ok' }, tk.a2)])
  assert.ok(rs.every((r) => r.statusCode === 200), rs.map((r) => r.statusCode).join(','))
  assert.strictEqual(rs.filter((r) => r.cuerpo.nueva).length, 1)
  assert.strictEqual((await db.collection('ruletaParticipantes').where('alumnoId', '==', 'st_a2').get()).size, 1)
})
await caso('C · con partidas iniciadas el docente ya no cambia las preguntas por partida', async () => {
  const r = await banco('config', { actividadId: 'ru_ok', preguntasPorPartida: 10 })
  assert.deepStrictEqual([r.statusCode, r.cuerpo.codigo], [409, 'CONGELADAS'])
})

// ── D · Girar ───────────────────────────────────────────────────────────────
grupo('D · girar')

await caso('D · girar abre la primera pregunta: enunciado y 4 opciones de la copia, 15 s, sin la clave', async () => {
  const r = await op('girar', { actividadId: 'ru_ok' })
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.cuerpo))
  const p = await participante('ru_ok', 'st_a1')
  const q = p.preguntas[p.partida.orden[0]]
  assert.deepStrictEqual([r.cuerpo.estado, r.cuerpo.pregunta.indice, r.cuerpo.pregunta.enunciado, r.cuerpo.pregunta.opciones, r.cuerpo.pregunta.restanteMs],
    ['pregunta', 0, q.enunciado, q.opciones, 15000])
  assert.ok(sinClave(r.cuerpo))
})
await caso('D · girar otra vez con la pregunta abierta devuelve la MISMA pregunta (no abre otra)', async () => {
  ahora += 4000
  const r = await op('girar', { actividadId: 'ru_ok' })
  assert.deepStrictEqual([r.cuerpo.pregunta.indice, r.cuerpo.pregunta.restanteMs], [0, 11000])
  assert.strictEqual((await participante('ru_ok', 'st_a1')).partida.respuestas.length, 0)
})

// ── E · Responder y tiempo ──────────────────────────────────────────────────
grupo('E · responder, tiempo exacto y manipulación')

await caso('E · manipulación: opción fuera de rango o de texto 400; índice ajeno 409; la «correcta» del cuerpo se ignora', async () => {
  for (const o of [7, -1, '1', 1.5, null]) assert.strictEqual((await op('responder', { actividadId: 'ru_ok', indice: 0, opcion: o })).statusCode, 400, String(o))
  assert.strictEqual((await op('responder', { actividadId: 'ru_ok', indice: 3, opcion: 0 })).statusCode, 409)
  const clave = await claveAbierta('ru_ok', 'st_a1')
  const mala = (clave + 1) % 4
  const r = await op('responder', { actividadId: 'ru_ok', indice: 0, opcion: mala, correcta: mala })
  assert.deepStrictEqual([r.statusCode, r.cuerpo.registrada, r.cuerpo.fueraDeTiempo, r.cuerpo.respondidas], [200, true, false, 1])
  assert.ok(sinClave(r.cuerpo))
  assert.strictEqual((await participante('ru_ok', 'st_a1')).partida.respuestas[0].correcta, false)
})
await caso('E · reintentar la misma respuesta no la cuenta dos veces', async () => {
  const r = await op('responder', { actividadId: 'ru_ok', indice: 0, opcion: 2 })
  assert.deepStrictEqual([r.statusCode, r.cuerpo.registrada, r.cuerpo.respondidas], [200, true, 1])
  assert.strictEqual((await respuestasDe('ru_ok')).filter((x) => x.alumnoId === 'st_a1').length, 1)
})
await caso('E · a los 15,000 ms exactos todavía cuenta (correcta)', async () => {
  await op('girar', { actividadId: 'ru_ok' })
  ahora += 15000
  const r = await op('responder', { actividadId: 'ru_ok', indice: 1, opcion: await claveAbierta('ru_ok', 'st_a1') })
  assert.deepStrictEqual([r.cuerpo.registrada, r.cuerpo.fueraDeTiempo], [true, false])
  const resp = (await participante('ru_ok', 'st_a1')).partida.respuestas[1]
  assert.deepStrictEqual([resp.motivo, resp.correcta, resp.tiempoMs], ['respondida', true, 15000])
})
await caso('E · a los 15,001 ms es incorrecta aunque elija la opción correcta', async () => {
  await op('girar', { actividadId: 'ru_ok' })
  ahora += 15001
  const r = await op('responder', { actividadId: 'ru_ok', indice: 2, opcion: await claveAbierta('ru_ok', 'st_a1') })
  assert.deepStrictEqual([r.cuerpo.registrada, r.cuerpo.fueraDeTiempo], [true, true])
  const p = await participante('ru_ok', 'st_a1')
  assert.strictEqual(p.partida.respuestas[2].correcta, false)
})
await caso('E · si sale y vuelve después de 15 s, la pregunta queda sin respuesta (incorrecta) y responderla luego no la cambia', async () => {
  await op('girar', { actividadId: 'ru_ok' })
  ahora += 60000
  const e = await op('estado', { actividadId: 'ru_ok' })
  assert.deepStrictEqual([e.cuerpo.estado, e.cuerpo.respondidas], ['lista', 4])
  const p = await participante('ru_ok', 'st_a1')
  assert.deepStrictEqual([p.partida.respuestas[3].motivo, p.partida.respuestas[3].correcta], ['sin_respuesta', false])
  const tarde = await op('responder', { actividadId: 'ru_ok', indice: 3, opcion: 0 })
  assert.deepStrictEqual([tarde.statusCode, tarde.cuerpo.fueraDeTiempo, tarde.cuerpo.respondidas], [200, true, 4])
})

// ── F · Final ───────────────────────────────────────────────────────────────
grupo('F · fin de la partida y calificación')

await caso('F · al responder la última: terminada, calificación sobre 10 y cuántas acertó; sin revelar claves', async () => {
  await op('girar', { actividadId: 'ru_ok' })
  ahora += 2000
  const r = await op('responder', { actividadId: 'ru_ok', indice: 4, opcion: await claveAbierta('ru_ok', 'st_a1') })
  // Aciertos: preguntas 1 y 4 → 2 de 5 → 4.
  assert.deepStrictEqual([r.cuerpo.estado, r.cuerpo.resultado], ['terminada', { correctas: 2, total: 5, calificacion: 4 }])
  assert.ok(sinClave(r.cuerpo))
  const p = await participante('ru_ok', 'st_a1')
  assert.deepStrictEqual([p.resultado.correctas, p.resultado.calificacion, p.resultado.sinRespuesta], [2, 4, 2])
  assert.strictEqual((await respuestasDe('ru_ok')).filter((x) => x.alumnoId === 'st_a1').length, 5)
})
await caso('F · después de terminar no se gira ni se responde de más; volver muestra el mismo resultado', async () => {
  const g = await op('girar', { actividadId: 'ru_ok' })
  assert.deepStrictEqual([g.statusCode, g.cuerpo.estado, g.cuerpo.resultado.calificacion], [200, 'terminada', 4])
  assert.strictEqual((await op('responder', { actividadId: 'ru_ok', indice: 5, opcion: 0 })).statusCode, 409)
  const e = await op('estado', { actividadId: 'ru_ok' })
  assert.deepStrictEqual([e.cuerpo.nueva, e.cuerpo.estado, e.cuerpo.resultado.correctas], [false, 'terminada', 2])
  assert.strictEqual((await participante('ru_ok', 'st_a1')).partida.respuestas.length, 5)
})
await caso('F · todas correctas = 10', async () => {
  await op('estado', { actividadId: 'ru_ok' }, tk.a3)
  let ultima
  for (let i = 0; i < 5; i++) {
    await op('girar', { actividadId: 'ru_ok' }, tk.a3)
    ahora += 1000
    ultima = await op('responder', { actividadId: 'ru_ok', indice: i, opcion: await claveAbierta('ru_ok', 'st_a3') }, tk.a3)
  }
  assert.deepStrictEqual(ultima.cuerpo.resultado, { correctas: 5, total: 5, calificacion: 10 })
})

// ── G · Simultáneos ─────────────────────────────────────────────────────────
grupo('G · respuestas simultáneas')

await caso('G · 6 respuestas simultáneas a la misma pregunta: se registra UNA', async () => {
  await op('girar', { actividadId: 'ru_ok' }, tk.a2)
  ahora += 1000
  const rs = await Promise.all([0, 1, 2, 3, 0, 1].map((o) => op('responder', { actividadId: 'ru_ok', indice: 0, opcion: o }, tk.a2)))
  assert.ok(rs.every((r) => r.statusCode === 200), rs.map((r) => r.statusCode).join(','))
  assert.ok(rs.every((r) => r.cuerpo.respondidas === 1))
  assert.strictEqual((await participante('ru_ok', 'st_a2')).partida.respuestas.length, 1)
  assert.strictEqual((await respuestasDe('ru_ok')).filter((x) => x.alumnoId === 'st_a2').length, 1)
})

// ── H · Copia de las preguntas ──────────────────────────────────────────────
grupo('H · la partida no cambia si el docente edita el banco')

await caso('H · el docente edita una pregunta ya sorteada: la partida conserva su copia; un estudiante nuevo espera la nueva aprobación', async () => {
  const p = await participante('ru_ok', 'st_a2')
  const rid = p.partida.orden[1]
  const ed = await banco('editar', { actividadId: 'ru_ok', reactivoId: rid, reactivo: { enunciado: '¿Pregunta CAMBIADA?', opciones: ['w', 'x', 'y', 'z'], correcta: 3 } })
  assert.strictEqual(ed.statusCode, 200, JSON.stringify(ed.cuerpo))
  const g = await op('girar', { actividadId: 'ru_ok' }, tk.a2)
  assert.strictEqual(g.cuerpo.pregunta.enunciado, p.preguntas[rid].enunciado)
  const nuevo = await op('estado', { actividadId: 'ru_ok' }, tk.a4)
  assert.deepStrictEqual([nuevo.statusCode, nuevo.cuerpo.codigo], [409, 'BANCO_NO_LISTO'])
})

// ── I · Partida de 10 ───────────────────────────────────────────────────────
grupo('I · partida de 10 preguntas')

await caso('I · una ruleta de 10 preguntas sortea 10 distintas', async () => {
  await crearRuleta('ru_diez', { n: 10 })
  const r = await op('estado', { actividadId: 'ru_diez' }, tk.a4)
  assert.deepStrictEqual([r.statusCode, r.cuerpo.total], [200, 10])
  assert.strictEqual(new Set((await participante('ru_diez', 'st_a4')).partida.orden).size, 10)
})

resumen('RULETA-PARTIDA-SERVIDOR CHECKS')
