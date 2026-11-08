// La Ruleta del Destino — fases 4 y 5 (individual): la PARTIDA de un estudiante inscrito (docs/RULETA_DESTINO.md).
// Acción `ruleta-partida` de /api/subject/[action] (no gasta funciones del plan de Vercel), una operación por petición:
//   · estado    → inicia la partida la primera vez (sorteo y copia de las preguntas) o la recupera
//   · girar     → abre la siguiente pregunta con la hora del servidor
//   · responder → registra la primera respuesta a la pregunta abierta
//   · estados   → solo lectura: el avance del estudiante en las ruletas de una asignatura (nunca crea partidas)
//
// Paso 2 (7-nov-2026): al terminar la partida, en la MISMA transacción, el servidor escribe la nota en
// `submissions/{actividadId}_{alumnoId}` (como los juegos y las evaluaciones). El Admin SDK no pasa por las reglas,
// así que aquí se repiten sus candados: con el parcial cerrado definitivamente no se juega ni se califica, y una nota
// que el docente ya puso se conserva. Con la nota oculta (calificacionesOcultas) la pantalla final no la muestra.
//
// Solo modalidad individual y acceso interno. El estudiante nunca lee Firestore: todo lo recibe de aquí, y la respuesta
// correcta NUNCA sale del servidor (ni antes ni después de responder; al final solo la calificación y cuántas acertó).
// Una sola partida por estudiante. Cada operación corre en una transacción sobre su documento
// `ruletaParticipantes/{actividadId}_{alumnoId}`: dos pestañas no pueden responder dos veces ni girar de más.
// Las reglas del juego (15 s exactos, primera respuesta, calificación sobre 10) viven en src/utils/ruletaDestino.js.
import crypto from 'crypto'
import { aplicarCors } from './cors.js'
import { getDb, verifyRequest, admin } from './firebaseAdmin.js'
import { ErrorRuleta } from './ruletaBanco.js'
import { isActivityPublished } from '../../src/utils/activityVisibility.js'
import { parcialCerrado, esNotaAutomaticaDeCierre } from '../../src/utils/ponderacion.js'
import { actividadOculta } from '../../src/utils/visibilidadCalificaciones.js'
import { ORIGEN_SERVIDOR } from '../../src/utils/evaluacionGrading.js'
import { submissionDocId } from '../../src/utils/submissionId.js'
import {
  RULETA_CFG, ESTADOS_PARTIDA, MOTIVOS_RESPUESTA, preguntasPorPartidaValida, evaluarAprobacion, sortearPreguntas,
  crearPartida, validarPartida, girar, responder, vencerPregunta, tiempoRestanteMs, resumenPartida,
} from '../../src/utils/ruletaDestino.js'

const { FieldValue } = admin.firestore

// Reloj del servidor. Las pruebas lo sustituyen para recorrer los 15 s sin esperar.
let reloj = () => Date.now()
export const ahoraRuleta = () => reloj()
export function fijarRelojRuleta(fn) { reloj = typeof fn === 'function' ? fn : () => Date.now() }

// Azar criptográfico para el sorteo (la lógica pura acepta cualquier fuente que devuelva [0, 1)).
const azarSeguro = () => crypto.randomInt(0, 0x100000000) / 0x100000000

const idValido = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(s)

