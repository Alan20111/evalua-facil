// Reto Exprés — piezas comunes del servidor en vivo (etapa 3). Las usan api/_lib/reto.js (participantes) y
// api/_lib/retoControl.js (docente). Especificación: docs/RETO_EXPRES.md.
//
// Toda regla de tiempo, cupo, alias, expulsión y puntuación vive en src/utils/retoExpres.js (lógica pura, la misma
// que usa la pantalla). Aquí solo se lee y escribe Firestore, dentro de transacciones, con el reloj del servidor.
import { createRequire } from 'module'
import { getDb, admin, verifyRequest } from './firebaseAdmin.js'
import { capitalizarNombre } from '../../src/utils/nombres.js'
import { codigoVivoValido } from '../../src/utils/participacionVivo.js'
import {
  ESTADOS_RETO, puedeFinalizar, calcularResultadosReto, formatoTokenValido, idParticipante,
} from '../../src/utils/retoExpres.js'

export { getDb, admin, verifyRequest }
export const { FieldValue } = admin.firestore

// Detector de palabras ofensivas (T8): el MISMO de functions/moderacionSugerencias.js, que es CommonJS. Se carga con
// require (y no con import) para que Vite en desarrollo no intente convertirlo: un `import` de ese archivo rompía el
// servidor local de /api/subject completo («module is not defined»). Vercel lo incluye en el paquete por `includeFiles`
// (vercel.json). Se carga la PRIMERA vez que hace falta y no al importar este módulo: si faltara, solo fallaría
// elegir alias en Reto Exprés, no todo /api/subject (Participación en vivo, activación por QR, contenido…).
const requerir = createRequire(import.meta.url)
let moderacion
function detector() {
  if (moderacion === undefined) {
    try {
      moderacion = requerir('../../functions/moderacionSugerencias.js')
    } catch (e) {
      console.error('reto: no se pudo cargar el detector de palabras ofensivas', e?.message)
      moderacion = null
    }
  }
  return moderacion
}

// Reloj del servidor. Las pruebas lo sustituyen (fijarRelojReto) para recorrer los 20 s de cada pregunta sin esperar.
let reloj = () => Date.now()
export const ahoraReto = () => reloj()
export function fijarRelojReto(fn) { reloj = typeof fn === 'function' ? fn : () => Date.now() }

export class ErrorReto extends Error {
  constructor(status, mensaje, codigo = null) { super(mensaje); this.status = status; this.codigo = codigo }
}

