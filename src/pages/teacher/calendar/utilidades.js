// Constantes y funciones de CalendarPage.jsx (fase 5 de PLAN_NORMALIZACION_UI).
import { Calendar, CalendarRange, Columns3, LayoutGrid, List } from 'lucide-react'
import { IS_NATIVE_APP } from '../../../utils/platform'
import { formatHora12 } from '../../../utils/formatHora'

// ─── Date helpers ──────────────────────────────────────────────────────────
export const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

export const DIAS_CORTO = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']

export function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

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

export function getMonthGrid(year, month) {
  const first = new Date(year, month, 1)
  const startDay = (first.getDay() + 6) % 7
  const start = addDays(new Date(year, month, 1), -startDay)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export function getWeekDays(date) {
  const mon = startOfWeekMon(date)
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i))
}

export function fmtHour(timeStr) {
  return formatHora12(timeStr)
}

export const ROW_H = 52

// px por hora en la vista semana
export const AGENDA_ROW_H = 64

// px por hora en la agenda del día
// Tamaños de texto de la rejilla (3 días y Semana).
//
// El texto de clases y eventos se probó al doble (20 px) en la web y quedó
// demasiado grande: las columnas de Semana son angostas y se comía el nombre
// de cada clase a puros puntos suspensivos. Quedó en 14 px, elegido a ojo
// sobre la pantalla real entre los 10 px originales y esos 20. En la app se
// queda en 10: ahí la columna de un día mide unos centímetros y no cabe.
//
// Medidas pedidas para la web (la app se queda como estaba en todas):
//   Día      → clases y eventos 13, horas 12
//   3 días   → clases y eventos 14, horas 12
//   Semana   → clases y eventos 14, horas 12
//   Mes      → clases y eventos 11
// Mes va más chico a propósito: en cada día solo caben tres antes del "+N más".
//
// En la app, Día se seguía viendo grande incluso ya emparejado con el
// tamaño de título de 3 días (12px) — la columna de Día es de ancho
// completo, así que el mismo tamaño se percibe más grande que en 3 días
// (columnas angostas). Se redujo directo a 10px, igual al texto secundario
// de la rejilla.
export const GRID_ITEM_TEXT = IS_NATIVE_APP ? 'text-[10px]' : 'text-[14px]'

export const GRID_ITEM_TITLE = IS_NATIVE_APP ? 'text-xs' : 'text-[14px]'

export const GRID_HOUR_TEXT = IS_NATIVE_APP ? 'text-[10px]' : 'text-[12px]'

export const DIA_ITEM_TEXT = IS_NATIVE_APP ? 'text-[10px]' : 'text-[13px]'

export const DIA_HOUR_TEXT = IS_NATIVE_APP ? 'text-[11px]' : 'text-[12px]'

// El am/pm cuelga debajo de la hora, más chico: es la etiqueta, no el dato.
export const DIA_HOUR_AMPM = IS_NATIVE_APP ? 'text-[9px]' : 'text-[10px]'

export const GRID_HOUR_AMPM = IS_NATIVE_APP ? 'text-[9px]' : 'text-[10px]'

export const DIA_HOUR_FIN_TEXT = IS_NATIVE_APP ? 'text-[9px]' : 'text-[12px]'

export const DIA_HOUR_INI_TEXT = IS_NATIVE_APP ? 'text-[10px]' : 'text-[12px]'

export const MES_ITEM_TEXT = IS_NATIVE_APP ? 'text-[10px]' : 'text-[12px]'

export const DEFAULT_DAY_START = 7

export const DEFAULT_DAY_END = 21

export const DIAS_LARGO = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']

// ─── Week view ─────────────────────────────────────────────────────────────
export function minutesToTimeStr(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export const SNAP_MIN = 15

// ─── Main CalendarPage ─────────────────────────────────────────────────────
export const VIEWS_ALL = [
  { id: 'agenda', label: 'Día',    Icon: List },
  { id: '3dias',  label: '3 días', Icon: Columns3 },
  { id: 'semana', label: 'Semana', Icon: CalendarRange },
  { id: 'mes',    label: 'Mes',    Icon: LayoutGrid },
  { id: 'anio',   label: 'Año',    Icon: Calendar },
]

// En la app nativa: Día, 3 días, Mes y Año (patrón del Calendario de Apple —
// Año → Mes → Día, oct-2026). Semana sigue solo en la web: en un teléfono sus
// siete columnas no caben legibles.
export const VIEWS = IS_NATIVE_APP
  ? VIEWS_ALL.filter(v => v.id !== 'semana')
  : VIEWS_ALL
