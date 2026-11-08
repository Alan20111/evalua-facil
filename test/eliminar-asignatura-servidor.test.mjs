// F-09 · eliminar una asignatura completa en el servidor (api/_lib/eliminarAsignatura.js), contra el emulador.
//
//   node scripts/sync-functions-shared.mjs
//   firebase emulators:exec --only firestore,auth --project demo-test "node test/eliminar-asignatura-servidor.test.mjs"
//
// Siembra una asignatura con TODO lo que puede colgar de ella (actividades con preguntas/clave/historiales,
// entregas con respuestas/historial/intentos/progreso, anuladas, estudiantes, asistencia, avisos, fuentes, recursos,
// archivos de Cloudinary, subcolecciones de la asignatura, Reto Exprés, Participación en vivo y La Ruleta), otra
// asignatura del MISMO docente, una de OTRO docente y registros que no son de la asignatura (no se deben tocar).
// Los triggers de limpieza de Reto/Participación/Ruleta se simulan llamando a sus funciones reales.
import { createRequire } from 'node:module'
// Llaves falsas: con ellas borrarAssets llama a Cloudinary (interceptado por pincharCloudinary), igual que en servidor.test.mjs.
process.env.CLOUDINARY_API_KEY = 'llave-de-prueba'
process.env.CLOUDINARY_API_SECRET = 'secreto-de-prueba'
import { db, limpiar, caso, grupo, resumen, assert, llamar, sesion, pincharCloudinary, urlCloudinary } from './helpers/entorno.mjs'
import { handleEliminarAsignatura, ejecutarEliminacionAsignatura, fijarPruebasEliminacion, CONTROL, ESPERA_BARRIDO_MS } from '../api/_lib/eliminarAsignatura.js'

const require = createRequire(import.meta.url)
const { limpiarRetoDeActividad } = require('../functions/retoLimpieza.js')
const { limpiarVivoDeActividad } = require('../functions/participacionVivo.js')
// La Ruleta todavía vive en su rama (worktree evalua-facil-ruleta); su limpieza se usa tal cual, solo para leerla.
let limpiarRuletaDeActividad = null
try { ({ limpiarRuletaDeActividad } = require('../../evalua-facil-ruleta/functions/ruletaLimpieza.js')) } catch { /* sin la rama */ }

const DOC = 'doc_f09', DOC2 = 'doc_ajeno', S = 'sub_f09', S_MISMO = 'sub_mismo', S_AJENA = 'sub_ajena'
const HOY = '2026-11-01T08:00'
const tk = {}

// Reloj: tiempo real (para el presupuesto por llamada) más un salto que se usa para no esperar el minuto del barrido.
let salto = 0
fijarPruebasEliminacion({ ahora: () => Date.now() + salto })
const conFalla = (fn) => fijarPruebasEliminacion({ ahora: () => Date.now() + salto, fallar: fn })
const sinFalla = () => fijarPruebasEliminacion({ ahora: () => Date.now() + salto })

const op = (cuerpo, token = tk.doc) => llamar(handleEliminarAsignatura, { cuerpo, token })

