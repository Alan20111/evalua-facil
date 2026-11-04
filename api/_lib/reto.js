// Reto Exprés — endpoints de los PARTICIPANTES (etapa 3): entrar, consultar el estado y responder. Se registran como
// acciones de /api/subject/[action] (`reto-unirse`, `reto-estado`, `reto-responder`), igual que Participación en vivo.
//
// Dos modalidades, decididas por la SESIÓN, nunca por el cliente:
//   · 'inscritos' → exige sesión de un estudiante inscrito en la asignatura; su id sale de su inscripción.
//   · 'externo'   → sin cuenta. Al entrar el servidor entrega UNA vez un token secreto (256 bits) y guarda solo su
//                   huella; con ella se le reconoce. Nunca se lee `students` ni se escribe `submissions`.
// Nadie recibe la clave durante la competencia; al final, solo los inscritos ven su corrección (D9, E11).
import crypto from 'crypto'
import { aplicarCors } from './cors.js'
import {
  getDb, FieldValue, ErrorReto, leerBody, leerCodigo, refs, ahoraReto, huellaToken, esOfensivo, nombresProtegidos,
  nombreRealEstudiante, participanteDeLaPeticion, estudianteInscrito, leerSesion, finalizarSiToca, responderError, resumenTiempo,
} from './retoComun.js'
import {
  RETO_CFG, ESTADOS_RETO, FASES_RETO, modoIdentidadDe, faseReto, puedeFinalizar, puedeUnirse, registroParticipante, idParticipante,
  validarAlias, puedeResponder, nombreVisible, vistaResultadosParticipante,
} from '../../src/utils/retoExpres.js'

const metodoNoPermitido = (res) => res.status(405).json({ error: 'Método no permitido' })

