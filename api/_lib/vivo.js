// Participación en vivo — endpoints de los PARTICIPANTES (estado de la sesión y enviar respuesta).
//
// Se registran como acciones de /api/subject/[action] (`vivo-estado`, `vivo-responder`), no como
// archivos nuevos, para no gastar funciones del plan Hobby (12 máx.).
//
// Dos modalidades, decididas por la SESIÓN (`acceso`), nunca por el cliente:
//   · 'grupo'   → exige sesión iniciada de un estudiante inscrito en la asignatura. La respuesta
//                 queda ligada a su inscripción (students/{id}).
//   · 'externo' → cualquiera con el código. Se IGNORA el token aunque venga: un estudiante inscrito
//                 que entra por el enlace externo no se asocia a su cuenta. La respuesta lleva solo
//                 una clave aleatoria del navegador (no es una identidad).
//
// Lo único que ve el participante es la pregunta actual de la sesión (copia pública guardada al
// iniciar). Las respuestas correctas y los criterios viven en `activities/{id}/clave`, que este
// archivo nunca lee para el cliente.
import { getDb, admin, verifyRequest } from './firebaseAdmin.js'
import { aplicarCors } from './cors.js'
import {
  VIVO_CFG, ESTADO_IA, codigoVivoValido, claveParticipanteValida, idRespuestaVivo, sanearTextoRespuesta,
} from '../../src/utils/participacionVivo.js'

const { FieldValue } = admin.firestore

