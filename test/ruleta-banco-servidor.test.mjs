// La Ruleta del Destino · fase 2 — banco del docente contra el emulador (Firestore + Auth), sin red ni costo.
//
//   firebase emulators:exec --only firestore,auth --project demo-test "node test/ruleta-banco-servidor.test.mjs"
//
// Llama al handler real de /api/subject/ruleta-banco (api/_lib/ruletaBanco.js), a la limpieza real al borrar una ruleta
// (functions/ruletaLimpieza.js) y al borrado de cuenta real (api/account/delete.js). Los guardados «simultáneos» se
// lanzan juntos con Promise.all, así que compiten de verdad por la misma transacción del emulador.
import { createRequire } from 'node:module'
import { db, limpiar, caso, grupo, resumen, assert, llamar, sesion, pincharCloudinary } from './helpers/entorno.mjs'
import { handleRuletaBanco, huellaEnunciado } from '../api/_lib/ruletaBanco.js'
import { datosNuevaRuleta } from '../src/utils/ruletaDestino.js'

// Llaves de mentira para el borrado de cuenta (igual que test/servidor.test.mjs); Cloudinary se intercepta.
process.env.CLOUDINARY_API_KEY = 'llave-de-prueba'
process.env.CLOUDINARY_API_SECRET = 'secreto-de-prueba'
const { default: borrarCuenta } = await import('../api/account/delete.js')

const require = createRequire(import.meta.url)
const { limpiarRuletaDeActividad } = require('../functions/ruletaLimpieza.js')

const DOC = 'doc_ruleta'
const DOC2 = 'doc_otro'
const ALUMNO_UID = 'u_alumno'
const S = 'sub_ruleta'
const tk = {}

async function crearRuleta(id, { docenteId = DOC, preguntasPorPartida = 5, extra = {} } = {}) {
  const r = datosNuevaRuleta({ nombre: `Ruleta ${id}`, tema: 'La célula', modalidad: 'vivo', acceso: 'interno', preguntasPorPartida, ranking: true, parcial: 1, orden: 1, asignaturaId: S, docenteId })
  assert.ok(r.ok, r.codigo)
  await db.doc(`activities/${id}`).set({ ...r.datos, ...extra })
}

async function preparar() {
  await limpiar()
  await db.doc(`users/${DOC}`).set({ role: 'docente', nombre: 'Docente', escuelaId: 'E1' })
  await db.doc(`users/${DOC2}`).set({ role: 'docente', nombre: 'Otro', escuelaId: 'E1' })
  await db.doc(`subjects/${S}`).set({ docenteId: DOC, nombre: 'Biología' })
  await crearRuleta('ru_a')
  await crearRuleta('ru_b')
  await crearRuleta('ru_ajena', { docenteId: DOC2 })
  await db.doc('activities/act_normal').set({ docenteId: DOC, asignaturaId: S, categoria: 'cuestionario', tipo: 'evaluacion', parcial: 1, nombre: 'Cuestionario' })
  tk.doc = await sesion(DOC, { email: 'doc@prueba.test' })
  tk.doc2 = await sesion(DOC2, { email: 'otro@prueba.test' })
  tk.alumno = await sesion(ALUMNO_UID, { email: 'al1.e1@evalua.local' })
}

const reactivo = (i, extra = {}) => ({ enunciado: `¿Pregunta número ${i}?`, opciones: [`A${i}`, `B${i}`, `C${i}`, `D${i}`], correcta: i % 4, ...extra })
const op = (operacion, cuerpo = {}, token = tk.doc) => llamar(handleRuletaBanco, { cuerpo: { operacion, ...cuerpo }, token })
const guardar = (actividadId, r, token) => op('guardar', { actividadId, reactivo: r }, token)
const estadoBanco = async (actividadId) => (await db.doc(`ruletaBancos/${actividadId}`).get()).data()
const reactivosDe = async (actividadId) => (await db.collection('ruletaReactivos').where('actividadId', '==', actividadId).get()).docs

async function llenar(actividadId, desde, hasta) {
  for (let i = desde; i < hasta; i++) {
    const r = await guardar(actividadId, reactivo(i))
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.cuerpo))
  }
}

await preparar()

// ── A · Identidad y propiedad ───────────────────────────────────────────────
grupo('A · identidad y propiedad')

await caso('A · el docente dueño guarda un reactivo: id del servidor, huella y estado del banco', async () => {
  const r = await guardar('ru_a', reactivo(1))
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.cuerpo))
  const id = r.cuerpo.reactivo.id
  assert.ok(id.startsWith('ru_a_'))
  const d = (await db.doc(`ruletaReactivos/${id}`).get()).data()
  assert.deepStrictEqual([d.docenteId, d.actividadId, d.enunciado, d.opciones, d.correcta, d.huella],
    [DOC, 'ru_a', '¿Pregunta número 1?', ['A1', 'B1', 'C1', 'D1'], 1, huellaEnunciado('¿Pregunta número 1?')])
  const b = await estadoBanco('ru_a')
  assert.deepStrictEqual([b.docenteId, b.actividadId, b.total, b.aprobado, Object.values(b.huellas)], [DOC, 'ru_a', 1, false, [id]])
  assert.deepStrictEqual(r.cuerpo.banco, { total: 1, aprobado: false, version: 1, origen: 'manual', minimo: 50, maximo: 100 })
  assert.strictEqual(b.origen, 'manual') // el servidor lo crea manual
})