// ── Siembra ──────────────────────────────────────────────────────────────────
async function sembrar(subjectId, docenteId, { nombre = 'Biología', actividades = 6, estudiantes = 4, entregasPorActividad = 3, cerrada = true, extras = true } = {}) {
  const lote = []
  const set = (p, d) => lote.push([p, d])
  set(`subjects/${subjectId}`, { docenteId, escuelaId: 'E1', nombre, parciales: 3, archived: false, planeacionArchivo: urlCloudinary('raw', `${subjectId}/planeacion`), ...(cerrada ? { parcialesCerrados: { 1: HOY } } : {}) })
  const stIds = Array.from({ length: estudiantes }, (_, i) => `${subjectId}_st${i}`)
  stIds.forEach((id, i) => {
    set(`students/${id}`, { asignaturaId: subjectId, escuelaId: 'E1', uid: `u_${id}`, username: `U${i}`, activado: true, nombre: `Est ${i}` })
    set(`attendanceSummaries/${id}`, { asignaturaId: subjectId, presentes: 3 })
    set(`studentResetTokens/${id}`, { token: 'x' })
  })
  const actIds = Array.from({ length: actividades }, (_, i) => `${subjectId}_a${i}`)
  actIds.forEach((id, i) => {
    const categoria = !extras ? 'entregable' : ['examen', 'reto', 'participacion', 'ruleta', 'entregable', 'juego'][i % 6]
    set(`activities/${id}`, { docenteId, asignaturaId: subjectId, parcial: (i % 3) + 1, categoria, tipo: categoria === 'examen' ? 'evaluacion' : 'archivo', nombre: `Act ${i}`, archivos: [urlCloudinary('image', `${id}/adjunto`)] })
    if (categoria === 'examen') {
      set(`activities/${id}/preguntas/p1`, { enunciado: '¿?', imagen: urlCloudinary('image', `${id}/pregunta`) })
      set(`activities/${id}/clave/p1`, { correcta: 1 })
      set(`activities/${id}/reactivosHistorial/h1`, { tipoCambio: 'creado' })
      set(`activities/${id}/configHistorial/c1`, { cambio: 'x' })
      set(`activities/${id}/analisisActividadIA/i1`, { informe: 'x' })
    }
    if (categoria === 'reto') {
      set(`retoSesiones/R${i}${subjectId}`.slice(0, 40), { docenteId, actividadId: id, asignaturaId: subjectId })
      set(`retoParticipantes/RP${i}_${subjectId}`, { docenteId, actividadId: id, sesionId: 'X' })
    }
    if (categoria === 'participacion') {
      set(`vivoSesiones/V${i}_${subjectId}`, { docenteId, actividadId: id, asignaturaId: subjectId })
      set(`vivoRespuestas/VR${i}_${subjectId}`, { docenteId, actividadId: id, sesionId: `V${i}_${subjectId}` })
    }
    if (categoria === 'ruleta') {
      set(`ruletaReactivos/${id}_r1`, { docenteId, actividadId: id })
      set(`ruletaBancos/${id}`, { docenteId, actividadId: id })
      set(`ruletaParticipantes/${id}_${stIds[0]}`, { docenteId, actividadId: id, asignaturaId: subjectId, alumnoId: stIds[0] })
      set(`ruletaRespuestas/${id}_${stIds[0]}_0`, { docenteId, actividadId: id, alumnoId: stIds[0] })
    }
    stIds.slice(0, entregasPorActividad).forEach((st, k) => {
      const sid = `${id}_${st}`
      set(`submissions/${sid}`, { actividadId: id, alumnoId: st, calificacion: 8, estado: 'calificado', archivos: [urlCloudinary('raw', `${sid}/entrega`)] })
      if (k === 0) {
        set(`submissions/${sid}/respuestas/p1`, { valor: 'a', archivo: urlCloudinary('image', `${sid}/respuesta`) })
        set(`submissions/${sid}/calificacionHistorial/e1`, { calificacionNueva: 8 })
        set(`submissions/${sid}/intentosRespuestas/1`, { valor: 'a' })
        set(`submissions/${sid}/progresoVideo/1`, { visto: 3 })
      }
    })
    if (i === 0) {
      set(`entregasAnuladas/AN_${id}`, { actividadId: id, alumnoId: stIds[0], submissionId: `${id}_${stIds[0]}` })
      set(`entregasAnuladas/AN_${id}/respuestas/p1`, { valor: 'b' })
    }
  })
  // Entrega de un estudiante de la asignatura en una actividad ya inexistente (solo se encuentra por alumnoId).
  set(`submissions/${subjectId}_huerfana`, { actividadId: `${subjectId}_borrada`, alumnoId: stIds[0], calificacion: 5 })
  // Lo que cuelga de la asignatura, fuera de actividades y entregas.
  set(`subjects/${subjectId}/planeacionesIA/p1`, { contenido: 'x', archivo: urlCloudinary('raw', `${subjectId}/planeacionIA`) })
  set(`subjects/${subjectId}/diagnosticosIA/d1`, { x: 1 })
  set(`subjects/${subjectId}/asistenteIA/a1`, { x: 1 })
  set(`subjects/${subjectId}/analisisIA/i1`, { x: 1 })
  set(`attendance/${subjectId}_at1`, { asignaturaId: subjectId, docenteId, fecha: '2026-10-01', presentes: { [stIds[0]]: true } })
  set(`attendance/${subjectId}_at_viejo`, { asignaturaId: subjectId, fecha: '2026-09-01', presentes: {} }) // sin docenteId (formato viejo)
  set(`horarioBloques/${subjectId}_hb1`, { asignaturaId: subjectId, docenteId, dia: 1 })
  set(`observacionesAsistencia/${subjectId}_ob1`, { asignaturaId: subjectId, docenteId, alumnoId: stIds[0], texto: 'x' })
  set(`resources/${subjectId}_r1`, { asignaturaId: subjectId, docenteId, url: urlCloudinary('raw', `${subjectId}/recurso`) })
  set(`materials/${subjectId}_m1`, { asignaturaId: subjectId, docenteId, archivos: [{ url: urlCloudinary('image', `${subjectId}/material`) }] })
  set(`avisos/${subjectId}_av1`, { asignaturaId: subjectId, docenteId, titulo: 'Aviso' })
  set(`avisoLecturas/${subjectId}_l1`, { asignaturaId: subjectId, avisoId: `${subjectId}_av1`, studentId: stIds[0] })
  set(`avisoLecturas/${subjectId}_l_viejo`, { avisoId: `${subjectId}_av1`, studentId: stIds.at(-1) }) // sin asignaturaId
  set(`avisoGuardados/${subjectId}_g1`, { asignaturaId: subjectId, avisoId: `${subjectId}_av1`, alumnoId: stIds[0] })
  set(`avisoOcultos/${subjectId}_o1`, { asignaturaId: subjectId, avisoId: `${subjectId}_av1`, alumnoId: stIds[0] })
  set(`academicEvents/${subjectId}_ev1`, { asignaturaId: subjectId, docenteId, titulo: 'Examen' })
  set(`fuentesAsignatura/${subjectId}_f1`, { asignaturaId: subjectId, docenteId, url: urlCloudinary('raw', `${subjectId}/fuente`) })
  set(`chatMensajes/${subjectId}_c1`, { subjectId, docenteId, role: 'user', content: 'x' })
  // Del docente pero NO de la asignatura: no se tocan.
  set(`bancoReactivos/${subjectId}_b1`, { docenteId, asignaturaId: subjectId, enunciado: 'del banco' })
  set(`events/${subjectId}_pers`, { docenteId, tipo: 'personal', asignaturaId: null })
  set(`asuetos/${subjectId}_as1`, { docenteId, fecha: '2026-11-20', asistencias: true })
  set(`iaConsumos/${subjectId}_ia1`, { uid: docenteId, asignaturaId: subjectId, creditos: 5 })
  set(`studentEvents/${subjectId}_se1`, { alumnoId: `u_${stIds[0]}`, titulo: 'Mi tarea' })
  for (let i = 0; i < lote.length; i += 400) {
    const b = db.batch()
    lote.slice(i, i + 400).forEach(([p, d]) => b.set(db.doc(p), d))
    await b.commit()
  }
  return { actIds, stIds }
}