function leerBody(req) {
  try { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch { return null }
}

// Participante de una sesión 'grupo': el estudiante inscrito, o un error con su status.
async function estudianteInscrito(db, req, asignaturaId) {
  let decoded
  try { decoded = await verifyRequest(req) } catch (e) { return { status: e.status || 401, error: 'Inicia sesión para participar.' } }
  if (!(typeof decoded.email === 'string' && decoded.email.endsWith('@evalua.local'))) {
    return { status: 403, error: 'Esta participación es para estudiantes del grupo.' }
  }
  const snap = await db.collection('students').where('uid', '==', decoded.uid).get()
  const insc = snap.docs.find((d) => d.data().asignaturaId === asignaturaId)
  if (!insc) return { status: 403, error: 'No estás inscrito en esta asignatura.' }
  return { alumnoId: insc.id }
}

// Sesión por código, o la activa de una actividad (solo modalidad 'grupo').
async function localizarSesion(db, body) {
  if (body.codigo !== undefined && body.codigo !== null && body.codigo !== '') {
    const codigo = String(body.codigo).trim().toUpperCase()
    if (!codigoVivoValido(codigo)) return { status: 404, error: 'El código no es válido.' }
    const snap = await db.doc(`vivoSesiones/${codigo}`).get()
    if (!snap.exists) return { status: 404, error: 'No encontramos esa participación. Revisa el código.' }
    return { codigo, sesion: snap.data() }
  }
  const actividadId = String(body.actividadId || '').trim()
  if (!actividadId) return { status: 400, error: 'Falta el código.' }
  const snap = await db.collection('vivoSesiones').where('actividadId', '==', actividadId).get()
  const activa = snap.docs.find((d) => d.data().estado === 'activa' && d.data().acceso === 'grupo')
  if (!activa) return { codigo: null, sesion: null }
  return { codigo: activa.id, sesion: activa.data() }
}

function vistaPregunta(sesion) {
  const p = (sesion.preguntas || [])[sesion.preguntaIndex]
  if (!p) return null
  return { id: p.id, tipo: p.tipo, enunciado: p.enunciado, ...(p.opciones ? { opciones: p.opciones } : {}) }
}

// ── /api/subject/vivo-estado ───────────────────────────────────────────────
export async function handleVivoEstado(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const body = leerBody(req)
  if (!body) return res.status(400).json({ error: 'Body inválido.' })

  const db = getDb()
  const loc = await localizarSesion(db, body)
  if (loc.error) return res.status(loc.status).json({ error: loc.error })
  if (!loc.sesion) return res.status(200).json({ ok: true, sesion: null })
  const { codigo, sesion } = loc

  let participanteKey
  if (sesion.acceso === 'grupo') {
    const est = await estudianteInscrito(db, req, sesion.asignaturaId)
    if (est.error) return res.status(est.status).json({ error: est.error })
    participanteKey = est.alumnoId
  } else {
    participanteKey = claveParticipanteValida(body.participanteKey) ? body.participanteKey : null
  }

  const pregunta = sesion.estado === 'activa' && sesion.preguntaIndex >= 0 ? vistaPregunta(sesion) : null
  let yaRespondio = false
  if (pregunta && participanteKey) {
    yaRespondio = (await db.doc(`vivoRespuestas/${idRespuestaVivo(codigo, pregunta.id, participanteKey)}`).get()).exists
  }
  return res.status(200).json({
    ok: true,
    sesion: {
      codigo, estado: sesion.estado, titulo: sesion.titulo || '', acceso: sesion.acceso,
      aceptando: sesion.aceptando === true, total: (sesion.preguntas || []).length, preguntaIndex: sesion.preguntaIndex,
    },
    pregunta,
    yaRespondio,
  })
}

// ── /api/subject/vivo-responder ────────────────────────────────────────────
export async function handleVivoResponder(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const body = leerBody(req)
  if (!body) return res.status(400).json({ error: 'Body inválido.' })

  const db = getDb()
  const codigo = String(body.codigo || '').trim().toUpperCase()
  if (!codigoVivoValido(codigo)) return res.status(404).json({ error: 'El código no es válido.' })
  const sesRef = db.doc(`vivoSesiones/${codigo}`)
  const sesSnap = await sesRef.get()
  if (!sesSnap.exists) return res.status(404).json({ error: 'No encontramos esa participación.' })
  const sesion = sesSnap.data()

  let participanteKey
  let alumnoId = null
  if (sesion.acceso === 'grupo') {
    const est = await estudianteInscrito(db, req, sesion.asignaturaId)
    if (est.error) return res.status(est.status).json({ error: est.error })
    participanteKey = est.alumnoId
    alumnoId = est.alumnoId
  } else {
    if (!claveParticipanteValida(body.participanteKey)) return res.status(400).json({ error: 'No se pudo identificar tu navegador. Recarga la página.' })
    participanteKey = body.participanteKey
  }

  const preguntaId = String(body.preguntaId || '')
  const respRef = db.doc(`vivoRespuestas/${idRespuestaVivo(codigo, preguntaId, participanteKey)}`)

  // Sin transacción sobre la sesión: ahí todos los participantes de un grupo escriben a la vez, y un documento
  // compartido se vuelve cuello de botella. Cada respuesta es un documento propio con id determinista:
  // `create` falla si ya existe, y eso es justo el «una sola respuesta por persona y pregunta».
  // Lo único que se lee de la sesión es su estado (ya leído arriba).
  if (sesion.estado !== 'activa') return res.status(409).json({ error: 'Esta participación ya terminó.' })
  const pregunta = (sesion.preguntas || [])[sesion.preguntaIndex]
  if (!pregunta || pregunta.id !== preguntaId) return res.status(409).json({ error: 'Esa pregunta ya no está activa.' })
  if (sesion.aceptando !== true) return res.status(409).json({ error: 'El docente cerró las respuestas de esta pregunta.' })

  const dato = {
    sesionId: codigo, actividadId: sesion.actividadId, asignaturaId: sesion.asignaturaId, docenteId: sesion.docenteId, preguntaId, preguntaTipo: pregunta.tipo,
    participante: sesion.acceso === 'grupo' ? 'inscrito' : 'externo', alumnoId, participanteKey, opcion: null, texto: null, creadaEn: FieldValue.serverTimestamp(),
  }
  if (pregunta.tipo === 'opcion_unica') {
    const opcion = String(body.opcion || '')
    if (!(pregunta.opciones || []).some((o) => o.id === opcion)) return res.status(400).json({ error: 'Elige una de las opciones.' })
    dato.opcion = opcion
    dato.abierta = false
    dato.estadoIA = null // opción única: se resuelve contra la clave, sin IA
  } else {
    const texto = sanearTextoRespuesta(body.texto, pregunta.tipo)
    if (!texto) return res.status(400).json({ error: 'Escribe tu respuesta.' })
    dato.texto = texto
    dato.abierta = true
    // Cuántas abiertas lleva ya la sesión (agregación: no lee los documentos). Solo para acotar costos:
    //   · pasado el tope duro la sesión no admite más (inundación);
    //   · pasada la cuota de análisis la respuesta entra ya como «omitida» y no despierta al evaluador.
    // La decisión EXACTA (las primeras 40 por orden de llegada) la sigue tomando la evaluación.
    const { count } = (await db.collection('vivoRespuestas').where('sesionId', '==', codigo).where('abierta', '==', true).count().get()).data()
    if (count >= VIVO_CFG.MAX_ABIERTAS_SESION) return res.status(409).json({ error: 'Esta participación alcanzó el máximo de respuestas.' })
    dato.estadoIA = sesion.analisisActivo !== true ? ESTADO_IA.SIN_ANALISIS
      : count >= VIVO_CFG.TOPE_ANALISIS ? ESTADO_IA.OMITIDA_TOPE : ESTADO_IA.RECIBIDA
  }
  try {
    await respRef.create(dato)
  } catch (e) {
    if (e?.code === 6 || /ALREADY_EXISTS/.test(String(e?.message))) return res.status(200).json({ ok: true, yaRespondio: true }) // doble toque o reintento
    throw e
  }
  return res.status(200).json({ ok: true, yaRespondio: false })
}