await caso('A · sin sesión: 401; otro docente: 403; un estudiante: 403; ruleta inexistente o no ruleta: 404', async () => {
  assert.strictEqual((await guardar('ru_a', reactivo(2), null)).statusCode, 401)
  assert.strictEqual((await guardar('ru_a', reactivo(2), 'token-falso')).statusCode, 401)
  assert.strictEqual((await guardar('ru_a', reactivo(2), tk.doc2)).statusCode, 403)
  assert.strictEqual((await guardar('ru_a', reactivo(2), tk.alumno)).statusCode, 403)
  assert.strictEqual((await guardar('no_existe', reactivo(2))).statusCode, 404)
  assert.strictEqual((await guardar('act_normal', reactivo(2))).statusCode, 404)
  assert.strictEqual((await guardar('ru_ajena', reactivo(2))).statusCode, 403)
  for (const operacion of ['editar', 'borrar', 'aprobar', 'config']) {
    const r = await op(operacion, { actividadId: 'ru_a', reactivoId: 'x', reactivo: reactivo(3), preguntasPorPartida: 10 }, tk.doc2)
    assert.strictEqual(r.statusCode, 403, `${operacion} de otro docente`)
  }
  assert.strictEqual((await estadoBanco('ru_a')).total, 1) // nada cambió
})

await caso('A · operación desconocida, sin actividad, id con barra o método distinto de POST: rechazados', async () => {
  assert.strictEqual((await op('publicar', { actividadId: 'ru_a' })).statusCode, 400)
  assert.strictEqual((await op('guardar', { reactivo: reactivo(4) })).statusCode, 400)
  assert.strictEqual((await op('guardar', { actividadId: 'ru_a/../x', reactivo: reactivo(4) })).statusCode, 400)
  assert.strictEqual((await llamar(handleRuletaBanco, { metodo: 'GET', token: tk.doc })).statusCode, 405)
})

// ── B · Validación de reactivos ─────────────────────────────────────────────
grupo('B · validación de reactivos')

await caso('B · reactivos inválidos se rechazan con 400 y no tocan nada', async () => {
  const antes = await estadoBanco('ru_a')
  for (const [motivo, r, codigo] of [
    ['sin enunciado', reactivo(5, { enunciado: '  ' }), 'enunciado'],
    ['3 opciones', reactivo(5, { opciones: ['a', 'b', 'c'] }), 'opciones_cantidad'],
    ['5 opciones', reactivo(5, { opciones: ['a', 'b', 'c', 'd', 'e'] }), 'opciones_cantidad'],
    ['opción vacía', reactivo(5, { opciones: ['a', '', 'c', 'd'] }), 'opcion_vacia'],
    ['opciones repetidas', reactivo(5, { opciones: ['Célula', 'celula', 'c', 'd'] }), 'opciones_repetidas'],
    ['correcta fuera de rango', reactivo(5, { correcta: 4 }), 'correcta'],
    ['correcta como texto', reactivo(5, { correcta: '1' }), 'correcta'],
    ['enunciado larguísimo', reactivo(5, { enunciado: 'x'.repeat(501) }), 'enunciado_largo'],
    ['opción que no es texto', reactivo(5, { opciones: [1, 2, 3, 4] }), 'opcion_vacia'],
  ]) {
    const res = await guardar('ru_a', r)
    assert.strictEqual(res.statusCode, 400, motivo)
    assert.strictEqual(res.cuerpo.codigo, 'REACTIVO_INVALIDO', motivo)
    assert.ok(res.cuerpo.errores.includes(codigo), `${motivo}: ${res.cuerpo.errores}`)
  }
  assert.deepStrictEqual(await estadoBanco('ru_a'), antes)
  assert.strictEqual((await reactivosDe('ru_a')).length, 1)
})

await caso('B · un enunciado repetido (con otras mayúsculas, acentos o espacios) se rechaza', async () => {
  const r = await guardar('ru_a', reactivo(1, { enunciado: '  ¿PREGUNTA   número 1?' }))
  assert.strictEqual(r.statusCode, 409)
  assert.strictEqual(r.cuerpo.codigo, 'DUPLICADO')
  assert.strictEqual((await reactivosDe('ru_a')).length, 1)
})

await caso('B · el mismo enunciado en OTRA ruleta sí se acepta (las huellas son por ruleta)', async () => {
  assert.strictEqual((await guardar('ru_b', reactivo(1))).statusCode, 200)
})

// ── C · Concurrencia ────────────────────────────────────────────────────────
grupo('C · guardados simultáneos')

await caso('C · 8 guardados simultáneos del MISMO enunciado: entra uno solo', async () => {
  const rs = await Promise.all(Array.from({ length: 8 }, () => guardar('ru_b', reactivo(77))))
  const ok = rs.filter((r) => r.statusCode === 200).length
  const dup = rs.filter((r) => r.statusCode === 409 && r.cuerpo.codigo === 'DUPLICADO').length
  assert.deepStrictEqual([ok, dup], [1, 7], rs.map((r) => r.statusCode).join(','))
  const docs = await reactivosDe('ru_b')
  assert.strictEqual(docs.filter((d) => d.data().enunciado === '¿Pregunta número 77?').length, 1)
  assert.strictEqual((await estadoBanco('ru_b')).total, docs.length)
})

