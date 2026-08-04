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

// Ciclo escolar mexicano ("2025-2026") derivado de fechaInicio — no hay un
// campo estructurado para esto (ver subject.ciclo, que es texto libre
// heredado), así que se calcula con la convención agosto-julio: un curso
// que arranca en la segunda mitad del año (ago-dic) pertenece al ciclo que
// empieza ESE año; uno que arranca en la primera mitad (ene-jul) pertenece
// al ciclo que empezó el agosto anterior. Usado en los encabezados
// "oficiales" de los exportes (ver excel.js/pdf.js) para que un director
// los reciba con el ciclo escolar ya puesto, sin que el docente lo escriba
// a mano.
export function cicloEscolarDe(subject) {
  const fecha = subject?.fechaInicio
  if (!fecha) return ''
  const d = new Date(`${fecha}T00:00:00`)
  if (isNaN(d)) return ''
  const y = d.getFullYear()
  return d.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`
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
