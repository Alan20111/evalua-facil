// Prórrogas por estudiante de una actividad.
//
// `activity.extensiones` es un mapa plano studentId → 'YYYY-MM-DDTHH:MM', sin
// metadatos de agrupación, y `activity.extensionesMotivo` otro mapa igual con
// el motivo. Una sola acción de "Nueva fecha límite" escribe la MISMA fecha y
// motivo a todos los estudiantes seleccionados, así que agrupar por (fecha,
// motivo) reconstruye "a quién se le dio esta prórroga" sin guardar un historial
// aparte.
//
// Vive aquí y no dentro de un editor porque lo usan los dos: entregables
// (EntregableEditor) y evaluaciones (EvaluacionEditor).

import { collection, getDocs, query, where } from 'firebase/firestore'
import { studentFullName } from './studentSearch'

export function groupExtensions(extensiones, extensionesMotivo, students) {
  const byKey = new Map()
  Object.entries(extensiones || {}).forEach(([studentId, date]) => {
    if (!date) return
    const motivo = (extensionesMotivo || {})[studentId] || ''
    const key = `${date}|${motivo}`
    const student = (students || []).find((s) => s.id === studentId)
    const name = student ? studentFullName(student) : 'Estudiante'
    if (!byKey.has(key)) byKey.set(key, { date, motivo, names: [] })
    byKey.get(key).names.push(name)
  })
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// ── Prórroga solo sin entrega real ────────────────────────────────────────────
//
// Una prórroga individual solo se puede dar (o cambiar) mientras el alumno NO
// tiene una entrega real. Si ya entregó, el docente primero anula la entrega:
// al borrarse el documento vuelve a poder darle fecha, y la prórroga que ya
// tuviera se conserva (anular no toca la actividad).
//
// ¿Qué es "entrega real"?
//   · Sin documento → no.
//   · `sinEntrega: true` (lo crea el docente: calificar sin entrega, asignación
//     masiva, cierre de parcial) → no.
//   · Juego → cualquier otro documento, igual que el "Anular" de JuegoManager.
//   · Cuestionario / examen → solo el intento `finalizado`. Uno `en_progreso`
//     no cuenta, y es justo donde EvaluacionManager ofrece "Anular".
//   · Entregable → cualquier otro documento.
//
// Juego antes que evaluación: se distingue por `categoria`, no por `tipo`.
// Solo decide si se ofrece la prórroga; no cambia cómo se calcula la fecha
// efectiva del alumno ni lo que aceptan las reglas.
export function tieneEntregaReal(sub, activity = null) {
  if (!sub || sub.sinEntrega === true) return false
  if (activity?.categoria === 'juego') return true
  if (activity?.tipo === 'evaluacion') return sub.estadoEvaluacion === 'finalizado'
  return true
}

// Lee de Firestore, EN ESTE MOMENTO, las entregas reales de la actividad (de
// un solo alumno si se pasa `alumnoId`). Devuelve un Map alumnoId → submission.
// Las pantallas del docente leen las entregas una sola vez, así que antes de
// escribir una prórroga se vuelve a preguntar: el alumno pudo entregar
// mientras la pantalla estaba abierta. Se consulta por campos y no por el id
// determinista para alcanzar también documentos viejos con id aleatorio.
// `activity` solo aporta el tipo (ver tieneEntregaReal).
export async function leerEntregasReales(db, actividadId, activity, alumnoId = null) {
  const filtros = [where('actividadId', '==', actividadId)]
  if (alumnoId) filtros.push(where('alumnoId', '==', alumnoId))
  const snap = await getDocs(query(collection(db, 'submissions'), ...filtros))
  const reales = new Map()
  snap.docs.forEach((d) => {
    const sub = { id: d.id, ...d.data() }
    if (tieneEntregaReal(sub, activity)) reales.set(sub.alumnoId, sub)
  })
  return reales
}

export const MENSAJE_PRORROGA_CON_ENTREGA =
  'Este estudiante ya tiene una entrega. Para modificar su fecha, primero anula la entrega.'
