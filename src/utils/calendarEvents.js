// Helpers puros compartidos por el calendario del docente
// (src/pages/teacher/CalendarPage.jsx) y la Agenda del alumno
// (src/pages/student/Agenda.jsx) — separados en su propio archivo porque
// mezclar funciones/constantes con componentes en el mismo módulo rompe
// Fast Refresh (react-refresh/only-export-components).

export const CATEGORIA_LABEL = { examen: 'Examen', cuestionario: 'Cuestionario', observacion: 'Observación', entregable: 'Entregable' }

// Estado de una fecha límite respecto a ahora, para dar contexto sin abrir la actividad.
export function deadlineEstado(fechaLimiteISO) {
  const ms = new Date(fechaLimiteISO) - new Date()
  const dias = Math.ceil(ms / 86400000)
  if (ms < 0) return { label: 'Vencida', tono: 'vencida' }
  if (dias <= 0) return { label: 'Vence hoy', tono: 'hoy' }
  if (dias === 1) return { label: 'Vence mañana', tono: 'proxima' }
  return { label: `Vence en ${dias} días`, tono: 'proxima' }
}

// Asigna "carriles" a items { start, end } (minutos desde medianoche) que se
// solapan en un mismo día, para mostrarlos lado a lado en vez de encimados.
export function assignLanes(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start)
  const lanesEnd = [] // minuto de fin de cada carril
  const placed = sorted.map((it) => {
    let lane = lanesEnd.findIndex((e) => e <= it.start)
    if (lane === -1) { lane = lanesEnd.length; lanesEnd.push(it.end) }
    else lanesEnd[lane] = it.end
    return { it, lane }
  })
  const total = Math.max(1, lanesEnd.length)
  return placed.map((p) => ({ ...p, total }))
}

// `personalEvents` mezcla dos listeners independientes ('events' y
// 'academicEvents') — cada snapshot reemplaza solo las entradas de SU
// propio tipo, conservando las del otro listener intactas.
export function mergeEvents(nuevos, prevList, tipo) {
  return [...prevList.filter((e) => e.tipo !== tipo), ...nuevos]
}
