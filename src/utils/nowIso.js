// Local "now" as a 'YYYY-MM-DDTHH:MM' string — the same shape EFDateTimePicker
// stores and compares (local time, no timezone suffix). Used to keep date/time
// pickers from accepting moments already in the past.

// Un solo punto para "Date → 'YYYY-MM-DDTHH:MM' en hora local" — antes esta
// misma línea estaba copiada a mano en 5 archivos distintos (EvaluacionEditor,
// EntregableEditor, VisibilitySelect, EvaluacionManager, PublicacionScheduler),
// cada uno con su propia función local (toIsoNow/computeScheduleDefault/
// toIsoNowLocal) que hacía exactamente esto.
export function isoLocalFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function nowIsoLocal() {
  return isoLocalFromDate(new Date())
}

// Latest of several 'YYYY-MM-DDTHH:MM' strings (falsy values ignored). These
// strings sort lexicographically the same as chronologically, so a plain string
// compare is enough. Returns undefined when nothing was provided.
export function maxIso(...values) {
  const present = values.filter(Boolean)
  if (present.length === 0) return undefined
  return present.reduce((a, b) => (b > a ? b : a))
}

// Minimum a *deadline* (fecha límite) picker should allow: never in the past, and
// never before the activity is published. Pass the effective publish datetime
// (publishAt for a scheduled activity, publishedAt for an already-published one).
export function minDeadline(publishAt) {
  return maxIso(nowIsoLocal(), publishAt)
}