// ── /api/subject/reto-unirse ───────────────────────────────────────────────
// Entrar o reconectarse. Externo: con `token` válido se reconecta; sin él entra como participante nuevo (pide alias).
export async function unirseReto(db, req, codigo, body) {
  const r = refs(db, codigo)
  const sesion = await leerSesion(db, codigo)
  const quien = await participanteDeLaPeticion(db, req, codigo, sesion, body)
  const modo = modoIdentidadDe(sesion)

  // Reconexión (los dos casos): ya tiene participante.
  if (quien.id) {
    const actual = await r.participante(quien.id).get()
    if (actual.exists) {
      const p = { id: actual.id, ...actual.data() }
      const u = puedeUnirse(sesion, p, ahoraReto())
      if (!u.ok) throw new ErrorReto(u.codigo === 'EXPULSADO' ? 403 : 409, u.error, u.codigo)
      return { nuevo: false, nombreVisible: nombreVisible(p, modo) }
    }
  }

  // Participante nuevo. El alias (si la competencia lo usa) se valida antes de la transacción, salvo su unicidad.
  let alias = null
  if (modo === 'alias') {
    const protegidos = await nombresProtegidos(db, sesion)
    const v = validarAlias(body.alias, { ocupados: [], esOfensivo, nombresProtegidos: protegidos })
    if (!v.ok) throw new ErrorReto(400, v.error, v.codigo)
    alias = v
  }
  let token = null
  let id = quien.id
  let tokenHash = null
  if (sesion.modalidad === 'externo') {
    token = crypto.randomBytes(32).toString('hex') // el token lo genera SIEMPRE el servidor
    tokenHash = await huellaToken(token)
    id = idParticipante({ codigo, modalidad: 'externo', tokenHash })
  }

  // Cupo de un reto externo (E7, R3, R4): 40 LUGARES NUMERADOS, `retoCupos/{código}_{1..40}`. Cada entrada mira qué
  // lugares siguen libres, elige UNO AL AZAR y lo CREA dentro de la misma transacción que crea al participante (si
  // todas tomaran «el siguiente», chocarían en el mismo número). Crear no lee un documento compartido, así que muchas
  // entradas a la vez no se bloquean entre sí (con un contador único sí: todas lo leían y luego querían escribirlo).
  // Si dos eligen el mismo lugar, una gana y la otra vuelve a mirar los libres y elige otro. Nunca hay más de 40 porque
  // no existen más números; un expulsado conserva su lugar (no se borra). El alias tampoco se lee: se crea, y si ya
  // existía, Firestore rechaza la transacción completa.
  const externo = sesion.modalidad === 'externo'
  let ocupados = 0
  let lugar = null
  const elegirLugar = async () => {
    const tomados = new Set((await db.collection('retoCupos').where('sesionId', '==', codigo).get()).docs.map((d) => d.data().lugar))
    const libres = Array.from({ length: RETO_CFG.MAX_EXTERNOS }, (_, i) => i + 1).filter((n) => !tomados.has(n))
    ocupados = RETO_CFG.MAX_EXTERNOS - libres.length
    lugar = libres.length ? libres[Math.floor(Math.random() * libres.length)] : null
  }
  if (externo) await elegirLugar()

  for (let intento = 0; intento < INTENTOS_ENTRADA; intento++) {
    try {
      const registro = await db.runTransaction(async (tx) => {
        const ses = (await tx.get(r.sesion)).data()
        const ahora = ahoraReto()
        const ya = await tx.get(r.participante(id))
        if (ya.exists) { // dos pestañas del mismo inscrito a la vez: la segunda solo se reconecta
          const p = { id: ya.id, ...ya.data() }
          const u = puedeUnirse(ses, p, ahora)
          if (!u.ok) throw new ErrorReto(u.codigo === 'EXPULSADO' ? 403 : 409, u.error, u.codigo)
          return { ...p, reconexion: true }
        }
        // `ocupados` = lugares tomados al elegir: la misma regla pura decide acceso, fase y cupo lleno (40 → CUPO_LLENO).
        const u = puedeUnirse(ses, null, ahora, externo ? { cupo: { ocupados } } : {})
        if (!u.ok) throw new ErrorReto(u.codigo === 'CUPO_LLENO' || u.codigo === 'ACCESO_CERRADO' || u.codigo === 'TERMINADA' ? 409 : 400, u.error, u.codigo)
        const base = registroParticipante({
          codigo, modalidad: ses.modalidad, docenteId: ses.docenteId, alias: alias?.alias ?? null, unidoMs: ahora,
          ...(ses.modalidad === 'inscritos' ? { alumnoId: quien.alumnoId, nombre: nombreRealEstudiante(quien.estudiante) } : { tokenHash }),
        })
        if (!base) throw new ErrorReto(400, 'No se pudo registrar tu entrada. Inténtalo de nuevo.')
        const datos = { ...base }
        delete datos.id // el id es el del documento, no un campo
        const comunes = { sesionId: codigo, actividadId: ses.actividadId, docenteId: ses.docenteId }
        tx.create(r.participante(id), { ...datos, actividadId: ses.actividadId, aliasClave: alias?.clave ?? null, creadoEn: FieldValue.serverTimestamp() })
        if (alias) tx.create(r.alias(alias.clave), { ...comunes, participanteId: id })
        if (externo) tx.create(r.lugar(lugar), { ...comunes, lugar, participanteId: id })
        return { ...base, aliasClave: alias?.clave ?? null }
      })
      if (registro.reconexion) return { nuevo: false, nombreVisible: nombreVisible(registro, modo) }
      return { nuevo: true, nombreVisible: nombreVisible(registro, modo), ...(token ? { token } : {}) }
    } catch (e) {
      if (e instanceof ErrorReto) throw e
      const yaExiste = e?.code === 6 || /ALREADY_EXISTS/.test(String(e?.message))
      const abortada = e?.code === 10 || /ABORTED/.test(String(e?.message))
      if (!yaExiste && !abortada) throw e
      // ¿Qué ya existía? El alias (de otro), el propio participante (otra pestaña) o el lugar (otra entrada lo tomó).
      if (alias && yaExiste) {
        const a = await r.alias(alias.clave).get()
        if (a.exists && a.data().participanteId !== id) throw new ErrorReto(409, 'Ese alias ya lo usa otro participante. Elige otro.', 'OCUPADO')
      }
      if (externo) await elegirLugar()
      await new Promise((ok) => setTimeout(ok, 20 + Math.random() * 80))
    }
  }
  throw new ErrorReto(503, 'Hay muchas personas entrando a la vez. Inténtalo de nuevo en un momento.', 'OCUPADO_TEMPORAL')
}