await caso('C · 12 guardados simultáneos distintos: entran todos y el total cuadra', async () => {
  const antes = (await reactivosDe('ru_b')).length
  const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => guardar('ru_b', reactivo(200 + i))))
  assert.ok(rs.every((r) => r.statusCode === 200), rs.map((r) => r.statusCode).join(','))
  const despues = (await reactivosDe('ru_b')).length
  assert.strictEqual(despues, antes + 12)
  assert.strictEqual((await estadoBanco('ru_b')).total, despues)
  assert.strictEqual(Object.keys((await estadoBanco('ru_b')).huellas).length, despues)
})

// ── D · Límites, aprobación y su pérdida ────────────────────────────────────
grupo('D · límites, aprobación y pérdida de la aprobación')

await caso('D · aprobar un banco manual incompleto (49 de 50) se rechaza sin aprobar', async () => {
  await llenar('ru_a', 2, 50) // ya tenía 1 → 49
  assert.strictEqual((await estadoBanco('ru_a')).total, 49)
  const r = await op('aprobar', { actividadId: 'ru_a' })
  assert.strictEqual(r.statusCode, 409)
  assert.strictEqual(r.cuerpo.codigo, 'BANCO_INCOMPLETO')
  assert.strictEqual((await estadoBanco('ru_a')).aprobado, false)
})

await caso('D · con 50 de 50 se aprueba; la aprobación vive solo en ruletaBancos', async () => {
  await llenar('ru_a', 50, 51)
  const r = await op('aprobar', { actividadId: 'ru_a' })
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.cuerpo))
  const b = await estadoBanco('ru_a')
  assert.deepStrictEqual([b.total, b.aprobado, b.aprobadoEn != null], [50, true, true])
  const act = (await db.doc('activities/ru_a').get()).data()
  assert.ok(!('aprobado' in act) && !('aprobado' in act.ruleta) && !('bancoAprobado' in act.ruleta))
})

await caso('D · editar después de aprobar retira la aprobación (también si solo cambia la correcta)', async () => {
  const [d] = await reactivosDe('ru_a')
  const r = await op('editar', { actividadId: 'ru_a', reactivoId: d.id, reactivo: { ...reactivo(999), correcta: 0 } })
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.cuerpo))
  assert.strictEqual((await estadoBanco('ru_a')).aprobado, false)
  assert.strictEqual((await op('aprobar', { actividadId: 'ru_a' })).statusCode, 200)
  const r2 = await op('editar', { actividadId: 'ru_a', reactivoId: d.id, reactivo: { ...reactivo(999), correcta: 3 } })
  assert.strictEqual(r2.statusCode, 200)
  const b = await estadoBanco('ru_a')
  assert.deepStrictEqual([b.aprobado, b.aprobadoEn, b.total], [false, null, 50])
})

await caso('D · editar actualiza la huella: el enunciado viejo queda libre y el nuevo ocupado', async () => {
  const [d] = (await reactivosDe('ru_a')).filter((x) => x.data().enunciado === '¿Pregunta número 999?')
  assert.strictEqual((await guardar('ru_a', reactivo(999))).statusCode, 409) // ocupado por el editado
  const r = await op('editar', { actividadId: 'ru_a', reactivoId: d.id, reactivo: reactivo(1999) })
  assert.strictEqual(r.statusCode, 200)
  const b = await estadoBanco('ru_a')
  assert.ok(!(huellaEnunciado('¿Pregunta número 999?') in b.huellas))
  assert.strictEqual(b.huellas[huellaEnunciado('¿Pregunta número 1999?')], d.id)
})

await caso('D · editar a un enunciado que ya tiene OTRO reactivo se rechaza sin cambiar nada', async () => {
  const docs = await reactivosDe('ru_a')
  const [x, y] = docs
  const antes = (await db.doc(`ruletaReactivos/${x.id}`).get()).data()
  const r = await op('editar', { actividadId: 'ru_a', reactivoId: x.id, reactivo: { ...reactivo(1), enunciado: y.data().enunciado } })
  assert.strictEqual(r.statusCode, 409)
  assert.deepStrictEqual((await db.doc(`ruletaReactivos/${x.id}`).get()).data(), antes)
})

await caso('D · borrar después de aprobar retira la aprobación y resta; borrar dos veces da 404', async () => {
  assert.strictEqual((await op('aprobar', { actividadId: 'ru_a' })).statusCode, 200)
  const [d] = await reactivosDe('ru_a')
  const r = await op('borrar', { actividadId: 'ru_a', reactivoId: d.id })
  assert.strictEqual(r.statusCode, 200)
  const b = await estadoBanco('ru_a')
  assert.deepStrictEqual([b.total, b.aprobado], [49, false])
  assert.ok(!Object.values(b.huellas).includes(d.id))
  assert.strictEqual((await op('borrar', { actividadId: 'ru_a', reactivoId: d.id })).statusCode, 404)
  assert.strictEqual((await op('editar', { actividadId: 'ru_a', reactivoId: d.id, reactivo: reactivo(5000) })).statusCode, 404)
})

