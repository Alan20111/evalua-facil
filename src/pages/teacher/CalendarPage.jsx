import { useState, useEffect, useMemo, useRef } from 'react'
import { collection, query, where, getDocs, onSnapshot, doc, updateDoc, writeBatch, serverTimestamp, addDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import EFDateTimePicker from '../../components/EFDateTimePicker'
import EventEditor, { EVENT_COLORS } from '../../components/calendar/EventEditor'
import ProgramarBloquesModal from '../../components/calendar/ProgramarBloquesModal'
import ProgramarZonaSemanal from '../../components/calendar/ProgramarZonaSemanal'
import useAlarmas from '../../components/calendar/useAlarmas'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectColors } from '../../utils/subjectPalette'
import { bloqueColor, timeToMinutes, addMinutesToTime, generarBloques } from '../../utils/horarioBloques'
import { buildAsuetoMap, esAsuetoPara, esAsuetoAlguno, alcanceAsuetoTexto, TIPOS_ASUETO } from '../../utils/asuetos'
import { TEACHER_CONTAINER } from '../../config/layout'
import {
  Clock, Eye, CalendarDays, ChevronLeft, ChevronRight, Plus,
  List, LayoutGrid, CalendarRange, CalendarPlus, AlertTriangle, Bell, CalendarClock,
  CalendarOff, Trash2, X, Minus,
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
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':')
  return `${parseInt(h)}:${m}`
}

const ROW_H = 52        // px por hora en la vista semana
const AGENDA_ROW_H = 64 // px por hora en la agenda del día
const DEFAULT_DAY_START = 7
const DEFAULT_DAY_END = 21
const DIAS_LARGO = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']

// Asigna "carriles" a items { start, end } (minutos desde medianoche) que se
// solapan en un mismo día, para mostrarlos lado a lado en vez de encimados.
function assignLanes(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start)
  const lanesEnd = [] // minuto de fin de cada carril
  const placed = sorted.map(it => {
    let lane = lanesEnd.findIndex(e => e <= it.start)
    if (lane === -1) { lane = lanesEnd.length; lanesEnd.push(it.end) }
    else lanesEnd[lane] = it.end
    return { it, lane }
  })
  const total = Math.max(1, lanesEnd.length)
  return placed.map(p => ({ ...p, total }))
}

// ─── Event pill component ──────────────────────────────────────────────────

function EventPill({ ev, compact, onClick }) {
  const Icon = ev.tipo === 'deadline' ? Clock : ev.tipo === 'publicacion' ? Eye : CalendarDays
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick?.(ev) }}
      className={`flex items-center gap-1 rounded text-left w-full truncate transition-opacity hover:opacity-80 ${compact ? 'px-1 py-0.5 text-xs' : 'px-2 py-1 text-xs'}`}
      style={{ background: ev.bg, color: ev.text }}
    >
      <Icon size={10} className="flex-shrink-0" />
      <span className="truncate">{ev.titulo}</span>
      {!compact && ev.timeStr && (
        <span className="ml-auto flex-shrink-0 opacity-70 pl-1">{fmtHour(ev.timeStr)}</span>
      )}
    </button>
  )
}

// ─── Agenda view ───────────────────────────────────────────────────────────