// Intentos de una entrada: cada choque de lugar o de transacción cuesta uno. 45 personas a la vez caben de sobra.
const INTENTOS_ENTRADA = 12

export async function handleRetoUnirse(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return metodoNoPermitido(res)
  const body = leerBody(req)
  if (!body) return res.status(400).json({ error: 'Body inválido.' })
  const codigo = leerCodigo(body.codigo)
  if (!codigo) return res.status(404).json({ error: 'El código no es válido.' })
  try {
    return res.status(200).json({ ok: true, ...(await unirseReto(getDb(), req, codigo, body)) })
  } catch (e) { return responderError(res, e) }
}

// ── /api/subject/reto-estado ───────────────────────────────────────────────
// Estado para el celular. La pregunta (sin clave) solo viaja a un participante dentro y con la pregunta abierta.
export async function estadoReto(db, req, codigo, body) {
  let sesion = await leerSesion(db, codigo)
  // Registro definitivo en la primera consulta tras terminar (no hay tarea programada).
  if (sesion.estado !== ESTADOS_RETO.finalizada && puedeFinalizar(sesion, ahoraReto())) {
    try { await finalizarSiToca(db, codigo) } catch (e) { console.error('reto-estado: no se pudo finalizar', codigo, e?.message) }
    sesion = await leerSesion(db, codigo)
  }
  const quien = await participanteDeLaPeticion(db, req, codigo, sesion, body)
  const ahora = ahoraReto()
  const t = resumenTiempo(sesion, ahora, faseReto)
  const salida = {
    sesion: { codigo, titulo: sesion.titulo || '', modalidad: sesion.modalidad, modoIdentidad: modoIdentidadDe(sesion), ...t },
    participante: null, pregunta: null, yaRespondio: false, resultados: null,
  }
  const pSnap = quien.id ? await refs(db, codigo).participante(quien.id).get() : null
  if (!pSnap?.exists) return salida
  const p = { id: pSnap.id, ...pSnap.data() }
  salida.participante = { nombreVisible: nombreVisible(p, modoIdentidadDe(sesion)), expulsado: p.expulsado === true }
  if (p.expulsado === true) return salida

  if (t.fase === FASES_RETO.abierta && Number.isInteger(t.indice)) {
    const q = sesion.preguntas[t.indice]
    salida.pregunta = { indice: t.indice, id: q.id, tipo: q.tipo, enunciado: q.enunciado, opciones: q.opciones }
    salida.yaRespondio = (await refs(db, codigo).respuesta(p.id, t.indice).get()).exists
  }
  if (sesion.estado === ESTADOS_RETO.finalizada) {
    const res = (await refs(db, codigo).resultados.get()).data()
    if (res) salida.resultados = vistaResultadosParticipante(res, p.id, { modalidad: sesion.modalidad })
    // Inscritos (D9): para leer su corrección necesitan el texto de las preguntas REALIZADAS (las de su corrección).
    // Las que nunca se abrieron no se muestran; un externo no recibe nada de esto (E11).
    if (salida.resultados?.correccion) {
      const ids = new Set(salida.resultados.correccion.map((c) => c.preguntaId))
      salida.preguntas = sesion.preguntas.filter((q) => ids.has(q.id)).map((q) => ({ id: q.id, enunciado: q.enunciado, opciones: q.opciones }))
    }
  }
  return salida
}

/**
 * Etapa 4 (D1): un INSCRITO entra desde la lista de actividades de su asignatura, sin código. Primero se comprueba que
 * esté inscrito (así nadie más sabe si hay una competencia), luego se elige la sesión de ese reto: la que sigue sin
 * finalizar (T6: hay a lo más una) o, si no, la más reciente (para que vea sus resultados). Un reto externo nunca se
 * encuentra así: solo con su código. Devuelve el código o null si el reto todavía no tiene sesiones.
 */