function leerBody(req) {
  try { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch { return null }
}

// Estudiante con su sesión habitual e inscrito en la asignatura de la ruleta (mismo criterio que las demás
// actividades del estudiante). Devuelve { uid, alumnoId }.
async function estudianteInscrito(db, req, asignaturaId) {
  let decoded
  try { decoded = await verifyRequest(req) } catch (e) { throw new ErrorRuleta(e.status || 401, 'Inicia sesión para jugar.', 'SIN_SESION') }
  if (!(typeof decoded.email === 'string' && decoded.email.endsWith('@evalua.local'))) {
    throw new ErrorRuleta(403, 'Esta ruleta es para los estudiantes del grupo.', 'NO_ES_ESTUDIANTE')
  }
  const snap = await db.collection('students').where('uid', '==', decoded.uid).get()
  const insc = snap.docs.find((d) => d.data().asignaturaId === asignaturaId)
  if (!insc) throw new ErrorRuleta(403, 'No estás inscrito en esta asignatura.', 'NO_INSCRITO')
  return { uid: decoded.uid, alumnoId: insc.id }
}

// La ruleta debe existir, ser individual e interna, estar bien configurada y visible para el estudiante.
// Devuelve la actividad y su asignatura (para el parcial cerrado y la visibilidad de la nota).
async function ruletaJugable(tx, db, actividadId) {
  const snap = await tx.get(db.doc(`activities/${actividadId}`))
  const act = snap.exists ? snap.data() : null
  if (!act || act.categoria !== RULETA_CFG.CATEGORIA) throw new ErrorRuleta(404, 'No encontramos esa ruleta.', 'NO_EXISTE')
  if (!act.ruleta || !preguntasPorPartidaValida(act.ruleta.preguntasPorPartida)) {
    throw new ErrorRuleta(409, 'Esta ruleta no está bien configurada.', 'MAL_CONFIGURADA')
  }
  if (act.ruleta.modalidad !== 'individual' || act.ruleta.acceso !== 'interno') {
    throw new ErrorRuleta(409, 'Esta ruleta todavía no se puede jugar desde aquí.', 'MODALIDAD_NO_DISPONIBLE')
  }
  const sub = await tx.get(db.doc(`subjects/${act.asignaturaId}`))
  const subject = sub.exists ? sub.data() : {}
  const parcialOculto = (subject.parcialesOcultos || []).includes(act.parcial)
  if (!isActivityPublished(act, parcialOculto)) throw new ErrorRuleta(403, 'Esta ruleta no está disponible.', 'NO_PUBLICADA')
  return { act, subject }
}

// Parcial cerrado definitivamente = resultado congelado (mismo predicado que las reglas y las Cloud Functions).
function exigirParcialAbierto(act, subject) {
  if (parcialCerrado(subject, act.parcial)) {
    throw new ErrorRuleta(409, `El Parcial ${act.parcial} ya está cerrado. Tu docente tiene que reabrirlo para que puedas jugar.`, 'PARCIAL_CERRADO')
  }
}

// Lo que ve el estudiante. Nunca incluye la respuesta correcta ni si acertó (decisión del PO, 7-nov-2026): durante la
// partida solo «respuesta registrada» o «se acabó el tiempo»; al final, la calificación y cuántas acertó.
// `notaOculta`: el docente ocultó las calificaciones de esta actividad; al final no se muestra ni la nota ni los
// aciertos (con los aciertos se deduce la nota).
function vista(p, ahora, { notaOculta = false } = {}) {
  const partida = p.partida
  const n = partida.preguntasPorPartida
  const base = { estado: partida.estado, total: n, respondidas: partida.respuestas.length, ahora }
  if (partida.estado === ESTADOS_PARTIDA.pregunta) {
    const a = partida.abierta
    const q = p.preguntas[a.reactivoId]
    return { ...base, pregunta: { indice: a.indice, enunciado: q.enunciado, opciones: q.opciones.slice(), restanteMs: tiempoRestanteMs(partida, ahora) } }
  }
  if (partida.estado === ESTADOS_PARTIDA.terminada) {
    const r = p.resultado || resumenPartida(partida)
    const notaConservada = p.nota?.estado === ESTADOS_NOTA.conservada
    if (notaOculta) return { ...base, resultado: { notaOculta: true, total: r.total, notaConservada } }
    return { ...base, resultado: { correctas: r.correctas, total: r.total, calificacion: r.calificacion, notaConservada } }
  }
  return base
}

const fueraDeTiempo = (r) => r && r.motivo !== MOTIVOS_RESPUESTA.respondida

// Datos que se escriben al terminar (para la publicación de la nota, paso 2).
function resultadoDe(partida) {
  const r = resumenPartida(partida)
  return { correctas: r.correctas, total: r.total, calificacion: r.calificacion, tiempoCorrectasMs: r.tiempoCorrectasMs, sinRespuesta: r.sinRespuesta }
}

// Qué pasó con la nota al terminar (queda en el participante, para el docente).
export const ESTADOS_NOTA = { registrada: 'registrada', conservada: 'conservada' }

// Decide qué hacer con la entrega existente (null si no hay). Pura, para poder probarla sola.
//   · sin entrega, o solo la nota automática de cierre (un 0 que no es calificación real) → se escribe la nota
//   · ya trae la nota de ESTA partida → nada (reintento)
//   · ya trae otra calificación (la puso el docente) → se conserva
//   · existe pero sin calificación → se completa con la nota
export function decisionNotaRuleta(previa, participanteId) {
  if (!previa) return 'crear'
  if (esNotaAutomaticaDeCierre(previa)) return 'reemplazar'
  if (previa.ruleta?.participanteId === participanteId) return 'ya'
  if (previa.calificacion !== null && previa.calificacion !== undefined && previa.calificacion !== '') return 'conservar'
  return 'completar'
}

// Lee la entrega (antes de cualquier escritura de la transacción) y escribe la nota si corresponde. Devuelve lo que
// se guarda en el participante como `nota`.
async function registrarNota(tx, db, p, participanteId, resultado) {
  const ref = db.doc(`submissions/${submissionDocId(p.actividadId, p.alumnoId)}`)
  const snap = await tx.get(ref)
  const decision = decisionNotaRuleta(snap.exists ? snap.data() : null, participanteId)
  if (decision === 'conservar') return { estado: ESTADOS_NOTA.conservada, motivo: 'nota_previa', registradaEn: FieldValue.serverTimestamp() }
  if (decision !== 'ya') {
    const nota = {
      actividadId: p.actividadId, alumnoId: p.alumnoId, calificacion: resultado.calificacion,
      estado: 'calificado', ultimaCalificacionPor: ORIGEN_SERVIDOR, sinEntrega: true, fechaEntrega: FieldValue.serverTimestamp(),
      ruleta: { participanteId, correctas: resultado.correctas, total: resultado.total },
    }
    // La nota de cierre se reemplaza completa (sin su marca `cierreParcial`, para que reabrir no la borre).
    if (decision === 'completar') tx.set(ref, nota, { merge: true })
    else tx.set(ref, { ...nota, comentario: '' })
  }
  return { estado: ESTADOS_NOTA.registrada, registradaEn: FieldValue.serverTimestamp() }
}

// Guarda la partida (y las respuestas nuevas) en la transacción. `nuevas` = respuestas registradas en esta operación.
// Si la partida termina aquí, también registra la nota (paso 2). Debe ser la PRIMERA escritura de la transacción.
async function guardar(tx, db, ref, p, partida, nuevas) {
  const cambios = { partida, actualizadoEn: FieldValue.serverTimestamp() }
  if (partida.estado === ESTADOS_PARTIDA.terminada && !p.resultado) {
    cambios.resultado = resultadoDe(partida)
    cambios.terminadaEn = FieldValue.serverTimestamp()
    cambios.nota = await registrarNota(tx, db, p, ref.id, cambios.resultado)
  }
  tx.update(ref, cambios)
  for (const r of nuevas) {
    tx.create(db.doc(`ruletaRespuestas/${ref.id}_${r.indice}`), {
      docenteId: p.docenteId, actividadId: p.actividadId, asignaturaId: p.asignaturaId, participanteId: ref.id, alumnoId: p.alumnoId,
      indice: r.indice, reactivoId: r.reactivoId, opcion: r.opcion, motivo: r.motivo, correcta: r.correcta, tiempoMs: r.tiempoMs,
      registradaEn: FieldValue.serverTimestamp(),
    })
  }
  return { ...p, partida, resultado: cambios.resultado || p.resultado || null, nota: cambios.nota || p.nota || null }
}

// Lee la partida dentro de la transacción y, si la pregunta abierta ya venció, la registra como sin respuesta.
async function partidaAlDia(tx, db, ref, ahora) {
  const snap = await tx.get(ref)
  if (!snap.exists) return null
  const p = snap.data()
  const v = validarPartida(p.partida)
  if (!v.ok) throw new ErrorRuleta(500, 'Tu partida tiene un problema. Avisa a tu docente.', 'PARTIDA_INVALIDA')
  const venc = vencerPregunta(p.partida, ahora)
  if (!venc.ok) throw new ErrorRuleta(500, 'Tu partida tiene un problema. Avisa a tu docente.', 'PARTIDA_INVALIDA')
  return { p, partida: venc.partida, nuevas: venc.vencida ? [venc.respuesta] : [] }
}

async function contexto(db, req, body) {
  const actividadId = body.actividadId
  // La asignatura se lee fuera de la transacción solo para saber contra qué inscripción validar; la transacción
  // vuelve a leer la actividad completa.
  const act = await db.doc(`activities/${actividadId}`).get()
  if (!act.exists || act.data().categoria !== RULETA_CFG.CATEGORIA) throw new ErrorRuleta(404, 'No encontramos esa ruleta.', 'NO_EXISTE')
  const { uid, alumnoId } = await estudianteInscrito(db, req, act.data().asignaturaId)
  return { actividadId, uid, alumnoId, ref: db.doc(`ruletaParticipantes/${actividadId}_${alumnoId}`) }
}

// ESTADO: inicia la partida la primera vez o la recupera.
async function estado(db, req, body) {
  const { actividadId, uid, alumnoId, ref } = await contexto(db, req, body)
  return db.runTransaction(async (tx) => {
    const { act, subject } = await ruletaJugable(tx, db, actividadId)
    const ahora = ahoraRuleta()
    const opciones = { notaOculta: actividadOculta(subject, actividadId) }
    if (parcialCerrado(subject, act.parcial)) {
      // Con el parcial cerrado solo se puede ver una partida ya terminada; nada se escribe.
      const snap = await tx.get(ref)
      if (snap.exists && snap.data().partida?.estado === ESTADOS_PARTIDA.terminada) return { nueva: false, ...vista(snap.data(), ahora, opciones) }
      exigirParcialAbierto(act, subject)
    }
    const actual = await partidaAlDia(tx, db, ref, ahora)
    if (actual) {
      const p = actual.nuevas.length ? await guardar(tx, db, ref, actual.p, actual.partida, actual.nuevas) : { ...actual.p, partida: actual.partida }
      return { nueva: false, ...vista(p, ahora, opciones) }
    }
    // Partida nueva: solo con el banco aprobado y completo (mínimo según su origen).
    const n = act.ruleta.preguntasPorPartida
    const bancoSnap = await tx.get(db.doc(`ruletaBancos/${actividadId}`))
    const banco = bancoSnap.exists ? bancoSnap.data() : null
    const reacSnap = await tx.get(db.collection('ruletaReactivos').where('actividadId', '==', actividadId).where('docenteId', '==', act.docenteId))
    const reactivos = reacSnap.docs.map((d) => ({ id: d.id, enunciado: d.data().enunciado, opciones: d.data().opciones, correcta: d.data().correcta }))
    if (!banco || banco.aprobado !== true || !evaluarAprobacion(banco, reactivos, n).ok) {
      throw new ErrorRuleta(409, 'Tu docente todavía está preparando esta ruleta.', 'BANCO_NO_LISTO')
    }
    const orden = sortearPreguntas(reactivos.map((r) => r.id), n, azarSeguro)
    const c = crearPartida({ orden, preguntasPorPartida: n })
    if (!c.ok) throw new ErrorRuleta(500, 'No se pudo iniciar la partida.', 'PARTIDA_INVALIDA')
    // Copia de las preguntas sorteadas: si el docente edita el banco después, esta partida no cambia.
    const preguntas = Object.fromEntries(orden.map((id) => { const r = reactivos.find((x) => x.id === id); return [id, { enunciado: r.enunciado, opciones: r.opciones.slice(), correcta: r.correcta }] }))
    const p = {
      docenteId: act.docenteId, actividadId, asignaturaId: act.asignaturaId, parcial: act.parcial ?? null, alumnoId, uid,
      modalidad: 'individual', preguntasPorPartida: n, partida: c.partida, preguntas, resultado: null,
      creadoEn: FieldValue.serverTimestamp(), actualizadoEn: FieldValue.serverTimestamp(),
    }
    tx.create(ref, p)
    // R8: al empezar la primera partida, las preguntas por partida quedan congeladas (lo pone solo el servidor).
    if (act.ruleta.preguntasCongeladas !== true) tx.update(db.doc(`activities/${actividadId}`), { 'ruleta.preguntasCongeladas': true })
    return { nueva: true, ...vista(p, ahora, opciones) }
  })
}

// GIRAR: abre la siguiente pregunta. Si ya hay una abierta (doble clic o reconexión), devuelve esa misma.
async function girarOp(db, req, body) {
  const { actividadId, ref } = await contexto(db, req, body)
  return db.runTransaction(async (tx) => {
    const { act, subject } = await ruletaJugable(tx, db, actividadId)
    exigirParcialAbierto(act, subject)
    const ahora = ahoraRuleta()
    const actual = await partidaAlDia(tx, db, ref, ahora)
    if (!actual) throw new ErrorRuleta(409, 'Primero inicia tu partida.', 'SIN_PARTIDA')
    let { partida } = actual
    if (partida.estado === ESTADOS_PARTIDA.lista) {
      const g = girar(partida, ahora)
      if (!g.ok) throw new ErrorRuleta(409, 'No se pudo girar la ruleta.', g.codigo.toUpperCase())
      partida = g.partida
    }
    const p = await guardar(tx, db, ref, actual.p, partida, actual.nuevas)
    return vista(p, ahora, { notaOculta: actividadOculta(subject, actividadId) })
  })
}

// RESPONDER: solo la primera respuesta a la pregunta abierta. Recibe únicamente { indice, opcion }; la clave y la hora
// son del servidor. Un reintento de una respuesta ya registrada devuelve lo registrado sin contarla otra vez.
async function responderOp(db, req, body) {
  const { actividadId, ref } = await contexto(db, req, body)
  const { indice, opcion } = body
  if (!Number.isInteger(indice) || indice < 0) throw new ErrorRuleta(400, 'Falta la pregunta.', 'SIN_INDICE')
  if (!Number.isInteger(opcion) || opcion < 0 || opcion >= RULETA_CFG.OPCIONES_POR_REACTIVO) throw new ErrorRuleta(400, 'Elige una de las cuatro opciones.', 'OPCION_INVALIDA')
  return db.runTransaction(async (tx) => {
    const { act, subject } = await ruletaJugable(tx, db, actividadId)
    exigirParcialAbierto(act, subject)
    const ahora = ahoraRuleta()
    const actual = await partidaAlDia(tx, db, ref, ahora)
    if (!actual) throw new ErrorRuleta(409, 'Primero inicia tu partida.', 'SIN_PARTIDA')
    let { partida } = actual
    const nuevas = [...actual.nuevas]
    let registrada = partida.respuestas[indice]
    if (!registrada) {
      if (partida.estado !== ESTADOS_PARTIDA.pregunta || partida.abierta.indice !== indice) {
        throw new ErrorRuleta(409, 'Esa pregunta no está abierta.', 'PREGUNTA_NO_ABIERTA')
      }
      const clave = actual.p.preguntas[partida.abierta.reactivoId]?.correcta
      const r = responder(partida, { indice, opcion, ahoraMs: ahora, correcta: clave })
      if (!r.ok) throw new ErrorRuleta(409, 'No se pudo registrar la respuesta.', r.codigo.toUpperCase())
      partida = r.partida
      registrada = r.respuesta
      nuevas.push(r.respuesta)
    }
    const p = nuevas.length ? await guardar(tx, db, ref, actual.p, partida, nuevas) : { ...actual.p, partida }
    return { registrada: true, fueraDeTiempo: fueraDeTiempo(registrada), ...vista(p, ahora, { notaOculta: actividadOculta(subject, actividadId) }) }
  })
}

// ESTADOS (solo lectura): en qué va el estudiante en cada ruleta de la asignatura, para su lista de actividades.
// Nunca crea partidas ni escribe. Solo el avance (en curso / terminada); la calificación le llega por su entrega, que
// ya respeta la visibilidad que eligió el docente.
async function estados(db, req, body) {
  const { alumnoId } = await estudianteInscrito(db, req, body.asignaturaId)
  const snap = await db.collection('ruletaParticipantes').where('alumnoId', '==', alumnoId).get()
  const ruletas = {}
  for (const d of snap.docs) {
    const p = d.data()
    if (p.asignaturaId !== body.asignaturaId || !p.partida) continue
    ruletas[p.actividadId] = {
      estado: p.partida.estado === ESTADOS_PARTIDA.terminada ? 'terminada' : 'en_curso',
      respondidas: Array.isArray(p.partida.respuestas) ? p.partida.respuestas.length : 0,
      total: p.preguntasPorPartida,
    }
  }
  return { ruletas }
}

const OPERACIONES = { estado, girar: girarOp, responder: responderOp }

/** Ejecuta una operación de la partida para quien hace la petición. Lanza ErrorRuleta con el estado HTTP y el mensaje. */
export async function ejecutarOperacionPartida(db, req, operacion, body) {
  if (operacion === 'estados') {
    if (!idValido(body?.asignaturaId)) throw new ErrorRuleta(400, 'Falta la asignatura.', 'SIN_ASIGNATURA')
    return estados(db, req, body)
  }
  const fn = OPERACIONES[operacion]
  if (!fn) throw new ErrorRuleta(400, 'Operación desconocida.', 'OPERACION')
  if (!idValido(body?.actividadId)) throw new ErrorRuleta(400, 'Falta la ruleta.', 'SIN_ACTIVIDAD')
  return fn(db, req, body)
}

export async function handleRuletaPartida(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const body = leerBody(req)
  if (!body) return res.status(400).json({ error: 'Body inválido.' })
  try {
    const r = await ejecutarOperacionPartida(getDb(), req, String(body.operacion || ''), body)
    return res.status(200).json({ ok: true, ...r })
  } catch (e) {
    if (e instanceof ErrorRuleta) return res.status(e.status).json({ error: e.message, ...(e.codigo ? { codigo: e.codigo } : {}) })
    throw e
  }
}
