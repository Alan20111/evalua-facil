// Human-readable date range for a subject's fechaInicio / fechaFin (both optional,
// stored as 'YYYY-MM-DD' strings). Falls back to the legacy `ciclo` string for
// subjects created before R6.

function fmt(d) {
  if (!d) return ''
  // Append T00:00:00 so the date is parsed in local time (avoids the off-by-one
  // that happens when 'YYYY-MM-DD' is parsed as UTC midnight).
  const date = new Date(`${d}T00:00:00`)
  if (isNaN(date)) return ''
  return date.toLocaleDateString('es-MX', { month: 'short', year: 'numeric' })
}

/** "feb 2026 – jul 2026", or one side, or '' when there are no dates. */
export function formatDateRange(fechaInicio, fechaFin) {
  const a = fmt(fechaInicio)
  const b = fmt(fechaFin)
  if (a && b) return `${a} – ${b}`
  return a || b || ''
}

/** What to show under a subject name: the date range, else the legacy ciclo. */
export function subjectPeriodLabel(subject) {
  if (!subject) return ''
  return formatDateRange(subject.fechaInicio, subject.fechaFin) || subject.ciclo || ''
}
