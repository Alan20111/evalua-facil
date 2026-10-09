// Escritura/lectura de `activities/{id}/propuestasVideo` (ver propuestasVideo.js
// para las reglas de negocio — aquí solo se aplican).
//
// Las escrituras entran por `firestoreGuard`, igual que evaluacionClave.js: es
// el candado de suscripción de las pantallas del docente.
import { collection, doc, getDocs, serverTimestamp } from 'firebase/firestore'
import { updateDoc, writeBatch } from './firestoreGuard'
import { db } from '../firebase'
import { partirPregunta } from './evaluacionClave'
import { ESTADO_PROPUESTA, aplicarEdicion, ordenarPropuestas, planAprobacion, propuestaDesdeIA, idPropuesta } from './propuestasVideo'

const coleccion = (activityId) => collection(db, 'activities', activityId, 'propuestasVideo')
const refPropuesta = (activityId, id) => doc(db, 'activities', activityId, 'propuestasVideo', id)

export async function cargarPropuestas(activityId) {
  const snap = await getDocs(coleccion(activityId))
  return ordenarPropuestas(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
}

/**
 * Guarda lo que devolvió `generar_preguntas_video` (resultado.preguntas) como
 * propuestas PENDIENTES. Idempotente: los ids salen de la generación, y una
 * propuesta que ya existe (quizá ya editada o aprobada) NO se vuelve a escribir.
 * Devuelve cuántas propuestas nuevas guardó.
 */
export async function guardarPropuestasGeneradas(activityId, preguntasIA, generacionId) {
  const existentes = new Set((await getDocs(coleccion(activityId))).docs.map((d) => d.id))
  const batch = writeBatch(db)
  let nuevas = 0
  preguntasIA.forEach((p, i) => {
    const id = idPropuesta(generacionId, i)
    if (existentes.has(id)) return
    batch.set(refPropuesta(activityId, id), { ...propuestaDesdeIA(p, generacionId), creadoEl: serverTimestamp() })
    nuevas += 1
  })
  if (nuevas) await batch.commit()
  return nuevas
}

/** Guarda la edición del docente. Devuelve los campos escritos o null si no cambió nada. */
export async function editarPropuesta(activityId, propuesta, edicion) {
  const r = aplicarEdicion(propuesta, edicion)
  if (!r) return null
  await updateDoc(refPropuesta(activityId, propuesta.id), { ...r.campos, editadoEl: serverTimestamp() })
  return r.campos
}

/**
 * Aprueba: UN lote atómico con la pregunta activa (+ clave) y el cambio de estado.
 * No toca las ponderaciones de las demás preguntas (ver ponderacionParaAprobada).
 * Si ya estaba aprobada no escribe nada. Devuelve el plan aplicado.
 */
export async function aprobarPropuesta({ activityId, propuesta, activas, pendientes, duracionSeg }) {
  const plan = planAprobacion({ propuesta, activas, pendientes, duracionSeg })
  if (plan.yaAprobada) return plan
  const { publico, clave } = partirPregunta(plan.pregunta)
  const batch = writeBatch(db)
  batch.set(doc(db, 'activities', activityId, 'preguntas', plan.preguntaId), publico)
  batch.set(doc(db, 'activities', activityId, 'clave', plan.preguntaId), clave)
  batch.update(refPropuesta(activityId, propuesta.id), { estado: ESTADO_PROPUESTA.APROBADA, preguntaId: plan.preguntaId, revisadoEl: serverTimestamp() })
  await batch.commit()
  return plan
}

export async function rechazarPropuesta(activityId, propuesta) {
  if (propuesta.estado !== ESTADO_PROPUESTA.PENDIENTE) throw new Error('Solo se pueden rechazar preguntas pendientes.')
  await updateDoc(refPropuesta(activityId, propuesta.id), { estado: ESTADO_PROPUESTA.RECHAZADA, revisadoEl: serverTimestamp() })
}

export async function restaurarPropuesta(activityId, propuesta) {
  if (propuesta.estado !== ESTADO_PROPUESTA.RECHAZADA) throw new Error('Solo se pueden restaurar preguntas rechazadas.')
  await updateDoc(refPropuesta(activityId, propuesta.id), { estado: ESTADO_PROPUESTA.PENDIENTE, revisadoEl: serverTimestamp() })
}