// Cuenta todo lo de una asignatura (incluidas subcolecciones) — 0 en todo = no quedó nada.
async function inventario(subjectId, { actIds, stIds }) {
  const cuenta = async (col, campo, valor) => (await db.collection(col).where(campo, '==', valor).get()).size
  const sub = async (p) => (await db.collection(p).get()).size
  const r = {}
  r.asignatura = (await db.doc(`subjects/${subjectId}`).get()).exists ? 1 : 0
  for (const c of ['planeacionesIA', 'diagnosticosIA', 'asistenteIA', 'analisisIA']) r[`subjects/${c}`] = await sub(`subjects/${subjectId}/${c}`)
  r.actividades = await cuenta('activities', 'asignaturaId', subjectId)
  r.subActividades = 0
  for (const id of actIds) for (const c of ['preguntas', 'clave', 'reactivosHistorial', 'configHistorial', 'analisisActividadIA']) r.subActividades += await sub(`activities/${id}/${c}`)
  r.entregas = 0; r.subEntregas = 0
  for (const id of actIds) {
    const s = await db.collection('submissions').where('actividadId', '==', id).get()
    r.entregas += s.size
  }
  for (const st of stIds) r.entregas += (await db.collection('submissions').where('alumnoId', '==', st).get()).size
  for (const id of actIds) for (const st of stIds) for (const c of ['respuestas', 'calificacionHistorial', 'intentosRespuestas', 'progresoVideo']) r.subEntregas += await sub(`submissions/${id}_${st}/${c}`)
  r.anuladas = 0
  for (const id of actIds) r.anuladas += await cuenta('entregasAnuladas', 'actividadId', id)
  r.subAnuladas = await sub(`entregasAnuladas/AN_${actIds[0]}/respuestas`)
  r.estudiantes = await cuenta('students', 'asignaturaId', subjectId)
  r.tokens = 0; for (const st of stIds) r.tokens += (await db.doc(`studentResetTokens/${st}`).get()).exists ? 1 : 0
  for (const c of ['attendance', 'attendanceSummaries', 'horarioBloques', 'observacionesAsistencia', 'resources', 'materials', 'avisos', 'avisoLecturas', 'avisoGuardados', 'avisoOcultos', 'academicEvents', 'fuentesAsignatura']) r[c] = await cuenta(c, 'asignaturaId', subjectId)
  r.lecturaVieja = (await db.doc(`avisoLecturas/${subjectId}_l_viejo`).get()).exists ? 1 : 0
  r.chat = await cuenta('chatMensajes', 'subjectId', subjectId)
  r.control = (await db.doc(`${CONTROL}/${subjectId}`).get()).exists ? 1 : 0
  return r
}
const ceros = (r) => Object.entries(r).filter(([, v]) => v !== 0)
// Lo que NO es de la asignatura y debe seguir ahí.
async function intactosDelDocente(subjectId) {
  const ex = async (p) => (await db.doc(p).get()).exists
  return [await ex(`bancoReactivos/${subjectId}_b1`), await ex(`events/${subjectId}_pers`), await ex(`asuetos/${subjectId}_as1`), await ex(`iaConsumos/${subjectId}_ia1`), await ex(`studentEvents/${subjectId}_se1`)]
}
// Datos de módulos que limpian SUS triggers al borrarse la actividad (aquí no se duplican).
async function modulos(actIds) {
  let n = 0
  for (const c of ['retoSesiones', 'retoParticipantes', 'vivoSesiones', 'vivoRespuestas', 'ruletaReactivos', 'ruletaParticipantes', 'ruletaRespuestas']) {
    for (const id of actIds) n += (await db.collection(c).where('actividadId', '==', id).get()).size
  }
  return n
}
async function simularTriggers(actIds) {
  for (const id of actIds) {
    await limpiarRetoDeActividad({ activityId: id })
    await limpiarVivoDeActividad({ activityId: id })
    if (limpiarRuletaDeActividad) await limpiarRuletaDeActividad({ activityId: id })
  }
}