export async function codigoPorActividad(db, req, actividadId) {
  if (typeof actividadId !== 'string' || !actividadId || actividadId.includes('/')) throw new ErrorReto(404, 'No encontramos esa competencia.')
  const act = (await db.doc(`activities/${actividadId}`).get()).data()
  if (!act || act.categoria !== 'reto' || act.reto?.modalidad !== 'inscritos') throw new ErrorReto(404, 'No encontramos esa competencia.')
  await estudianteInscrito(db, req, act.asignaturaId)
  const sesiones = (await db.collection('retoSesiones').where('actividadId', '==', actividadId).get()).docs
  if (!sesiones.length) return null
  const abierta = sesiones.find((d) => d.data().estado !== ESTADOS_RETO.finalizada)
  if (abierta) return abierta.id
  return sesiones.reduce((a, b) => ((b.data().creadaMs ?? 0) > (a.data().creadaMs ?? 0) ? b : a)).id
}

export async function handleRetoEstado(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return metodoNoPermitido(res)
  res.setHeader?.('Cache-Control', 'no-store')
  const body = leerBody(req)
  if (!body) return res.status(400).json({ error: 'Body inválido.' })
  try {
    const db = getDb()
    let codigo = leerCodigo(body.codigo)
    if (!codigo && body.actividadId !== undefined) {
      codigo = await codigoPorActividad(db, req, body.actividadId)
      if (!codigo) return res.status(200).json({ ok: true, sesion: null, participante: null, pregunta: null, yaRespondio: false, resultados: null })
    }
    if (!codigo) return res.status(404).json({ error: 'El código no es válido.' })
    return res.status(200).json({ ok: true, ...(await estadoReto(db, req, codigo, body)) })
  } catch (e) { return responderError(res, e) }
}

// ── /api/subject/reto-responder ────────────────────────────────────────────
// Una respuesta por participante y pregunta: la PRIMERA que llega (tx.create con id fijo). El veredicto de tiempo se
// toma dentro de la transacción con el reloj del servidor. No se dice si acertó: la clave no sale durante la competencia.
export async function responderReto(db, req, codigo, body) {
  const r = refs(db, codigo)
  const sesion = await leerSesion(db, codigo)
  const quien = await participanteDeLaPeticion(db, req, codigo, sesion, body)
  if (!quien.id) throw new ErrorReto(403, 'Primero entra a la competencia.', 'NO_PARTICIPANTE')
  const indice = Number(body.indice)
  if (!Number.isInteger(indice) || indice < 0 || indice >= (sesion.preguntas || []).length) throw new ErrorReto(400, 'Esa pregunta no existe.')
  const pregunta = sesion.preguntas[indice]
  const opcion = String(body.opcion ?? '')
  if (!(pregunta.opciones || []).some((o) => o.id === opcion)) throw new ErrorReto(400, 'Elige una de las opciones.')
  const respRef = r.respuesta(quien.id, indice)
  try {
    await db.runTransaction(async (tx) => {
      const ses = (await tx.get(r.sesion)).data()
      const pSnap = await tx.get(r.participante(quien.id))
      const ahora = ahoraReto()
      const p = pSnap.exists ? { id: pSnap.id, ...pSnap.data() } : null
      const v = puedeResponder(ses, p, indice, ahora)
      if (!v.ok) throw new ErrorReto(v.codigo === 'EXPULSADO' || v.codigo === 'NO_PARTICIPANTE' ? 403 : 409, v.error, v.codigo)
      tx.create(respRef, {
        sesionId: codigo, actividadId: ses.actividadId, docenteId: ses.docenteId, participanteId: quien.id,
        preguntaId: pregunta.id, indice, opcionSeleccionada: opcion, recibidaMs: ahora, creadaEn: FieldValue.serverTimestamp(),
      })
    })
  } catch (e) {
    if (e instanceof ErrorReto) throw e
    if (e?.code === 6 || /ALREADY_EXISTS/.test(String(e?.message))) return { yaRespondio: true } // doble toque o reintento (T5)
    throw e
  }
  return { yaRespondio: false }
}

export async function handleRetoResponder(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return metodoNoPermitido(res)
  const body = leerBody(req)
  if (!body) return res.status(400).json({ error: 'Body inválido.' })
  const codigo = leerCodigo(body.codigo)
  if (!codigo) return res.status(404).json({ error: 'El código no es válido.' })
  try {
    return res.status(200).json({ ok: true, ...(await responderReto(getDb(), req, codigo, body)) })
  } catch (e) { return responderError(res, e) }
}
