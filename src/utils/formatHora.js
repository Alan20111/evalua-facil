// Formato de hora único para toda la UI: 12 horas con am/pm en minúsculas,
// sin ceros a la izquierda en la hora y sin puntos ("4:00 pm", no "04:00
// p.m." ni "16:00 hrs"). Los campos guardados (horaInicio, horaFin, hora,
// etc.) siguen siendo "HH:MM" 24h — necesario para ordenar/comparar — esto
// es solo para mostrar.
export function formatHora12(hhmm) {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm
  const periodo = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${periodo}`
}

// Mismo formato, a partir de un objeto Date (hora local del dispositivo).
export function formatHora12FromDate(d) {
  if (!d) return ''
  const periodo = d.getHours() < 12 ? 'am' : 'pm'
  const h12 = d.getHours() % 12 || 12
  return `${h12}:${String(d.getMinutes()).padStart(2, '0')} ${periodo}`
}