await caso('D · un reactivo de OTRA ruleta no se edita ni se borra desde esta', async () => {
  const [ajeno] = await reactivosDe('ru_b')
  assert.strictEqual((await op('borrar', { actividadId: 'ru_a', reactivoId: ajeno.id })).statusCode, 404)
  assert.strictEqual((await op('editar', { actividadId: 'ru_a', reactivoId: ajeno.id, reactivo: reactivo(6000) })).statusCode, 404)
  assert.ok((await db.doc(`ruletaReactivos/${ajeno.id}`).get()).exists)
})

await caso('D · con el máximo (100 para 5 preguntas) no entra uno más; aprobar con 100 sí', async () => {
  await llenar('ru_a', 3000, 3051) // 49 → 100
  assert.strictEqual((await estadoBanco('ru_a')).total, 100)
  const r = await guardar('ru_a', reactivo(4000))
  assert.strictEqual(r.statusCode, 409)
  assert.strictEqual(r.cuerpo.codigo, 'BANCO_LLENO')
  assert.strictEqual((await op('aprobar', { actividadId: 'ru_a' })).statusCode, 200)
})

await caso('D · aprobación falsificada imposible: un estado «aprobado» con reactivos de menos no pasa al aprobar de nuevo', async () => {
  // Simula un estado alterado (solo podría pasar por un error del servidor): total que no cuadra con los reactivos.
  await db.doc('ruletaBancos/ru_b').update({ total: 50, aprobado: false })
  const r = await op('aprobar', { actividadId: 'ru_b' })
  assert.strictEqual(r.statusCode, 409)
  assert.strictEqual((await estadoBanco('ru_b')).aprobado, false)
})

// ── E · Cambiar preguntas por partida ───────────────────────────────────────
grupo('E · cambiar preguntas por partida (R6, F2-6)')

await caso('E · con 100 reactivos: de 5 a 10 sí (mínimo 100, máximo 200); 20 no existe y nada cambia', async () => {
  const r = await op('config', { actividadId: 'ru_a', preguntasPorPartida: 10 })
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.cuerpo))
  assert.deepStrictEqual([r.cuerpo.banco.total, r.cuerpo.banco.minimo, r.cuerpo.banco.maximo], [100, 100, 200])
  assert.strictEqual((await db.doc('activities/ru_a').get()).data().ruleta.preguntasPorPartida, 10)
  const r2 = await op('config', { actividadId: 'ru_a', preguntasPorPartida: 20 })
  assert.strictEqual(r2.statusCode, 409)
  assert.strictEqual(r2.cuerpo.codigo, 'PREGUNTAS_POR_PARTIDA')
  assert.strictEqual(r2.cuerpo.error, 'Elige 5 o 10 preguntas por partida.')
  assert.strictEqual((await db.doc('activities/ru_a').get()).data().ruleta.preguntasPorPartida, 10)
})

await caso('E · valor inválido, el mismo valor o un banco por encima del nuevo máximo: rechazados sin cambios', async () => {
  for (const v of [7, '10', null, 20, 15]) assert.strictEqual((await op('config', { actividadId: 'ru_a', preguntasPorPartida: v })).statusCode, 409, String(v))
  assert.strictEqual((await op('config', { actividadId: 'ru_a', preguntasPorPartida: 10 })).cuerpo.codigo, 'SIN_CAMBIO')
  // Un banco de 101 reactivos para 10 preguntas no puede pasar a 5 (máximo 100).
  await crearRuleta('ru_grande', { preguntasPorPartida: 10 })
  await llenar('ru_grande', 0, 101)
  const r = await op('config', { actividadId: 'ru_grande', preguntasPorPartida: 5 })
  assert.strictEqual(r.statusCode, 409)
  assert.strictEqual(r.cuerpo.codigo, 'BANCO_EXCEDIDO')
  assert.strictEqual(r.cuerpo.error, 'Para 5 preguntas el banco puede tener como máximo 100 reactivos.')
  assert.strictEqual((await db.doc('activities/ru_grande').get()).data().ruleta.preguntasPorPartida, 10)
})

await caso('E · con 10 preguntas el banco manual va de 100 a 200: con 99 no se aprueba, con 100 sí; con 200 no entra otro ni baja a 5', async () => {
  await crearRuleta('ru_diez', { preguntasPorPartida: 10 })
  await llenar('ru_diez', 0, 99)
  const inc = await op('aprobar', { actividadId: 'ru_diez' })
  assert.deepStrictEqual([inc.statusCode, inc.cuerpo.codigo, inc.cuerpo.error], [409, 'BANCO_INCOMPLETO', 'Faltan reactivos: necesitas al menos 100.'])
  await llenar('ru_diez', 99, 100)
  assert.strictEqual((await op('aprobar', { actividadId: 'ru_diez' })).statusCode, 200)
  await llenar('ru_diez', 100, 200)
  const lleno = await guardar('ru_diez', reactivo(9999))
  assert.deepStrictEqual([lleno.statusCode, lleno.cuerpo.codigo], [409, 'BANCO_LLENO'])
  assert.strictEqual((await estadoBanco('ru_diez')).total, 200)
  // De 10 a 5 con 200 reactivos: excede el máximo de 5 (100).
  const bajar = await op('config', { actividadId: 'ru_diez', preguntasPorPartida: 5 })
  assert.deepStrictEqual([bajar.statusCode, bajar.cuerpo.codigo], [409, 'BANCO_EXCEDIDO'])
})