// Llama hasta `completa` (como el navegador). Si el servidor pide esperar el barrido, adelanta el reloj.
async function eliminarHasta(subjectId, nombre, { token = tk.doc, max = 300 } = {}) {
  const respuestas = []
  for (let i = 0; i < max; i++) {
    const r = await op({ subjectId, confirmacion: nombre }, token)
    respuestas.push(r)
    if (r.statusCode !== 200) return respuestas
    if (r.cuerpo.estado === 'completa') return respuestas
    if (r.cuerpo.esperaMs) salto += r.cuerpo.esperaMs + 1
  }
  throw new Error('no terminó')
}

async function preparar() {
  await limpiar()
  await db.doc(`users/${DOC}`).set({ role: 'docente', escuelaId: 'E1' })
  await db.doc(`users/${DOC2}`).set({ role: 'docente', escuelaId: 'E1' })
  tk.doc = await sesion(DOC, { email: 'doc@prueba.test' })
  tk.doc2 = await sesion(DOC2, { email: 'otro@prueba.test' })
  tk.alumno = await sesion(`u_${S}_st0`, { email: `u0.e1@evalua.local` })
}
await preparar()
const datos = {}
datos.S = await sembrar(S, DOC)
datos.MISMO = await sembrar(S_MISMO, DOC, { nombre: 'Química' })
datos.AJENA = await sembrar(S_AJENA, DOC2, { nombre: 'Física' })
const inicialMismo = await inventario(S_MISMO, datos.MISMO)
const inicialAjena = await inventario(S_AJENA, datos.AJENA)
const inicialS = await inventario(S, datos.S)

