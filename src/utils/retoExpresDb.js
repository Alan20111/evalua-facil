// Reto Exprés — acceso a Firestore y al servidor desde las pantallas (etapa 2: crear y editar; etapa 4: competencia en vivo).
//
// La lógica (qué se puede guardar, cómo se arma cada pregunta) vive en src/utils/retoExpres.js; aquí solo se lee y
// se escribe. Las preguntas y su clave pasan SIEMPRE por src/utils/evaluacionClave.js, el mismo reparto que usan los
// cuestionarios: lo público en `preguntas/`, la respuesta correcta en `clave/` (solo el docente dueño la lee).
// Las reglas de Firestore (etapa 1-bis) vuelven a exigir la forma del reto: modalidad fija y, en externo, oculto y
// no calificable.
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { fetchApi } from './apiBase'
import { crearPreguntasEnLote, actualizarPregunta, borrarPregunta, cargarPreguntasConClave } from './evaluacionClave'
import { datosNuevoReto, cambiosDatosReto, reactivoCompatibleReto, RETO_CFG } from './retoExpres'

const ordenar = (lista) => [...lista].sort((a, b) => ((a.orden ?? 0) - (b.orden ?? 0)) || String(a.id).localeCompare(String(b.id)))

/** Crea el reto (borrador) y devuelve su id. Lanza un Error con el mensaje para el docente si algo no cuadra. */
export async function crearReto(entrada) {
  const r = datosNuevoReto(entrada)
  if (!r.ok) throw Object.assign(new Error(r.error), { codigo: r.codigo })
  const ref = await addDoc(collection(db, 'activities'), { ...r.datos, numPreguntas: 0, createdAt: serverTimestamp() })
  return ref.id
}

/** El reto y sus preguntas con clave (solo el docente dueño). null si no existe o no es un reto. */
export async function cargarReto(activityId) {
  const snap = await getDoc(doc(db, 'activities', activityId))
  if (!snap.exists()) return null
  const actividad = { id: snap.id, ...snap.data() }
  if (actividad.categoria !== RETO_CFG.CATEGORIA) return { actividad, preguntas: [], noEsReto: true }
  const preguntas = ordenar(await cargarPreguntasConClave(activityId))
  return { actividad, preguntas }
}

/** Guarda nombre, instrucciones, identidad o calificable (la modalidad nunca). Devuelve el patch aplicado. */
export async function guardarDatosReto(actividad, cambios) {
  const r = cambiosDatosReto(actividad, cambios)
  if (!r.ok) throw Object.assign(new Error(r.error), { codigo: r.codigo })
  if (Object.keys(r.patch).length) await updateDoc(doc(db, 'activities', actividad.id), r.patch)
  return r.patch
}

async function sincronizarCantidad(activityId, total) {
  await updateDoc(doc(db, 'activities', activityId), { numPreguntas: total })
}

/** Agrega preguntas ya armadas (preguntaRetoDesde…). Devuelve la lista completa actualizada. */
export async function agregarPreguntas(activityId, actuales, nuevas) {
  if (!nuevas.length) return actuales
  const ids = await crearPreguntasEnLote(activityId, nuevas)
  const lista = ordenar([...actuales, ...nuevas.map((p, i) => ({ id: ids[i], ...p }))])
  await sincronizarCantidad(activityId, lista.length)
  return lista
}

export async function editarPregunta(activityId, preguntaId, datos) {
  await actualizarPregunta(activityId, preguntaId, datos)
}

export async function quitarPregunta(activityId, preguntaId, restantes) {
  await borrarPregunta(activityId, preguntaId)
  await sincronizarCantidad(activityId, restantes)
}

/** Pone el mismo tiempo para responder a todas las preguntas del reto (botón «Aplicar a todas»). */
export async function aplicarTiempoATodas(activityId, preguntas, tiempoSeg) {
  await Promise.all(preguntas.map((p) => actualizarPregunta(activityId, p.id, { tiempoSeg })))
}

/** Intercambia el orden de dos preguntas (subir / bajar). */
export async function intercambiarOrden(activityId, a, b) {
  await Promise.all([
    actualizarPregunta(activityId, a.id, { orden: b.orden }),
    actualizarPregunta(activityId, b.id, { orden: a.orden }),
  ])
}

/**
 * Reactivos que el docente puede traer a un reto (D10, S3): su banco y los cuestionarios y exámenes de ESTA
 * asignatura. Cada uno trae `compatible` y, si no lo es, `motivo` (ver MOTIVOS_INCOMPATIBLE). Solo lectura: los
 * originales nunca se tocan.
 */