await caso('E · una ruleta guardada con 20 preguntas (fuera del sistema) no admite ninguna operación y no se toca', async () => {
  const r = datosNuevaRuleta({ nombre: 'Ruleta 20', tema: 'La célula', modalidad: 'vivo', acceso: 'interno', preguntasPorPartida: 20, ranking: true, parcial: 1, orden: 1, asignaturaId: S, docenteId: DOC })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'Elige 5 o 10 preguntas por partida.')
  const base = datosNuevaRuleta({ nombre: 'Ruleta 20', tema: 'La célula', modalidad: 'vivo', acceso: 'interno', preguntasPorPartida: 10, ranking: true, parcial: 1, orden: 1, asignaturaId: S, docenteId: DOC }).datos
  await db.doc('activities/ru_veinte').set({ ...base, ruleta: { ...base.ruleta, preguntasPorPartida: 20 } })
  for (const [operacion, extra] of [['guardar', { reactivo: reactivo(1) }], ['aprobar', {}], ['config', { preguntasPorPartida: 10 }], ['borrar', { reactivoId: 'x' }]]) {
    const res = await op(operacion, { actividadId: 'ru_veinte', ...extra })
    assert.deepStrictEqual([res.statusCode, res.cuerpo.codigo], [409, 'MAL_CONFIGURADA'], operacion)
  }
  assert.strictEqual((await reactivosDe('ru_veinte')).length, 0)
  assert.strictEqual((await db.doc('ruletaBancos/ru_veinte').get()).exists, false)
  assert.strictEqual((await db.doc('activities/ru_veinte').get()).data().ruleta.preguntasPorPartida, 20)
})

await caso('E · con preguntasCongeladas o con una sesión existente: rechazado sin cambios', async () => {
  await crearRuleta('ru_jugada', { extra: {} })
  await db.doc('activities/ru_jugada').update({ 'ruleta.preguntasCongeladas': true })
  await llenar('ru_jugada', 0, 100)
  const r = await op('config', { actividadId: 'ru_jugada', preguntasPorPartida: 10 })
  assert.strictEqual(r.statusCode, 409)
  assert.strictEqual(r.cuerpo.codigo, 'CONGELADAS')
  assert.strictEqual((await db.doc('activities/ru_jugada').get()).data().ruleta.preguntasPorPartida, 5)
  await crearRuleta('ru_con_sesion')
  await llenar('ru_con_sesion', 0, 100)
  await db.doc('ruletaSesiones/SESION1').set({ docenteId: DOC, actividadId: 'ru_con_sesion' })
  const r2 = await op('config', { actividadId: 'ru_con_sesion', preguntasPorPartida: 10 })
  assert.strictEqual(r2.statusCode, 409)
  assert.strictEqual((await db.doc('activities/ru_con_sesion').get()).data().ruleta.preguntasPorPartida, 5)
})

await caso('E · el cambio deja intactos modalidad, acceso, ranking y la bandera', async () => {
  const r = (await db.doc('activities/ru_a').get()).data().ruleta
  assert.deepStrictEqual(r, { modalidad: 'vivo', acceso: 'interno', preguntasPorPartida: 10, ranking: true })
})

// ── G · Origen del banco (manual / IA) ──────────────────────────────────────
grupo('G · origen del banco: lo fija el servidor; el mínimo para aprobar depende de él')

// Simula lo que hará la generación con IA de la fase 3 (todavía no existe): reactivos y estado escritos por el servidor
// con origen 'ia'. Se escribe con el SDK de administrador, igual que lo haría el servidor.
async function sembrarBancoIA(id, n, total) {
  await crearRuleta(id, { preguntasPorPartida: n })
  const lote = db.batch()
  const huellas = {}
  for (let i = 0; i < total; i++) {
    const r = reactivo(70000 + i)
    const rid = `${id}_ia${i}`
    const huella = huellaEnunciado(r.enunciado)
    huellas[huella] = rid
    lote.set(db.doc(`ruletaReactivos/${rid}`), { docenteId: DOC, actividadId: id, ...r, huella })
  }
  lote.set(db.doc(`ruletaBancos/${id}`), { docenteId: DOC, actividadId: id, origen: 'ia', total, huellas, aprobado: false, aprobadoEn: null, version: total })
  await lote.commit()
}

await caso('G · un origen enviado por el navegador se ignora: el banco nace manual y con 25 no se aprueba', async () => {
  await crearRuleta('ru_trampa')
  for (let i = 0; i < 25; i++) {
    const r = await op('guardar', { actividadId: 'ru_trampa', reactivo: reactivo(i), origen: 'ia' })
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.cuerpo))
  }
  const b = await estadoBanco('ru_trampa')
  assert.deepStrictEqual([b.origen, b.total], ['manual', 25])
  const a = await op('aprobar', { actividadId: 'ru_trampa', origen: 'ia', banco: { origen: 'ia' } })
  assert.deepStrictEqual([a.statusCode, a.cuerpo.codigo, a.cuerpo.error], [409, 'BANCO_INCOMPLETO', 'Faltan reactivos: necesitas al menos 50.'])
  assert.deepStrictEqual([(await estadoBanco('ru_trampa')).origen, (await estadoBanco('ru_trampa')).aprobado], ['manual', false])
})

