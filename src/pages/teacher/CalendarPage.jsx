import { useState, useEffect, useMemo, useRef } from 'react'
import { collection, query, where, getDocs, onSnapshot, doc, serverTimestamp } from 'firebase/firestore'
// Escrituras a través del candado de suscripción vencida (ver utils/firestoreGuard.js).
import { updateDoc, writeBatch, addDoc, deleteDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import EFDateTimePicker from '../../components/EFDateTimePicker'
import EventEditor, { EVENT_COLORS } from '../../components/calendar/EventEditor'
import ProgramarBloquesModal from '../../components/calendar/ProgramarBloquesModal'
import ProgramarZonaSemanal from '../../components/calendar/ProgramarZonaSemanal'
import useAlarmas from '../../components/calendar/useAlarmas'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectColors } from '../../utils/subjectPalette'
import { bloqueColor, timeToMinutes, addMinutesToTime, generarBloques, tramosFaltantes as tramosFaltantesDe } from '../../utils/horarioBloques'
import { CATEGORIA_LABEL, deadlineEstado, assignLanes, mergeEvents } from '../../utils/calendarEvents'
import { formatLongDate } from '../../utils/dateRange'
import SubjectIcon from '../../components/SubjectIcon'
import { useNavigate } from 'react-router-dom'
import { buildAsuetoMap, esAsuetoPara, esAsuetoAlguno, alcanceAsuetoTexto, alcanceCompleto, TIPOS_ASUETO } from '../../utils/asuetos'
import { buildVacacionMap, fechasVacacionParaClases } from '../../utils/vacaciones'
import { TEACHER_CONTAINER } from '../../config/layout'
import { IS_NATIVE_APP } from '../../utils/platform'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { usePointerDrag } from '../../hooks/usePointerDrag'
import { refreshTeacherReminders } from '../../utils/localReminders'
import { formatHora12 } from '../../utils/formatHora'
import MiniSelect from '../../components/calendar/MiniSelect'
import { isActivityPublished, isDraftActivity, withDefaultTime } from '../../utils/activityVisibility'
import {
  Clock, Send, CalendarDays, ChevronLeft, ChevronRight, Plus,
  List, LayoutGrid, CalendarRange, CalendarPlus, AlertTriangle, Bell, CalendarClock,
  CalendarOff, Trash2, X, Minus, Columns3, Lock, LockOpen,
} from 'lucide-react'

// ─── Date helpers ──────────────────────────────────────────────────────────

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DIAS_CORTO = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function addDays(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}
function addMonths(d, n) {
  const r = new Date(d); r.setMonth(r.getMonth() + n); return r
}
function addWeeks(d, n) { return addDays(d, n * 7) }
function startOfWeekMon(d) {
  const r = new Date(d)
  r.setDate(r.getDate() - (r.getDay() + 6) % 7)
  r.setHours(0, 0, 0, 0)
  return r
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate()
}
function isToday(d) { return isSameDay(d, new Date()) }
function getMonthGrid(year, month) {
  const first = new Date(year, month, 1)
  const startDay = (first.getDay() + 6) % 7
  const start = addDays(new Date(year, month, 1), -startDay)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}
function getWeekDays(date) {
  const mon = startOfWeekMon(date)
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i))
}
function fmtHour(timeStr) {
  return formatHora12(timeStr)
}
const ROW_H = 52        // px por hora en la vista semana
const AGENDA_ROW_H = 64 // px por hora en la agenda del día

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
const GRID_ITEM_TEXT = IS_NATIVE_APP ? 'text-[10px]' : 'text-[14px]'
const GRID_ITEM_TITLE = IS_NATIVE_APP ? 'text-xs' : 'text-[14px]'
const GRID_HOUR_TEXT = IS_NATIVE_APP ? 'text-[10px]' : 'text-[12px]'
const DIA_ITEM_TEXT = IS_NATIVE_APP ? 'text-[10px]' : 'text-[13px]'
const DIA_HOUR_TEXT = IS_NATIVE_APP ? 'text-[11px]' : 'text-[12px]'
// El am/pm cuelga debajo de la hora, más chico: es la etiqueta, no el dato.
const DIA_HOUR_AMPM = IS_NATIVE_APP ? 'text-[9px]' : 'text-[10px]'
const GRID_HOUR_AMPM = IS_NATIVE_APP ? 'text-[9px]' : 'text-[10px]'
const DIA_HOUR_FIN_TEXT = IS_NATIVE_APP ? 'text-[9px]' : 'text-[12px]'
const DIA_HOUR_INI_TEXT = IS_NATIVE_APP ? 'text-[10px]' : 'text-[12px]'
const MES_ITEM_TEXT = IS_NATIVE_APP ? 'text-[10px]' : 'text-[12px]'
const DEFAULT_DAY_START = 7
const DEFAULT_DAY_END = 21
const DIAS_LARGO = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']

// ─── Event pill component ──────────────────────────────────────────────────