// Agenda del día: rejilla de horas (configurable) con las clases y eventos del
// día mostrado. Los items se pueden arrastrar verticalmente para cambiar de
// hora, o soltarse sobre los chips de días posteriores para moverlos de día.
function AgendaView({
  date, events, bloques, subjects, dayStart, dayEnd,
  onEventClick, onBlockClick, onMoveBloque, onMoveEvent, onSlotClick, asuetoMap = {},
}) {
  const dateStr = toDateStr(date)
  const asuetoDia = asuetoMap[dateStr]
  const hours = Array.from({ length: dayEnd - dayStart }, (_, i) => i + dayStart)
  const gridH = hours.length * AGENDA_ROW_H

  const gridRef = useRef(null)
  const chipRefs = useRef([])
  const dragStartRef = useRef(null)
  const [drag, setDrag] = useState(null)

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
      let end = start + 40 // duración visual mínima
      if (ev.endTimeStr && ev.endDateStr === ev.dateStr) {
        const e = timeToMinutes(ev.endTimeStr)
        if (e > start + 40) end = e
      }
      return { kind: 'event', id: ev.id, start, end, ev }
    }),
  ]
  const placed = assignLanes(items)

  // Días destino (posteriores) para soltar mientras se arrastra.
  const dayTargets = Array.from({ length: 7 }, (_, i) => addDays(date, i + 1))

  const isMovable = it => it.kind === 'bloque' || it.ev?.editable

  function startDrag(e, it) {
    if (e.button != null && e.button !== 0) return
    if (!isMovable(it)) return
    const rect = e.currentTarget.getBoundingClientRect()
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    setDrag({
      item: it,
      x: e.clientX, y: e.clientY,
      grabDX: e.clientX - rect.left, grabDY: e.clientY - rect.top,
      w: rect.width, h: rect.height,
      moved: false,
    })
  }

  useEffect(() => {
    if (!drag) return
    function onMove(e) {
      const s = dragStartRef.current
      const moved = s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 5
      setDrag(d => d && ({ ...d, x: e.clientX, y: e.clientY, moved: d.moved || moved }))
    }
    function onUp(e) {
      // Handlers del padre FUERA del updater de setDrag (evita setState en render).
      const d = drag
      setDrag(null)
      if (!d) return
      const { item } = d
      if (!d.moved) {
        // Clic en bloque de clase: no abre editor. Los eventos sí se editan.
        if (item.kind !== 'bloque') onEventClick?.(item.ev)
        return
      }
      // 1) ¿Soltó sobre un chip de día posterior?
      let chip = null
      chipRefs.current.forEach(c => {
        if (!c?.el) return
        const r = c.el.getBoundingClientRect()
        if (e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom) chip = c
      })
      if (chip) {
        if (item.kind === 'bloque') onMoveBloque?.(item.b, chip.dateStr, item.b.horaInicio)
        else onMoveEvent?.(item.ev.rawEvent, chip.dateStr, item.ev.timeStr)
        return
      }
      // 2) ¿Soltó sobre la rejilla? → nueva hora, mismo día.
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
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, dateStr, dayStart, dayEnd, onBlockClick, onEventClick, onMoveBloque, onMoveEvent])

  return (
    <div>
      {/* Aviso de día de asueto */}
      {asuetoDia && (
        <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800 flex items-center gap-2">
          <CalendarOff size={14} className="flex-shrink-0 text-amber-600" />
          Día de asueto — sin {alcanceAsuetoTexto(asuetoDia).toLowerCase()}.
        </div>
      )}

      {/* Chips de días posteriores, visibles mientras se arrastra */}
      {drag?.moved && (
        <div className="sticky top-0 z-20 flex items-center gap-1.5 flex-wrap px-3 py-2 bg-surface-card border-b border-outline-variant">
          <span className="text-xs text-muted mr-1">Soltar en:</span>
          {dayTargets.map((d, i) => {
            const dStr = toDateStr(d)
            const esManana = isToday(date) && i === 0
            return (
              <span
                key={dStr}
                ref={el => { chipRefs.current[i] = el ? { el, dateStr: dStr } : null }}
                className="px-2.5 py-1.5 rounded-full border border-accent/40 bg-accent-tint text-accent text-xs font-medium"
              >
                {esManana ? 'Mañana' : `${DIAS_CORTO[(d.getDay() + 6) % 7]} ${d.getDate()}`}
              </span>
            )
          })}
        </div>
      )}

      {/* Eventos sin hora */}
      {allDayEvs.length > 0 && (
        <div className="px-3 py-2 border-b border-outline-variant space-y-1">
          {allDayEvs.map(ev => (
            <div key={ev.id} data-tooltip={ev.editable ? 'Editar' : 'Se edita desde la actividad'}>
              <EventPill ev={ev} onClick={onEventClick} />
            </div>
          ))}
        </div>
      )}

      {/* Rejilla del día */}
      <div className="flex">
        {/* Gutter de horas */}
        <div className="relative w-14 flex-shrink-0" style={{ height: gridH }}>
          {hours.map((h, i) => (
            <div key={h} className="absolute right-2 text-xs text-muted" style={{ top: i * AGENDA_ROW_H + 2 }}>
              {h}:00
            </div>
          ))}
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
              aria-label={`Crear evento a las ${h}:00`}
            />
          ))}

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
                onClick={!movable ? e => { e.stopPropagation(); onEventClick?.(it.ev) } : undefined}
                className={`absolute rounded-card overflow-hidden shadow-sm ring-1 ring-black/5 select-none transition-[filter] hover:brightness-95 p-0 text-left block ${movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
                style={{
                  top, height,
                  left: `calc(${lane * w}% + 3px)`,
                  width: `calc(${w}% - 6px)`,
                  background: bg, color: fg,
                  opacity: isDragging ? 0.3 : 1,
                  touchAction: 'none',
                }}
                data-tooltip={movable ? 'Editar' : 'Se edita desde la actividad'}
              >
                <div className="flex h-full">
                  {/* Horas a la izquierda */}
                  <div className="w-14 flex-shrink-0 text-right pr-2 py-1.5 border-r" style={{ borderColor: `${fg}22` }}>
                    <span className="block text-xs font-bold leading-tight">{fmtHour(horaIni)}</span>
                    {horaFin && <span className="block text-[11px] opacity-70 leading-tight">{fmtHour(horaFin)}</span>}
                  </div>
                  {/* Evento y descripción a la derecha */}
                  <div className="flex-1 min-w-0 pl-2.5 py-1.5">
                    <span className="block text-sm font-semibold leading-tight truncate">{titulo}</span>
                    {sub && <span className="block text-xs opacity-75 leading-tight truncate">{sub}</span>}
                    {it.kind === 'bloque' && it.b.alarma?.activa && (
                      <span className="inline-flex items-center gap-1 text-[10px] opacity-70 leading-tight">
                        <Bell size={10} /> {it.b.alarma.minutosAntes} min antes
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
            <span className="block text-sm font-semibold leading-tight truncate">{titulo}</span>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Month view ────────────────────────────────────────────────────────────

function BloquePill({ b, subj, onClick }) {
  const pal = bloqueColor(b.color)
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick?.(b) }}
      className="flex items-center gap-1 rounded-md w-full truncate px-1 py-0.5 text-xs ring-1 ring-black/5 hover:opacity-80 transition-opacity"
      style={{ background: pal.bg, color: pal.text }}
      data-tooltip={`${subjectDisplayName(subj)} · ${b.horaInicio}–${b.horaFin}${b.lugar ? ' · ' + b.lugar : ''}`}
    >
      <span className="truncate">{subjectDisplayName(subj)}</span>
      <span className="ml-auto flex-shrink-0 opacity-70 pl-1">{b.horaInicio}</span>
    </button>
  )
}

function MonthView({ year, month, events, bloques, subjects, selectedDate, onDateClick, onEventClick, onBlockClick, onMoveEvent, onMoveBloque, asuetoMap = {} }) {
  const cells = getMonthGrid(year, month)
  const selStr = selectedDate ? toDateStr(selectedDate) : null

  const cellRefs = useRef({})
  const dragStartRef = useRef(null)
  const [drag, setDrag] = useState(null) // { kind, b?, ev?, x, y, w, moved }

  const bloquesByDate = useMemo(() => {
    const m = {}
    bloques.forEach(b => { (m[b.fecha] ||= []).push(b) })
    Object.values(m).forEach(list => list.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio)))
    return m
  }, [bloques])

  // Arrastrar una pastilla a otro día del mes: los eventos personales se
  // mueven directo (conservan su hora); los bloques de clase preguntan si el
  // cambio es solo para ese bloque o también para los siguientes.
  function startDrag(e, item) {
    if (e.button != null && e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    setDrag({ ...item, x: e.clientX, y: e.clientY, w: rect.width, moved: false })
  }

  useEffect(() => {
    if (!drag) return
    function onMove(e) {
      const s = dragStartRef.current
      const moved = s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 5
      setDrag(d => d && ({ ...d, x: e.clientX, y: e.clientY, moved: d.moved || moved }))
    }
    function onUp(e) {
      // Handlers del padre FUERA del updater de setDrag (evita setState en render).
      const d = drag
      setDrag(null)
      if (!d) return
      if (!d.moved) {
        // Clic en bloque de clase: no abre editor (solo se mueve arrastrando).
        if (d.kind !== 'bloque') onEventClick?.(d.ev)
        return
      }
      let target = null
      Object.entries(cellRefs.current).forEach(([dStr, el]) => {
        if (!el) return
        const r = el.getBoundingClientRect()
        if (e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom) target = dStr
      })
      if (!target) return
      if (d.kind === 'bloque') {
        if (target !== d.b.fecha) onMoveBloque?.(d.b, target, d.b.horaInicio)
      } else if (target !== d.ev.dateStr) {
        onMoveEvent?.(d.ev.rawEvent, target, d.ev.timeStr || null)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, onBlockClick, onEventClick, onMoveBloque, onMoveEvent])

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-outline-variant bg-surface">
        {DIAS_CORTO.map(d => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-muted uppercase tracking-wide">{d}</div>
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
              style={asueto ? { background: '#fffbeb' } : dateStr === selStr ? { background: 'color-mix(in srgb, var(--accent) 7%, transparent)' } : undefined}
            >
              <div className={`w-6 h-6 flex items-center justify-center text-xs font-semibold mb-1 rounded-full mx-auto ${
                isToday(cell) ? 'bg-accent text-white'
                  : dateStr === selStr ? 'ring-2 ring-accent text-accent'
                  : 'text-on-surface'
              }`}>
                {cell.getDate()}
              </div>
              {asueto && (
                <p className="text-[9px] font-semibold text-amber-600 uppercase text-center leading-none mb-1">Asueto</p>
              )}
              <div className="space-y-1">
                {items.slice(0, 3).map((it) => {
                  // Arrastrables: bloques (pregunta al soltar) y eventos
                  // personales (se mueven directo). Un clic sin mover, edita.
                  const movable = it.kind === 'bloque' || it.ev?.editable
                  const isDraggingThis = drag?.moved && (
                    (it.kind === 'bloque' && drag.kind === 'bloque' && drag.b?.id === it.b.id) ||
                    (it.kind === 'event' && drag.kind === 'event' && drag.ev?.id === it.ev.id)
                  )
                  const pill = it.kind === 'bloque'
                    ? <BloquePill b={it.b} subj={subjects[it.b.asignaturaId]} onClick={movable ? undefined : onBlockClick} />
                    : <EventPill ev={it.ev} compact onClick={movable ? undefined : onEventClick} />
                  return (
                    <div
                      key={it.kind === 'bloque' ? it.b.id : it.ev.id}
                      onPointerDown={movable ? e => { e.stopPropagation(); startDrag(e, it.kind === 'bloque' ? { kind: 'bloque', b: it.b } : { kind: 'event', ev: it.ev }) } : undefined}
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

      {/* Fantasma que sigue al cursor mientras se arrastra */}
      {drag?.moved && (() => {
        const esEvento = drag.kind === 'event'
        const pal = esEvento ? { bg: drag.ev.bg, text: drag.ev.text } : bloqueColor(drag.b.color)
        const titulo = esEvento ? drag.ev.titulo : subjectDisplayName(subjects[drag.b.asignaturaId])
        return (
          <div
            className="fixed z-50 rounded px-2 py-1 shadow-lg pointer-events-none opacity-90 text-xs font-semibold truncate"
            style={{ left: drag.x + 8, top: drag.y + 8, maxWidth: drag.w, background: pal.bg, color: pal.text }}
          >
            {titulo}
          </div>
        )
      })()}
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

function WeekView({ weekStart, events, bloques, subjects, dayStart, dayEnd, numDays = 7, selectedDate, onSlotClick, onBlockClick, onEventClick, onMoveBloque, onMoveEvent, asuetoMap = {} }) {
  const days = getWeekDays(weekStart).slice(0, numDays)
  const todayStr = toDateStr(new Date())
  const selStr = selectedDate ? toDateStr(selectedDate) : null
  const hoursRange = Array.from({ length: dayEnd - dayStart }, (_, i) => i + dayStart)
  const gridH = hoursRange.length * ROW_H
  const gridCols = `3.5rem repeat(${numDays}, 1fr)`

  const colRefs = useRef([])
  const dragStartRef = useRef(null)
  // { kind: 'bloque'|'event', bloque?, ev?, x, y, grabDX, grabDY, w, h, moved }
  const [drag, setDrag] = useState(null)

  // Bloques agrupados por fecha.
  const byDate = useMemo(() => {
    const m = {}
    bloques.forEach(b => { (m[b.fecha] ||= []).push(b) })
    return m
  }, [bloques])

  function topPx(time) {
    return (timeToMinutes(time) - dayStart * 60) / 60 * ROW_H
  }

  function startDrag(e, item) {
    if (e.button != null && e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    setDrag({
      ...item,
      x: e.clientX, y: e.clientY,
      grabDX: e.clientX - rect.left,
      grabDY: e.clientY - rect.top,
      w: rect.width, h: rect.height,
      moved: false,
    })
  }

  useEffect(() => {
    if (!drag) return
    function onMove(e) {
      const s = dragStartRef.current
      const moved = s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 5
      setDrag(d => d && ({ ...d, x: e.clientX, y: e.clientY, moved: d.moved || moved }))
    }
    function onUp(e) {
      // Los handlers del padre (onMove*/onEventClick) se llaman FUERA del
      // updater de setDrag: llamarlos dentro dispara "setState durante render".
      const d = drag
      setDrag(null)
      if (!d) return
      if (!d.moved) {
        // Clic en bloque de clase: no abre editor (solo se mueve arrastrando).
        if (d.kind === 'event') onEventClick?.(d.ev)
        return
      }
      // Detecta la columna (día) bajo el cursor.
      const blockTop = e.clientY - d.grabDY
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
      if (d.kind === 'event') {
        // Evento personal: se mueve directo, sin preguntar.
        if (nuevaFecha !== d.ev.dateStr || nuevaHora !== d.ev.timeStr) {
          onMoveEvent?.(d.ev.rawEvent, nuevaFecha, nuevaHora)
        }
      } else if (nuevaFecha !== d.bloque.fecha || nuevaHora !== d.bloque.horaInicio) {
        onMoveBloque?.(d.bloque, nuevaFecha, nuevaHora)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, days, dayStart, dayEnd, onBlockClick, onEventClick, onMoveBloque, onMoveEvent])

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[620px]">
        {/* Day headers */}
        <div className="grid border-b border-outline-variant sticky top-0 bg-surface-card z-10" style={{ gridTemplateColumns: gridCols }}>
          <div className="py-2 px-2" />
          {days.map((d, i) => {
            const dStr = toDateStr(d)
            const asueto = esAsuetoAlguno(asuetoMap, dStr)
            return (
              <div
                key={dStr}
                className="py-2 text-center text-xs border-l border-outline-variant"
                style={asueto ? { background: '#fffbeb' } : dStr === selStr ? { background: 'color-mix(in srgb, var(--accent) 7%, transparent)' } : undefined}
              >
                <span className="block uppercase text-muted">{DIAS_CORTO[i]}</span>
                <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-semibold mt-0.5 ${
                  dStr === todayStr ? 'bg-accent text-white'
                    : dStr === selStr ? 'ring-2 ring-accent text-accent'
                    : 'text-on-surface'
                }`}>
                  {d.getDate()}
                </span>
                {asueto && (
                  <span className="block text-[9px] font-semibold text-amber-600 uppercase leading-tight mt-0.5">Asueto</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Body: time gutter + day columns */}
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          {/* Time gutter */}
          <div className="relative" style={{ height: gridH }}>
            {hoursRange.map((hour, i) => (
              <div key={hour} className="absolute left-0 right-0 px-2 text-xs text-muted" style={{ top: i * ROW_H }}>
                {hour}:00
              </div>
            ))}
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
                    aria-label={`Crear evento a las ${hour}:00`}
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
                      onPointerDown={e => { e.stopPropagation(); startDrag(e, { kind: 'bloque', bloque: b }) }}
                      className="absolute rounded-lg px-1.5 py-1 text-left overflow-hidden shadow-sm ring-1 ring-black/5 hover:brightness-95 transition-[filter] select-none cursor-grab active:cursor-grabbing"
                      style={{
                        top, height,
                        left: `calc(${lane * w}% + 2px)`,
                        width: `calc(${w}% - 4px)`,
                        background: pal.bg, color: pal.text,
                        opacity: isDragging ? 0.3 : 1,
                        touchAction: 'none',
                      }}
                      data-tooltip={`${subjectDisplayName(subj)} · ${b.horaInicio}–${b.horaFin} · arrastra para mover`}
                    >
                      <span className="block text-xs font-semibold leading-tight truncate">{subjectDisplayName(subj)}</span>
                      <span className="block text-[10px] opacity-80 leading-tight">{b.horaInicio}–{b.horaFin}</span>
                      {b.lugar && <span className="block text-[10px] opacity-70 leading-tight truncate">{b.lugar}</span>}
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
                      className={`absolute right-0.5 rounded px-1 py-0.5 text-left overflow-hidden shadow-sm ring-1 ring-white/60 hover:brightness-95 transition-[filter] select-none ${ev.editable ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      style={{ top, width: '55%', minHeight: EV_H, background: ev.bg, color: ev.text, zIndex: 5, opacity: isDragging ? 0.3 : 1, touchAction: 'none' }}
                      data-tooltip={ev.editable ? `${ev.titulo} · ${fmtHour(ev.timeStr)} · arrastra para mover` : `${ev.titulo} · ${fmtHour(ev.timeStr)}`}
                    >
                      <span className="block text-[10px] font-bold leading-tight">{fmtHour(ev.timeStr)}</span>
                      <span className="block text-[10px] font-medium leading-tight truncate">{ev.titulo}</span>
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
            <span className="block text-xs font-semibold leading-tight truncate">{titulo}</span>
            <span className="block text-[10px] opacity-80 leading-tight">{horas}</span>
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
  { id: 'agenda', label: 'Agenda', Icon: List },
  { id: 'semana', label: 'Semana', Icon: CalendarRange },
  { id: 'mes',    label: 'Mes',    Icon: LayoutGrid },
]

export default function CalendarPage() {
  const { currentUser } = useAuth()
  const toast = useToast()

  const [view, setView] = useState(() => localStorage.getItem('cal_view') || 'agenda')
  const [currentDate, setCurrentDate] = useState(new Date())

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
  const [showEventEditor, setShowEventEditor] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  // Modal de configuración (paso 1): { mode, initial?, subjectName?, baseline?, baselinePatrones? }
  const [programar, setProgramar] = useState(null)
  // Zona semanal de colocación de bloques: { config, mode, initialPatrones, asignaturaId }
  const [zona, setZona] = useState(null)
  const [showModificarPicker, setShowModificarPicker] = useState(false)
  const [showAsuetos, setShowAsuetos] = useState(false)

  function changeView(v) {
    setView(v)
    localStorage.setItem('cal_view', v)
  }

  // ── Load data ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return
    let pending = 4
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
      snap => { setPersonalEvents(snap.docs.map(d => ({ id: d.id, ...d.data() }))); finish() },
      () => { toast('No se pudieron cargar tus eventos', 'error'); finish() }
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

    return () => { unsubEv(); unsubH(); unsubA() }
  }, [currentUser])

  // ── Aggregate events ───────────────────────────────────────────────────
  const events = useMemo(() => {
    const evs = []

    activities.forEach(a => {
      if (!a.fechaLimite && !a.publishAt) return
      const subj = subjects[a.asignaturaId]
      const pal = subjectColors(subj)
      const subjName = subjectDisplayName(subj)

      if (a.fechaLimite) {
        evs.push({
          id: `dl-${a.id}`,
          titulo: a.nombre || 'Actividad',
          subtitulo: subjName,
          tipo: 'deadline',
          dateStr: a.fechaLimite.substring(0, 10),
          timeStr: a.fechaLimite.substring(11, 16),
          bg: pal.bg, text: pal.text,
          editable: false,
        })
      }
      if (a.publishAt) {
        evs.push({
          id: `pub-${a.id}`,
          titulo: `↑ ${a.nombre || 'Actividad'}`,
          subtitulo: subjName,
          tipo: 'publicacion',
          dateStr: a.publishAt.substring(0, 10),
          timeStr: a.publishAt.substring(11, 16),
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
  }, [activities, personalEvents, subjects])

  const conflicts = useConflicts(events)

  // Índice de días de asueto por fecha (para marcar y bloquear por tipo).
  const asuetoMap = useMemo(() => buildAsuetoMap(asuetos), [asuetos])

  // Alarmas de los bloques (suenan con la app abierta + notificación).
  useAlarmas(bloques, subjects)

  // ── Navigation ─────────────────────────────────────────────────────────
  function prev() {
    if (view === 'mes') setCurrentDate(d => addMonths(d, -1))
    else if (view === 'semana') setCurrentDate(d => addWeeks(d, -1))
    else setCurrentDate(d => addDays(d, -1))
  }
  function next() {
    if (view === 'mes') setCurrentDate(d => addMonths(d, 1))
    else if (view === 'semana') setCurrentDate(d => addWeeks(d, 1))
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
    const days = getWeekDays(currentDate)
    const first = days[0]; const last = days[6]
    if (first.getMonth() === last.getMonth()) {
      return `${first.getDate()}–${last.getDate()} ${MESES[first.getMonth()]} ${first.getFullYear()}`
    }
    return `${first.getDate()} ${MESES[first.getMonth()]} – ${last.getDate()} ${MESES[last.getMonth()]}`
  }

  // ── Event editor helpers ───────────────────────────────────────────────
  // Bloquea la creación en un día marcado como asueto para eventos.
  function bloqueadoPorAsueto(fecha, tipo) {
    if (esAsuetoPara(asuetoMap, fecha, tipo)) {
      const d = new Date(fecha + 'T12:00:00')
      toast(`${d.getDate()}/${d.getMonth() + 1} es día de asueto (sin ${tipo}). Quítalo en "Días de asueto" para permitirlo.`, 'error')
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
      setZona({ config, mode: 'modificar', initialPatrones: patrones, asignaturaId: config.asignaturaId })
    } else {
      setZona({ config, mode: 'crear', initialPatrones: null, asignaturaId: config.asignaturaId })
    }
  }

  // Deriva la plantilla semanal (patrones) a partir de las instancias ya
  // materializadas de una asignatura: colapsa por (día, hora) tomando la
  // combinación más frecuente de lugar/color/alarma.
  function derivarPatrones(asignaturaId) {
    const propios = bloques.filter(b => b.asignaturaId === asignaturaId)
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
      .map(({ muestras, ...p }) => {
        const m = muestras[0]
        return {
          ...p,
          lugar: m.lugar || '',
          color: m.color || 'blue',
          alarma: m.alarma || { activa: false, sonido: 'campana', minutosAntes: 10 },
        }
      })
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
    const baseline = {
      asignaturaId,
      fechaInicio: fechas[0],
      fechaFin: fechas[fechas.length - 1],
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
    // Los días de asueto que bloquean CLASES se omiten al materializar.
    const diasAsueto = asuetos.filter(a => a.clases).map(a => a.fecha)
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
      // Salta a la fecha del primer bloque para que se vean de inmediato.
      const first = created.reduce((min, b) =>
        (b.fecha + b.horaInicio) < (min.fecha + min.horaInicio) ? b : min, created[0])
      if (first?.fecha) { setCurrentDate(new Date(first.fecha + 'T12:00:00')); changeView('semana') }
    } catch (err) {
      toast('Error al guardar: ' + err.message, 'error')
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
      await updateDoc(doc(db, 'events', rawEvent.id), { inicio: nuevoInicio, fin: nuevoFin })
    } catch (err) {
      toast('No se pudo mover el evento: ' + err.message, 'error')
    }
  }

  // Al soltar un bloque arrastrado NO se mueve de inmediato: se pide
  // confirmación y si el movimiento es solo de ese bloque o en cadena.
  function requestMoveBloque(b, nuevaFecha, nuevaHora) {
    if (nuevaFecha === b.fecha && nuevaHora === b.horaInicio) return
    if (bloqueadoPorAsueto(nuevaFecha, 'clases')) return
    setPendingMove({ bloque: b, fecha: nuevaFecha, hora: nuevaHora })
  }

  // En las vistas normales (Agenda/Semana/Mes) arrastrar mueve SOLO ese bloque
  // —útil para adelantar o recorrer una clase suelta—. Para mover ese bloque y
  // los siguientes hay que entrar a "Modificar bloques".
  async function confirmPendingMove() {
    const pm = pendingMove
    setPendingMove(null)
    if (!pm) return
    await moveBloque(pm.bloque, pm.fecha, pm.hora)
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

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <TeacherLayout>
      <div className={`px-4 py-4 ${TEACHER_CONTAINER}`}>

        {/* Top controls */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {/* Date navigator */}
          <div className="relative flex items-center gap-0.5 bg-surface-card border border-outline-variant rounded-card shadow-card px-1 py-1">
            <button type="button" onClick={prev} aria-label="Anterior" className="p-1.5 rounded hover:bg-accent-tint text-muted transition-colors">
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
            <button type="button" onClick={next} aria-label="Siguiente" className="p-1.5 rounded hover:bg-accent-tint text-muted transition-colors">
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
                    <button type="button" onClick={() => setPickerMonth(m => addMonths(m, -1))} className="p-1 rounded hover:bg-accent-tint text-muted">
                      <ChevronLeft size={15} />
                    </button>
                    <span className="text-sm font-semibold text-on-surface">
                      {MESES[pickerMonth.getMonth()]} {pickerMonth.getFullYear()}
                    </span>
                    <button type="button" onClick={() => setPickerMonth(m => addMonths(m, 1))} className="p-1 rounded hover:bg-accent-tint text-muted">
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

          <button
            type="button"
            onClick={goToday}
            className="text-xs px-3 py-1.5 rounded border border-outline-variant text-muted hover:bg-accent-tint transition-colors"
          >
            Hoy
          </button>

          {/* Nuevo evento — al lado de Hoy */}
          <button
            type="button"
            onClick={() => openNewEvent(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-outline-variant text-sm text-muted hover:bg-accent-tint transition-colors"
          >
            <Plus size={15} /> Evento
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* View switcher */}
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

          {/* Rango de horas del día */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowHoras(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-outline-variant text-sm text-muted hover:bg-accent-tint transition-colors"
              data-tooltip="Horas visibles de tu día (Agenda y Semana)"
              data-tooltip-pos="bottom"
            >
              <Clock size={14} /> {dayStart}:00–{dayEnd}:00
            </button>
            {showHoras && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-20 bg-transparent border-none cursor-default"
                  onClick={() => setShowHoras(false)}
                  aria-label="Cerrar selector de horas"
                />
                <div className="absolute right-0 top-10 z-30 bg-surface-card border border-outline-variant rounded-card shadow-lg p-3 w-64 space-y-2">
                  <p className="text-xs font-semibold text-muted uppercase tracking-wide">Horas del día en tu agenda</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted w-10">Desde</span>
                    <select
                      value={dayStart}
                      onChange={e => changeDayStart(Number(e.target.value))}
                      className="flex-1 px-2 py-1.5 rounded border border-outline-variant bg-surface text-sm"
                    >
                      {Array.from({ length: 23 }, (_, h) => h).map(h => (
                        <option key={h} value={h}>{h}:00</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted w-10">Hasta</span>
                    <select
                      value={dayEnd}
                      onChange={e => changeDayEnd(Number(e.target.value))}
                      className="flex-1 px-2 py-1.5 rounded border border-outline-variant bg-surface text-sm"
                    >
                      {Array.from({ length: 24 }, (_, h) => h + 1).filter(h => h > dayStart).map(h => (
                        <option key={h} value={h}>{h}:00</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs font-semibold text-muted uppercase tracking-wide pt-1">Días de tu semana</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted w-10">Días</span>
                    <select
                      value={numDays}
                      onChange={e => changeNumDays(Number(e.target.value))}
                      className="flex-1 px-2 py-1.5 rounded border border-outline-variant bg-surface text-sm"
                    >
                      <option value={5}>Lunes a Viernes</option>
                      <option value={6}>Lunes a Sábado</option>
                      <option value={7}>Lunes a Domingo</option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>
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

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => setShowModificarPicker(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-outline-variant text-sm text-muted hover:bg-accent-tint transition-colors"
            data-tooltip="Modificar bloques de clase por asignatura"
            data-tooltip-pos="bottom"
          >
            <CalendarClock size={15} /> Modificar bloques
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

        {/* Calendar body */}
        <div className="bg-surface-card border border-outline-variant rounded-card shadow-card overflow-hidden">
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
              onEventClick={openEditEvent}              onMoveBloque={requestMoveBloque}
              onMoveEvent={moveEvent}
              onSlotClick={openNewEventAt}
              asuetoMap={asuetoMap}
            />
          ) : view === 'mes' ? (
            <MonthView
              year={currentDate.getFullYear()}
              month={currentDate.getMonth()}
              events={events}
              bloques={bloques}
              subjects={subjects}
              selectedDate={currentDate}
              onDateClick={openNewEvent}
              onEventClick={openEditEvent}              onMoveEvent={moveEvent}
              onMoveBloque={requestMoveBloque}
              asuetoMap={asuetoMap}
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
              onSlotClick={openNewEventAt}              onEventClick={openEditEvent}
              onMoveBloque={requestMoveBloque}
              onMoveEvent={moveEvent}
              asuetoMap={asuetoMap}
            />
          )}
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted px-1">
          <span className="flex items-center gap-1"><CalendarPlus size={12} /> Bloques de clase (Semana/Mes)</span>
          <span className="flex items-center gap-1"><Clock size={12} /> Fecha límite (de actividades)</span>
          <span className="flex items-center gap-1"><Eye size={12} /> Publicación programada</span>
          <span className="flex items-center gap-1"><CalendarDays size={12} /> Evento personal</span>
        </div>
      </div>

      {/* Modals */}
      {showEventEditor && (
        <EventEditor
          event={editingEvent}
          defaultDate={selectedDate}
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
        />
      )}

      {zona && (
        <ProgramarZonaSemanal
          config={zona.config}
          mode={zona.mode}
          initialPatrones={zona.initialPatrones}
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
          <div className="relative bg-surface-card rounded-t-card md:rounded-card shadow-2xl w-full max-w-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarClock size={18} className="text-accent" />
                <h2 className="font-semibold text-on-surface">Modificar bloques por asignatura</h2>
              </div>
              <button type="button" onClick={() => setShowModificarPicker(false)} aria-label="Cerrar" className="p-1 text-muted hover:text-error rounded"><Plus size={18} className="rotate-45" /></button>
            </div>
            {subjectsConBloques.length === 0 ? (
              <p className="text-sm text-muted py-4 text-center">
                Todavía no has programado bloques de ninguna asignatura. Usa <strong>Programar bloques</strong> para empezar.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
                <p className="text-xs text-muted">Elige la asignatura cuyos bloques quieres reacomodar:</p>
                {subjectsConBloques.map(s => {
                  const n = bloques.filter(b => b.asignaturaId === s.id).length
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => openModificar(s.id)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-card border border-outline-variant hover:bg-accent-tint hover:border-accent transition-colors text-left"
                    >
                      <span className="text-sm font-medium text-on-surface truncate">{subjectDisplayName(s)}</span>
                      <span className="text-xs text-muted flex-shrink-0">{n} bloque(s)</span>
                    </button>
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

      {/* Confirmación al mover un bloque arrastrado — solo ESTE bloque.
          El docente ajusta el día y la HORA EXACTA antes de confirmar, para que
          no quede en la hora "aproximada" a la que cayó el arrastre. */}
      {pendingMove && (() => {
        const { bloque: b, fecha, hora } = pendingMove
        const subj = subjects[b.asignaturaId]
        const durMin = Math.max(5, timeToMinutes(b.horaFin) - timeToMinutes(b.horaInicio))
        const fmtF = s => {
          const d = new Date(s + 'T12:00:00')
          return `${DIAS_LARGO[(d.getDay() + 6) % 7]} ${d.getDate()} de ${MESES[d.getMonth()]}`
        }
        const stepHora = (delta) => setPendingMove(pm => ({ ...pm, hora: addMinutesToTime(pm.hora, delta) }))
        const inputCls = 'px-2.5 py-1.5 rounded border border-outline-variant text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-accent'
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-black/40 border-none cursor-default"
              onClick={() => setPendingMove(null)}
              aria-label="Cerrar"
            />
            <div className="relative bg-surface-card rounded-card shadow-2xl w-full max-w-sm p-4 space-y-3">
              <h2 className="font-semibold text-on-surface">¿Mover solo este bloque?</h2>
              <div className="text-sm text-on-surface space-y-1 bg-surface rounded-card border border-outline-variant p-3">
                <p className="font-medium">{subjectDisplayName(subj) || 'Clase'}</p>
                <p className="text-muted text-xs">De: {fmtF(b.fecha)} · {fmtHour(b.horaInicio)}</p>
              </div>

              {/* Destino editable: día + hora exacta */}
              <div className="space-y-2">
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-muted uppercase tracking-wide">Día</span>
                  <EFDateTimePicker
                    mode="date" value={fecha}
                    onChange={v => v && setPendingMove(pm => ({ ...pm, fecha: v }))}
                    clearable={false} showShortcuts={false}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-muted uppercase tracking-wide">Hora exacta de inicio</span>
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
                  <p className="text-xs text-muted">Termina a las <strong className="text-on-surface">{addMinutesToTime(hora, durMin)}</strong></p>
                </div>
              </div>

              <p className="text-xs text-muted flex items-start gap-1.5">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5 text-amber-500" />
                Solo se mueve este bloque (p. ej. para adelantar una clase). Para mover
                este y los siguientes, o reacomodar todo el horario, usa <strong className="text-on-surface">Modificar bloques</strong>.
              </p>
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => confirmPendingMove()}
                  className="w-full py-2 bg-accent text-white rounded-card text-sm font-semibold hover:bg-accent-hover transition-colors"
                >
                  Mover a {fmtF(fecha)} · {fmtHour(hora)}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingMove(null)}
                  className="w-full py-2 rounded-card border border-outline-variant text-muted text-sm hover:bg-surface transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </TeacherLayout>
  )
}

// ─── Administrador de días de asueto ────────────────────────────────────────
// El docente elige una fecha y a qué afecta (clases, eventos, actividades). Un
// tipo marcado = ese tipo NO se permite ese día. "Todo" marca los tres.
function AsuetoManager({ asuetos, onAdd, onRemove, onClose }) {
  const [fecha, setFecha] = useState('')
  const [alcance, setAlcance] = useState({ clases: true, eventos: true, actividades: true })

  const lista = [...asuetos].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
  const algo = alcance.clases || alcance.eventos || alcance.actividades
  const todo = alcance.clases && alcance.eventos && alcance.actividades

  function toggle(id) { setAlcance(a => ({ ...a, [id]: !a[id] })) }
  function setTodo() { const v = !todo; setAlcance({ clases: v, eventos: v, actividades: v }) }
  function add() {
    if (!fecha || !algo) return
    onAdd(fecha, alcance)
    setFecha('')
    setAlcance({ clases: true, eventos: true, actividades: true })
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
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1 text-muted hover:text-error rounded"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          <p className="text-sm text-muted">
            Marca un día como asueto y elige a qué afecta. Lo marcado <strong>no se permitirá</strong> ese día:
            los bloques de clase se omiten al programar, y no se podrán crear eventos (ni actividades) en él.
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
                  className="p-1.5 text-muted hover:text-error rounded transition-colors flex-shrink-0"
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