await caso('G · banco IA de 25 para 5 preguntas: se aprueba; el resumen dice origen ia, mínimo 25 y máximo 100', async () => {
  await sembrarBancoIA('ru_ia5', 5, 25)
  const a = await op('aprobar', { actividadId: 'ru_ia5' })
  assert.strictEqual(a.statusCode, 200, JSON.stringify(a.cuerpo))
  assert.deepStrictEqual([a.cuerpo.banco.origen, a.cuerpo.banco.minimo, a.cuerpo.banco.maximo, a.cuerpo.banco.aprobado], ['ia', 25, 100, true])
  assert.deepStrictEqual([(await estadoBanco('ru_ia5')).origen, (await estadoBanco('ru_ia5')).aprobado], ['ia', true])
})

await caso('G · editar o agregar en un banco IA conserva el origen; borrar por debajo de 25 impide aprobar', async () => {
  const [d] = await reactivosDe('ru_ia5')
  const e = await op('editar', { actividadId: 'ru_ia5', reactivoId: d.id, reactivo: reactivo(80001), origen: 'manual' })
  assert.strictEqual(e.statusCode, 200, JSON.stringify(e.cuerpo))
  assert.deepStrictEqual([e.cuerpo.banco.origen, (await estadoBanco('ru_ia5')).origen, (await estadoBanco('ru_ia5')).aprobado], ['ia', 'ia', false])
  const g = await guardar('ru_ia5', reactivo(80002))
  assert.deepStrictEqual([g.statusCode, g.cuerpo.banco.origen, g.cuerpo.banco.total], [200, 'ia', 26])
  assert.strictEqual((await op('aprobar', { actividadId: 'ru_ia5' })).statusCode, 200) // 26 ≥ 25
  const docs = await reactivosDe('ru_ia5')
  for (const x of docs.slice(0, 2)) assert.strictEqual((await op('borrar', { actividadId: 'ru_ia5', reactivoId: x.id })).statusCode, 200)
  const b = await estadoBanco('ru_ia5')
  assert.deepStrictEqual([b.origen, b.total, b.aprobado], ['ia', 24, false])
  const a = await op('aprobar', { actividadId: 'ru_ia5' })
  assert.deepStrictEqual([a.statusCode, a.cuerpo.codigo, a.cuerpo.error], [409, 'BANCO_INCOMPLETO', 'Faltan reactivos: necesitas al menos 25.'])
})

await caso('G · banco IA para 10 preguntas: 49 no se aprueba, 50 sí; el máximo sigue siendo 200', async () => {
  await sembrarBancoIA('ru_ia10_49', 10, 49)
  const no = await op('aprobar', { actividadId: 'ru_ia10_49' })
  assert.deepStrictEqual([no.statusCode, no.cuerpo.codigo, no.cuerpo.error], [409, 'BANCO_INCOMPLETO', 'Faltan reactivos: necesitas al menos 50.'])
  await sembrarBancoIA('ru_ia10', 10, 50)
  const si = await op('aprobar', { actividadId: 'ru_ia10' })
  assert.strictEqual(si.statusCode, 200, JSON.stringify(si.cuerpo))
  assert.deepStrictEqual([si.cuerpo.banco.origen, si.cuerpo.banco.minimo, si.cuerpo.banco.maximo], ['ia', 50, 200])
})

await caso('G · cambiar de tamaño con un banco IA usa el mínimo de IA del nuevo tamaño', async () => {
  await sembrarBancoIA('ru_ia_cambio', 5, 50)
  const r = await op('config', { actividadId: 'ru_ia_cambio', preguntasPorPartida: 10 })
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.cuerpo))
  assert.deepStrictEqual([r.cuerpo.banco.origen, r.cuerpo.banco.minimo, r.cuerpo.banco.maximo], ['ia', 50, 200])
  assert.strictEqual((await estadoBanco('ru_ia_cambio')).origen, 'ia')
})

// ── H · Banco vaciado: el origen vuelve a manual al llegar a 0 ───────────────
grupo('H · banco vaciado: al borrar el último reactivo el servidor deja el origen en manual')

const borrar = (actividadId, reactivoId) => op('borrar', { actividadId, reactivoId })

await caso('H · IA 25 → borrar uno → 24, sigue ia (estado y respuesta)', async () => {
  await sembrarBancoIA('ru_v25', 5, 25)
  const [d] = await reactivosDe('ru_v25')
  const r = await borrar('ru_v25', d.id)
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.cuerpo))
  assert.deepStrictEqual([r.cuerpo.banco.total, r.cuerpo.banco.origen, r.cuerpo.banco.minimo], [24, 'ia', 25])
  const b = await estadoBanco('ru_v25')
  assert.deepStrictEqual([b.total, b.origen], [24, 'ia'])
})

await caso('H · IA 2 → borrar uno → 1, sigue ia', async () => {
  await sembrarBancoIA('ru_v2', 5, 2)
  const [d] = await reactivosDe('ru_v2')
  const r = await borrar('ru_v2', d.id)
  assert.deepStrictEqual([r.statusCode, r.cuerpo.banco.total, r.cuerpo.banco.origen], [200, 1, 'ia'])
  assert.deepStrictEqual([(await estadoBanco('ru_v2')).total, (await estadoBanco('ru_v2')).origen], [1, 'ia'])
})

