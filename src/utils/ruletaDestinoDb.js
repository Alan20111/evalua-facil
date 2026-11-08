// La Ruleta del Destino — acceso a Firestore y al servidor desde la pantalla del docente (fase 2).
//
// El navegador solo escribe la ACTIVIDAD (como cualquier actividad; las reglas de la fase 1 exigen su forma: modalidad,
// acceso y preguntas fijos, ranking solo en vivo). El banco (`ruletaReactivos`) y su estado (`ruletaBancos`) los
// escribe SOLO el servidor (R1, F2-1): aquí se leen y se piden cambios a /api/subject/ruleta-banco. La lógica (qué se
// puede guardar, el avance del banco) vive en src/utils/ruletaDestino.js.
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { fetchApi } from './apiBase'
import { RULETA_CFG, bancoVacio, datosNuevaRuleta, origenBanco } from './ruletaDestino'

const segundos = (t) => (t?.toMillis ? t.toMillis() : 0)

/** Crea la ruleta (oculta) y devuelve su id. Lanza un Error con el mensaje para el docente si algo no cuadra. */
export async function crearRuleta(entrada) {
  const r = datosNuevaRuleta(entrada)
  if (!r.ok) throw Object.assign(new Error(r.error), { codigo: r.codigo })
  const ref = await addDoc(collection(db, 'activities'), { ...r.datos, createdAt: serverTimestamp() })
  return ref.id
}

/**
 * La ruleta, su banco (en el orden en que se agregó) y el estado del banco. null si no existe; `noEsRuleta` si la
 * actividad es de otra categoría. Antes del primer reactivo el estado del banco todavía no existe (y las reglas no
 * dejan leer un documento ausente): se toma como vacío.
 */
export async function cargarRuleta(activityId, uid) {
  const snap = await getDoc(doc(db, 'activities', activityId))
  if (!snap.exists()) return null
  const actividad = { id: snap.id, ...snap.data() }
  if (actividad.categoria !== RULETA_CFG.CATEGORIA) return { actividad, noEsRuleta: true }
  const [reactivosSnap, banco] = await Promise.all([
    getDocs(query(collection(db, 'ruletaReactivos'), where('docenteId', '==', uid), where('actividadId', '==', activityId))),
    getDoc(doc(db, 'ruletaBancos', activityId)).then((b) => (b.exists() ? b.data() : bancoVacio())).catch(() => bancoVacio()),
  ])
  const reactivos = reactivosSnap.docs
    .map((d) => ({ id: d.id, enunciado: d.data().enunciado, opciones: d.data().opciones, correcta: d.data().correcta, creadoEn: segundos(d.data().creadoEn) }))
    .sort((a, b) => (a.creadoEn - b.creadoEn) || a.id.localeCompare(b.id))
  // El origen ('manual' | 'ia') es el que guardó el servidor; la pantalla solo lo refleja (nunca lo envía ni lo cambia).
  return { actividad, reactivos, banco: { total: banco.total ?? 0, aprobado: banco.aprobado === true, origen: origenBanco(banco) } }
}

/** Nombre y tema (campos de la actividad; el tema va fuera del mapa `ruleta`). */
export async function guardarDatosRuleta(activityId, { nombre, tema }) {
  await updateDoc(doc(db, 'activities', activityId), { nombre: nombre.trim(), tema: tema.trim() })
}

/** Ranking (solo en vivo; las reglas lo rechazan en individual). */
export async function guardarRankingRuleta(activityId, ranking) {
  await updateDoc(doc(db, 'activities', activityId), { 'ruleta.ranking': ranking === true })
}

/**
 * Pide una operación del banco al servidor: guardar, editar, borrar, aprobar o config. Si falla, lanza un Error con el
 * mensaje para la pantalla, `status`, `codigo` y `errores`.
 */
export async function operacionBanco(operacion, cuerpo) {
  return llamarServidor('ruleta-banco', operacion, cuerpo)
}

/**
 * Partida del estudiante (fases 4 y 5, individual): estado (inicia o recupera), girar o responder. Lo que devuelve el
 * servidor nunca trae la respuesta correcta. Si falla, lanza un Error con el mensaje para la pantalla, `status` y `codigo`.
 */
export async function operacionPartida(operacion, cuerpo) {
  return llamarServidor('ruleta-partida', operacion, cuerpo)
}

/**
 * Avance del estudiante en las ruletas de una asignatura (solo lectura; nunca crea partidas):
 * { [actividadId]: { estado: 'en_curso' | 'terminada', respondidas, total } }.
 */
export async function estadosRuletaAlumno(asignaturaId) {
  const r = await llamarServidor('ruleta-partida', 'estados', { asignaturaId })
  return r.ruletas || {}
}

/**
 * Resultados de una ruleta para el docente (paso 2): los participantes con su avance, aciertos, calificación, qué
 * pasó con la nota y el detalle de cada pregunta, con el nombre de cada estudiante. Solo lee lo del propio docente
 * (las reglas exigen el filtro por docenteId).
 */
export async function cargarResultadosRuleta(actividad, uid) {
  const [partSnap, alumnosSnap] = await Promise.all([
    getDocs(query(collection(db, 'ruletaParticipantes'), where('docenteId', '==', uid), where('actividadId', '==', actividad.id))),
    getDocs(query(collection(db, 'students'), where('asignaturaId', '==', actividad.asignaturaId))),
  ])
  const alumnos = new Map(alumnosSnap.docs.map((d) => [d.id, d.data()]))
  return partSnap.docs.map((d) => {
    const p = d.data()
    const respuestas = Array.isArray(p.partida?.respuestas) ? p.partida.respuestas : []
    return {
      id: d.id,
      alumnoId: p.alumnoId,
      alumno: alumnos.get(p.alumnoId) || null,
      terminada: p.partida?.estado === 'terminada',
      respondidas: respuestas.length,
      total: p.preguntasPorPartida,
      resultado: p.resultado || null,
      nota: p.nota || null,
      detalle: respuestas.map((r) => {
        const q = p.preguntas?.[r.reactivoId] || {}
        return { indice: r.indice, enunciado: q.enunciado || '', opciones: q.opciones || [], correcta: q.correcta, opcion: r.opcion, motivo: r.motivo, acierto: r.correcta === true, tiempoMs: r.tiempoMs }
      }),
    }
  })
}

async function llamarServidor(accion, operacion, cuerpo) {
  const headers = { 'Content-Type': 'application/json' }
  const token = await auth.currentUser?.getIdToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetchApi(`/api/subject/${accion}`, { method: 'POST', headers, body: JSON.stringify({ operacion, ...cuerpo }) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw Object.assign(new Error(json?.error || 'No se pudo completar. Intenta de nuevo.'), {
      status: res.status, codigo: json?.codigo || null, errores: json?.errores || [],
    })
  }
  return json
}
