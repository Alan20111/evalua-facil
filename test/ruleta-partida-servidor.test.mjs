// La Ruleta del Destino · fases 4 y 5 (individual) — partida del estudiante contra el emulador (Firestore + Auth).
//
//   firebase emulators:exec --only firestore,auth --project demo-test "node test/ruleta-partida-servidor.test.mjs"
//
// Llama al handler real de /api/subject/ruleta-partida (api/_lib/ruletaPartida.js). El reloj del servidor se sustituye
// (fijarRelojRuleta) para recorrer los 15 s sin esperar. Las respuestas «simultáneas» se lanzan juntas con Promise.all.
import { db, limpiar, caso, grupo, resumen, assert, llamar, sesion } from './helpers/entorno.mjs'
import { handleRuletaPartida, fijarRelojRuleta, decisionNotaRuleta } from '../api/_lib/ruletaPartida.js'
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
const entrega = async (act, alumnoId) => { const d = await db.doc(`submissions/${act}_${alumnoId}`).get(); return d.exists ? d.data() : null }
const entregasDe = async (act) => (await db.collection('submissions').where('actividadId', '==', act).get()).docs.map((d) => d.data())

async function crearRuleta(id, { n = 5, modalidad = 'individual', acceso = 'interno', publicada = true, parcial = 1, aprobado = true, reactivos = null } = {}) {
  const r = datosNuevaRuleta({ nombre: `Ruleta ${id}`, tema: 'La célula', acceso, preguntasPorPartida: n, parcial, orden: 1, asignaturaId: S, docenteId: DOC })
  assert.ok(r.ok, r.codigo)
  const visible = publicada && acceso === 'interno' ? { oculta: false, publishedAt: '2026-11-01T08:00' } : {}
  // Otra modalidad ya no se puede crear (7-nov-2026); se escribe directo para probar la defensa del servidor.
  await db.doc(`activities/${id}`).set({ ...r.datos, ...visible, ruleta: { ...r.datos.ruleta, modalidad } })
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

// Juega la partida completa de un estudiante: `aciertos[i]` dice si responde bien la pregunta i.
async function jugar(act, token, alumnoId, aciertos) {
  await op('estado', { actividadId: act }, token)
  let ultima
  for (let i = 0; i < aciertos.length; i++) {
    await op('girar', { actividadId: act }, token)
    ahora += 1000
    const clave = await claveAbierta(act, alumnoId)
    ultima = await op('responder', { actividadId: act, indice: i, opcion: aciertos[i] ? clave : (clave + 1) % 4 }, token)
  }
  return ultima
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

await caso('B · oculta, modalidad ajena (en vivo, ya no existe), externa, parcial oculto o banco sin aprobar: no se crea partida ni se congela nada', async () => {
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
  assert.deepStrictEqual([r.cuerpo.estado, r.cuerpo.resultado], ['terminada', { correctas: 2, total: 5, calificacion: 4, notaConservada: false }])
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
  assert.deepStrictEqual(ultima.cuerpo.resultado, { correctas: 5, total: 5, calificacion: 10, notaConservada: false })
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

// ── J · Nota (paso 2) ───────────────────────────────────────────────────────
grupo('J · la nota se registra sola al terminar, una sola vez')

await caso('J · al terminar se escribe la entrega con la nota del servidor (y queda anotado en el participante)', async () => {
  const s1 = await entrega('ru_ok', 'st_a1')
  assert.deepStrictEqual(
    [s1.actividadId, s1.alumnoId, s1.calificacion, s1.estado, s1.ultimaCalificacionPor, s1.sinEntrega, s1.comentario, s1.ruleta],
    ['ru_ok', 'st_a1', 4, 'calificado', 'servidor', true, '', { participanteId: 'ru_ok_st_a1', correctas: 2, total: 5 }])
  assert.ok(s1.fechaEntrega)
  assert.strictEqual((await entrega('ru_ok', 'st_a3')).calificacion, 10)
  assert.strictEqual((await participante('ru_ok', 'st_a1')).nota.estado, 'registrada')
  // Quien no ha terminado no tiene nota.
  assert.strictEqual(await entrega('ru_ok', 'st_a2'), null)
  assert.strictEqual(await entrega('ru_diez', 'st_a4'), null)
})
await caso('J · volver a entrar, girar o reintentar después de terminar no reescribe la nota', async () => {
  const antes = await entrega('ru_ok', 'st_a1')
  await op('estado', { actividadId: 'ru_ok' })
  await op('girar', { actividadId: 'ru_ok' })
  await op('responder', { actividadId: 'ru_ok', indice: 4, opcion: 0 })
  assert.deepStrictEqual(await entrega('ru_ok', 'st_a1'), antes)
  assert.strictEqual((await entregasDe('ru_ok')).length, 2)
})
await caso('J · si la última pregunta se vence sin respuesta, al volver se termina y se registra la nota', async () => {
  await crearRuleta('ru_venc')
  await op('estado', { actividadId: 'ru_venc' })
  for (let i = 0; i < 4; i++) {
    await op('girar', { actividadId: 'ru_venc' })
    ahora += 1000
    await op('responder', { actividadId: 'ru_venc', indice: i, opcion: await claveAbierta('ru_venc', 'st_a1') })
  }
  await op('girar', { actividadId: 'ru_venc' })
  ahora += 20000
  assert.strictEqual(await entrega('ru_venc', 'st_a1'), null)
  const e = await op('estado', { actividadId: 'ru_venc' })
  assert.deepStrictEqual([e.cuerpo.estado, e.cuerpo.resultado.calificacion], ['terminada', 8])
  assert.strictEqual((await entrega('ru_venc', 'st_a1')).calificacion, 8)
})
await caso('J · la última respuesta enviada a la vez desde varias pestañas deja UNA nota', async () => {
  await crearRuleta('ru_conc')
  await op('estado', { actividadId: 'ru_conc' }, tk.a2)
  for (let i = 0; i < 4; i++) {
    await op('girar', { actividadId: 'ru_conc' }, tk.a2)
    ahora += 1000
    await op('responder', { actividadId: 'ru_conc', indice: i, opcion: await claveAbierta('ru_conc', 'st_a2') }, tk.a2)
  }
  await op('girar', { actividadId: 'ru_conc' }, tk.a2)
  ahora += 1000
  const clave = await claveAbierta('ru_conc', 'st_a2')
  const rs = await Promise.all([
    ...[clave, clave, (clave + 1) % 4, clave].map((o) => op('responder', { actividadId: 'ru_conc', indice: 4, opcion: o }, tk.a2)),
    op('estado', { actividadId: 'ru_conc' }, tk.a2), op('girar', { actividadId: 'ru_conc' }, tk.a2),
  ])
  assert.ok(rs.every((r) => r.statusCode === 200), rs.map((r) => r.statusCode).join(','))
  const subs = await entregasDe('ru_conc')
  assert.strictEqual(subs.length, 1)
  const p = await participante('ru_conc', 'st_a2')
  assert.strictEqual(subs[0].calificacion, p.resultado.calificacion)
  // Un estado o un giro que llega antes que la respuesta ve la pregunta abierta; las que ven el final, la misma nota.
  assert.ok(rs.slice(0, 4).every((r) => r.cuerpo.estado === 'terminada'))
  assert.ok(rs.filter((r) => r.cuerpo.estado === 'terminada').every((r) => r.cuerpo.resultado.calificacion === p.resultado.calificacion))
  assert.strictEqual(p.partida.respuestas.length, 5)
})

// ── K · Parcial cerrado ─────────────────────────────────────────────────────
grupo('K · parcial cerrado definitivamente: no se juega ni se califica')

await caso('K · con el parcial cerrado no se inicia, no se gira ni se responde, y no se escribe nada', async () => {
  await crearRuleta('ru_cerr', { parcial: 2 })
  await op('estado', { actividadId: 'ru_cerr' })
  await op('girar', { actividadId: 'ru_cerr' })
  ahora += 1000
  await op('responder', { actividadId: 'ru_cerr', indice: 0, opcion: await claveAbierta('ru_cerr', 'st_a1') })
  await op('girar', { actividadId: 'ru_cerr' })
  await db.doc(`subjects/${S}`).update({ parcialesCerrados: { 2: '2026-11-07T10:00' } })
  const antes = await participante('ru_cerr', 'st_a1')
  ahora += 60000 // aunque la pregunta abierta venza, con el parcial cerrado no se registra
  for (const [o, cuerpo] of [['estado', {}], ['girar', {}], ['responder', { indice: 1, opcion: 0 }]]) {
    const r = await op(o, { actividadId: 'ru_cerr', ...cuerpo })
    assert.deepStrictEqual([r.statusCode, r.cuerpo.codigo], [409, 'PARCIAL_CERRADO'], o)
  }
  const nuevo = await op('estado', { actividadId: 'ru_cerr' }, tk.a2)
  assert.deepStrictEqual([nuevo.statusCode, nuevo.cuerpo.codigo], [409, 'PARCIAL_CERRADO'])
  assert.strictEqual((await db.doc('ruletaParticipantes/ru_cerr_st_a2').get()).exists, false)
  assert.deepStrictEqual(await participante('ru_cerr', 'st_a1'), antes)
  assert.strictEqual((await entregasDe('ru_cerr')).length, 0)
})
await caso('K · al reabrirlo (atención de inquietudes) continúa donde iba y la nota se registra', async () => {
  await db.doc(`subjects/${S}`).update({ parcialesCerrados: {}, parcialesAtencion: { 2: '2026-11-07T10:00' } })
  const e = await op('estado', { actividadId: 'ru_cerr' })
  assert.deepStrictEqual([e.statusCode, e.cuerpo.estado, e.cuerpo.respondidas], [200, 'lista', 2]) // la que estaba abierta venció
  for (let i = 2; i < 5; i++) {
    await op('girar', { actividadId: 'ru_cerr' })
    ahora += 1000
    await op('responder', { actividadId: 'ru_cerr', indice: i, opcion: await claveAbierta('ru_cerr', 'st_a1') })
  }
  assert.strictEqual((await entrega('ru_cerr', 'st_a1')).calificacion, 8)
})
await caso('K · con el parcial cerrado otra vez, quien ya terminó sigue viendo su resultado (sin escribir nada)', async () => {
  await db.doc(`subjects/${S}`).update({ parcialesCerrados: { 2: '2026-11-07T12:00' } })
  const antes = await participante('ru_cerr', 'st_a1')
  const e = await op('estado', { actividadId: 'ru_cerr' })
  assert.deepStrictEqual([e.statusCode, e.cuerpo.estado, e.cuerpo.resultado.calificacion], [200, 'terminada', 8])
  assert.deepStrictEqual(await participante('ru_cerr', 'st_a1'), antes)
  await db.doc(`subjects/${S}`).update({ parcialesCerrados: {} })
})

// ── L · Nota previa ─────────────────────────────────────────────────────────
grupo('L · una nota que ya puso el docente se conserva')

await caso('L · si el docente ya calificó a mano, se conserva su nota y queda el motivo', async () => {
  await crearRuleta('ru_doc')
  const previa = { actividadId: 'ru_doc', alumnoId: 'st_a1', calificacion: 7, comentario: 'Bien', estado: 'calificado', ultimaCalificacionPor: 'docente' }
  await db.doc('submissions/ru_doc_st_a1').set(previa)
  const r = await jugar('ru_doc', tk.a1, 'st_a1', [true, true, true, true, true])
  assert.deepStrictEqual(r.cuerpo.resultado, { correctas: 5, total: 5, calificacion: 10, notaConservada: true })
  assert.deepStrictEqual(await entrega('ru_doc', 'st_a1'), previa)
  const p = await participante('ru_doc', 'st_a1')
  assert.deepStrictEqual([p.nota.estado, p.nota.motivo], ['conservada', 'nota_previa'])
})
await caso('L · la nota automática de cierre (un 0 sin trabajo) sí se reemplaza, sin su marca de cierre', async () => {
  await db.doc('submissions/ru_doc_st_a2').set({ actividadId: 'ru_doc', alumnoId: 'st_a2', calificacion: 0, comentario: '', estado: 'calificado', sinEntrega: true, cierreParcial: true })
  await jugar('ru_doc', tk.a2, 'st_a2', [true, false, true, false, true])
  const s2 = await entrega('ru_doc', 'st_a2')
  assert.deepStrictEqual([s2.calificacion, s2.ultimaCalificacionPor, 'cierreParcial' in s2], [6, 'servidor', false])
  assert.strictEqual((await participante('ru_doc', 'st_a2')).nota.estado, 'registrada')
})
await caso('L · decisión de la nota (pura)', async () => {
  assert.strictEqual(decisionNotaRuleta(null, 'p'), 'crear')
  assert.strictEqual(decisionNotaRuleta({ calificacion: 0, cierreParcial: true, sinEntrega: true }, 'p'), 'reemplazar')
  assert.strictEqual(decisionNotaRuleta({ calificacion: 0, cierreParcial: true, sinEntrega: true, archivos: ['x'] }, 'p'), 'conservar')
  assert.strictEqual(decisionNotaRuleta({ calificacion: 6, ruleta: { participanteId: 'p' } }, 'p'), 'ya')
  assert.strictEqual(decisionNotaRuleta({ calificacion: 0 }, 'p'), 'conservar')
  assert.strictEqual(decisionNotaRuleta({ comentario: 'hola' }, 'p'), 'completar')
  assert.strictEqual(decisionNotaRuleta({ calificacion: null }, 'p'), 'completar')
})

// ── M · Nota oculta ─────────────────────────────────────────────────────────
grupo('M · con la calificación oculta, la pantalla final no la muestra')

await caso('M · nota oculta: se registra, pero el estudiante no ve ni la nota ni los aciertos', async () => {
  await crearRuleta('ru_ocu')
  await db.doc(`subjects/${S}`).update({ 'calificacionesOcultas.actividades.ru_ocu': true })
  const r = await jugar('ru_ocu', tk.a3, 'st_a3', [true, true, false, true, true])
  assert.deepStrictEqual(r.cuerpo.resultado, { notaOculta: true, total: 5, notaConservada: false })
  const e = await op('estado', { actividadId: 'ru_ocu' }, tk.a3)
  assert.deepStrictEqual(e.cuerpo.resultado, { notaOculta: true, total: 5, notaConservada: false })
  assert.ok(!/calificacion|correctas/.test(JSON.stringify(e.cuerpo)))
  assert.strictEqual((await entrega('ru_ocu', 'st_a3')).calificacion, 8)
  // Al publicarla, la ve.
  await db.doc(`subjects/${S}`).update({ 'calificacionesOcultas.actividades.ru_ocu': false })
  assert.strictEqual((await op('estado', { actividadId: 'ru_ocu' }, tk.a3)).cuerpo.resultado.calificacion, 8)
})

// ── N · Estados (solo lectura) ──────────────────────────────────────────────
grupo('N · estados: el avance del estudiante, sin crear partidas')

await caso('N · devuelve en curso / terminada de SUS ruletas en la asignatura, sin claves ni notas', async () => {
  const antes = (await db.collection('ruletaParticipantes').get()).size
  const a1 = await op('estados', { asignaturaId: S })
  assert.strictEqual(a1.statusCode, 200, JSON.stringify(a1.cuerpo))
  assert.deepStrictEqual(a1.cuerpo.ruletas.ru_ok, { estado: 'terminada', respondidas: 5, total: 5 })
  assert.strictEqual(a1.cuerpo.ruletas.ru_diez, undefined) // no la ha abierto: Pendiente
  const a4 = await op('estados', { asignaturaId: S }, tk.a4)
  assert.deepStrictEqual(a4.cuerpo.ruletas, { ru_diez: { estado: 'en_curso', respondidas: 0, total: 10 } })
  const a2 = await op('estados', { asignaturaId: S }, tk.a2)
  assert.strictEqual(a2.cuerpo.ruletas.ru_ok.estado, 'en_curso')
  for (const r of [a1, a2, a4]) assert.ok(!/correcta|calificacion|preguntas/.test(JSON.stringify(r.cuerpo)))
  assert.strictEqual((await db.collection('ruletaParticipantes').get()).size, antes)
})
await caso('N · otro grupo, el docente, sin sesión o sin asignatura: rechazado; cada quien solo ve lo suyo', async () => {
  const x = await op('estados', { asignaturaId: S }, tk.x)
  assert.deepStrictEqual([x.statusCode, x.cuerpo.codigo], [403, 'NO_INSCRITO'])
  assert.strictEqual((await op('estados', { asignaturaId: S }, tk.doc)).statusCode, 403)
  assert.strictEqual((await op('estados', { asignaturaId: S }, null)).statusCode, 401)
  assert.strictEqual((await op('estados', {})).statusCode, 400)
  const propia = await op('estados', { asignaturaId: S_OTRA }, tk.x)
  assert.deepStrictEqual([propia.statusCode, propia.cuerpo.ruletas], [200, {}])
})

resumen('RULETA-PARTIDA-SERVIDOR CHECKS')