await caso('H · IA 1 → borrar el último → 0 y manual; la respuesta ya trae origen manual, mínimo 50 y máximo 100', async () => {
  const [d] = await reactivosDe('ru_v2')
  const r = await borrar('ru_v2', d.id)
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.cuerpo))
  assert.deepStrictEqual(
    [r.cuerpo.banco.total, r.cuerpo.banco.origen, r.cuerpo.banco.minimo, r.cuerpo.banco.maximo, r.cuerpo.banco.aprobado],
    [0, 'manual', 50, 100, false],
  )
  const b = await estadoBanco('ru_v2')
  assert.deepStrictEqual([b.total, b.origen, b.aprobado, b.huellas], [0, 'manual', false, {}])
  assert.strictEqual((await reactivosDe('ru_v2')).length, 0)
})

await caso('H · banco manual que llega a 0 sigue manual', async () => {
  await crearRuleta('ru_vman')
  await llenar('ru_vman', 0, 2)
  for (const d of await reactivosDe('ru_vman')) assert.strictEqual((await borrar('ru_vman', d.id)).statusCode, 200)
  const b = await estadoBanco('ru_vman')
  assert.deepStrictEqual([b.total, b.origen], [0, 'manual'])
})

await caso('H · el banco vacío no se aprueba (el que fue IA y el manual)', async () => {
  for (const id of ['ru_v2', 'ru_vman']) {
    const a = await op('aprobar', { actividadId: id })
    assert.deepStrictEqual([a.statusCode, a.cuerpo.codigo, a.cuerpo.error], [409, 'BANCO_INCOMPLETO', 'Faltan reactivos: necesitas al menos 50.'], id)
    assert.strictEqual((await estadoBanco(id)).aprobado, false)
  }
})

await caso('H · IA vaciado (5 preguntas) + 25 capturados a mano: NO se aprueba; con 50 sí', async () => {
  await llenar('ru_v2', 1000, 1025)
  const b = await estadoBanco('ru_v2')
  assert.deepStrictEqual([b.total, b.origen], [25, 'manual'])
  const a = await op('aprobar', { actividadId: 'ru_v2' })
  assert.deepStrictEqual([a.statusCode, a.cuerpo.codigo, a.cuerpo.error], [409, 'BANCO_INCOMPLETO', 'Faltan reactivos: necesitas al menos 50.'])
  await llenar('ru_v2', 1025, 1050)
  const si = await op('aprobar', { actividadId: 'ru_v2' })
  assert.deepStrictEqual([si.statusCode, si.cuerpo.banco.origen, si.cuerpo.banco.minimo], [200, 'manual', 50])
})

await caso('H · IA vaciado (10 preguntas) + 50 capturados a mano: NO se aprueba (pide 100)', async () => {
  await sembrarBancoIA('ru_v10', 10, 1)
  const [d] = await reactivosDe('ru_v10')
  const r = await borrar('ru_v10', d.id)
  assert.deepStrictEqual([r.statusCode, r.cuerpo.banco.origen, r.cuerpo.banco.minimo, r.cuerpo.banco.maximo], [200, 'manual', 100, 200])
  await llenar('ru_v10', 2000, 2050)
  assert.deepStrictEqual([(await estadoBanco('ru_v10')).total, (await estadoBanco('ru_v10')).origen], [50, 'manual'])
  const a = await op('aprobar', { actividadId: 'ru_v10' })
  assert.deepStrictEqual([a.statusCode, a.cuerpo.codigo, a.cuerpo.error], [409, 'BANCO_INCOMPLETO', 'Faltan reactivos: necesitas al menos 100.'])
})

await caso('H · simultáneos: IA de 2, se borran los dos a la vez → 0 y manual', async () => {
  await sembrarBancoIA('ru_vsim2', 5, 2)
  const docs = await reactivosDe('ru_vsim2')
  const rs = await Promise.all(docs.map((d) => borrar('ru_vsim2', d.id)))
  assert.ok(rs.every((r) => r.statusCode === 200), rs.map((r) => r.statusCode).join(','))
  const b = await estadoBanco('ru_vsim2')
  assert.deepStrictEqual([b.total, b.origen, (await reactivosDe('ru_vsim2')).length], [0, 'manual', 0])
  // Solo la última respuesta (la que dejó el banco en 0) dice manual; la otra vio 1 y siguió en ia.
  assert.deepStrictEqual(rs.map((r) => `${r.cuerpo.banco.total}:${r.cuerpo.banco.origen}`).sort(), ['0:manual', '1:ia'])
})

await caso('H · simultáneos: IA de 3, se borran dos a la vez → 1 y sigue ia', async () => {
  await sembrarBancoIA('ru_vsim3', 5, 3)
  const docs = await reactivosDe('ru_vsim3')
  const rs = await Promise.all(docs.slice(0, 2).map((d) => borrar('ru_vsim3', d.id)))
  assert.ok(rs.every((r) => r.statusCode === 200), rs.map((r) => r.statusCode).join(','))
  const b = await estadoBanco('ru_vsim3')
  assert.deepStrictEqual([b.total, b.origen, (await reactivosDe('ru_vsim3')).length], [1, 'ia', 1])
})