// ── 1-3 · Quién puede ────────────────────────────────────────────────────────
grupo('1-3 · solo el docente dueño')

await caso('1 · sin sesión → 401; nada cambia', async () => {
  const r = await op({ subjectId: S, confirmacion: 'Biología' }, null)
  assert.strictEqual(r.statusCode, 401)
  assert.deepStrictEqual(await inventario(S, datos.S), inicialS)
})
await caso('2 · un estudiante (aunque sea de la asignatura) → 403; nada cambia', async () => {
  const r = await op({ subjectId: S, confirmacion: 'Biología' }, tk.alumno)
  assert.deepStrictEqual([r.statusCode, r.cuerpo.codigo], [403, 'NO_ES_TUYA'])
  assert.deepStrictEqual(await inventario(S, datos.S), inicialS)
})
await caso('3 · otro docente → 403; nada cambia', async () => {
  const r = await op({ subjectId: S, confirmacion: 'Biología' }, tk.doc2)
  assert.deepStrictEqual([r.statusCode, r.cuerpo.codigo], [403, 'NO_ES_TUYA'])
  assert.deepStrictEqual(await inventario(S, datos.S), inicialS)
})
await caso('3b · el dueño sin el nombre exacto → 400; sin asignatura → 400; nada cambia', async () => {
  assert.deepStrictEqual([(await op({ subjectId: S, confirmacion: 'biologia' })).cuerpo.codigo], ['CONFIRMACION'])
  assert.strictEqual((await op({ confirmacion: 'Biología' })).statusCode, 400)
  assert.strictEqual((await op({ subjectId: 'a/b', confirmacion: 'x' })).statusCode, 400)
  assert.deepStrictEqual(await inventario(S, datos.S), inicialS)
})

// ── 13 · Falla a la mitad y reintento ─────────────────────────────────────────
grupo('13 · un corte a la mitad: la asignatura sigue, el reintento termina')

let cortada = false
await caso('13 · falla en plena fase de entregas → 500; la asignatura sigue ahí con lo que falta', async () => {
  conFalla((fase, avance) => { if (fase === 'entregas' && avance.entregas >= 6 && !cortada) { cortada = true; throw new Error('corte simulado') } })
  const rs = await eliminarHasta(S, 'Biología')
  sinFalla()
  const ultima = rs.at(-1)
  assert.deepStrictEqual([ultima.statusCode, ultima.cuerpo.codigo], [500, 'ERROR'])
  const r = await inventario(S, datos.S)
  assert.strictEqual(r.asignatura, 1)
  assert.strictEqual(r.actividades, 0) // ya se habían borrado
  assert.ok(r.entregas > 0 && r.estudiantes > 0) // faltan
  assert.strictEqual(r.control, 1) // el avance quedó guardado
  const ctrl = (await db.doc(`${CONTROL}/${S}`).get()).data()
  assert.deepStrictEqual([ctrl.fase, ctrl.lease.hasta], ['entregas', 0]) // y el candado se soltó
})
await caso('13 · un candado vigente de otra llamada → 409 EN_CURSO; vencido, la llamada lo toma', async () => {
  await db.doc(`${CONTROL}/${S}`).update({ lease: { token: 'otro', hasta: Date.now() + salto + 30_000 } })
  const r = await op({ subjectId: S, confirmacion: 'Biología' })
  assert.deepStrictEqual([r.statusCode, r.cuerpo.codigo], [409, 'EN_CURSO'])
  salto += 31_000
})
await caso('13 · el reintento sigue donde se quedó y termina: no queda NADA (subcolecciones incluidas)', async () => {
  // Un trigger tardío (historial de reactivos) escribe bajo una actividad ya borrada: el barrido lo encuentra.
  await db.doc(`activities/${datos.S.actIds[0]}/reactivosHistorial/tarde`).set({ tipoCambio: 'eliminado' })
  // …y el del historial de notas, bajo una entrega ya borrada (visto en el E2E con el emulador de Functions).
  assert.strictEqual((await db.doc(`submissions/${datos.S.actIds[0]}_${datos.S.stIds[0]}`).get()).exists, false)
  await db.doc(`submissions/${datos.S.actIds[0]}_${datos.S.stIds[0]}/calificacionHistorial/tarde`).set({ calificacionNueva: 8, creacion: true })
  const cloud = pincharCloudinary()
  const rs = await eliminarHasta(S, 'Biología')
  cloud.restaurar()
  assert.deepStrictEqual([rs.at(-1).statusCode, rs.at(-1).cuerpo.estado], [200, 'completa'])
  assert.deepStrictEqual(ceros(await inventario(S, datos.S)), [])
  datos.S.destruidos = cloud.destruidos()
})

