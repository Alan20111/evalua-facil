// Helpers de fecha/cuadrícula para vistas de calendario Día/Semana/Mes.
//
// El calendario del docente (src/pages/teacher/CalendarPage.jsx) define
// estos mismos helpers de forma local/privada — es un archivo grande y ya
// probado en producción, así que no se toca aquí para no arriesgarlo. Este
// archivo es la versión reutilizable para la Agenda del estudiante y
// cualquier vista de calendario futura.

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export const DIAS_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
export const DIAS_LARGO = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

export function addDays(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}
export function addMonths(d, n) {
  const r = new Date(d); r.setMonth(r.getMonth() + n); return r
}
export function addWeeks(d, n) { return addDays(d, n * 7) }

export function startOfWeekMon(d) {
  const r = new Date(d)
  r.setDate(r.getDate() - (r.getDay() + 6) % 7)
  r.setHours(0, 0, 0, 0)
  return r
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}
export function isToday(d) { return isSameDay(d, new Date()) }

// 42 celdas (6×7) empezando en lunes, cubriendo el mes completo con relleno
// de días del mes anterior/siguiente.
export function getMonthGrid(year, month) {
  const first = new Date(year, month, 1)
  const startDay = (first.getDay() + 6) % 7
  const start = addDays(first, -startDay)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export function getWeekDays(date) {
  const mon = startOfWeekMon(date)
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i))
}

export function fmtHour(timeStr) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':')
  return `${parseInt(h)}:${m}`
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