await caso('H · simultáneos: IA de 6, se borran los seis a la vez → 0 y manual; el total cuadra con los documentos', async () => {
  await sembrarBancoIA('ru_vsim6', 5, 6)
  const docs = await reactivosDe('ru_vsim6')
  const rs = await Promise.all(docs.map((d) => borrar('ru_vsim6', d.id)))
  assert.ok(rs.every((r) => r.statusCode === 200), rs.map((r) => r.statusCode).join(','))
  assert.deepStrictEqual(rs.map((r) => r.cuerpo.banco.total).sort(), [0, 1, 2, 3, 4, 5])
  assert.ok(rs.every((r) => r.cuerpo.banco.origen === (r.cuerpo.banco.total === 0 ? 'manual' : 'ia')))
  const b = await estadoBanco('ru_vsim6')
  assert.deepStrictEqual([b.total, b.origen, Object.keys(b.huellas).length, (await reactivosDe('ru_vsim6')).length], [0, 'manual', 0, 0])
})

await caso('H · simultáneos: el MISMO último reactivo borrado 4 veces a la vez → uno entra, los demás 404; 0 y manual', async () => {
  await sembrarBancoIA('ru_vmismo', 5, 1)
  const [d] = await reactivosDe('ru_vmismo')
  const rs = await Promise.all(Array.from({ length: 4 }, () => borrar('ru_vmismo', d.id)))
  assert.deepStrictEqual(rs.map((r) => r.statusCode).sort(), [200, 404, 404, 404])
  const b = await estadoBanco('ru_vmismo')
  assert.deepStrictEqual([b.total, b.origen], [0, 'manual'])
})

// ── F · Limpieza al borrar una ruleta y al borrar la cuenta ──────────────────
grupo('F · limpieza (C2/F2-2) y borrado de cuenta (F2-3)')

await caso('F · borrar un borrador limpia SUS reactivos y su estado; las demás ruletas no se tocan', async () => {
  const otrasAntes = (await reactivosDe('ru_b')).length
  const ajenaAntes = (await reactivosDe('ru_ajena')).length
  await db.doc('activities/ru_grande').delete()
  const r = await limpiarRuletaDeActividad({ activityId: 'ru_grande' })
  assert.strictEqual(r.borrados, 102) // 101 reactivos + su estado
  assert.strictEqual((await reactivosDe('ru_grande')).length, 0)
  assert.strictEqual((await db.doc('ruletaBancos/ru_grande').get()).exists, false)
  assert.strictEqual((await reactivosDe('ru_b')).length, otrasAntes)
  assert.strictEqual((await reactivosDe('ru_ajena')).length, ajenaAntes)
  assert.ok((await db.doc('ruletaBancos/ru_b').get()).exists)
})

await caso('F · repetir la limpieza no falla ni borra nada más; un id inválido no hace nada', async () => {
  assert.deepStrictEqual(await limpiarRuletaDeActividad({ activityId: 'ru_grande' }), { borrados: 0 })
  assert.deepStrictEqual(await limpiarRuletaDeActividad({ activityId: 'a/b' }), { borrados: 0 })
  assert.deepStrictEqual(await limpiarRuletaDeActividad({ activityId: '' }), { borrados: 0 })
  assert.ok((await reactivosDe('ru_b')).length > 0)
})

await caso('F · la limpieza no toca otras categorías ni documentos sin ese actividadId', async () => {
  await db.doc('bancoReactivos/br1').set({ docenteId: DOC, actividadId: 'act_normal', enunciado: 'x' })
  await db.doc('activities/act_normal/preguntas/p1').set({ enunciado: 'x' })
  await limpiarRuletaDeActividad({ activityId: 'act_normal' })
  assert.ok((await db.doc('bancoReactivos/br1').get()).exists)
  assert.ok((await db.doc('activities/act_normal/preguntas/p1').get()).exists)
})

await caso('F · borrar la cuenta del docente elimina ruletaReactivos y ruletaBancos SUYOS; los del otro docente quedan', async () => {
  // Datos del otro docente: su ruleta (ru_ajena) con un reactivo guardado por él.
  assert.strictEqual((await guardar('ru_ajena', reactivo(1), tk.doc2)).statusCode, 200)
  assert.ok((await db.collection('ruletaReactivos').where('docenteId', '==', DOC).get()).size > 0)
  const cloud = pincharCloudinary()
  const r = await llamar(borrarCuenta, { token: await sesion(DOC), cuerpo: { confirmacion: 'ELIMINAR' } })
  cloud.restaurar()
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.cuerpo))
  assert.strictEqual((await db.collection('ruletaReactivos').where('docenteId', '==', DOC).get()).size, 0)
  assert.strictEqual((await db.collection('ruletaBancos').where('docenteId', '==', DOC).get()).size, 0)
  assert.strictEqual((await db.collection('ruletaReactivos').where('docenteId', '==', DOC2).get()).size, 1)
  assert.ok((await db.doc('ruletaBancos/ru_ajena').get()).exists)
})

resumen('RULETA-BANCO-SERVIDOR CHECKS')