// ── 4-12 · Resultado completo ────────────────────────────────────────────────
grupo('4-12 · todo lo de la asignatura, y nada más')

await caso('4/7/8/9/11 · borrada con parciales cerrados, evaluaciones (preguntas y clave), entregas con historial, respuestas, intentos y progreso, anuladas, asistencia, avisos, fuentes y subcolecciones de la asignatura', async () => {
  assert.deepStrictEqual(ceros(await inventario(S, datos.S)), [])
})
await caso('5 · otra asignatura del MISMO docente: intacta', async () => {
  assert.deepStrictEqual(await inventario(S_MISMO, datos.MISMO), inicialMismo)
})
await caso('6 · la asignatura de OTRO docente: intacta', async () => {
  assert.deepStrictEqual(await inventario(S_AJENA, datos.AJENA), inicialAjena)
})
await caso('no se tocan: banco de reactivos, eventos personales, asuetos, consumos de IA ni la agenda del estudiante', async () => {
  assert.deepStrictEqual(await intactosDelDocente(S), [true, true, true, true, true])
  assert.ok((await db.collection('users').doc(DOC).get()).exists)
})
await caso('12 · archivos de Cloudinary: se destruyen los de la asignatura (actividades, preguntas, entregas, respuestas, recursos, materiales, fuentes, planeación) y ninguno ajeno', async () => {
  const d = datos.S.destruidos
  const esperados = [
    `${S}/planeacion`, `${S}/planeacionIA`, `${S}/recurso`, `${S}/material`, `${S}/fuente`,
    ...datos.S.actIds.map((id) => `${id}/adjunto`), `${datos.S.actIds[0]}/pregunta`,
    `${datos.S.actIds[0]}_${datos.S.stIds[0]}/entrega`, `${datos.S.actIds[0]}_${datos.S.stIds[0]}/respuesta`,
  ]
  for (const e of esperados) assert.ok(d.some((x) => x.startsWith(e)), `falta ${e}`)
  assert.ok(!d.some((x) => x.startsWith(S_MISMO) || x.startsWith(S_AJENA)), 'se destruyó un archivo ajeno')
  assert.strictEqual(new Set(d).size, d.length) // ninguno dos veces
})
await caso('10 · Reto Exprés, Participación en vivo y Ruleta: sus datos los limpian SUS triggers al borrarse la actividad (aquí no se duplican)', async () => {
  assert.ok(await modulos(datos.S.actIds) > 0) // el borrado de la asignatura no los tocó…
  await simularTriggers(datos.S.actIds) // …los triggers onRetoBorrado / onParticipacionBorrada / onRuletaBorrada sí
  assert.strictEqual(await modulos(datos.S.actIds), 0)
  assert.ok(await modulos(datos.MISMO.actIds) > 0 && await modulos(datos.AJENA.actIds) > 0)
  assert.ok(limpiarRuletaDeActividad, 'no se encontró la limpieza de la Ruleta (rama evalua-facil-ruleta)')
})

// ── 14 · Idempotencia y simultaneidad ────────────────────────────────────────
grupo('14 · repetir y simultáneos')

