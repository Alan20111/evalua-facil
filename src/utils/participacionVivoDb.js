// Participación en vivo — acceso a Firestore y a los endpoints de participantes.
//
//   · El DOCENTE maneja la sesión por Firestore (reglas: solo avance; el análisis de IA y su contador
//     los escribe el servidor al activarlo con `activarAnalisisVivo`, que es gratis).
//   · Los PARTICIPANTES jamás tocan Firestore: usan /api/subject/vivo-estado y vivo-responder.
import { doc, setDoc, collection, query, where, getDocs, serverTimestamp, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from '../firebase'
import { fetchApi } from './apiBase'
import { generarCodigoVivo, muestraDeDesfase } from './participacionVivo'

// ── Docente ────────────────────────────────────────────────────────────────

function aleatorio() {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return a[0] / 2 ** 32
}

/** Crea una sesión en vivo con una COPIA pública de las preguntas (lo que se proyecta no cambia a media clase). */
export async function crearSesionVivo({ actividadId, asignaturaId, docenteId, titulo, proposito, acceso, calificable, preguntas }) {
  const codigo = generarCodigoVivo(aleatorio)
  await setDoc(doc(db, 'vivoSesiones', codigo), {
    actividadId, asignaturaId, docenteId, titulo: String(titulo || '').slice(0, 120), proposito: proposito || null,
    acceso, calificable: calificable === true,
    estado: 'activa',
    preguntaIndex: -1, // -1 = sala de espera: aún no se proyecta ninguna pregunta
    aceptando: false,
    preguntas,
    analisisActivo: false,
    creadaEn: serverTimestamp(),
  })
  return codigo
}

// El reloj de la sesión es del servidor: abrir una pregunta, ampliar su tiempo, cerrarla y finalizar pasan por
// /api/subject/vivo-control (con tu sesión de docente). Las reglas de Firestore no dejan escribirlos desde el navegador.
export function controlarVivo(codigo, accion, extra = {}) {
  return llamarVivo('vivo-control', { codigo, accion, ...extra }, { conSesion: true })
}
export const irAPreguntaVivo = (codigo, indice) => controlarVivo(codigo, 'abrir', { indice })
export const cerrarPreguntaVivo = (codigo) => controlarVivo(codigo, 'cerrar')
export const ampliarTiempoVivo = (codigo, segundos) => controlarVivo(codigo, 'ampliar', { segundos })
export const sellarPreguntaVivo = (codigo) => controlarVivo(codigo, 'sellar')
export const finalizarSesionVivo = (codigo) => controlarVivo(codigo, 'finalizar')

/** Una medición del desfase entre este reloj y el del servidor (para el proyector). */
export async function medirRelojServidor() {
  const t0 = Date.now()
  const r = await llamarVivo('vivo-reloj', {})
  return muestraDeDesfase(t0, Date.now(), r.ahora)
}

/** Sesiones de una actividad (la más reciente primero). Dos igualdades: no necesita índice compuesto. */
export async function sesionesDeActividad(actividadId, docenteId) {
  const snap = await getDocs(query(collection(db, 'vivoSesiones'), where('docenteId', '==', docenteId), where('actividadId', '==', actividadId)))
  return snap.docs
    .map((d) => ({ codigo: d.id, ...d.data() }))
    .sort((a, b) => (b.creadaEn?.toMillis?.() ?? 0) - (a.creadaEn?.toMillis?.() ?? 0))
}

export function escucharSesionVivo(codigo, cb, onError) {
  return onSnapshot(doc(db, 'vivoSesiones', codigo), (s) => cb(s.exists() ? { codigo: s.id, ...s.data() } : null), onError)
}

/** Respuestas de una sesión en tiempo real. El filtro por docente es el que permiten las reglas. */
export function escucharRespuestasVivo(codigo, docenteId, cb, onError) {
  return onSnapshot(
    query(collection(db, 'vivoRespuestas'), where('docenteId', '==', docenteId), where('sesionId', '==', codigo)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  )
}

/** Diagnósticos pedagógicos de la sesión (uno por pregunta y uno final), en tiempo real. Solo lectura. */
export function escucharInformesVivo(codigo, docenteId, cb, onError) {
  return onSnapshot(
    query(collection(db, 'vivoInformes'), where('docenteId', '==', docenteId), where('sesionId', '==', codigo)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  )
}

/** «Actualizar» manual de un diagnóstico (sin preguntaId = el informe final). Sin cargo: el servidor limita las llamadas. */
export function actualizarInformeVivo({ sesionId, preguntaId = null }) {
  return httpsCallable(functions, 'actualizarInformeVivo')({ sesionId, preguntaId }).then((r) => r.data)
}

/** Activa el análisis de la sesión. GRATIS: no pasa por el libro de créditos; es idempotente. */
export function activarAnalisisVivo({ sesionId }) {
  return httpsCallable(functions, 'activarAnalisisVivo')({ sesionId }).then((r) => r.data)
}

// ── Participantes ──────────────────────────────────────────────────────────

/** `conSesion`: manda el token del estudiante. La modalidad externa NUNCA lo manda. */
export async function llamarVivo(accion, cuerpo, { conSesion = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (conSesion) {
    const token = await auth.currentUser?.getIdToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }
  const res = await fetchApi(`/api/subject/${accion}`, { method: 'POST', headers, body: JSON.stringify(cuerpo) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json?.error || 'No se pudo completar. Intenta de nuevo.')
    err.status = res.status
    throw err
  }
  return json
}

const CLAVE_LOCAL = 'ef-vivo-participante'

/** Identificador aleatorio del navegador (participantes externos). No es una cuenta ni una identidad. */
export function claveParticipanteLocal() {
  try {
    const guardada = localStorage.getItem(CLAVE_LOCAL)
    if (guardada && /^[a-z0-9]{16,40}$/.test(guardada)) return guardada
    const nueva = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => (b % 36).toString(36)).join('')
    localStorage.setItem(CLAVE_LOCAL, nueva)
    return nueva
  } catch {
    // Sin almacenamiento (navegación privada): vale para esta pestaña.
    return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => (b % 36).toString(36)).join('')
  }
}

export const urlParticipacion = (codigo) => `${window.location.origin}/p/${codigo}`