export function leerBody(req) {
  try { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch { return null }
}

// El código del reto usa el mismo alfabeto y largo que Participación en vivo (10 caracteres, sin 0/O/1/I/L).
export function leerCodigo(valor) {
  const codigo = String(valor ?? '').trim().toUpperCase()
  return codigoVivoValido(codigo) ? codigo : null
}

export const refs = (db, codigo) => ({
  sesion: db.doc(`retoSesiones/${codigo}`),
  claves: db.doc(`retoClaves/${codigo}`),
  lugar: (n) => db.doc(`retoCupos/${codigo}_${n}`), // cupo de externos: lugares numerados 1..40 (R4, etapa 4)
  resultados: db.doc(`retoResultados/${codigo}`),
  participante: (id) => db.doc(`retoParticipantes/${id}`),
  alias: (clave) => db.doc(`retoAlias/${codigo}_${clave}`),
  respuesta: (participanteId, indice) => db.doc(`retoRespuestas/${participanteId}_${indice}`),
})

// Huella SHA-256 del token del externo: el servidor nunca guarda el token.
export async function huellaToken(token) {
  const { createHash } = await import('crypto')
  return createHash('sha256').update(String(token)).digest('hex')
}

/**
 * Detector de palabras ofensivas del servidor (functions/moderacionSugerencias.js): no viaja al navegador. Sin el
 * detector no se acepta ningún alias (falla cerrada) y se dice que es un problema del servidor, no del alias.
 */
export function esOfensivo(texto) {
  const m = detector()
  if (!m) throw new ErrorReto(503, 'No se pudo revisar el alias en este momento. Avisa a tu docente.', 'SIN_DETECTOR')
  return m.evaluarTexto(texto).estado !== 'limpia'
}

/** Nombre real que ve el grupo (modo «nombre real»): nombre y apellidos tal como los registró el docente. */
export function nombreRealEstudiante(e) {
  return [e?.nombre, e?.apellidoPaterno, e?.apellidoMaterno].map((p) => capitalizarNombre(p || '')).filter(Boolean).join(' ') || 'Estudiante'
}

/** Nombres que un alias no puede tener (T4): TODOS los inscritos de la asignatura, incluido el propio. */
export async function nombresProtegidos(db, sesion) {
  if (sesion.modalidad !== 'inscritos') return []
  const snap = await db.collection('students').where('asignaturaId', '==', sesion.asignaturaId).get()
  return snap.docs.map((d) => {
    const e = d.data()
    return { nombre: e.nombre || '', apellidoPaterno: e.apellidoPaterno || '', apellidoMaterno: e.apellidoMaterno || '' }
  })
}

/**
 * Estudiante inscrito en la asignatura de la sesión (mismo criterio que Participación en vivo): sesión iniciada con
 * cuenta de estudiante y una inscripción en esa asignatura. Devuelve { alumnoId, estudiante } o lanza ErrorReto.
 */
export async function estudianteInscrito(db, req, asignaturaId) {
  let decoded
  try { decoded = await verifyRequest(req) } catch (e) { throw new ErrorReto(e.status || 401, 'Inicia sesión para participar.') }
  if (!(typeof decoded.email === 'string' && decoded.email.endsWith('@evalua.local'))) {
    throw new ErrorReto(403, 'Esta competencia es para estudiantes del grupo.')
  }
  const snap = await db.collection('students').where('uid', '==', decoded.uid).get()
  const insc = snap.docs.find((d) => d.data().asignaturaId === asignaturaId)
  if (!insc) throw new ErrorReto(403, 'No estás inscrito en esta asignatura.')
  return { alumnoId: insc.id, estudiante: insc.data() }
}

/**
 * Id del participante que hace la petición, o null si todavía no tiene uno (externo sin token válido).
 * Inscrito: por su sesión (lanza ErrorReto si no está inscrito). Externo: por la huella de su token; nunca por su cuenta.
 */
export async function participanteDeLaPeticion(db, req, codigo, sesion, body) {
  if (sesion.modalidad === 'inscritos') {
    const { alumnoId, estudiante } = await estudianteInscrito(db, req, sesion.asignaturaId)
    return { id: idParticipante({ codigo, modalidad: 'inscritos', alumnoId }), alumnoId, estudiante }
  }
  if (!formatoTokenValido(body?.token)) return { id: null }
  const tokenHash = await huellaToken(body.token)
  return { id: idParticipante({ codigo, modalidad: 'externo', tokenHash }), tokenHash }
}

export async function leerSesion(db, codigo) {
  const snap = await refs(db, codigo).sesion.get()
  if (!snap.exists) throw new ErrorReto(404, 'No encontramos esa competencia. Revisa el código.')
  return snap.data()
}

// ── Registro definitivo de resultados ───────────────────────────────────────
// Sin tareas programadas (decisión del 3-nov-2026): los resultados se calculan en la PRIMERA consulta que llega al
// servidor después de terminar (proyector, celular o el docente al volver a abrir el reto). Para que 40 celulares que
// consultan a la vez no calculen 40 veces, uno «toma el turno» con una marca de 15 s; si falla, otro lo retoma al
// vencer la marca. El cálculo parte siempre de las respuestas guardadas: hacerlo más tarde da el mismo resultado.
const TURNO_FINALIZAR_MS = 15000

/**
 * Calcula y guarda el registro definitivo si ya toca. Devuelve 'finalizada' (ya estaba o se acaba de hacer),
 * 'en_curso' (todavía no toca) u 'ocupado' (otro lo está calculando).
 */
export async function finalizarSiToca(db, codigo) {
  const r = refs(db, codigo)
  const marca = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const turno = await db.runTransaction(async (tx) => {
    const ses = (await tx.get(r.sesion)).data()
    const ahora = ahoraReto()
    if (!ses) throw new ErrorReto(404, 'La competencia ya no existe.')
    if (ses.estado === ESTADOS_RETO.finalizada) return 'finalizada'
    if (!puedeFinalizar(ses, ahora)) return 'en_curso'
    if (Number.isFinite(ses.finalizandoHastaMs) && ses.finalizandoHastaMs > ahora) return 'ocupado'
    tx.update(r.sesion, { finalizandoHastaMs: ahora + TURNO_FINALIZAR_MS, finalizandoMarca: marca })
    return 'mio'
  })
  if (turno !== 'mio') return turno

  return db.runTransaction(async (tx) => {
    const ses = (await tx.get(r.sesion)).data()
    if (!ses) throw new ErrorReto(404, 'La competencia ya no existe.')
    if (ses.estado === ESTADOS_RETO.finalizada) return 'finalizada'
    if (ses.finalizandoMarca !== marca) return 'ocupado' // venció la marca y otro la retomó
    const [clavesSnap, partSnap, respSnap] = await Promise.all([
      tx.get(r.claves),
      tx.get(db.collection('retoParticipantes').where('sesionId', '==', codigo)),
      tx.get(db.collection('retoRespuestas').where('sesionId', '==', codigo)),
    ])
    const resultados = calcularResultadosReto({
      sesion: ses,
      preguntas: ses.preguntas,
      claves: clavesSnap.data()?.claves || {},
      participantes: partSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      respuestas: respSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    })
    if (!resultados.ok) throw new Error(`reto ${codigo}: no se pudieron calcular los resultados (${resultados.codigo})`)
    const ahora = ahoraReto()
    tx.set(r.resultados, {
      ...resultados, sesionId: codigo, actividadId: ses.actividadId, asignaturaId: ses.asignaturaId, docenteId: ses.docenteId,
      modalidad: ses.modalidad, calculadoMs: ahora,
    })
    tx.update(r.sesion, {
      estado: ESTADOS_RETO.finalizada, finalizadaMs: ahora, accesoAbierto: false,
      finalizandoHastaMs: FieldValue.delete(), finalizandoMarca: FieldValue.delete(),
    })
    return 'finalizada'
  })
}

/** Respuesta HTTP uniforme para los errores esperados; los demás se relanzan (500 del dispatcher). */
export function responderError(res, e) {
  if (e instanceof ErrorReto) return res.status(e.status).json({ error: e.message, ...(e.codigo ? { codigo: e.codigo } : {}) })
  throw e
}

/** Lo que el docente, el proyector y los celulares necesitan saber del reloj, calculado con la hora del servidor. */
export function resumenTiempo(ses, ahora, faseReto) {
  const f = faseReto(ses, ahora)
  return {
    estado: ses.estado, fase: f.fase, indice: f.indice, faseAlPausar: f.faseAlPausar, restanteMs: f.restanteMs,
    faltaParaAbrirMs: f.faltaParaAbrirMs, abreMs: f.abreMs, cierraMs: f.cierraMs, accesoAbierto: ses.accesoAbierto === true,
    totalPreguntas: ses.totalPreguntas, ahora,
  }
}