await caso('14 · repetir después de terminar: 200 completa, nada más cambia', async () => {
  const r = await op({ subjectId: S, confirmacion: 'Biología' })
  assert.deepStrictEqual([r.statusCode, r.cuerpo.estado], [200, 'completa'])
  assert.deepStrictEqual(await inventario(S_MISMO, datos.MISMO), inicialMismo)
  assert.deepStrictEqual(await inventario(S_AJENA, datos.AJENA), inicialAjena)
})
await caso('14 · dos solicitudes a la vez: solo una trabaja (la otra recibe EN_CURSO) y termina igual de limpio', async () => {
  const d = await sembrar('sub_doble', DOC, { nombre: 'Doble', actividades: 3, estudiantes: 2, entregasPorActividad: 2, extras: false })
  const rs = await Promise.all([op({ subjectId: 'sub_doble', confirmacion: 'Doble' }), op({ subjectId: 'sub_doble', confirmacion: 'Doble' })])
  const codigos = rs.map((r) => r.statusCode).sort()
  assert.ok(codigos.includes(200), codigos.join(','))
  assert.ok(rs.some((r) => r.statusCode === 409 && r.cuerpo.codigo === 'EN_CURSO') || rs.every((r) => r.statusCode === 200), codigos.join(','))
  await eliminarHasta('sub_doble', 'Doble')
  assert.deepStrictEqual(ceros(await inventario('sub_doble', d)), [])
  assert.deepStrictEqual(await inventario(S_MISMO, datos.MISMO), inicialMismo)
})

// ── 15 · Asignatura grande ───────────────────────────────────────────────────
grupo('15 · asignatura grande, por partes')

await caso('15 · 60 actividades, 45 estudiantes, 540 entregas: varias llamadas cortas, todas reanudan, termina limpia', async () => {
  const g = await sembrar('sub_grande', DOC, { nombre: 'Grande', actividades: 60, estudiantes: 45, entregasPorActividad: 9 })
  const ini = await inventario('sub_grande', g)
  assert.ok(ini.entregas >= 540 * 2, `entregas sembradas: ${ini.entregas / 2}`) // cada una se cuenta por actividad y por alumno
  const cloud = pincharCloudinary()
  let llamadas = 0, maxMs = 0
  for (;;) {
    const t0 = Date.now()
    const r = await ejecutarEliminacionAsignatura(db, DOC, 'sub_grande', { confirmacion: 'Grande', presupuestoMs: 1500 })
    maxMs = Math.max(maxMs, Date.now() - t0)
    llamadas += 1
    if (r.estado === 'completa') break
    if (r.esperaMs) salto += r.esperaMs + 1
    assert.ok(llamadas < 400, 'demasiadas llamadas')
  }
  cloud.restaurar()
  console.log(`      (${llamadas} llamadas; la más larga ${maxMs} ms con presupuesto de 1500 ms)`)
  assert.ok(llamadas > 3)
  assert.ok(maxMs < 1500 + 6000, `una llamada tardó ${maxMs} ms`)
  await simularTriggers(g.actIds)
  assert.deepStrictEqual(ceros(await inventario('sub_grande', g)), [])
  assert.strictEqual(await modulos(g.actIds), 0)
  assert.deepStrictEqual(await inventario(S_MISMO, datos.MISMO), inicialMismo)
  assert.deepStrictEqual(await inventario(S_AJENA, datos.AJENA), inicialAjena)
})
await caso('el barrido espera a los triggers: no se borra la asignatura antes de un minuto desde la última actividad', async () => {
  const d = await sembrar('sub_espera', DOC, { nombre: 'Espera', actividades: 2, estudiantes: 1, entregasPorActividad: 1, extras: false })
  const r = await op({ subjectId: 'sub_espera', confirmacion: 'Espera' })
  assert.deepStrictEqual([r.cuerpo.estado, r.cuerpo.fase], ['en_curso', 'barrido'])
  assert.ok(r.cuerpo.esperaMs > 0 && r.cuerpo.esperaMs <= ESPERA_BARRIDO_MS)
  assert.strictEqual((await db.doc('subjects/sub_espera').get()).exists, true)
  salto += r.cuerpo.esperaMs + 1
  const fin = await op({ subjectId: 'sub_espera', confirmacion: 'Espera' })
  assert.strictEqual(fin.cuerpo.estado, 'completa')
  assert.deepStrictEqual(ceros(await inventario('sub_espera', d)), [])
})

resumen('ELIMINAR-ASIGNATURA CHECKS')
