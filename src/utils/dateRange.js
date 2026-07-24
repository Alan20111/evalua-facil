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

const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

// Mismo formato largo que EFDateTimePicker ("Viernes 24 de Julio de 2026"),
// para que las fechas fijas (no editables) en otras pantallas se vean igual
// que las elegibles con el picker — ver también ParcialesFechas.jsx.
export function formatLongDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(`${dateStr}T00:00:00`)
  if (isNaN(d)) return ''
  return `${DIAS_SEMANA[(d.getDay() + 6) % 7]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`
}

// 'YYYY-MM-DD' → 'DD/MM/AA' — formato corto para mostrar junto al nombre de
// la asignatura o de cada parcial, donde el formato largo no cabe.
export function formatShortDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(`${dateStr}T00:00:00`)
  if (isNaN(d)) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`
}

/** "24/07/26 – 18/12/26" para el rango del curso, en formato corto. */
export function formatShortDateRange(fechaInicio, fechaFin) {
  const a = formatShortDate(fechaInicio)
  const b = formatShortDate(fechaFin)
  if (a && b) return `${a} – ${b}`
  return a || b || ''
}
