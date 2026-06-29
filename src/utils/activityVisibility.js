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
