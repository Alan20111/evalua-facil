// Single source of truth for activity visibility.
// Used by teacher views (styling) and student views (filtering).
// Backward-compat: activities without `oculta` field are treated as visible.
// `parcialOculto` is the subject-level override (the whole parcial hidden from
// students) — when true it always wins over the activity's own `oculta` state.

export function isActivityPublished(a, parcialOculto = false) {
  if (parcialOculto) return false
  if (!a?.oculta) return true
  if (a.publishAt) return new Date(a.publishAt).getTime() <= Date.now()
  return false
}

// Returns the display state for teacher UI.
// 'visible' | 'scheduled' | 'hidden'
export function activityVisibilityState(a, parcialOculto = false) {
  if (parcialOculto) return 'hidden'
  if (!a?.oculta) return 'visible'
  if (a.publishAt && new Date(a.publishAt).getTime() <= Date.now()) return 'visible'
  if (a.publishAt) return 'scheduled'
  return 'hidden'
}

// Human-readable label for scheduled date
export function formatPublishAt(publishAt) {
  if (!publishAt) return ''
  const d = new Date(publishAt)
  // toLocaleString (not toLocaleDateString) so hour/minute are actually rendered.
  return d.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Human-readable label for the submission deadline. `fechaLimite` used to be
// a plain date (YYYY-MM-DD); default legacy values without a time component
// to midnight so the hour always renders.
export function formatDeadline(fechaLimite) {
  if (!fechaLimite) return ''
  const hasTime = fechaLimite.includes('T')
  const d = new Date(hasTime ? fechaLimite : `${fechaLimite}T00:00:00`)
  return d.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ── Estado de entrega para el estudiante ────────────────────────────────
// Misma lógica graded/delivered/overdue que ya usa
// src/pages/student/SubjectPage.jsx (duplicada ahí dos veces) — centralizada
// aquí para que también la use la Agenda del estudiante.

// `fechaLimite` puede ser una fecha simple ('YYYY-MM-DD', legado) o traer hora
// ('...THH:MM'). Sin hora, `new Date(str)` la interpreta como medianoche UTC,
// lo que corre la fecha un día en zonas horarias al oeste de UTC — se ancla a
// las 23:59 hora LOCAL (fin del día) para que "vencida"/"hoy" coincidan con el
// calendario del estudiante, no con UTC.
function parseFechaLimite(fechaLimite) {
  const hasTime = fechaLimite.includes('T')
  return new Date(hasTime ? fechaLimite : `${fechaLimite}T23:59:59`)
}

export function isOverdue(activity) {
  if (!activity?.fechaLimite) return false
  const d = parseFechaLimite(activity.fechaLimite)
  return !isNaN(d.getTime()) && d < new Date()
}

export function isDueToday(activity) {
  if (!activity?.fechaLimite) return false
  const d = parseFechaLimite(activity.fechaLimite)
  if (isNaN(d.getTime())) return false
  const hoy = new Date()
  return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate()
}

// 'calificada' | 'entregada' | 'hoy' | 'vencida' | 'proxima' | null (sin
// fecha límite — p.ej. una observación, que no aplica a la Agenda por fecha).
export function estadoAgenda(activity, submission) {
  if (!activity?.fechaLimite) return null
  const graded = submission?.calificacion != null
  const delivered = submission && !graded
  if (graded) return 'calificada'
  if (delivered) return 'entregada'
  if (isDueToday(activity)) return 'hoy'
  if (isOverdue(activity)) return 'vencida'
  return 'proxima'
}