export function EventPill({ ev, compact, onClick, movable }) {
  // Fecha límite: candado cerrado/abierto según si ya deja de recibir tarde
  // (cambia solo cuando el docente edita la actividad). Publicación: sin
  // candado, se queda como está.
  // El ojito ya se usa en toda la app para "visible/no visible" (VisibilitySelect) —
  // aquí necesitábamos algo distinto para "se publicó en esta fecha".
  const Icon = ev.tipo === 'deadline' ? (ev.cierraEnFecha ? Lock : LockOpen) : ev.tipo === 'publicacion' ? Send : CalendarDays
  const dot = ev.tipo === 'deadline' && (ev.estado?.tono === 'vencida' || ev.estado?.tono === 'hoy')
  const esActividad = ev.tipo === 'deadline' || ev.tipo === 'publicacion'
  // La materia se muestra SIEMPRE como texto, nunca solo en tooltip: en
  // celular/tablet (touch) los tooltips no aparecen nunca (ver index.css).
  const materia = esActividad && ev.subtitulo ? ev.subtitulo.split(' · ')[0] : null
  return (
    <button
      type="button"
      onClick={onClick ? e => { e.stopPropagation(); onClick(ev) } : undefined}
      data-tooltip={esActividad ? 'Clic para editar esta actividad' : movable ? 'Muévelo' : undefined}
      className={`block rounded text-left w-full transition-opacity ${onClick ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'} ${compact ? `px-1 py-0.5 ${MES_ITEM_TEXT}` : 'px-2 py-1 text-xs'}`}
      style={{ background: ev.bg, color: ev.text }}
    >
      <span className="flex items-start gap-1 w-full">
        <Icon size={13} className="flex-shrink-0 mt-0.5" />
        {dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${ev.estado.tono === 'vencida' ? 'bg-red-500' : 'bg-amber-400'}`} />}
        {/* Nunca se corta el nombre: crece a los renglones que necesite —
            así "(Publicada)"/"(Cierre)" siempre queda visible completo. */}
        <span className="break-words leading-tight">{ev.titulo}</span>
        {!compact && ev.timeStr && (
          <span className="ml-auto flex-shrink-0 opacity-70 pl-1">{fmtHour(ev.timeStr)}</span>
        )}
      </span>
      {materia && <span className={`block truncate opacity-80 leading-tight ${IS_NATIVE_APP ? 'text-[10px]' : 'text-[11px]'}`}>{materia}</span>}
    </button>
  )
}

// ─── Agenda view ───────────────────────────────────────────────────────────

// Agenda del día: rejilla de horas (configurable) con las clases y eventos del
// día mostrado. Los items se pueden arrastrar verticalmente para cambiar de
// hora, o soltarse sobre los chips de días posteriores para moverlos de día.
export function AgendaView({
  date, events, bloques, subjects, dayStart, dayEnd,
  onEventClick, onBlockClick, onMoveBloque, onMoveEvent, onSlotClick, asuetoMap = {}, vacacionMap = {},
  // La Agenda del alumno reutiliza esta misma vista con su horario de
  // clases, que él no puede mover — a diferencia del docente (siempre
  // `true` por default, así su comportamiento no cambia).
  editableBloques = true,
}) {
  const dateStr = toDateStr(date)
  const asuetoDia = asuetoMap[dateStr]
  const vacacionDia = vacacionMap[dateStr]
  const hours = Array.from({ length: dayEnd - dayStart }, (_, i) => i + dayStart)
  const gridH = hours.length * AGENDA_ROW_H

  const gridRef = useRef(null)

  // Línea de la hora actual (solo cuando el día mostrado es hoy) — se actualiza
  // cada minuto para que vaya bajando por la rejilla.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const showNowLine = isToday(date) && nowMinutes >= dayStart * 60 && nowMinutes <= dayEnd * 60
  const nowLineTop = (nowMinutes - dayStart * 60) / 60 * AGENDA_ROW_H

  const dayBloques = bloques.filter(b => b.fecha === dateStr)
  const timedEvs = events.filter(ev => ev.dateStr === dateStr && ev.timeStr)
  const allDayEvs = events.filter(ev => ev.dateStr === dateStr && !ev.timeStr)

  const items = [
    ...dayBloques.map(b => ({
      kind: 'bloque', id: b.id,
      start: timeToMinutes(b.horaInicio),
      end: Math.max(timeToMinutes(b.horaFin), timeToMinutes(b.horaInicio) + 20),
      b,
    })),
    ...timedEvs.map(ev => {
      const start = timeToMinutes(ev.timeStr)
      // Duración visual mínima: las actividades llevan nombre (hasta 2
      // renglones) + materia + estado/candado, así que necesitan más alto
      // que un evento personal simple para no recortarse.
      const minVisual = (ev.tipo === 'deadline' || ev.tipo === 'publicacion') ? 75 : 40
      let end = start + minVisual
      if (ev.endTimeStr && ev.endDateStr === ev.dateStr) {
        const e = timeToMinutes(ev.endTimeStr)
        if (e > start + minVisual) end = e
      }
      return { kind: 'event', id: ev.id, start, end, ev }
    }),
  ]
  const placed = assignLanes(items)

  const isMovable = it => (it.kind === 'bloque' && editableBloques) || it.ev?.editable

  const { drag, startDrag: startDragRaw } = usePointerDrag((d, e) => {
    const { item } = d
    if (!d.moved) {
      // Clic: evento → su editor; bloque de clase → diálogo de acciones.
      if (item.kind === 'bloque') onBlockClick?.(item.b)
      else onEventClick?.(item.ev)
      return
    }
    // ¿Soltó sobre la rejilla? → nueva hora, mismo día. Cambiar de día se
    // hace desde Semana o Mes, donde sí se puede soltar sobre otra columna/celda.
    const g = gridRef.current?.getBoundingClientRect()
    if (g && e.clientX >= g.left && e.clientX < g.right) {
      const blockTop = e.clientY - d.grabDY
      let mins = Math.round(((blockTop - g.top) / AGENDA_ROW_H * 60 + dayStart * 60) / SNAP_MIN) * SNAP_MIN
      mins = Math.max(dayStart * 60, Math.min(dayEnd * 60 - SNAP_MIN, mins))
      const hora = minutesToTimeStr(mins)
      if (item.kind === 'bloque') {
        if (hora !== item.b.horaInicio) onMoveBloque?.(item.b, dateStr, hora)
      } else if (hora !== item.ev.timeStr) {
        onMoveEvent?.(item.ev.rawEvent, dateStr, hora)
      }
    }
  })
  function startDrag(e, it) {
    if (!isMovable(it)) return
    startDragRaw(e, { item: it })
  }

  return (
    <div>
      {/* Aviso de día de asueto o de vacaciones */}
      {(vacacionDia || asuetoDia) && (
        <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800 flex items-center gap-2">
          <CalendarOff size={14} className="flex-shrink-0 text-amber-600" />
          {vacacionDia ? 'Periodo de vacaciones' : 'Día de asueto'} — sin {alcanceAsuetoTexto(vacacionDia || asuetoDia).toLowerCase()}.
        </div>
      )}

      {/* Eventos sin hora */}
      {allDayEvs.length > 0 && (
        <div className="px-3 py-2 border-b border-outline-variant space-y-1">
          {allDayEvs.map(ev => (
            <div key={ev.id} data-tooltip={ev.editable ? 'Editar' : undefined}>
              <EventPill ev={ev} onClick={onEventClick} />
            </div>
          ))}
        </div>
      )}

      {/* Rejilla del día */}
      <div className="flex">
        {/* Gutter de horas. El am/pm va en su propio renglón debajo de la hora
            (pedido explícito, primero en la App y después también en la web),
            así la columna no tiene que caber "12:00 pm" en una sola línea. */}
        <div className={`relative flex-shrink-0 ${IS_NATIVE_APP ? 'w-11' : 'w-20'}`} style={{ height: gridH }}>
          {hours.map((h, i) => {
            const [hNum, periodo] = formatHora12(`${String(h).padStart(2, '0')}:00`).split(' ')
            return (
              <div key={h}
                className={`absolute ${DIA_HOUR_TEXT} text-muted leading-none whitespace-nowrap ${IS_NATIVE_APP ? 'inset-x-0 text-center' : 'right-2 text-right'}`}
                style={{ top: i * AGENDA_ROW_H + AGENDA_ROW_H / 2, transform: 'translateY(-50%)' }}>
                <span className="block">{hNum}</span>
                <span className={`block ${DIA_HOUR_AMPM} opacity-70 -mt-0.5`}>{periodo}</span>
              </div>
            )
          })}
        </div>

        <div ref={gridRef} className="relative flex-1 border-l border-outline-variant" style={{ height: gridH }}>
          {/* Líneas de hora / click para crear evento */}
          {hours.map((h, i) => (
            <button
              key={h}
              type="button"
              onClick={() => onSlotClick?.(dateStr, `${String(h).padStart(2, '0')}:00`)}
              className="absolute left-0 right-0 p-0 border-b border-outline-variant hover:bg-accent-tint transition-colors cursor-pointer"
              style={{ top: i * AGENDA_ROW_H, height: AGENDA_ROW_H }}
              data-tooltip="Crear evento a esta hora"
              aria-label={`Crear evento a las ${formatHora12(`${String(h).padStart(2, '0')}:00`)}`}
            />
          ))}

          {/* Línea de la hora actual — se disuelve hacia abajo. Solo cuando
              el día mostrado es hoy. */}
          {showNowLine && (
            <div className="absolute left-0 right-0 pointer-events-none z-20" style={{ top: nowLineTop }}>
              <div style={{ height: 3, background: 'var(--accent)' }} />
              <div style={{ height: 32, background: 'linear-gradient(to bottom, color-mix(in srgb, var(--accent) 40%, transparent), transparent)' }} />
            </div>
          )}

          {/* Día sin nada programado */}
          {placed.length === 0 && allDayEvs.length === 0 && (
            <div className="absolute inset-x-0 top-6 text-center pointer-events-none">
              <p className="text-sm text-muted">No hay clases ni eventos este día</p>
              <p className="text-xs text-muted opacity-60 mt-0.5">Haz clic en una hora para crear un evento</p>
            </div>
          )}

          {/* Items del día */}
          {placed.map(({ it, lane, total }) => {
            const isDragging = drag?.moved && drag.item.id === it.id
            const rawTop = (it.start - dayStart * 60) / 60 * AGENDA_ROW_H
            // Hueco de 6px entre bloques para que cada hora se lea como un
            // rectángulo propio, separado del siguiente.
            const height = Math.max(34, (it.end - it.start) / 60 * AGENDA_ROW_H - 6)
            const top = Math.max(0, Math.min(rawTop, gridH - height))
            const w = 100 / total
            const movable = isMovable(it)

            const horaIni = it.kind === 'bloque' ? it.b.horaInicio : it.ev.timeStr
            const horaFin = it.kind === 'bloque'
              ? it.b.horaFin
              : (it.ev.endTimeStr && it.ev.endDateStr === it.ev.dateStr && it.ev.endTimeStr !== it.ev.timeStr ? it.ev.endTimeStr : null)

            let bg, fg, titulo, sub
            if (it.kind === 'bloque') {
              const pal = bloqueColor(it.b.color)
              bg = pal.bg; fg = pal.text
              titulo = subjectDisplayName(subjects[it.b.asignaturaId]) || 'Clase'
              sub = it.b.lugar
            } else {
              bg = it.ev.bg; fg = it.ev.text
              titulo = it.ev.titulo
              sub = it.ev.subtitulo
            }

            return (
              <button
                key={it.id}
                type="button"
                onPointerDown={movable ? e => { e.stopPropagation(); startDrag(e, it) } : undefined}
                onClick={!movable ? e => {
                  e.stopPropagation()
                  if (it.kind === 'bloque') onBlockClick?.(it.b)
                  else onEventClick?.(it.ev)
                } : undefined}
                className={`absolute rounded-card shadow-sm ring-1 ring-black/5 select-none transition-[filter] hover:brightness-95 p-0 text-left block ${movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
                style={{
                  top, height,
                  left: `calc(${lane * w}% + 3px)`,
                  width: `calc(${w}% - 6px)`,
                  background: bg, color: fg,
                  opacity: isDragging ? 0.3 : 1,
                  touchAction: 'none',
                }}
                data-tooltip={
                  it.kind === 'bloque' ? (editableBloques ? 'Usa modificar bloques para editar, o muévelo' : undefined)
                  : movable ? 'Editar, o muévelo'
                  : 'Clic para editar esta actividad'
                }
              >
                <div className="flex h-full">
                  {/* Horas a la izquierda — texto sin salto de línea (evita que
                      "am"/"pm" se corte o se pegue al borde). En la app ya
                      quedó bien de tamaño; en la web se veía demasiado chico,
                      un punto más grande ahí (con su columna un poco más
                      ancha para que siga cabiendo completo).
                      Con muchos eventos encimados (total >= 3, carriles muy
                      angostos) esta columna fija de hora ya no cabe —
                      se quitaba casi todo el ancho al título y lo dejaba en
                      una franja de un carácter, envolviendo letra por letra.
                      Con pocos carriles libres, la hora se mueve arriba del
                      título en vez de a un lado, y el título trunca en una
                      línea en vez de envolver. */}
                  {total < 3 && (
                    <div className={`flex-shrink-0 text-right pl-1 pr-1.5 py-1.5 border-r ${IS_NATIVE_APP ? 'w-16' : 'w-[72px]'}`} style={{ borderColor: `${fg}22` }}>
                      <span className={`block font-bold leading-tight whitespace-nowrap ${DIA_HOUR_INI_TEXT}`}>{fmtHour(horaIni)}</span>
                      {horaFin && <span className={`block opacity-70 leading-tight whitespace-nowrap ${DIA_HOUR_FIN_TEXT}`}>{fmtHour(horaFin)}</span>}
                    </div>
                  )}
                  {/* Evento y descripción a la derecha */}
                  <div className="flex-1 min-w-0 pl-2.5 py-1.5">
                    {total >= 3 && (
                      <span className={`block font-bold leading-tight whitespace-nowrap ${DIA_HOUR_INI_TEXT}`}>{fmtHour(horaIni)}</span>
                    )}
                    <span className={`block ${DIA_ITEM_TEXT} font-semibold leading-tight ${total >= 3 ? 'truncate' : 'break-words'}`}>{titulo}</span>
                    {sub && total < 3 && <span className={`block ${IS_NATIVE_APP ? GRID_ITEM_TEXT : 'text-xs'} opacity-75 leading-tight truncate`}>{sub}</span>}
                    {it.kind === 'bloque' && it.b.alarma?.activa && (
                      <span className="inline-flex items-center gap-1 text-[10px] opacity-70 leading-tight">
                        <Bell size={10} /> {it.b.alarma.minutosAntes} min antes
                      </span>
                    )}
                    {it.ev?.tipo === 'deadline' && (
                      <span className="inline-flex items-center gap-1 text-[10px] opacity-80 leading-tight">
                        {it.ev.cierraEnFecha ? <Lock size={13} /> : <LockOpen size={13} />}
                        {it.ev.estado?.label}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Fantasma que sigue al cursor */}
      {drag?.moved && (() => {
        const it = drag.item
        const pal = it.kind === 'bloque' ? bloqueColor(it.b.color) : { bg: it.ev.bg, text: it.ev.text }
        const titulo = it.kind === 'bloque'
          ? subjectDisplayName(subjects[it.b.asignaturaId])
          : it.ev.titulo
        return (
          <div
            className="fixed z-50 rounded-card px-2 py-1.5 shadow-lg pointer-events-none opacity-90"
            style={{
              left: drag.x - drag.grabDX, top: drag.y - drag.grabDY,
              width: drag.w, height: drag.h,
              background: pal.bg, color: pal.text,
            }}
          >
            <span className={`block ${DIA_ITEM_TEXT} font-semibold leading-tight truncate`}>{titulo}</span>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Month view ────────────────────────────────────────────────────────────

export function BloquePill({ b, subj, onClick }) {
  const pal = bloqueColor(b.color)
  return (
    <button
      type="button"
      onClick={onClick ? e => { e.stopPropagation(); onClick(b) } : undefined}
      className={`flex items-center gap-1 rounded-md w-full px-1 py-0.5 ${MES_ITEM_TEXT} ring-1 ring-black/5 transition-opacity ${onClick ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
      style={{ background: pal.bg, color: pal.text }}
      data-tooltip={onClick ? 'Usa modificar bloques para editar' : undefined}
    >
      <span className="truncate">{subjectDisplayName(subj)}</span>
    </button>
  )
}

export function MonthView({ year, month, events, bloques, subjects, selectedDate, onDateClick, onEventClick, onBlockClick, onMoveEvent, asuetoMap = {}, vacacionMap = {}, editable = true }) {
  const cells = getMonthGrid(year, month)
  const selStr = selectedDate ? toDateStr(selectedDate) : null

  const cellRefs = useRef({})

  const bloquesByDate = useMemo(() => {
    const m = {}
    bloques.forEach(b => { (m[b.fecha] ||= []).push(b) })
    Object.values(m).forEach(list => list.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio)))
    return m
  }, [bloques])

  // Arrastrar una pastilla a otro día del mes: solo eventos personales — los
  // bloques de clase no se arrastran en esta vista (ver `movable` más abajo),
  // así que solo se mueven directo conservando su hora.
  const { drag, startDrag } = usePointerDrag((d, e) => {
    if (!d.moved) {
      // Clic: evento → su editor; bloque de clase → diálogo de acciones.
      if (d.kind === 'bloque') onBlockClick?.(d.b)
      else onEventClick?.(d.ev)
      return
    }
    let target = null
    Object.entries(cellRefs.current).forEach(([dStr, el]) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom) target = dStr
    })
    if (!target || target === d.ev.dateStr) return
    onMoveEvent?.(d.ev.rawEvent, target, d.ev.timeStr || null)
  }, { grab: false })

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-outline-variant bg-surface">
        {DIAS_CORTO.map(d => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-muted uppercase tracking-wide">{d.charAt(0)}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const isThisMonth = cell.getMonth() === month
          const dateStr = toDateStr(cell)
          const dayBloques = bloquesByDate[dateStr] || []
          const dayEvs = events
            .filter(ev => ev.dateStr === dateStr)
            .sort((a, b) => (a.timeStr || '').localeCompare(b.timeStr || ''))
          const items = [
            ...dayBloques.map(b => ({ kind: 'bloque', b })),
            ...dayEvs.map(ev => ({ kind: 'event', ev })),
          ]
          const extra = items.length > 3 ? items.length - 3 : 0

          const asueto = esAsuetoAlguno(asuetoMap, dateStr)
          const vacacion = esAsuetoAlguno(vacacionMap, dateStr)

          return (
            <div
              key={dateStr}
              ref={el => { cellRefs.current[dateStr] = el }}
              role="button"
              tabIndex={0}
              onClick={() => onDateClick?.(cell)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onDateClick?.(cell)
                }
              }}
              aria-label={`Ver día ${cell.getDate()} de ${MESES[cell.getMonth()]}`}
              className={`min-h-[92px] border-b border-r border-outline-variant p-1 cursor-pointer hover:bg-accent-tint transition-colors ${!isThisMonth ? 'opacity-35' : ''}`}
              style={(asueto || vacacion) ? { background: '#fffbeb' } : dateStr === selStr ? { background: 'color-mix(in srgb, var(--accent) 7%, transparent)' } : undefined}
            >
              {/* HOY: misma banda azul de ancho completo que en 3 días/Semana.
                  El -mx-1 cancela el p-1 de la celda para que llegue de borde
                  a borde de la columna; el alto es el del círculo (h-6). */}
              <div className={`text-xs font-semibold mb-1 ${
                isToday(cell)
                  ? 'flex items-center justify-center h-6 -mx-1 bg-accent text-white'
                  : `w-6 h-6 flex items-center justify-center rounded-full mx-auto ${
                      dateStr === selStr ? 'ring-2 ring-accent text-accent' : 'text-on-surface'
                    }`
              }`}>
                {cell.getDate()}
              </div>
              {(asueto || vacacion) && (
                <p className="text-[9px] font-semibold text-amber-600 uppercase text-center leading-none mb-1">{vacacion ? 'Vacaciones' : 'Asueto'}</p>
              )}
              <div className="space-y-1">
                {items.slice(0, 3).map((it) => {
                  // En la vista Mes los BLOQUES DE CLASE no se arrastran (no se
                  // pueden cambiar de día aquí; para eso está "Modificar
                  // bloques"). Solo los eventos personales se arrastran a otro
                  // día. Al tocar un bloque se abre el diálogo para borrarlo.
                  const movable = it.kind === 'event' && it.ev?.editable
                  const isDraggingThis = drag?.moved && it.kind === 'event' && drag.kind === 'event' && drag.ev?.id === it.ev.id
                  const pill = it.kind === 'bloque'
                    ? <BloquePill b={it.b} subj={subjects[it.b.asignaturaId]} onClick={editable ? onBlockClick : undefined} />
                    : <EventPill ev={it.ev} compact movable={movable} onClick={movable ? undefined : onEventClick} />
                  return (
                    <div
                      key={it.kind === 'bloque' ? it.b.id : it.ev.id}
                      onPointerDown={movable ? e => { e.stopPropagation(); startDrag(e, { kind: 'event', ev: it.ev }) } : undefined}
                      className={movable ? 'cursor-grab active:cursor-grabbing select-none' : ''}
                      style={{ touchAction: 'none', opacity: isDraggingThis ? 0.3 : 1 }}
                    >
                      {pill}
                    </div>
                  )
                })}
                {extra > 0 && (
                  <p className="text-xs text-muted pl-1">+{extra} más</p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Fantasma que sigue al cursor mientras se arrastra — solo eventos
          personales, los bloques de clase no se arrastran en esta vista. */}
      {drag?.moved && (
        <div
          className="fixed z-50 rounded px-2 py-1 shadow-lg pointer-events-none opacity-90 text-xs font-semibold truncate"
          style={{ left: drag.x + 8, top: drag.y + 8, maxWidth: drag.w, background: drag.ev.bg, color: drag.ev.text }}
        >
          {drag.ev.titulo}
        </div>
      )}
    </div>
  )
}

// ─── Week view ─────────────────────────────────────────────────────────────

function minutesToTimeStr(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
const SNAP_MIN = 15 // los bloques se sueltan alineados a 15 min

export function WeekView({ weekStart, events, bloques, subjects, dayStart, dayEnd, numDays = 7, anchorToday = false, selectedDate, onSlotClick, onBlockClick, onEventClick, onMoveBloque, onMoveEvent, asuetoMap = {}, vacacionMap = {}, editable = true }) {
  // Vista "3 días": ventana móvil de numDays días consecutivos arrancando en
  // weekStart (no anclada a lunes, a diferencia de la vista Semana normal).
  const days = anchorToday
    ? Array.from({ length: numDays }, (_, i) => addDays(weekStart, i))
    : getWeekDays(weekStart).slice(0, numDays)
  const todayStr = toDateStr(new Date())
  const selStr = selectedDate ? toDateStr(selectedDate) : null
  const hoursRange = Array.from({ length: dayEnd - dayStart }, (_, i) => i + dayStart)
  const gridH = hoursRange.length * ROW_H
  // En la web, 3 días y Semana usan la MISMA canaleta de horas que la vista
  // Día: 5rem de ancho y la hora pegada a la derecha (Día es `w-20` + `right-2
  // text-right`), para que las tres vistas se lean igual. La app va aparte:
  // ahí la canaleta es angosta a propósito, porque la pantalla no da para más.
  const gutterComoDia = !IS_NATIVE_APP
  const gridCols = `${gutterComoDia ? '5rem' : '3.5rem'} repeat(${numDays}, 1fr)`

  const colRefs = useRef([])

  // Bloques agrupados por fecha.
  const byDate = useMemo(() => {
    const m = {}
    bloques.forEach(b => { (m[b.fecha] ||= []).push(b) })
    return m
  }, [bloques])

  function topPx(time) {
    return (timeToMinutes(time) - dayStart * 60) / 60 * ROW_H
  }

  const { drag, startDrag } = usePointerDrag((d, e) => {
    if (!d.moved) {
      // Clic: en evento abre su editor; en bloque de clase abre el diálogo de
      // acciones (mover el mismo día / borrar esta clase), NO su editor.
      if (d.kind === 'event') onEventClick?.(d.ev)
      else onBlockClick?.(d.bloque)
      return
    }
    const blockTop = e.clientY - d.grabDY
    if (d.kind === 'bloque') {
      // SOLO vertical y el MISMO día: el día no cambia; la hora sale de la
      // posición vertical (todas las columnas comparten el mismo `top`).
      const anyCol = colRefs.current.find(el => el)
      const colTop = anyCol ? anyCol.getBoundingClientRect().top : 0
      let mins = Math.round(((blockTop - colTop) / ROW_H * 60 + dayStart * 60) / SNAP_MIN) * SNAP_MIN
      mins = Math.max(dayStart * 60, Math.min(dayEnd * 60 - SNAP_MIN, mins))
      const nuevaHora = minutesToTimeStr(mins)
      if (nuevaHora !== d.bloque.horaInicio) onMoveBloque?.(d.bloque, d.bloque.fecha, nuevaHora)
      return
    }
    // Eventos personales: pueden cambiar de día (se detecta la columna).
    let target = null
    colRefs.current.forEach((el, idx) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX < r.right) target = { idx, top: r.top }
    })
    if (!target) return
    let mins = Math.round(((blockTop - target.top) / ROW_H * 60 + dayStart * 60) / SNAP_MIN) * SNAP_MIN
    mins = Math.max(dayStart * 60, Math.min(dayEnd * 60 - SNAP_MIN, mins))
    const nuevaFecha = toDateStr(days[target.idx])
    const nuevaHora = minutesToTimeStr(mins)
    // Evento personal: se mueve directo, sin preguntar.
    if (nuevaFecha !== d.ev.dateStr || nuevaHora !== d.ev.timeStr) {
      onMoveEvent?.(d.ev.rawEvent, nuevaFecha, nuevaHora)
    }
  }, {
    // Los bloques de clase solo se mueven en VERTICAL (mismo día): el
    // fantasma no se desplaza en horizontal (x fija).
    freezeX: d => d.kind === 'bloque',
  })

  return (
    <div className="overflow-x-auto">
      {/* Sin mínimo forzado en móvil (min-w-0): las columnas de días, que ya
          usan 1fr, se encogen para caber en la pantalla en vez de obligar a
          hacer scroll horizontal. En escritorio (md+) se mantiene el ancho
          mínimo de siempre para que las columnas no queden demasiado
          angostas para arrastrar bloques/eventos. */}
      <div className="min-w-0 md:min-w-[620px]">
        {/* Day headers */}
        <div className="grid border-b border-outline-variant sticky top-0 bg-surface-card z-10" style={{ gridTemplateColumns: gridCols }}>
          <div className="py-2 px-2" />
          {days.map((d) => {
            const dStr = toDateStr(d)
            const asueto = esAsuetoAlguno(asuetoMap, dStr)
            const vacacion = esAsuetoAlguno(vacacionMap, dStr)
            return (
              <div
                key={dStr}
                className="py-2 text-center text-xs border-l border-outline-variant"
                style={(asueto || vacacion) ? { background: '#fffbeb' } : dStr === selStr ? { background: 'color-mix(in srgb, var(--accent) 7%, transparent)' } : undefined}
              >
                <span className="block uppercase text-muted">
                  {numDays === 3 ? DIAS_CORTO[(d.getDay() + 6) % 7] : DIAS_CORTO[(d.getDay() + 6) % 7].charAt(0)}
                </span>
                {/* HOY: barra azul de ancho completo, no la bolita. Con la
                    bolita había que buscar cuál de los círculos estaba pintado;
                    una banda que ocupa toda la columna se ve de un vistazo.
                    Conserva el alto que tenía el círculo (h-7). */}
                <span className={`text-sm font-semibold mt-0.5 ${
                  dStr === todayStr
                    ? 'flex items-center justify-center h-7 bg-accent text-white'
                    : `inline-flex items-center justify-center w-7 h-7 rounded-full ${
                        dStr === selStr ? 'ring-2 ring-accent text-accent' : 'text-on-surface'
                      }`
                }`}>
                  {d.getDate()}
                </span>
                {(asueto || vacacion) && (
                  <span className="block text-[9px] font-semibold text-amber-600 uppercase leading-tight mt-0.5">{vacacion ? 'Vacaciones' : 'Asueto'}</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Body: time gutter + day columns */}
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          {/* Time gutter — el am/pm cuelga debajo de la hora, igual que en la
              vista Día, para que las tres se lean igual. z-10: en un grid,
              los items posteriores en el DOM (columnas de días) pintan
              encima de los anteriores donde se toquen (sombras/anillos de
              bloques y eventos) — sin esto, esas sombras tapaban los
              números de hora pegados al borde derecho de esta columna. */}
          <div className="relative z-10" style={{ height: gridH }}>
            {hoursRange.map((hour, i) => {
              const [hNum, periodo] = formatHora12(`${String(hour).padStart(2, '0')}:00`).split(' ')
              return (
                <div key={hour} className={`absolute left-0 right-0 ${GRID_HOUR_TEXT} text-muted leading-none whitespace-nowrap ${gutterComoDia ? 'pr-2 text-right' : 'px-1.5'}`}
                  style={{ top: i * ROW_H + ROW_H / 2, transform: 'translateY(-50%)' }}>
                  <span className="block">{hNum}</span>
                  <span className={`block ${GRID_HOUR_AMPM} opacity-70 -mt-0.5`}>{periodo}</span>
                </div>
              )
            })}
          </div>

          {/* Day columns */}
          {days.map((d, di) => {
            const dStr = toDateStr(d)
            const placed = assignLanes((byDate[dStr] || []).map(b => ({
              start: timeToMinutes(b.horaInicio),
              end: timeToMinutes(b.horaFin),
              b,
            })))
            const dayEvs = events.filter(ev => ev.dateStr === dStr && ev.timeStr)
            return (
              <div
                key={dStr}
                ref={el => { colRefs.current[di] = el }}
                className="relative border-l border-outline-variant"
                style={{
                  height: gridH,
                  ...(dStr === selStr ? { background: 'color-mix(in srgb, var(--accent) 4%, transparent)' } : {}),
                }}
              >
                {/* Hour gridlines / click targets — crean un EVENTO nuevo */}
                {hoursRange.map((hour, i) => (
                  <button
                    key={hour}
                    type="button"
                    onClick={() => onSlotClick?.(dStr, `${String(hour).padStart(2, '0')}:00`)}
                    className="absolute left-0 right-0 p-0 border-b border-outline-variant hover:bg-accent-tint transition-colors cursor-pointer"
                    style={{ top: i * ROW_H, height: ROW_H }}
                    aria-label={`Crear evento a las ${formatHora12(`${String(hour).padStart(2, '0')}:00`)}`}
                  />
                ))}

                {/* Bloques */}
                {placed.map(({ it, lane, total }) => {
                  const { b, start, end } = it
                  const pal = bloqueColor(b.color)
                  // Hueco de 4px entre bloques → cada hora es su propio rectángulo.
                  const height = Math.max(20, (end - start) / 60 * ROW_H - 4)
                  // Acota dentro de la rejilla: lo que cae fuera del rango de
                  // horas visible se ancla al borde en vez de desaparecer.
                  const top = Math.max(0, Math.min(topPx(b.horaInicio), gridH - height))
                  const w = 100 / total
                  const subj = subjects[b.asignaturaId]
                  const isDragging = drag?.moved && drag.kind === 'bloque' && drag.bloque.id === b.id
                  return (
                    <div
                      key={b.id}
                      onPointerDown={editable ? e => { e.stopPropagation(); startDrag(e, { kind: 'bloque', bloque: b }) } : undefined}
                      className={`absolute rounded-lg px-1.5 py-1 text-left shadow-sm ring-1 ring-black/5 hover:brightness-95 transition-[filter] select-none ${editable ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      style={{
                        top, height,
                        left: `calc(${lane * w}% + 2px)`,
                        width: `calc(${w}% - 4px)`,
                        background: pal.bg, color: pal.text,
                        opacity: isDragging ? 0.3 : 1,
                        touchAction: 'none',
                      }}
                      data-tooltip={editable ? 'Usa modificar bloques para editar, o muévelo' : undefined}
                    >
                      <span className={`block ${GRID_ITEM_TEXT} font-normal leading-tight truncate`}>{subjectDisplayName(subj)}</span>
                      {b.lugar && <span className={`block ${GRID_ITEM_TEXT} opacity-70 leading-tight truncate`}>{b.lugar}</span>}
                    </div>
                  )
                })}

                {/* Eventos con hora — los personales (editables) se arrastran
                    directo a otro horario, sin preguntar */}
                {dayEvs.map(ev => {
                  const EV_H = 30
                  // Acota dentro de la rejilla (p. ej. fechas límite a las
                  // 23:59 se anclan al fondo en vez de quedar fuera).
                  const top = Math.max(0, Math.min(topPx(ev.timeStr), gridH - EV_H))
                  const isDragging = drag?.moved && drag.kind === 'event' && drag.ev?.id === ev.id
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onPointerDown={ev.editable ? e => { e.stopPropagation(); startDrag(e, { kind: 'event', ev }) } : undefined}
                      onClick={!ev.editable ? e => { e.stopPropagation(); onEventClick?.(ev) } : undefined}
                      className={`absolute right-0.5 rounded px-1 py-0.5 text-left shadow-sm ring-1 ring-white/60 hover:brightness-95 transition-[filter] select-none ${ev.editable ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      style={{ top, width: '78%', minHeight: EV_H, background: ev.bg, color: ev.text, zIndex: 5, opacity: isDragging ? 0.3 : 1, touchAction: 'none' }}
                      data-tooltip={
                        ev.activityId ? 'Clic para editar esta actividad'
                        : [ev.titulo, fmtHour(ev.timeStr), ev.editable && 'arrastra para mover'].filter(Boolean).join(' · ')
                      }
                    >
                      <span className={`flex items-start gap-1 ${GRID_ITEM_TEXT} font-normal leading-tight`}>
                        {ev.tipo === 'deadline' && (ev.cierraEnFecha
                          ? <Lock size={12} className="flex-shrink-0 opacity-90 mt-0.5" />
                          : <LockOpen size={12} className="flex-shrink-0 opacity-90 mt-0.5" />)}
                        <span className="break-words">{ev.titulo}</span>
                      </span>
                      {ev.tipo === 'deadline' && (
                        <span className={`block text-[10px] opacity-90 leading-tight truncate font-medium ${ev.estado?.tono === 'vencida' ? 'text-red-100' : ''}`}>{ev.estado.label}</span>
                      )}
                      {ev.subtitulo && (
                        <span className="block text-[10px] opacity-75 leading-tight truncate">{ev.subtitulo}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* Fantasma que sigue al cursor mientras se arrastra */}
      {drag?.moved && (() => {
        const esEvento = drag.kind === 'event'
        const pal = esEvento ? { bg: drag.ev.bg, text: drag.ev.text } : bloqueColor(drag.bloque.color)
        const titulo = esEvento ? drag.ev.titulo : subjectDisplayName(subjects[drag.bloque.asignaturaId])
        const horas = esEvento ? fmtHour(drag.ev.timeStr) : `${drag.bloque.horaInicio}–${drag.bloque.horaFin}`
        return (
          <div
            className="fixed z-50 rounded px-1.5 py-1 shadow-lg pointer-events-none opacity-90"
            style={{
              left: drag.x - drag.grabDX, top: drag.y - drag.grabDY,
              width: drag.w, height: drag.h,
              background: pal.bg, color: pal.text,
            }}
          >
            <span className={`block ${GRID_ITEM_TITLE} font-semibold leading-tight truncate`}>{titulo}</span>
            <span className={`block ${GRID_ITEM_TEXT} opacity-80 leading-tight`}>{horas}</span>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Conflict detection ────────────────────────────────────────────────────

function useConflicts(events) {
  return useMemo(() => {
    const byDate = {}
    events.filter(ev => ev.tipo === 'deadline').forEach(ev => {
      byDate[ev.dateStr] = (byDate[ev.dateStr] || 0) + 1
    })
    return Object.entries(byDate)
      .filter(([, count]) => count >= 3)
      .map(([date]) => date)
      .sort()
  }, [events])
}

// ─── Main CalendarPage ─────────────────────────────────────────────────────

const VIEWS = [
  { id: 'agenda', label: 'Día',    Icon: List },
  { id: '3dias',  label: '3 días', Icon: Columns3 },
  { id: 'semana', label: 'Semana', Icon: CalendarRange },
  { id: 'mes',    label: 'Mes',    Icon: LayoutGrid },
]

// Select propio con el estilo de la app — reemplaza el <select> nativo, que
// en Android abre el picker del sistema operativo (se ve fuera de lugar).
export default function CalendarPage() {
  const { currentUser } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  // Entra donde el docente lo dejó la última vez (vista y fecha) — pedido
  // explícito: no siempre debe aterrizar en Hoy/Día. "Hoy" sigue disponible
  // como botón para volver rápido a la fecha actual.
  const [view, setView] = useState(() => {
    const raw = localStorage.getItem('cal_view')
    return VIEWS.some((v) => v.id === raw) ? raw : 'agenda'
  })
  const [currentDate, setCurrentDate] = useState(() => {
    const raw = localStorage.getItem('cal_current_date')
    const d = raw ? new Date(raw) : null
    return d && !isNaN(d) ? d : new Date()
  })
  useEffect(() => {
    localStorage.setItem('cal_current_date', currentDate.toISOString())
  }, [currentDate])

  // Foco inicial en el botón "Hoy" al entrar a Horario (web y app).
  const hoyBtnRef = useRef(null)
  useEffect(() => {
    hoyBtnRef.current?.focus()
  }, [])

  // Rango de horas visibles del día (Agenda y Semana), configurable.
  // Ojo: getItem devuelve null si no existe y Number(null) === 0, así que hay
  // que distinguir "sin guardar" de un 0 guardado explícitamente.
  const [dayStart, setDayStart] = useState(() => {
    const raw = localStorage.getItem('cal_dia_ini')
    const v = raw == null || raw === '' ? NaN : Number(raw)
    return Number.isInteger(v) && v >= 0 && v <= 22 ? v : DEFAULT_DAY_START
  })
  const [dayEnd, setDayEnd] = useState(() => {
    const raw = localStorage.getItem('cal_dia_fin')
    const v = raw == null || raw === '' ? NaN : Number(raw)
    return Number.isInteger(v) && v >= 1 && v <= 24 ? v : DEFAULT_DAY_END
  })
  const [showHoras, setShowHoras] = useState(false)

  function changeDayStart(v) {
    setDayStart(v)
    localStorage.setItem('cal_dia_ini', String(v))
    if (v >= dayEnd) { setDayEnd(v + 1); localStorage.setItem('cal_dia_fin', String(v + 1)) }
  }
  function changeDayEnd(v) {
    setDayEnd(v)
    localStorage.setItem('cal_dia_fin', String(v))
  }

  // Días visibles de la semana (5 = L-V, 6 = L-S, 7 = L-D).
  const [numDays, setNumDays] = useState(() => {
    const raw = localStorage.getItem('cal_dias_sem')
    const v = raw == null ? NaN : Number(raw)
    return [5, 6, 7].includes(v) ? v : 7
  })
  function changeNumDays(v) {
    setNumDays(v)
    localStorage.setItem('cal_dias_sem', String(v))
  }

  // Selector de fecha al hacer clic en la etiqueta de navegación.
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [pickerMonth, setPickerMonth] = useState(new Date())

  // Confirmación pendiente al arrastrar un bloque de clase.
  const [pendingMove, setPendingMove] = useState(null) // { bloque, fecha, hora }
  const [subjects, setSubjects] = useState({})
  const [activities, setActivities] = useState([])
  const [personalEvents, setPersonalEvents] = useState([])
  const [bloques, setBloques] = useState([])
  const [loading, setLoading] = useState(true)

  const [asuetos, setAsuetos] = useState([])
  const [vacaciones, setVacaciones] = useState([])
  const [showEventEditor, setShowEventEditor] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  // Modal de configuración (paso 1): { mode, initial?, subjectName?, baseline?, baselinePatrones? }
  const [programar, setProgramar] = useState(null)
  // Zona semanal de colocación de bloques: { config, mode, initialPatrones, asignaturaId }
  const [zona, setZona] = useState(null)
  const [showModificarPicker, setShowModificarPicker] = useState(false)
  // asignaturaId pendiente de confirmar en "quitar bloques fuera de rango" (picker de Modificar bloques)
  const [confirmLimpiarRango, setConfirmLimpiarRango] = useState(null)
  // asignaturaId pendiente de confirmar en "quitar bloques en asueto/vacaciones" (mismo picker)
  const [confirmLimpiarAsueto, setConfirmLimpiarAsueto] = useState(null)
  const [confirmGenerarFaltantes, setConfirmGenerarFaltantes] = useState(null)
  const [showAsuetos, setShowAsuetos] = useState(false)
  const [showVacaciones, setShowVacaciones] = useState(false)

  // Botón atrás físico (Android): cierra el editor de eventos o el modal de
  // "programar bloques" (paso 1), igual que sus botones de cerrar en pantalla.
  // La zona semanal (paso 2) maneja su propio guard en ProgramarZonaSemanal.
  useBackHandler(closeEventEditor, showEventEditor)
  useBackHandler(() => setProgramar(null), !!programar)

  // Bloquean el scroll de fondo mientras cada overlay propio de esta página
  // está abierto (los demás overlays manejan su propio lock: EventEditor,
  // ProgramarZonaSemanal, AsuetoManager, VacacionManager).
  useScrollLock(showModificarPicker)
  useScrollLock(!!pendingMove)

  function changeView(v) {
    setView(v)
    localStorage.setItem('cal_view', v)
  }

  // ── Load data ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return
    let pending = 5
    const finish = () => { pending--; if (pending <= 0) setLoading(false) }

    getDocs(query(collection(db, 'subjects'), where('docenteId', '==', currentUser.uid)))
      .then(snap => {
        const map = {}
        snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() } })
        setSubjects(map)
      }).catch(() => toast('No se pudieron cargar tus asignaturas', 'error')).finally(finish)

    getDocs(query(collection(db, 'activities'), where('docenteId', '==', currentUser.uid)))
      .then(snap => setActivities(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => toast('No se pudieron cargar tus actividades', 'error')).finally(finish)

    const unsubEv = onSnapshot(
      query(collection(db, 'events'), where('docenteId', '==', currentUser.uid)),
      snap => { setPersonalEvents(prev => mergeEvents(snap.docs.map(d => ({ id: d.id, ...d.data(), tipo: 'personal' })), prev, 'personal')); finish() },
      () => { toast('No se pudieron cargar tus eventos', 'error'); finish() }
    )
    // Eventos académicos — colección separada (ver firestore.rules: el
    // alumno los lee por asignaturaId, algo que `events` no puede autorizar
    // para un `list`). Se mezclan en el mismo estado `personalEvents` para
    // que el resto del calendario los pinte sin distinguir de dónde vienen.
    const unsubAcEv = onSnapshot(
      query(collection(db, 'academicEvents'), where('docenteId', '==', currentUser.uid)),
      snap => { setPersonalEvents(prev => mergeEvents(snap.docs.map(d => ({ id: d.id, ...d.data(), tipo: 'academico' })), prev, 'academico')); finish() },
      () => { toast('No se pudieron cargar tus eventos académicos', 'error'); finish() }
    )
    const unsubH = onSnapshot(
      query(collection(db, 'horarioBloques'), where('docenteId', '==', currentUser.uid)),
      snap => { setBloques(snap.docs.map(d => ({ id: d.id, ...d.data() }))); finish() },
      () => { toast('No se pudo cargar tu horario', 'error'); finish() }
    )
    const unsubA = onSnapshot(
      query(collection(db, 'asuetos'), where('docenteId', '==', currentUser.uid)),
      snap => setAsuetos(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => { /* asuetos son opcionales: si fallan, seguimos sin ellos */ }
    )
    const unsubV = onSnapshot(
      query(collection(db, 'vacaciones'), where('docenteId', '==', currentUser.uid)),
      snap => setVacaciones(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => { /* vacaciones son opcionales: si fallan, seguimos sin ellas */ }
    )

    return () => { unsubEv(); unsubAcEv(); unsubH(); unsubA(); unsubV() }
  }, [currentUser])

  // ── Aggregate events ───────────────────────────────────────────────────
  // Numeración "1.3." = misma regla que ActivityPage: posición entre las
  // hermanas del mismo parcial+asignatura, excluyendo borradores, ordenadas
  // por `orden`. Nunca se confía en un campo guardado, siempre se deriva.
  const activityLabels = useMemo(() => {
    const labels = {}
    const groups = {}
    activities.forEach(a => {
      if (isDraftActivity(a)) return
      const key = `${a.asignaturaId}|${a.parcial}`
      ;(groups[key] ||= []).push(a)
    })
    Object.values(groups).forEach(group => {
      group.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      group.forEach((a, idx) => { labels[a.id] = `${a.parcial}.${idx + 1}.` })
    })
    return labels
  }, [activities])

  const events = useMemo(() => {
    const evs = []

    activities.forEach(a => {
      if (!a.fechaLimite && !a.publishAt && !a.publishedAt) return
      const subj = subjects[a.asignaturaId]
      // Asignatura archivada = ciclo cerrado: sus fechas límite dejan de ser
      // pendientes y salen del calendario, igual que de la agenda del alumno.
      // (Los bloques del horario NO se tocan: el calendario sigue siendo el
      // registro de lo que se programó; lo que se apagó son los avisos.)
      if (subj?.archived) return
      // Actividad no visible (oculta, borrador o programada a futuro) — igual
      // que en la agenda del alumno, no debe aparecer en la agenda del
      // docente tampoco. Pedido explícito.
      if (!isActivityPublished(a, subj?.parcialesOcultos?.includes(a.parcial))) return
      const pal = subjectColors(subj)
      const subjName = subjectDisplayName(subj)
      const numero = activityLabels[a.id]
      const nombreConNumero = numero ? `${numero} ${a.nombre || 'Actividad'}` : (a.nombre || 'Actividad')

      if (a.fechaLimite) {
        const categoriaLabel = CATEGORIA_LABEL[a.categoria] || CATEGORIA_LABEL.entregable
        const cierraEnFecha = !a.recibirTarde
        // `fechaLimite` puede venir sin hora (fecha límite legada, 'YYYY-MM-DD')
        // — sin normalizar, `timeStr` queda vacío y WeekView (Semana/3 días, a
        // diferencia de AgendaView) nunca pinta eventos sin hora: la actividad
        // desaparecía por completo de esas dos vistas.
        const fechaLimiteConHora = withDefaultTime(a.fechaLimite, '23:59:59')
        evs.push({
          id: `dl-${a.id}`,
          activityId: a.id,
          titulo: cierraEnFecha ? `${nombreConNumero} (Cierre)` : nombreConNumero,
          subtitulo: `${subjName} · Parcial ${a.parcial ?? '–'} · ${categoriaLabel}`,
          tipo: 'deadline',
          dateStr: fechaLimiteConHora.substring(0, 10),
          timeStr: fechaLimiteConHora.substring(11, 16),
          bg: pal.bg, text: pal.text,
          editable: false,
          // true = deja de recibir entregas justo en la fecha; false = la fecha es informativa.
          cierraEnFecha,
          estado: deadlineEstado(a.fechaLimite),
        })
      }
      // `publishAt` solo queda guardado cuando la publicación se PROGRAMÓ a
      // futuro; si se publicó de inmediato, ese campo se guarda en null y la
      // fecha real vive en `publishedAt` (permanente, no cambia si luego se
      // vuelve a ocultar). Sin este fallback, las actividades publicadas al
      // instante nunca mostraban su marca "(Publicada)" en el calendario.
      const fechaPublicacion = a.publishAt || a.publishedAt
      if (fechaPublicacion) {
        evs.push({
          id: `pub-${a.id}`,
          activityId: a.id,
          titulo: `↑ ${nombreConNumero} (Publicada)`,
          subtitulo: subjName,
          tipo: 'publicacion',
          dateStr: fechaPublicacion.substring(0, 10),
          timeStr: fechaPublicacion.substring(11, 16),
          bg: pal.bg, text: pal.text,
          editable: false,
        })
      }
    })

    personalEvents.forEach(e => {
      const colorDef = EVENT_COLORS.find(c => c.id === e.color) || EVENT_COLORS[0]
      evs.push({
        id: e.id,
        titulo: e.titulo || '',
        subtitulo: e.descripcion || '',
        tipo: 'personal',
        dateStr: (e.inicio || '').substring(0, 10),
        timeStr: (e.inicio || '').substring(11, 16),
        endDateStr: (e.fin || '').substring(0, 10),
        endTimeStr: (e.fin || '').substring(11, 16),
        bg: colorDef.bg, text: colorDef.text,
        editable: true,
        rawEvent: e,
      })
    })

    return evs.filter(ev => ev.dateStr)
  }, [activities, personalEvents, subjects, activityLabels])

  const conflicts = useConflicts(events)

  // Índice de días de asueto por fecha (para marcar y bloquear por tipo).
  const asuetoMap = useMemo(() => buildAsuetoMap(asuetos), [asuetos])
  // Índice de días de vacaciones por fecha (cada periodo expandido día a día).
  const vacacionMap = useMemo(() => buildVacacionMap(vacaciones), [vacaciones])

  // Alarmas de los bloques (suenan con la app abierta + notificación).
  useAlarmas(bloques, subjects, currentUser?.uid)

  // ── Navigation ─────────────────────────────────────────────────────────
  function prev() {
    if (view === 'mes') setCurrentDate(d => addMonths(d, -1))
    else if (view === 'semana') setCurrentDate(d => addWeeks(d, -1))
    else if (view === '3dias') setCurrentDate(d => addDays(d, -3))
    else setCurrentDate(d => addDays(d, -1))
  }
  function next() {
    if (view === 'mes') setCurrentDate(d => addMonths(d, 1))
    else if (view === 'semana') setCurrentDate(d => addWeeks(d, 1))
    else if (view === '3dias') setCurrentDate(d => addDays(d, 3))
    else setCurrentDate(d => addDays(d, 1))
  }
  function goToday() { setCurrentDate(new Date()) }

  function navLabel() {
    if (view === 'mes') return `${MESES[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    if (view === 'agenda') {
      const dl = DIAS_LARGO[(currentDate.getDay() + 6) % 7]
      const base = `${dl} ${currentDate.getDate()} de ${MESES[currentDate.getMonth()]}`
      return isToday(currentDate) ? `Hoy · ${base}` : `${base} ${currentDate.getFullYear()}`
    }
    if (view === '3dias') {
      const first = currentDate; const last = addDays(currentDate, 2)
      if (first.getMonth() === last.getMonth()) {
        return `${first.getDate()}–${last.getDate()} ${MESES[first.getMonth()]} ${first.getFullYear()}`
      }
      return `${first.getDate()} ${MESES[first.getMonth()]} – ${last.getDate()} ${MESES[last.getMonth()]}`
    }
    const days = getWeekDays(currentDate)
    const first = days[0]; const last = days[6]
    if (first.getMonth() === last.getMonth()) {
      return `${first.getDate()}–${last.getDate()} ${MESES[first.getMonth()]} ${first.getFullYear()}`
    }
    return `${first.getDate()} ${MESES[first.getMonth()]} – ${last.getDate()} ${MESES[last.getMonth()]}`
  }

  // ── Event editor helpers ───────────────────────────────────────────────
  // Bloquea la creación en un día marcado como asueto o dentro de vacaciones.
  function bloqueadoPorAsueto(fecha, tipo) {
    const d = new Date(fecha + 'T12:00:00')
    if (esAsuetoPara(asuetoMap, fecha, tipo)) {
      toast(`${d.getDate()}/${d.getMonth() + 1} es día de asueto (sin ${tipo}). Quítalo en "Días de asueto" para permitirlo.`, 'error')
      return true
    }
    if (esAsuetoPara(vacacionMap, fecha, tipo)) {
      toast(`${d.getDate()}/${d.getMonth() + 1} cae en vacaciones (sin ${tipo}). Ajusta el periodo en "Vacaciones" para permitirlo.`, 'error')
      return true
    }
    return false
  }
  function openNewEvent(date) {
    if (date && bloqueadoPorAsueto(toDateStr(date), 'eventos')) return
    setEditingEvent(null)
    setSelectedDate(date ? `${toDateStr(date)}T08:00` : '')
    setShowEventEditor(true)
  }
  function openEditEvent(ev) {
    // Fecha límite / publicación: se editan desde la actividad, no aquí.
    if (ev.activityId) { navigate(`/activity/${ev.activityId}`, { state: { openEditActivity: true, returnTo: 'calendario' } }); return }
    if (!ev.editable) return
    setEditingEvent(ev.rawEvent)
    setSelectedDate(null)
    setShowEventEditor(true)
  }
  function closeEventEditor() {
    setShowEventEditor(false)
    setEditingEvent(null)
    setSelectedDate(null)
  }

  // ── Programación de bloques ────────────────────────────────────────────
  function openProgramar() {
    setProgramar({ mode: 'crear' })
  }

  // Paso 1 (modal) → paso 2 (zona semanal). En "crear" abre la zona vacía; en
  // "modificar" precarga la plantilla derivada y aplica los cambios de
  // color/duración/alarma que el docente haya hecho en el modal a TODA la
  // asignatura (por eso solo se propagan los campos que realmente cambió).
  function continuarAZona(config) {
    const ctx = programar
    setProgramar(null)
    if (ctx?.mode === 'modificar') {
      const base = ctx.baseline || {}
      const patch = {}
      if (config.color !== base.color) patch.color = config.color
      if (config.duracionMin !== base.duracionMin) patch.duracionMin = config.duracionMin
      if (JSON.stringify(config.alarma) !== JSON.stringify(base.alarma)) patch.alarma = config.alarma
      const patrones = (ctx.baselinePatrones || []).map(p => ({
        ...p,
        ...(patch.color ? { color: patch.color } : {}),
        ...(patch.duracionMin ? { duracionMin: patch.duracionMin } : {}),
        ...(patch.alarma ? { alarma: { ...patch.alarma } } : {}),
      }))
      // ¿El docente cambió algo en el modal de configuración? (fechas/duración/
      // BS/color/alarma). Si no, y tampoco toca los bloques en la zona, no hay
      // nada que guardar → el botón será "Salir sin modificar".
      const configChanged = config.fechaInicio !== base.fechaInicio
        || config.fechaFin !== base.fechaFin
        || config.duracionMin !== base.duracionMin
        || config.bloquesPorSemana !== base.bloquesPorSemana
        || config.color !== base.color
        || JSON.stringify(config.alarma) !== JSON.stringify(base.alarma)
      setZona({ config, mode: 'modificar', initialPatrones: patrones, asignaturaId: config.asignaturaId, configChanged })
    } else {
      setZona({ config, mode: 'crear', initialPatrones: null, asignaturaId: config.asignaturaId })
    }
  }

  // Deriva la plantilla semanal (patrones) a partir de las instancias ya
  // materializadas de una asignatura: colapsa por (día, hora) tomando la
  // combinación más frecuente de lugar/color/alarma.
  //
  // IMPORTANTE: los bloques movidos a mano en el horario normal (movido:true)
  // son cambios de UNA sola clase y NO forman parte del horario recurrente, así
  // que se EXCLUYEN de la plantilla de "Modificar". Así, mover una clase en el
  // horario normal nunca afecta a "Modificar bloques". (Si por algún caso todos
  // los bloques estuvieran movidos, se usan todos como respaldo.)
  // Combinación de lugar/color/alarma que más se repite entre las muestras de
  // un mismo (día, hora) — empate se resuelve a favor de la que apareció
  // primero. Antes se tomaba siempre muestras[0] (la primera, sin importar
  // cuántas veces se repitiera cada combinación), contradiciendo el propio
  // comentario de la función.
  function comboMasFrecuente(muestras) {
    const counts = new Map()
    muestras.forEach(m => {
      const combo = {
        lugar: m.lugar || '',
        color: m.color || 'blue',
        alarma: m.alarma || { activa: false, sonido: 'campana', minutosAntes: 10 },
      }
      const key = JSON.stringify(combo)
      const entry = counts.get(key)
      if (entry) entry.count++
      else counts.set(key, { combo, count: 1 })
    })
    let best = null
    counts.forEach(entry => { if (!best || entry.count > best.count) best = entry })
    return best.combo
  }

  function derivarPatrones(asignaturaId) {
    const todos = bloques.filter(b => b.asignaturaId === asignaturaId)
    const recurrentes = todos.filter(b => !b.movido)
    const propios = recurrentes.length ? recurrentes : todos
    const porClave = {}
    propios.forEach(b => {
      const dia = b.diaSemana ?? ((new Date(b.fecha + 'T12:00:00').getDay() + 6) % 7)
      const key = `${dia}-${b.horaInicio}`
      const dur = Math.max(5, timeToMinutes(b.horaFin) - timeToMinutes(b.horaInicio))
      ;(porClave[key] ||= { diaSemana: dia, horaInicio: b.horaInicio, duracionMin: dur, muestras: [] })
      porClave[key].muestras.push(b)
    })
    return Object.values(porClave)
      .sort((a, b) => a.diaSemana - b.diaSemana || timeToMinutes(a.horaInicio) - timeToMinutes(b.horaInicio))
      .map(({ muestras, ...p }) => ({ ...p, ...comboMasFrecuente(muestras) }))
  }

  // "Modificar bloques" → paso 1 (modal de configuración con la asignatura fija
  // y los valores derivados de los bloques actuales). El docente puede ajustar
  // fechas/duración/BS/color/alarma antes de reacomodar en la zona.
  function openModificar(asignaturaId) {
    setShowModificarPicker(false)
    const propios = bloques.filter(b => b.asignaturaId === asignaturaId)
    if (propios.length === 0) {
      toast('Esa asignatura aún no tiene bloques programados', 'error')
      return
    }
    const fechas = propios.map(b => b.fecha).sort()
    const patrones = derivarPatrones(asignaturaId)
    const durComun = patrones[0]?.duracionMin || 60
    const primerAlarma = patrones.find(p => p.alarma?.activa)?.alarma
      || { activa: false, sonido: 'campana', minutosAntes: 10 }
    // Si la asignatura ya tiene fechas de curso, ProgramarBloquesModal las
    // muestra fijas (no editables) en vez de las derivadas del primer/último
    // bloque real — el baseline debe coincidir con eso, si no, abrir
    // "Modificar" sin tocar nada ya marcaría un cambio falso (fechas
    // derivadas ≠ fechas del curso) y habilitaría "Guardar" de balde.
    const subj = subjects[asignaturaId]
    const fechaInicioBase = (subj?.fechaInicio && subj?.fechaFin) ? subj.fechaInicio : fechas[0]
    const fechaFinBase = (subj?.fechaInicio && subj?.fechaFin) ? subj.fechaFin : fechas[fechas.length - 1]
    const baseline = {
      asignaturaId,
      fechaInicio: fechaInicioBase,
      fechaFin: fechaFinBase,
      duracionMin: durComun,
      bloquesPorSemana: patrones.length,
      color: patrones[0]?.color || 'blue',
      alarma: primerAlarma,
    }
    setProgramar({
      mode: 'modificar',
      initial: baseline,
      baseline,
      baselinePatrones: patrones,
      subjectName: subjectDisplayName(subjects[asignaturaId]),
    })
  }

  // Materializa los patrones colocados en la zona y los persiste. En modo
  // "modificar" reemplaza (borra + recrea) las instancias de esa asignatura.
  async function guardarDesdeZona(patrones) {
    const cfg = zona?.config
    if (!cfg) return
    // Los días de asueto y de vacaciones que bloquean CLASES se omiten al materializar.
    const diasAsueto = [
      ...asuetos.filter(a => a.clases).map(a => a.fecha),
      ...fechasVacacionParaClases(vacaciones),
    ]
    const nuevos = generarBloques({
      fechaInicio: cfg.fechaInicio,
      fechaFin: cfg.fechaFin,
      diasAsueto,
      duracionMin: cfg.duracionMin,
      patrones,
      color: cfg.color,
      alarma: cfg.alarma,
    })
    if (nuevos.length === 0) {
      toast('Con esas fechas y días no se generó ningún bloque. Revisa el rango.', 'error')
      return
    }
    const modo = zona.mode
    const asignaturaId = cfg.asignaturaId
    setZona(null)
    try {
      // Modo modificar: borra primero las instancias actuales de la asignatura.
      if (modo === 'modificar') {
        const viejos = bloques.filter(b => b.asignaturaId === asignaturaId).map(b => b.id)
        for (let i = 0; i < viejos.length; i += 450) {
          const batch = writeBatch(db)
          viejos.slice(i, i + 450).forEach(id => batch.delete(doc(db, 'horarioBloques', id)))
          await batch.commit()
        }
      }
      const programacionId = crypto.randomUUID()
      const meta = { docenteId: currentUser.uid, programacionId, asignaturaId, createdAt: serverTimestamp() }
      const created = []
      for (let i = 0; i < nuevos.length; i += 450) {
        const batch = writeBatch(db)
        nuevos.slice(i, i + 450).forEach(b => {
          const ref = doc(collection(db, 'horarioBloques'))
          batch.set(ref, { ...b, ...meta })
          created.push({ id: ref.id, ...b, docenteId: currentUser.uid, programacionId, asignaturaId })
        })
        await batch.commit()
      }
      toast(modo === 'modificar'
        ? `Bloques actualizados (${created.length})`
        : `Se programaron ${created.length} bloques de clase`)
      // Reprograma los recordatorios de "clase por comenzar" YA — si no, un
      // bloque recién creado no dispara su aviso hasta el próximo login o
      // resume de la app.
      refreshTeacherReminders(currentUser.uid)
      // Salta a la fecha del primer bloque para que se vean de inmediato.
      const first = created.reduce((min, b) =>
        (b.fecha + b.horaInicio) < (min.fecha + min.horaInicio) ? b : min, created[0])
      if (first?.fecha) { setCurrentDate(new Date(first.fecha + 'T12:00:00')); changeView('semana') }
    } catch (err) {
      toast('Error al guardar: ' + err.message, 'error')
    }
  }

  // Bloques materializados que ya quedaron fuera del rango vigente de la
  // asignatura — pasa cuando se edita fechaInicio/fechaFin desde "Editar
  // asignatura" DESPUÉS de haber programado el horario: nada resincroniza los
  // bloques automáticamente, así que se acumulan clases fantasma fuera del
  // periodo real del curso hasta que alguien las nota aquí.
  function bloquesFueraDeRango(asignaturaId) {
    const subj = subjects[asignaturaId]
    if (!subj?.fechaInicio || !subj?.fechaFin) return []
    return bloques.filter(b => b.asignaturaId === asignaturaId
      && (b.fecha < subj.fechaInicio || b.fecha > subj.fechaFin))
  }

  async function limpiarBloquesFueraDeRango(asignaturaId) {
    const ids = bloquesFueraDeRango(asignaturaId).map(b => b.id)
    setConfirmLimpiarRango(null)
    if (ids.length === 0) return
    try {
      for (let i = 0; i < ids.length; i += 450) {
        const batch = writeBatch(db)
        ids.slice(i, i + 450).forEach(id => batch.delete(doc(db, 'horarioBloques', id)))
        await batch.commit()
      }
      toast(`Se quitaron ${ids.length} bloque(s) que estaban fuera del rango actual de la asignatura`)
    } catch (err) {
      toast('Error al quitar bloques: ' + err.message, 'error')
    }
  }

  // El espejo de bloquesFueraDeRango: tramos del curso que se quedaron SIN
  // bloques. Pasa al ALARGAR la asignatura desde "Editar asignatura" — nada
  // resincroniza, así que las clases terminan en la fecha vieja y, como la
  // asistencia se arma a partir de los bloques reales, ese tramo también se
  // queda sin días de asistencia, en silencio. Cubre los dos lados por si se
  // adelanta la fecha de inicio.
  function tramosFaltantes(asignaturaId) {
    const subj = subjects[asignaturaId]
    if (!subj?.fechaInicio || !subj?.fechaFin) return []
    const bloquesAsignatura = bloques.filter(b => b.asignaturaId === asignaturaId)
    return tramosFaltantesDe(bloquesAsignatura, subj.fechaInicio, subj.fechaFin)
  }

  // Extiende el patrón semanal vigente a los tramos que faltan. NO borra ni
  // reescribe lo existente (a diferencia de "Modificar bloques", que reemplaza
  // todo): solo rellena el hueco, así que las clases que el docente haya movido
  // a mano dentro del tramo ya programado se quedan como están.
  async function generarBloquesFaltantes(asignaturaId) {
    const tramos = tramosFaltantes(asignaturaId)
    setConfirmGenerarFaltantes(null)
    if (tramos.length === 0) return
    const patrones = derivarPatrones(asignaturaId)
    if (patrones.length === 0) { toast('No se pudo deducir el horario semanal de esa asignatura', 'error'); return }
    const diasAsueto = [
      ...asuetos.filter(a => a.clases).map(a => a.fecha),
      ...fechasVacacionParaClases(vacaciones),
    ]
    const nuevos = tramos.flatMap(t => generarBloques({
      fechaInicio: t.desde,
      fechaFin: t.hasta,
      diasAsueto,
      duracionMin: patrones[0].duracionMin || 60,
      patrones,
      color: patrones[0].color,
      alarma: patrones[0].alarma,
    }))
    if (nuevos.length === 0) {
      toast('No había clases pendientes por generar en ese tramo (cae en asueto o no coincide con el horario semanal)', 'warning')
      return
    }
    try {
      const meta = {
        docenteId: currentUser.uid,
        programacionId: crypto.randomUUID(),
        asignaturaId,
        createdAt: serverTimestamp(),
      }
      for (let i = 0; i < nuevos.length; i += 450) {
        const batch = writeBatch(db)
        nuevos.slice(i, i + 450).forEach(b => batch.set(doc(collection(db, 'horarioBloques')), { ...b, ...meta }))
        await batch.commit()
      }
      toast(`Se generaron ${nuevos.length} bloque(s) para el tramo que faltaba`)
      refreshTeacherReminders(currentUser.uid)
    } catch (err) {
      toast('Error al generar los bloques faltantes: ' + err.message, 'error')
    }
  }

  // Bloques que caen en un día que se marcó como asueto/vacaciones DESPUÉS de
  // materializarse — se generan excluyendo los asuetos que existían en ese
  // momento (utils/horarioBloques.js), pero un asueto agregado después no
  // borra retroactivamente los bloques que ya habían quedado ahí, así que el
  // calendario termina mostrando una clase el mismo día que dice "sin clases".
  function bloquesEnAsueto(asignaturaId) {
    return bloques.filter(b => b.asignaturaId === asignaturaId
      && (esAsuetoPara(asuetoMap, b.fecha, 'clases') || esAsuetoPara(vacacionMap, b.fecha, 'clases')))
  }

  async function limpiarBloquesEnAsueto(asignaturaId) {
    const ids = bloquesEnAsueto(asignaturaId).map(b => b.id)
    setConfirmLimpiarAsueto(null)
    if (ids.length === 0) return
    try {
      for (let i = 0; i < ids.length; i += 450) {
        const batch = writeBatch(db)
        ids.slice(i, i + 450).forEach(id => batch.delete(doc(db, 'horarioBloques', id)))
        await batch.commit()
      }
      toast(`Se quitaron ${ids.length} bloque(s) que caían en día de asueto o vacaciones`)
    } catch (err) {
      toast('Error al quitar bloques: ' + err.message, 'error')
    }
  }

  // Asignaturas que YA tienen programación (solo se pueden modificar, no volver
  // a programar hasta que se borre su programación completa).
  const programmedIds = useMemo(() => new Set(bloques.map(b => b.asignaturaId)), [bloques])
  const subjectsConBloques = useMemo(() =>
    Object.values(subjects).filter(s => programmedIds.has(s.id))
      .sort((a, b) => subjectDisplayName(a).localeCompare(subjectDisplayName(b))),
  [subjects, programmedIds])
  const subjectsSinProgramar = useMemo(() =>
    Object.values(subjects).filter(s => !programmedIds.has(s.id))
      .sort((a, b) => subjectDisplayName(a).localeCompare(subjectDisplayName(b))),
  [subjects, programmedIds])
  // Total para el badge del botón "Modificar bloques" — así se nota desde el
  // calendario mismo, sin tener que abrir el selector para descubrirlo.
  const totalBloquesFueraDeRango = useMemo(() =>
    [...programmedIds].reduce((sum, id) => sum + bloquesFueraDeRango(id).length, 0),
  [bloques, subjects, programmedIds]) // eslint-disable-line react-hooks/exhaustive-deps
  const totalBloquesEnAsueto = useMemo(() =>
    [...programmedIds].reduce((sum, id) => sum + bloquesEnAsueto(id).length, 0),
  [bloques, asuetoMap, vacacionMap, programmedIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Borra TODA la programación de una asignatura → vuelve a estar disponible
  // para programarse desde cero.
  async function borrarProgramacion(asignaturaId) {
    const ids = bloques.filter(b => b.asignaturaId === asignaturaId).map(b => b.id)
    setProgramar(null)
    try {
      for (let i = 0; i < ids.length; i += 450) {
        const batch = writeBatch(db)
        ids.slice(i, i + 450).forEach(id => batch.delete(doc(db, 'horarioBloques', id)))
        await batch.commit()
      }
      toast(`Programación eliminada (${ids.length} bloque(s)). La asignatura vuelve a estar disponible para programar.`)
      refreshTeacherReminders(currentUser.uid)
    } catch (err) {
      toast('No se pudo borrar la programación: ' + err.message, 'error')
    }
  }

  // Mover un bloque (arrastrar) → nueva fecha/hora, conservando la duración.
  async function moveBloque(b, nuevaFecha, nuevaHora) {
    const durMin = timeToMinutes(b.horaFin) - timeToMinutes(b.horaInicio)
    const nuevaHoraFin = addMinutesToTime(nuevaHora, durMin)
    const diaSemana = (new Date(nuevaFecha + 'T12:00:00').getDay() + 6) % 7
    // Actualización optimista para que se vea al instante (onSnapshot confirma).
    setBloques(prev => prev.map(x => x.id === b.id
      ? { ...x, fecha: nuevaFecha, horaInicio: nuevaHora, horaFin: nuevaHoraFin, diaSemana, movido: true }
      : x))
    try {
      await updateDoc(doc(db, 'horarioBloques', b.id), {
        fecha: nuevaFecha, horaInicio: nuevaHora, horaFin: nuevaHoraFin, diaSemana, movido: true,
      })
      refreshTeacherReminders(currentUser.uid)
    } catch (err) {
      toast('No se pudo mover el bloque: ' + err.message, 'error')
    }
  }

  // Mover un evento personal (arrastrar) → nueva fecha/hora, conservando duración.
  async function moveEvent(rawEvent, nuevaFecha, nuevaHora) {
    const inicio = rawEvent.inicio || ''
    const fecha = nuevaFecha || inicio.substring(0, 10)
    if (nuevaFecha && bloqueadoPorAsueto(nuevaFecha, 'eventos')) return
    const hora = nuevaHora || inicio.substring(11, 16) || '08:00'
    const nuevoInicio = `${fecha}T${hora}`
    let nuevoFin = nuevoInicio
    if (rawEvent.fin && inicio) {
      const durMs = new Date(rawEvent.fin) - new Date(inicio)
      if (Number.isFinite(durMs) && durMs > 0) {
        const f = new Date(new Date(`${nuevoInicio}:00`).getTime() + durMs)
        nuevoFin = `${toDateStr(f)}T${String(f.getHours()).padStart(2, '0')}:${String(f.getMinutes()).padStart(2, '0')}`
      }
    }
    // Optimista: onSnapshot confirma después.
    setPersonalEvents(prev => prev.map(x => x.id === rawEvent.id
      ? { ...x, inicio: nuevoInicio, fin: nuevoFin }
      : x))
    try {
      const col = rawEvent.tipo === 'academico' ? 'academicEvents' : 'events'
      await updateDoc(doc(db, col, rawEvent.id), { inicio: nuevoInicio, fin: nuevoFin })
      refreshTeacherReminders(currentUser.uid)
    } catch (err) {
      toast('No se pudo mover el evento: ' + err.message, 'error')
    }
  }

  // Al soltar (o tocar) una clase se abre el diálogo de acciones de ESA clase:
  // mover el mismo día a otra hora, o borrarla (clase suspendida). Un
  // adelanto/movimiento de una sola clase es SIEMPRE el mismo día: solo cambia
  // la hora (nunca el día ni las clases siguientes → eso es "Modificar bloques").
  function requestMoveBloque(b, _nuevaFecha, nuevaHora) {
    setPendingMove({ bloque: b, fecha: b.fecha, hora: nuevaHora })
  }
  // Tocar una clase (sin arrastrar) abre el mismo diálogo con su hora actual.
  function openBloqueAcciones(b) {
    setPendingMove({ bloque: b, fecha: b.fecha, hora: b.horaInicio })
  }
  // En la vista Mes solo se puede BORRAR ese día (no mover): el diálogo se abre
  // sin la opción de cambiar la hora.
  function openBloqueSoloBorrar(b) {
    setPendingMove({ bloque: b, fecha: b.fecha, hora: b.horaInicio, soloBorrar: true })
  }

  async function confirmPendingMove() {
    const pm = pendingMove
    setPendingMove(null)
    if (!pm) return
    // Mismo día siempre; solo puede cambiar la hora.
    if (pm.hora === pm.bloque.horaInicio) return
    await moveBloque(pm.bloque, pm.bloque.fecha, pm.hora)
  }

  // Borrar SOLO esta clase (p. ej. suspendida). No toca las demás instancias.
  async function borrarBloqueUnico(bloque) {
    setPendingMove(null)
    try {
      await deleteDoc(doc(db, 'horarioBloques', bloque.id))
      toast('Esta clase se borró. Las demás clases siguen igual.')
      refreshTeacherReminders(currentUser.uid)
    } catch (err) {
      toast('No se pudo borrar la clase: ' + err.message, 'error')
    }
  }

  // Crear evento desde un hueco de la agenda del día.
  function openNewEventAt(dateStr, hora) {
    if (bloqueadoPorAsueto(dateStr, 'eventos')) return
    setEditingEvent(null)
    setSelectedDate(`${dateStr}T${hora}`)
    setShowEventEditor(true)
  }

  // ── Días de asueto ─────────────────────────────────────────────────────
  async function addAsueto(fecha, alcance) {
    if (!fecha) return
    const existente = asuetos.find(a => a.fecha === fecha)
    try {
      if (existente) {
        await updateDoc(doc(db, 'asuetos', existente.id), alcance)
      } else {
        await addDoc(collection(db, 'asuetos'), {
          docenteId: currentUser.uid, fecha, ...alcance, createdAt: serverTimestamp(),
        })
      }
      toast('Día de asueto guardado')
    } catch (err) {
      toast('No se pudo guardar el día de asueto: ' + err.message, 'error')
    }
  }
  async function removeAsueto(id) {
    try {
      await deleteDoc(doc(db, 'asuetos', id))
    } catch (err) {
      toast('No se pudo quitar el día de asueto: ' + err.message, 'error')
    }
  }

  // ── Vacaciones (periodo) ───────────────────────────────────────────────
  async function addVacacion(fechaInicio, fechaFin, alcance) {
    if (!fechaInicio || !fechaFin) return
    try {
      await addDoc(collection(db, 'vacaciones'), {
        docenteId: currentUser.uid, fechaInicio, fechaFin, ...alcance, createdAt: serverTimestamp(),
      })
      toast('Periodo de vacaciones guardado')
    } catch (err) {
      toast('No se pudo guardar el periodo de vacaciones: ' + err.message, 'error')
    }
  }
  async function removeVacacion(id) {
    try {
      await deleteDoc(doc(db, 'vacaciones', id))
    } catch (err) {
      toast('No se pudo quitar el periodo de vacaciones: ' + err.message, 'error')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  // Piezas del toolbar armadas como variables JSX para poder recomponerlas en
  // dos layouts distintos (nativo vs. web) sin duplicar el marcado.
  const dateNav = (
    <div className="relative flex items-center gap-0.5 bg-surface-card border border-outline-variant rounded-card shadow-card px-1 py-1">
      <button type="button" onClick={prev} aria-label="Anterior" className="p-2 rounded hover:bg-accent-tint text-muted transition-colors">
        <ChevronLeft size={16} />
      </button>
      <button
        type="button"
        onClick={() => {
          setPickerMonth(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1))
          setShowDatePicker(v => !v)
        }}
        className="text-sm font-semibold text-on-surface px-3 min-w-[180px] text-center select-none rounded hover:bg-accent-tint transition-colors py-0.5"
        data-tooltip="Ir a otra fecha"
        data-tooltip-pos="bottom"
      >
        {navLabel()}
      </button>
      <button type="button" onClick={next} aria-label="Siguiente" className="p-2 rounded hover:bg-accent-tint text-muted transition-colors">
        <ChevronRight size={16} />
      </button>

      {/* Mini calendario para saltar a una fecha */}
      {showDatePicker && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-20 bg-transparent border-none cursor-default"
            onClick={() => setShowDatePicker(false)}
            aria-label="Cerrar selector de fecha"
          />
          <div className="absolute left-1/2 -translate-x-1/2 top-11 z-30 bg-surface-card border border-outline-variant rounded-card shadow-lg p-3 w-64">
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => setPickerMonth(m => addMonths(m, -1))} className="p-2 rounded hover:bg-accent-tint text-muted">
                <ChevronLeft size={15} />
              </button>
              <span className="text-sm font-semibold text-on-surface">
                {MESES[pickerMonth.getMonth()]} {pickerMonth.getFullYear()}
              </span>
              <button type="button" onClick={() => setPickerMonth(m => addMonths(m, 1))} className="p-2 rounded hover:bg-accent-tint text-muted">
                <ChevronRight size={15} />
              </button>
            </div>
            <div className="grid grid-cols-7 mb-1">
              {DIAS_CORTO.map(d => (
                <span key={d} className="text-center text-[10px] font-semibold text-muted uppercase">{d.charAt(0)}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5">
              {getMonthGrid(pickerMonth.getFullYear(), pickerMonth.getMonth()).map(cell => {
                const inMonth = cell.getMonth() === pickerMonth.getMonth()
                const sel = isSameDay(cell, currentDate)
                return (
                  <button
                    key={toDateStr(cell)}
                    type="button"
                    onClick={() => { setCurrentDate(cell); setShowDatePicker(false) }}
                    className={`h-7 w-7 mx-auto rounded-full text-xs flex items-center justify-center transition-colors ${
                      sel ? 'bg-accent text-white font-bold'
                        : isToday(cell) ? 'ring-1 ring-accent text-accent font-semibold hover:bg-accent-tint'
                        : inMonth ? 'text-on-surface hover:bg-accent-tint' : 'text-muted opacity-40 hover:bg-accent-tint'
                    }`}
                  >
                    {cell.getDate()}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )

  const hoyBtn = (
    <button
      ref={hoyBtnRef}
      type="button"
      onClick={goToday}
      className={IS_NATIVE_APP
        ? 'text-xs px-2 py-1.5 rounded border-2 border-accent/40 bg-surface-card shadow-card text-muted transition-colors'
        : 'text-xs px-3 py-1.5 rounded border border-outline-variant text-muted hover:bg-accent-tint transition-colors'}
    >
      Hoy
    </button>
  )

  const eventoBtn = (
    <button
      type="button"
      onClick={() => openNewEvent(null)}
      className={IS_NATIVE_APP
        ? 'flex items-center gap-1 px-2 py-1.5 rounded-card border-2 border-accent/40 bg-surface-card shadow-card text-xs text-muted transition-colors'
        : 'flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-outline-variant text-sm text-muted hover:bg-accent-tint transition-colors'}
    >
      <Plus size={15} /> Evento
    </button>
  )

  const viewSwitcher = (
    <div className="flex items-center gap-0.5 bg-surface-card border border-outline-variant rounded-card shadow-card px-1 py-1">
      {VIEWS.map(({ id, label, Icon }) => (
        <button
          type="button"
          key={id}
          onClick={() => changeView(id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${view === id ? 'bg-accent text-white' : 'text-muted hover:bg-accent-tint'}`}
        >
          <Icon size={13} />{label}
        </button>
      ))}
    </div>
  )

  const hourRangeBtn = (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowHoras(v => !v)}
        className={IS_NATIVE_APP
          ? 'flex items-center gap-1 px-2 py-1.5 rounded-card border-2 border-accent/40 bg-surface-card shadow-card text-[11px] whitespace-nowrap text-muted transition-colors'
          : 'flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-outline-variant text-sm text-muted hover:bg-accent-tint transition-colors'}
        data-tooltip="Horas visibles de tu día (Agenda y Semana)"
        data-tooltip-pos="bottom"
      >
        {/* % 24 — dayEnd puede ser 24 (medianoche, límite exclusivo del rango
            visible), que formatHora12 debe leer como "12:00 am", no "24:00". */}
        <Clock size={14} /> {formatHora12(`${String(dayStart % 24).padStart(2, '0')}:00`)}–{formatHora12(`${String(dayEnd % 24).padStart(2, '0')}:00`)}
      </button>
      {showHoras && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30 bg-transparent border-none cursor-default"
            onClick={() => setShowHoras(false)}
            aria-label="Cerrar selector de horas"
          />
          <div className="absolute right-0 top-10 z-40 bg-surface-card border border-outline-variant rounded-card shadow-lg p-3 w-64 space-y-2">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">Horas del día en tu agenda</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted w-12 flex-shrink-0">Desde</span>
              <MiniSelect
                value={dayStart}
                onChange={v => changeDayStart(v)}
                options={Array.from({ length: 23 }, (_, h) => h).map(h => ({
                  value: h, label: formatHora12(`${String(h).padStart(2, '0')}:00`),
                }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted w-12 flex-shrink-0">Hasta</span>
              <MiniSelect
                value={dayEnd}
                onChange={v => changeDayEnd(v)}
                options={Array.from({ length: 24 }, (_, h) => h + 1).filter(h => h > dayStart).map(h => ({
                  value: h, label: formatHora12(`${String(h % 24).padStart(2, '0')}:00`),
                }))}
              />
            </div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wide pt-1">Días de tu semana</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted w-12 flex-shrink-0">Días</span>
              <MiniSelect
                value={numDays}
                onChange={v => changeNumDays(v)}
                options={[
                  { value: 5, label: 'Lunes a Viernes' },
                  { value: 6, label: 'Lunes a Sábado' },
                  { value: 7, label: 'Lunes a Domingo' },
                ]}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )

  return (
    <>
      <div className={`px-4 py-4 ${TEACHER_CONTAINER}`}>

        {IS_NATIVE_APP ? (
          <>
            {/* Nativo: fecha/Hoy/Evento/horas en un renglón; vista debajo.
                Días de asueto, Vacaciones, Modificar y Programar bloques se
                manejan solo en la web. */}
            <div className="flex items-center gap-2 mb-2">
              {dateNav}
            </div>
            <div className="flex flex-nowrap items-center gap-1.5 mb-2">
              {hoyBtn}
              {eventoBtn}
              {hourRangeBtn}
            </div>
            <div className="flex items-center gap-2 mb-4">
              {viewSwitcher}
            </div>
          </>
        ) : (
          <>
            {/* Top controls — centrados como un solo grupo (antes iban con un
                spacer flex-1 empujándolos a las orillas, se veía muy separado). */}
            <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
              {dateNav}
              {hoyBtn}
              {eventoBtn}
              {hourRangeBtn}
              {viewSwitcher}
            </div>

            {/* Segunda fila: asuetos + programación de bloques */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <button
                type="button"
                onClick={() => setShowAsuetos(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-outline-variant text-sm text-muted hover:bg-amber-50 hover:text-amber-700 hover:border-amber-300 transition-colors"
                data-tooltip="Marca días sin clases, eventos y/o actividades"
                data-tooltip-pos="bottom"
              >
                <CalendarOff size={15} /> Días de asueto
                {asuetos.length > 0 && (
                  <span className="ml-0.5 text-xs px-1.5 rounded-full bg-amber-500 text-white">{asuetos.length}</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowVacaciones(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-outline-variant text-sm text-muted hover:bg-amber-50 hover:text-amber-700 hover:border-amber-300 transition-colors"
                data-tooltip="Marca un periodo sin clases, eventos y/o actividades"
                data-tooltip-pos="bottom"
              >
                <CalendarRange size={15} /> Vacaciones
                {vacaciones.length > 0 && (
                  <span className="ml-0.5 text-xs px-1.5 rounded-full bg-amber-500 text-white">{vacaciones.length}</span>
                )}
              </button>

              <div className="flex-1" />

              <button
                type="button"
                onClick={() => setShowModificarPicker(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-outline-variant text-sm text-muted hover:bg-accent-tint transition-colors"
                data-tooltip={(totalBloquesFueraDeRango + totalBloquesEnAsueto) > 0
                  ? `${totalBloquesFueraDeRango + totalBloquesEnAsueto} bloque(s) necesitan revisión (rango o asueto/vacaciones)`
                  : 'Modificar bloques de clase por asignatura'}
                data-tooltip-pos="bottom"
              >
                <CalendarClock size={15} /> Modificar bloques
                {(totalBloquesFueraDeRango + totalBloquesEnAsueto) > 0 && (
                  <span className="ml-0.5 flex items-center gap-0.5 text-xs px-1.5 rounded-full bg-amber-500 text-white">
                    <AlertTriangle size={10} /> {totalBloquesFueraDeRango + totalBloquesEnAsueto}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => openProgramar()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-card bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
                data-tooltip="Programar bloques de clase por asignatura"
                data-tooltip-pos="bottom"
              >
                <CalendarPlus size={15} /> Programar bloques
              </button>
            </div>
          </>
        )}

        {/* Conflict warning */}
        {conflicts.length > 0 && (
          <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-card flex items-start gap-2 text-sm text-amber-800">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-amber-500" />
            <span>
              <strong>Días con 3 o más entregas:</strong>{' '}
              {conflicts.map(d => {
                const dt = new Date(d + 'T12:00:00')
                return `${dt.getDate()} ${MESES[dt.getMonth()]}`
              }).join(', ')}.
              Considera distribuir las fechas límite para evitar saturar a tus alumnos.
            </span>
          </div>
        )}

        {/* Calendar body — en web, Día y 3 días se ven mal a lo ancho de las
            demás vistas (columnas gigantes); se acotan y centran. Semana y
            Mes se quedan a ancho completo, como ya estaban. Solo web: en la
            app esta franja ya es angosta por el propio viewport. */}
        <div className={`bg-surface-card border border-outline rounded shadow-card overflow-hidden ${
          IS_NATIVE_APP ? '' : view === 'agenda' ? 'w-1/2 mx-auto' : view === '3dias' ? 'w-3/4 mx-auto' : ''
        }`}>
          {loading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : view === 'agenda' ? (
            <AgendaView
              date={currentDate}
              events={events}
              bloques={bloques}
              subjects={subjects}
              dayStart={dayStart}
              dayEnd={dayEnd}
              onEventClick={openEditEvent}
              onBlockClick={openBloqueAcciones}
              onMoveBloque={requestMoveBloque}
              onMoveEvent={moveEvent}
              onSlotClick={IS_NATIVE_APP ? undefined : openNewEventAt}
              asuetoMap={asuetoMap}
              vacacionMap={vacacionMap}
            />
          ) : view === 'mes' ? (
            <MonthView
              year={currentDate.getFullYear()}
              month={currentDate.getMonth()}
              events={events}
              bloques={bloques}
              subjects={subjects}
              selectedDate={currentDate}
              onDateClick={IS_NATIVE_APP ? undefined : openNewEvent}
              // En la App, Mes es solo informativo: presionar un bloque o
              // evento no hace nada — evita saturar una vista ya de por sí
              // apretada en pantallas chicas. La web sigue igual.
              onEventClick={IS_NATIVE_APP ? undefined : openEditEvent}
              onBlockClick={IS_NATIVE_APP ? undefined : openBloqueSoloBorrar}
              onMoveEvent={IS_NATIVE_APP ? undefined : moveEvent}
              onMoveBloque={IS_NATIVE_APP ? undefined : requestMoveBloque}
              asuetoMap={asuetoMap}
              vacacionMap={vacacionMap}
              editable={false}
            />
          ) : view === '3dias' ? (
            <WeekView
              weekStart={currentDate}
              anchorToday
              numDays={3}
              events={events}
              bloques={bloques}
              subjects={subjects}
              dayStart={dayStart}
              dayEnd={dayEnd}
              selectedDate={currentDate}
              onSlotClick={IS_NATIVE_APP ? undefined : openNewEventAt}
              onEventClick={openEditEvent}
              onBlockClick={openBloqueAcciones}
              onMoveBloque={requestMoveBloque}
              onMoveEvent={moveEvent}
              asuetoMap={asuetoMap}
              vacacionMap={vacacionMap}
            />
          ) : (
            <WeekView
              weekStart={startOfWeekMon(currentDate)}
              events={events}
              bloques={bloques}
              subjects={subjects}
              dayStart={dayStart}
              dayEnd={dayEnd}
              numDays={numDays}
              selectedDate={currentDate}
              onSlotClick={IS_NATIVE_APP ? undefined : openNewEventAt}
              // En la App, Semana es solo informativa: presionar un bloque o
              // evento no hace nada — evita saturar la vista. La web sigue
              // igual, y 3 días (arriba) tampoco cambia.
              onEventClick={IS_NATIVE_APP ? undefined : openEditEvent}
              onBlockClick={IS_NATIVE_APP ? undefined : openBloqueAcciones}
              onMoveBloque={IS_NATIVE_APP ? undefined : requestMoveBloque}
              onMoveEvent={IS_NATIVE_APP ? undefined : moveEvent}
              asuetoMap={asuetoMap}
              vacacionMap={vacacionMap}
              editable={false}
            />
          )}
        </div>

        {/* Legend — solo web (pedido explícito: en la App no hace falta). */}
        {!IS_NATIVE_APP && (
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted px-1">
          <span className="flex items-center gap-1"><CalendarPlus size={12} /> Bloques de clase (Semana/Mes)</span>
          <span className="flex items-center gap-1"><Send size={12} /> Publicación</span>
          <span className="flex items-center gap-1"><CalendarDays size={12} /> Evento personal</span>
          <span className="flex items-center gap-1"><Lock size={14} /> Fecha límite — ya no recibe tarde</span>
          <span className="flex items-center gap-1"><LockOpen size={14} /> Sigue recibiendo tarde</span>
        </div>
        )}
      </div>

      {/* Modals */}
      {showEventEditor && (
        <EventEditor
          event={editingEvent}
          defaultDate={selectedDate}
          subjects={Object.values(subjects).filter(s => !s.archived)}
          onClose={closeEventEditor}
          onSaved={closeEventEditor}
          onDeleted={closeEventEditor}
        />
      )}
      {programar && (
        <ProgramarBloquesModal
          subjects={subjects}
          subjectsDisponibles={subjectsSinProgramar}
          mode={programar.mode}
          initial={programar.initial}
          subjectName={programar.subjectName}
          onClose={() => setProgramar(null)}
          onContinue={continuarAZona}
          onDeleteAll={borrarProgramacion}
          onIrAsignatura={(id) => {
            if (!id) return
            setProgramar(null)
            // `openEditSubject` abre allá el modal de "Editar asignatura" — que
            // es donde viven las fechas y, con ellas, los parciales.
            navigate(`/subject/${id}`, { state: { openEditSubject: true } })
          }}
        />
      )}

      {zona && (
        <ProgramarZonaSemanal
          config={zona.config}
          mode={zona.mode}
          initialPatrones={zona.initialPatrones}
          configChanged={zona.configChanged}
          subjects={subjects}
          otrosBloques={bloques.filter(b => b.asignaturaId !== zona.asignaturaId)}
          dayStart={dayStart}
          dayEnd={dayEnd}
          numDays={numDays}
          onCancel={() => setZona(null)}
          onConfirm={guardarDesdeZona}
        />
      )}

      {/* Selector de asignatura para "Modificar bloques" */}
      {showModificarPicker && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40 border-none cursor-default"
            onClick={() => setShowModificarPicker(false)}
            aria-label="Cerrar"
          />
          {/* pb mayor en la web: la lista terminaba pegada al borde inferior de
              la tarjeta. `pb-*` se emite después de `p-*`, así que gana sin
              depender del orden en que se escriban las clases. */}
          <div className={`relative bg-surface-card rounded-t-card md:rounded-card shadow-2xl w-full max-w-sm p-4 space-y-3 ${IS_NATIVE_APP ? '' : 'pb-6'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarClock size={18} className="text-accent" />
                <h2 className="font-semibold text-on-surface">Modificar bloques por asignatura</h2>
              </div>
              <button type="button" onClick={() => setShowModificarPicker(false)} aria-label="Cerrar" className="p-2 text-muted hover:text-error rounded"><Plus size={18} className="rotate-45" /></button>
            </div>
            {subjectsConBloques.length === 0 ? (
              <p className="text-sm text-muted py-4 text-center">
                Todavía no has programado bloques de ninguna asignatura. Usa <strong>Programar bloques</strong> para empezar.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
                <p className="text-xs text-muted">Elige la asignatura cuyos bloques quieres reacomodar:</p>
                {subjectsConBloques.map(s => {
                  const delSubj = bloques.filter(b => b.asignaturaId === s.id)
                  const n = delSubj.length
                  // El color de sus bloques, no el de la paleta de la
                  // asignatura: así cada renglón se reconoce contra la rejilla,
                  // donde el docente ya vio esa clase de ese color.
                  const pal = bloqueColor(delSubj[0]?.color)
                  const fuera = bloquesFueraDeRango(s.id)
                  const enAsueto = bloquesEnAsueto(s.id)
                  const faltan = tramosFaltantes(s.id)
                  return (
                    <div className="rounded-card border overflow-hidden" key={s.id} style={{ borderColor: pal.text + '55' }}>
                      {/* El renglón entero va del color de la asignatura, sin
                          muestra aparte. El hover se hace con brillo y no con
                          una clase de fondo: el color va en `style` y una
                          utilidad de Tailwind no le ganaría. */}
                      <button
                        type="button"
                        onClick={() => openModificar(s.id)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:brightness-95 transition-[filter]"
                        style={{ background: pal.bg, color: pal.text }}
                      >
                        {/* Los íconos del banco se pintan con currentColor, así
                            que toman el tono de la asignatura sin más. */}
                        <SubjectIcon iconKey={s.icon} size={18} className="flex-shrink-0" />
                        <span className="text-sm font-medium truncate flex-1">{subjectDisplayName(s)}</span>
                        <span className="text-xs opacity-75 flex-shrink-0">{n} bloque(s)</span>
                      </button>
                      {fuera.length > 0 && (
                        confirmLimpiarRango === s.id ? (
                          <div className="flex items-center gap-2 px-3 py-2 bg-error/10 border-t border-error/30">
                            <span className="text-xs text-error flex-1">¿Quitar los {fuera.length} bloque(s) fuera de rango?</span>
                            <button type="button" onClick={() => setConfirmLimpiarRango(null)} className="text-xs text-muted px-2 py-1">Cancelar</button>
                            <button type="button" onClick={() => limpiarBloquesFueraDeRango(s.id)} className="text-xs bg-error text-white rounded px-2.5 py-1 font-medium">Quitar</button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmLimpiarRango(s.id)}
                            className="w-full flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-t border-amber-200 text-xs text-amber-800 hover:bg-amber-100 transition-colors text-left"
                          >
                            <AlertTriangle size={12} className="flex-shrink-0" />
                            {fuera.length} bloque(s) quedaron fuera del rango actual — tócalo para quitarlos
                          </button>
                        )
                      )}
                      {faltan.length > 0 && (
                        confirmGenerarFaltantes === s.id ? (
                          <div className="flex items-center gap-2 px-3 py-2 bg-accent-tint border-t border-accent/30">
                            <span className="text-xs text-accent flex-1">
                              ¿Generar las clases que faltan {faltan.map(t => `del ${formatLongDate(t.desde)} al ${formatLongDate(t.hasta)}`).join(' y ')}?
                            </span>
                            <button type="button" onClick={() => setConfirmGenerarFaltantes(null)} className="text-xs text-muted px-2 py-1">Cancelar</button>
                            <button type="button" onClick={() => generarBloquesFaltantes(s.id)} className="text-xs bg-accent text-white rounded px-2.5 py-1 font-medium">Generar</button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmGenerarFaltantes(s.id)}
                            className="w-full flex items-center gap-1.5 px-3 py-1.5 bg-accent-tint border-t border-accent/30 text-xs text-accent hover:brightness-95 transition-[filter] text-left"
                          >
                            <CalendarClock size={12} className="flex-shrink-0" />
                            Faltan clases desde el {formatLongDate(faltan[faltan.length - 1].desde)} — tócalo para generarlas
                          </button>
                        )
                      )}
                      {enAsueto.length > 0 && (
                        confirmLimpiarAsueto === s.id ? (
                          <div className="flex items-center gap-2 px-3 py-2 bg-error/10 border-t border-error/30">
                            <span className="text-xs text-error flex-1">¿Quitar los {enAsueto.length} bloque(s) en día de asueto/vacaciones?</span>
                            <button type="button" onClick={() => setConfirmLimpiarAsueto(null)} className="text-xs text-muted px-2 py-1">Cancelar</button>
                            <button type="button" onClick={() => limpiarBloquesEnAsueto(s.id)} className="text-xs bg-error text-white rounded px-2.5 py-1 font-medium">Quitar</button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmLimpiarAsueto(s.id)}
                            className="w-full flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-t border-amber-200 text-xs text-amber-800 hover:bg-amber-100 transition-colors text-left"
                          >
                            <AlertTriangle size={12} className="flex-shrink-0" />
                            {enAsueto.length} bloque(s) caen en día de asueto o vacaciones — tócalo para quitarlos
                          </button>
                        )
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {showAsuetos && (
        <AsuetoManager
          asuetos={asuetos}
          onAdd={addAsueto}
          onRemove={removeAsueto}
          onClose={() => setShowAsuetos(false)}
        />
      )}
      {showVacaciones && (
        <VacacionManager
          vacaciones={vacaciones}
          onAdd={addVacacion}
          onRemove={removeVacacion}
          onClose={() => setShowVacaciones(false)}
        />
      )}

      {/* Acciones de UNA sola clase: mover el mismo día a otra hora, o borrarla
          (clase suspendida). Nunca afecta a las clases siguientes ni cambia de
          día — para eso está "Modificar bloques". */}
      {pendingMove && (() => {
        const { bloque: b, hora, confirmDel, soloBorrar } = pendingMove
        const subj = subjects[b.asignaturaId]
        const durMin = Math.max(5, timeToMinutes(b.horaFin) - timeToMinutes(b.horaInicio))
        const fmtF = s => {
          const d = new Date(s + 'T12:00:00')
          return `${DIAS_LARGO[(d.getDay() + 6) % 7]} ${d.getDate()} de ${MESES[d.getMonth()]}`
        }
        const stepHora = (delta) => setPendingMove(pm => ({ ...pm, hora: addMinutesToTime(pm.hora, delta) }))
        const inputCls = 'px-2.5 py-1.5 rounded border border-outline-variant text-sm bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'
        const cambioHora = hora !== b.horaInicio
        // No permitir encimar con otra clase del MISMO día.
        const iniMin = timeToMinutes(hora)
        const finMin = iniMin + durMin
        const seEncima = bloques.some(x => x.id !== b.id && x.fecha === b.fecha
          && timeToMinutes(x.horaInicio) < finMin && iniMin < timeToMinutes(x.horaFin))
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-black/40 border-none cursor-default"
              onClick={() => setPendingMove(null)}
              aria-label="Cerrar"
            />
            <div className="relative bg-surface-card rounded-card shadow-2xl w-full max-w-sm p-4 space-y-3">
              <h2 className="font-semibold text-on-surface">{soloBorrar ? 'Borrar esta clase' : 'Mover o borrar esta clase'}</h2>
              <div className="text-sm text-on-surface space-y-0.5 bg-surface rounded-card border border-outline-variant p-3">
                <p className="font-medium">{subjectDisplayName(subj) || 'Clase'}</p>
                <p className="text-muted text-xs">{fmtF(b.fecha)} · empieza a las {fmtHour(b.horaInicio)}</p>
              </div>

              {/* Mover el MISMO día a otra hora — no disponible en la vista Mes */}
              {!soloBorrar && (<>
              <div className="space-y-1">
                <span className="text-xs font-semibold text-muted uppercase tracking-wide">Cambiar la hora (el mismo día)</span>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => stepHora(-5)}
                    className="px-2 py-1.5 rounded border border-outline-variant text-accent hover:bg-accent-tint transition-colors" aria-label="−5 minutos">
                    <Minus size={14} />
                  </button>
                  <input
                    type="time" value={hora} step={60}
                    onChange={e => e.target.value && setPendingMove(pm => ({ ...pm, hora: e.target.value }))}
                    className={`${inputCls} flex-1 text-center text-base font-semibold tabular-nums`}
                  />
                  <button type="button" onClick={() => stepHora(5)}
                    className="px-2 py-1.5 rounded border border-outline-variant text-accent hover:bg-accent-tint transition-colors" aria-label="+5 minutos">
                    <Plus size={14} />
                  </button>
                </div>
                <p className="text-xs text-muted">Termina a las <strong className="text-on-surface">{formatHora12(addMinutesToTime(hora, durMin))}</strong></p>
                {seEncima && (
                  <p className="text-xs text-error flex items-center gap-1">
                    <AlertTriangle size={13} className="flex-shrink-0" /> A esa hora se encima con otra clase. Elige otra hora.
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => confirmPendingMove()}
                disabled={!cambioHora || seEncima}
                className="w-full py-2 bg-accent text-white rounded-card text-sm font-semibold hover:bg-accent-hover transition-colors disabled:opacity-45"
              >
                {seEncima ? 'Se encima con otra clase' : cambioHora ? `Mover a las ${fmtHour(hora)}` : 'Ajusta la hora para mover'}
              </button>
              </>)}

              {soloBorrar && (
                <p className="text-xs text-muted">En la vista Mes las clases no se cambian de hora ni de día. Para eso, usa <strong className="text-on-surface">Modificar bloques</strong>.</p>
              )}

              {/* Borrar SOLO esta clase */}
              {confirmDel ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-card bg-error/10 border border-error/30">
                  <span className="text-xs text-error flex-1">¿Borrar solo esta clase? Las demás clases no se tocan.</span>
                  <button type="button" onClick={() => setPendingMove(pm => ({ ...pm, confirmDel: false }))} className="text-xs text-muted px-2 py-1">No</button>
                  <button type="button" onClick={() => borrarBloqueUnico(b)} className="text-xs bg-error text-white rounded px-2.5 py-1 font-medium">Sí, borrar</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPendingMove(pm => ({ ...pm, confirmDel: true }))}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-card border border-error/30 text-error text-sm hover:bg-error/10 transition-colors"
                >
                  <Trash2 size={14} /> Borrar esta clase (suspendida)
                </button>
              )}

              <p className="text-xs text-muted">
                Esto solo afecta a <strong className="text-on-surface">esta clase</strong>. Para mover también las clases siguientes, o reacomodar todo el horario, entra a <strong className="text-on-surface">Modificar bloques</strong>.
              </p>

              <button
                type="button"
                onClick={() => setPendingMove(null)}
                className="w-full py-2 rounded-card border border-outline-variant text-muted text-sm hover:bg-surface transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )
      })()}
    </>
  )
}

// ─── Administrador de días de asueto ────────────────────────────────────────
// El docente elige una fecha y a qué afecta (clases, eventos, actividades). Un
// tipo marcado = ese tipo NO se permite ese día. "Todo" marca los tres.
function AsuetoManager({ asuetos, onAdd, onRemove, onClose }) {
  useScrollLock(true)
  const [fecha, setFecha] = useState('')
  const [alcance, setAlcance] = useState(alcanceCompleto)

  const lista = [...asuetos].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
  // Derivados de TIPOS_ASUETO y no escritos a mano: al agregar "Asistencias"
  // como cuarto tipo, "Todo" tenía que contarlo sin tocar tres condiciones.
  const algo = TIPOS_ASUETO.some(t => alcance[t.id])
  const todo = TIPOS_ASUETO.every(t => alcance[t.id])

  function toggle(id) { setAlcance(a => ({ ...a, [id]: !a[id] })) }
  function setTodo() { setAlcance(alcanceCompleto(!todo)) }
  function add() {
    if (!fecha || !algo) return
    onAdd(fecha, alcance)
    setFecha('')
    setAlcance(alcanceCompleto())
  }

  const fmt = s => { const d = new Date(s + 'T12:00:00'); return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}` }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 border-none cursor-default"
        onClick={onClose}
        aria-label="Cerrar"
      />
      <div className="relative bg-surface-card rounded-t-card md:rounded-card shadow-2xl w-full max-w-md max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-outline-variant flex-shrink-0">
          <div className="flex items-center gap-2">
            <CalendarOff size={18} className="text-amber-600" />
            <h2 className="font-semibold text-on-surface">Días de asueto</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-2 text-muted hover:text-error rounded"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          <p className="text-sm text-muted">
            Marca un día como asueto y elige a qué afecta. Lo marcado <strong>no se permitirá</strong> ese día:
            los bloques de clase se omiten al programar, no se podrán crear eventos ni actividades,
            y no se pasará lista. Puedes combinarlos: por ejemplo, suspender clases pero seguir pasando lista.
          </p>

          {/* Alta de asueto */}
          <div className="rounded-card border border-outline-variant p-3 space-y-3">
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-muted uppercase tracking-wide">Fecha</span>
              <EFDateTimePicker mode="date" value={fecha} onChange={setFecha} placeholder="Elige el día…" clearable showShortcuts={false} />
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-muted uppercase tracking-wide">¿A qué afecta?</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button" onClick={setTodo}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${todo ? 'bg-amber-500 text-white border-amber-500' : 'border-outline-variant text-muted hover:bg-amber-50'}`}
                >
                  Todo
                </button>
                {TIPOS_ASUETO.map(t => (
                  <button
                    key={t.id} type="button" onClick={() => toggle(t.id)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${alcance[t.id] ? 'bg-amber-100 text-amber-800 border-amber-300' : 'border-outline-variant text-muted hover:bg-surface'}`}
                  >
                    {alcance[t.id] ? '✓ ' : ''}{t.label}
                  </button>
                ))}
              </div>
              {!algo && <p className="text-xs text-error">Elige al menos un tipo.</p>}
            </div>
            <button
              type="button" onClick={add} disabled={!fecha || !algo}
              className="w-full py-2 bg-amber-600 text-white rounded text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2 hover:bg-amber-700 transition-colors"
            >
              <Plus size={15} /> Agregar día de asueto
            </button>
          </div>

          {/* Lista */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted uppercase tracking-wide">
              Días marcados ({lista.length})
            </span>
            {lista.length === 0 ? (
              <p className="text-sm text-muted py-2">Aún no has marcado ningún día de asueto.</p>
            ) : lista.map(a => (
              <div key={a.id} className="flex items-center gap-2 px-3 py-2 rounded-card border border-outline-variant bg-amber-50/50">
                <CalendarOff size={15} className="text-amber-600 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-on-surface">{fmt(a.fecha)}</p>
                  <p className="text-xs text-muted">Sin: {alcanceAsuetoTexto(a)}</p>
                </div>
                <button
                  type="button" onClick={() => onRemove(a.id)}
                  className="p-2 text-muted hover:text-error rounded transition-colors flex-shrink-0"
                  data-tooltip="Quitar" aria-label="Quitar"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-outline-variant px-4 py-3 flex justify-end flex-shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted rounded border border-outline-variant hover:bg-surface transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Administrador de vacaciones ────────────────────────────────────────────
// Igual que AsuetoManager, pero para un PERIODO (fechaInicio–fechaFin) en vez
// de un solo día. El docente elige el rango y a qué afecta (clases, eventos,
// actividades, asistencias) — el mismo alcance que en Días de asueto.
function VacacionManager({ vacaciones, onAdd, onRemove, onClose }) {
  useScrollLock(true)
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')
  const [alcance, setAlcance] = useState(alcanceCompleto)

  const lista = [...vacaciones].sort((a, b) => (a.fechaInicio || '').localeCompare(b.fechaInicio || ''))
  const algo = TIPOS_ASUETO.some(t => alcance[t.id])
  const todo = TIPOS_ASUETO.every(t => alcance[t.id])
  const rangoValido = !!(fechaInicio && fechaFin && fechaFin >= fechaInicio)

  function toggle(id) { setAlcance(a => ({ ...a, [id]: !a[id] })) }
  function setTodo() { setAlcance(alcanceCompleto(!todo)) }
  function add() {
    if (!rangoValido || !algo) return
    onAdd(fechaInicio, fechaFin, alcance)
    setFechaInicio('')
    setFechaFin('')
    setAlcance(alcanceCompleto())
  }

  const fmt = s => { const d = new Date(s + 'T12:00:00'); return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}` }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 border-none cursor-default"
        onClick={onClose}
        aria-label="Cerrar"
      />
      <div className="relative bg-surface-card rounded-t-card md:rounded-card shadow-2xl w-full max-w-md max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-outline-variant flex-shrink-0">
          <div className="flex items-center gap-2">
            <CalendarRange size={18} className="text-amber-600" />
            <h2 className="font-semibold text-on-surface">Vacaciones</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-2 text-muted hover:text-error rounded"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          <p className="text-sm text-muted">
            Marca un periodo de vacaciones y elige a qué afecta. Lo marcado <strong>no se permitirá</strong> ningún
            día del periodo: los bloques de clase se omiten al programar, y no se podrán crear eventos (ni
            actividades) en esos días.
          </p>

          {/* Alta de vacaciones */}
          <div className="rounded-card border border-outline-variant p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-muted uppercase tracking-wide">Inicio</span>
                <EFDateTimePicker mode="date" value={fechaInicio} onChange={setFechaInicio} placeholder="Inicio…" clearable showShortcuts={false} />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-muted uppercase tracking-wide">Fin</span>
                <EFDateTimePicker mode="date" value={fechaFin} onChange={setFechaFin} placeholder="Fin…" clearable showShortcuts={false} />
              </div>
            </div>
            {fechaInicio && fechaFin && fechaFin < fechaInicio && (
              <p className="text-xs text-error">La fecha de fin debe ser igual o posterior a la de inicio.</p>
            )}
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-muted uppercase tracking-wide">¿A qué afecta?</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button" onClick={setTodo}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${todo ? 'bg-amber-500 text-white border-amber-500' : 'border-outline-variant text-muted hover:bg-amber-50'}`}
                >
                  Todo
                </button>
                {TIPOS_ASUETO.map(t => (
                  <button
                    key={t.id} type="button" onClick={() => toggle(t.id)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${alcance[t.id] ? 'bg-amber-100 text-amber-800 border-amber-300' : 'border-outline-variant text-muted hover:bg-surface'}`}
                  >
                    {alcance[t.id] ? '✓ ' : ''}{t.label}
                  </button>
                ))}
              </div>
              {!algo && <p className="text-xs text-error">Elige al menos un tipo.</p>}
            </div>
            <button
              type="button" onClick={add} disabled={!rangoValido || !algo}
              className="w-full py-2 bg-amber-600 text-white rounded text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2 hover:bg-amber-700 transition-colors"
            >
              <Plus size={15} /> Agregar periodo de vacaciones
            </button>
          </div>

          {/* Lista */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted uppercase tracking-wide">
              Periodos marcados ({lista.length})
            </span>
            {lista.length === 0 ? (
              <p className="text-sm text-muted py-2">Aún no has marcado ningún periodo de vacaciones.</p>
            ) : lista.map(v => (
              <div key={v.id} className="flex items-center gap-2 px-3 py-2 rounded-card border border-outline-variant bg-amber-50/50">
                <CalendarRange size={15} className="text-amber-600 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-on-surface">{fmt(v.fechaInicio)} – {fmt(v.fechaFin)}</p>
                  <p className="text-xs text-muted">Sin: {alcanceAsuetoTexto(v)}</p>
                </div>
                <button
                  type="button" onClick={() => onRemove(v.id)}
                  className="p-2 text-muted hover:text-error rounded transition-colors flex-shrink-0"
                  data-tooltip="Quitar" aria-label="Quitar"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-outline-variant px-4 py-3 flex justify-end flex-shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted rounded border border-outline-variant hover:bg-surface transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