export async function fuentesDeReactivos({ asignaturaId, docenteId }) {
  const [bancoSnap, actsSnap] = await Promise.all([
    getDocs(query(collection(db, 'bancoReactivos'), where('docenteId', '==', docenteId))),
    getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', asignaturaId), where('docenteId', '==', docenteId))),
  ])
  const marcar = (r) => {
    const c = reactivoCompatibleReto(r)
    return { ...r, compatible: c.ok, motivo: c.ok ? null : c.motivo }
  }
  const banco = bancoSnap.docs.map((d) => marcar({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.enunciado || '').localeCompare(String(b.enunciado || '')))
  const evaluacionesDocs = actsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => a.categoria === 'cuestionario' || a.categoria === 'examen')
    .sort((a, b) => ((a.parcial ?? 0) - (b.parcial ?? 0)) || ((a.orden ?? 0) - (b.orden ?? 0)))
  const evaluaciones = await Promise.all(evaluacionesDocs.map(async (a) => ({
    id: a.id, nombre: a.nombre || '', categoria: a.categoria, parcial: a.parcial,
    reactivos: ordenar(await cargarPreguntasConClave(a.id)).map(marcar),
  })))
  return { banco, evaluaciones: evaluaciones.filter((e) => e.reactivos.length) }
}

// ── Competencia en vivo (etapa 4) ───────────────────────────────────────────
// Toda decisión (tiempo, cupo, alias, expulsión, puntuación) la toma el servidor (api/_lib/reto*.js). Aquí: llamar
// a sus acciones, guardar el token del externo en este navegador y, para el docente, escuchar su sesión.

/**
 * Llama a una acción `reto-*` de /api/subject. Con `conSesion` envía la sesión (docente o estudiante inscrito).
 * Si falla, lanza un Error con el mensaje para la pantalla, `status` y `codigo` (CUPO_LLENO, EXPULSADO, OCUPADO…).
 */
export async function llamarReto(accion, cuerpo, { conSesion = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (conSesion) {
    const token = await auth.currentUser?.getIdToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }
  const res = await fetchApi(`/api/subject/${accion}`, { method: 'POST', headers, body: JSON.stringify(cuerpo) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(json?.error || 'No se pudo completar. Intenta de nuevo.'), { status: res.status, codigo: json?.codigo || null })
  return json
}

export const crearSesionReto = (actividadId) => llamarReto('reto-crear', { actividadId }, { conSesion: true })
export const controlarReto = (codigo, accion, extra = {}) => llamarReto('reto-control', { codigo, accion, ...extra }, { conSesion: true })
export const urlReto = (codigo) => `${window.location.origin}/r/${codigo}`

// Token del participante externo (E3): solo en este navegador. Sin almacenamiento (modo privado estricto, datos del
// sitio bloqueados) se juega igual, pero al recargar se entra como participante nuevo: la pantalla lo avisa.
const claveToken = (codigo) => `ef-reto-token-${codigo}`
export function leerTokenReto(codigo) {
  try { return window.localStorage.getItem(claveToken(codigo)) || null } catch { return null }
}
export function guardarTokenReto(codigo, token) {
  try { window.localStorage.setItem(claveToken(codigo), token); return window.localStorage.getItem(claveToken(codigo)) === token } catch { return false }
}

/** Sesión en vivo para el docente dueño (las reglas le dejan leerla). */
export function escucharSesionReto(codigo, cb, onError) {
  return onSnapshot(doc(db, 'retoSesiones', codigo), (s) => cb(s.exists() ? { codigo: s.id, ...s.data() } : null), onError)
}
/** Participantes de la sesión (el docente ve también el nombre real detrás del alias). */
export function escucharParticipantesReto(codigo, docenteId, cb, onError) {
  const q = query(collection(db, 'retoParticipantes'), where('docenteId', '==', docenteId), where('sesionId', '==', codigo))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), onError)
}
/** Respuestas de la sesión: solo para contar cuántos respondieron cada pregunta. */
export function escucharRespuestasReto(codigo, docenteId, cb, onError) {
  const q = query(collection(db, 'retoRespuestas'), where('docenteId', '==', docenteId), where('sesionId', '==', codigo))
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), onError)
}
export function escucharResultadosReto(codigo, cb, onError) {
  return onSnapshot(doc(db, 'retoResultados', codigo), (s) => cb(s.exists() ? s.data() : null), onError)
}

/** Sesiones del reto, la más reciente primero. Dos igualdades: no necesita índice compuesto. */
export async function sesionesDeReto(actividadId, docenteId) {
  const snap = await getDocs(query(collection(db, 'retoSesiones'), where('docenteId', '==', docenteId), where('actividadId', '==', actividadId)))
  return snap.docs.map((d) => ({ codigo: d.id, ...d.data() })).sort((a, b) => (b.creadaMs ?? 0) - (a.creadaMs ?? 0))
}

/** Borra UNA sesión (como en Participación en vivo); el servidor limpia sus participantes, respuestas y resultados. */
export const borrarSesionReto = (codigo) => deleteDoc(doc(db, 'retoSesiones', codigo))
