import { useState, useEffect, useMemo, useRef } from 'react'
import { collection, query, where, getDocs, onSnapshot, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import EventEditor, { EVENT_COLORS } from '../../components/calendar/EventEditor'
import ProgramarBloquesModal from '../../components/calendar/ProgramarBloquesModal'
import BloqueEditor from '../../components/calendar/BloqueEditor'
import useAlarmas from '../../components/calendar/useAlarmas'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectColors } from '../../utils/subjectPalette'
import { bloqueColor, timeToMinutes, addMinutesToTime } from '../../utils/horarioBloques'
import {
  Clock, Eye, CalendarDays, ChevronLeft, ChevronRight, Plus,
  List, LayoutGrid, CalendarRange, CalendarPlus, AlertTriangle,
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

const DAY_START_HOUR = 7
const DAY_END_HOUR = 21
const ROW_H = 52 // px por hora en la vista semana
const HOURS_RANGE = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => i + DAY_START_HOUR)

// Asigna "carriles" a bloques que se solapan en un mismo día para mostrarlos
// lado a lado en vez de encimados.
function assignLanes(blocks) {
  const sorted = [...blocks].sort((a, b) =>
    timeToMinutes(a.horaInicio) - timeToMinutes(b.horaInicio))
  const lanesEnd = [] // minuto de fin de cada carril
  const placed = sorted.map(b => {
    const start = timeToMinutes(b.horaInicio)
    const end = timeToMinutes(b.horaFin)
    let lane = lanesEnd.findIndex(e => e <= start)
    if (lane === -1) { lane = lanesEnd.length; lanesEnd.push(end) }
    else lanesEnd[lane] = end
    return { b, lane, start, end }
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

function AgendaView({ events, onEventClick }) {
  const today = new Date()
  const todayStr = toDateStr(today)
  const endStr = toDateStr(addDays(today, 90))

  const filtered = events
    .filter(ev => ev.dateStr >= todayStr && ev.dateStr <= endStr)
    .sort((a, b) =>
      (a.dateStr + (a.timeStr || '00:00')).localeCompare(b.dateStr + (b.timeStr || '00:00'))
    )

  if (filtered.length === 0) {
    return (
      <div className="text-center py-16 text-muted">
        <CalendarDays size={40} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">No hay eventos en los próximos 90 días</p>
        <p className="text-xs mt-1 opacity-60">Las fechas límite y publicaciones de tus actividades aparecen aquí automáticamente</p>
      </div>
    )
  }

  const byDate = []
  let lastDate = null
  filtered.forEach(ev => {
    if (ev.dateStr !== lastDate) { byDate.push({ dateStr: ev.dateStr, evs: [] }); lastDate = ev.dateStr }
    byDate[byDate.length - 1].evs.push(ev)
  })

  function labelDate(str) {
    const d = new Date(str + 'T12:00:00')
    const day = d.getDate()
    const mes = MESES[d.getMonth()]
    const dSem = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.getDay()]
    if (str === todayStr) return `Hoy · ${dSem} ${day} de ${mes}`
    if (str === toDateStr(addDays(today, 1))) return `Mañana · ${dSem} ${day} de ${mes}`
    return `${dSem} ${day} de ${mes}`
  }

  return (
    <div className="divide-y divide-outline-variant">
      {byDate.map(({ dateStr, evs }) => (
        <div key={dateStr} className="flex gap-4 px-4 py-3 hover:bg-accent-tint transition-colors">
          <div className={`flex-shrink-0 w-36 pt-0.5 text-sm font-medium ${dateStr === todayStr ? 'text-accent' : 'text-muted'}`}>
            {labelDate(dateStr)}
          </div>
          <div className="flex-1 space-y-1 min-w-0">
            {evs.map(ev => (
              <div key={ev.id}>
                <EventPill ev={ev} onClick={onEventClick} />
                {ev.subtitulo && (
                  <p className="text-xs text-muted pl-2 truncate">{ev.subtitulo}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
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
      className="flex items-center gap-1 rounded w-full truncate px-1 py-0.5 text-xs hover:opacity-80 transition-opacity"
      style={{ background: pal.bg, color: pal.text }}
      data-tooltip={`${subjectDisplayName(subj)} · ${b.horaInicio}–${b.horaFin}${b.lugar ? ' · ' + b.lugar : ''}`}
    >
      <span className="truncate">{subjectDisplayName(subj)}</span>
      <span className="ml-auto flex-shrink-0 opacity-70 pl-1">{b.horaInicio}</span>
    </button>
  )
}

function MonthView({ year, month, events, bloques, subjects, onDateClick, onEventClick, onBlockClick }) {
  const cells = getMonthGrid(year, month)

  const bloquesByDate = useMemo(() => {
    const m = {}
    bloques.forEach(b => { (m[b.fecha] ||= []).push(b) })
    Object.values(m).forEach(list => list.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio)))
    return m
  }, [bloques])

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

          return (
            <div
              key={dateStr}
              onClick={() => onDateClick?.(cell)}
              className={`min-h-[92px] border-b border-r border-outline-variant p-1 cursor-pointer hover:bg-accent-tint transition-colors ${!isThisMonth ? 'opacity-35' : ''}`}
            >
              <div className={`w-6 h-6 flex items-center justify-center text-xs font-semibold mb-1 rounded-full mx-auto ${isToday(cell) ? 'bg-accent text-white' : 'text-on-surface'}`}>
                {cell.getDate()}
              </div>
              <div className="space-y-0.5">
                {items.slice(0, 3).map((it) => (
                  it.kind === 'bloque'
                    ? <BloquePill key={it.b.id} b={it.b} subj={subjects[it.b.asignaturaId]} onClick={onBlockClick} />
                    : <EventPill key={it.ev.id} ev={it.ev} compact onClick={onEventClick} />
                ))}
                {extra > 0 && (
                  <p className="text-xs text-muted pl-1">+{extra} más</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
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

function WeekView({ weekStart, events, bloques, subjects, onSlotClick, onBlockClick, onEventClick, onMoveBloque }) {
  const days = getWeekDays(weekStart)
  const todayStr = toDateStr(new Date())
  const gridH = HOURS_RANGE.length * ROW_H

  const colRefs = useRef([])
  const dragStartRef = useRef(null)
  const [drag, setDrag] = useState(null) // { bloque, x, y, grabDX, grabDY, w, h, moved }

  // Bloques agrupados por fecha.
  const byDate = useMemo(() => {
    const m = {}
    bloques.forEach(b => { (m[b.fecha] ||= []).push(b) })
    return m
  }, [bloques])

  function topPx(time) {
    return (timeToMinutes(time) - DAY_START_HOUR * 60) / 60 * ROW_H
  }

  function startDrag(e, b) {
    if (e.button != null && e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    setDrag({
      bloque: b,
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
      setDrag(d => {
        if (!d) return null
        if (!d.moved) {
          onBlockClick?.(d.bloque)
          return null
        }
        // Detecta la columna (día) bajo el cursor.
        const blockTop = e.clientY - d.grabDY
        let target = null
        colRefs.current.forEach((el, idx) => {
          if (!el) return
          const r = el.getBoundingClientRect()
          if (e.clientX >= r.left && e.clientX < r.right) target = { idx, top: r.top }
        })
        if (target) {
          let mins = Math.round(((blockTop - target.top) / ROW_H * 60 + DAY_START_HOUR * 60) / SNAP_MIN) * SNAP_MIN
          mins = Math.max(DAY_START_HOUR * 60, Math.min(DAY_END_HOUR * 60 - SNAP_MIN, mins))
          const nuevaFecha = toDateStr(days[target.idx])
          const nuevaHora = minutesToTimeStr(mins)
          if (nuevaFecha !== d.bloque.fecha || nuevaHora !== d.bloque.horaInicio) {
            onMoveBloque?.(d.bloque, nuevaFecha, nuevaHora)
          }
        }
        return null
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, days, onBlockClick, onMoveBloque])

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[620px]">
        {/* Day headers */}
        <div className="grid border-b border-outline-variant sticky top-0 bg-surface-card z-10" style={{ gridTemplateColumns: '3.5rem repeat(7, 1fr)' }}>
          <div className="py-2 px-2" />
          {days.map((d, i) => {
            const dStr = toDateStr(d)
            return (
              <div key={dStr} className="py-2 text-center text-xs border-l border-outline-variant">
                <span className="block uppercase text-muted">{DIAS_CORTO[i]}</span>
                <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-semibold mt-0.5 ${dStr === todayStr ? 'bg-accent text-white' : 'text-on-surface'}`}>
                  {d.getDate()}
                </span>
              </div>
            )
          })}
        </div>

        {/* Body: time gutter + day columns */}
        <div className="grid" style={{ gridTemplateColumns: '3.5rem repeat(7, 1fr)' }}>
          {/* Time gutter */}
          <div className="relative" style={{ height: gridH }}>
            {HOURS_RANGE.map((hour, i) => (
              <div key={hour} className="absolute left-0 right-0 px-2 text-xs text-muted" style={{ top: i * ROW_H }}>
                {hour}:00
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((d, di) => {
            const dStr = toDateStr(d)
            const dayOfWeek = (d.getDay() + 6) % 7
            const placed = assignLanes(byDate[dStr] || [])
            const dayEvs = events.filter(ev => ev.dateStr === dStr && ev.timeStr)
            return (
              <div
                key={dStr}
                ref={el => { colRefs.current[di] = el }}
                className="relative border-l border-outline-variant"
                style={{ height: gridH }}
              >
                {/* Hour gridlines / click targets */}
                {HOURS_RANGE.map((hour, i) => (
                  <div
                    key={hour}
                    onClick={() => onSlotClick?.(dayOfWeek, `${String(hour).padStart(2, '0')}:00`)}
                    className="absolute left-0 right-0 border-b border-outline-variant hover:bg-accent-tint transition-colors cursor-pointer"
                    style={{ top: i * ROW_H, height: ROW_H }}
                  />
                ))}

                {/* Bloques */}
                {placed.map(({ b, lane, total, start, end }) => {
                  const pal = bloqueColor(b.color)
                  const top = Math.max(0, topPx(b.horaInicio))
                  const height = Math.max(20, (end - start) / 60 * ROW_H - 2)
                  const w = 100 / total
                  const subj = subjects[b.asignaturaId]
                  const isDragging = drag?.moved && drag.bloque.id === b.id
                  return (
                    <div
                      key={b.id}
                      onPointerDown={e => { e.stopPropagation(); startDrag(e, b) }}
                      className="absolute rounded px-1.5 py-1 text-left overflow-hidden shadow-sm hover:brightness-95 transition-[filter] select-none cursor-grab active:cursor-grabbing"
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

                {/* Eventos con hora */}
                {dayEvs.map(ev => {
                  const top = Math.max(0, topPx(ev.timeStr))
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={e => { e.stopPropagation(); onEventClick?.(ev) }}
                      className="absolute right-0.5 rounded px-1 py-0.5 text-left overflow-hidden border border-white/40"
                      style={{ top, width: '46%', background: ev.bg, color: ev.text, zIndex: 5 }}
                      data-tooltip={ev.titulo}
                    >
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
        const pal = bloqueColor(drag.bloque.color)
        const subj = subjects[drag.bloque.asignaturaId]
        return (
          <div
            className="fixed z-50 rounded px-1.5 py-1 shadow-lg pointer-events-none opacity-90"
            style={{
              left: drag.x - drag.grabDX, top: drag.y - drag.grabDY,
              width: drag.w, height: drag.h,
              background: pal.bg, color: pal.text,
            }}
          >
            <span className="block text-xs font-semibold leading-tight truncate">{subjectDisplayName(subj)}</span>
            <span className="block text-[10px] opacity-80 leading-tight">{drag.bloque.horaInicio}–{drag.bloque.horaFin}</span>
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
  const [subjects, setSubjects] = useState({})
  const [activities, setActivities] = useState([])
  const [personalEvents, setPersonalEvents] = useState([])
  const [bloques, setBloques] = useState([])
  const [loading, setLoading] = useState(true)

  const [showEventEditor, setShowEventEditor] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  const [showProgramar, setShowProgramar] = useState(false)
  const [programarDefaults, setProgramarDefaults] = useState({ dia: 0, hora: '07:00' })
  const [editingBloque, setEditingBloque] = useState(null)

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

    return () => { unsubEv(); unsubH() }
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
        bg: colorDef.bg, text: colorDef.text,
        editable: true,
        rawEvent: e,
      })
    })

    return evs.filter(ev => ev.dateStr)
  }, [activities, personalEvents, subjects])

  const conflicts = useConflicts(events)

  // Alarmas de los bloques (suenan con la app abierta + notificación).
  useAlarmas(bloques, subjects)

  // ── Navigation ─────────────────────────────────────────────────────────
  function prev() {
    if (view === 'mes') setCurrentDate(d => addMonths(d, -1))
    else setCurrentDate(d => addWeeks(d, -1))
  }
  function next() {
    if (view === 'mes') setCurrentDate(d => addMonths(d, 1))
    else setCurrentDate(d => addWeeks(d, 1))
  }
  function goToday() { setCurrentDate(new Date()) }

  function navLabel() {
    if (view === 'mes') return `${MESES[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    const days = getWeekDays(currentDate)
    const first = days[0]; const last = days[6]
    if (first.getMonth() === last.getMonth()) {
      return `${first.getDate()}–${last.getDate()} ${MESES[first.getMonth()]} ${first.getFullYear()}`
    }
    return `${first.getDate()} ${MESES[first.getMonth()]} – ${last.getDate()} ${MESES[last.getMonth()]}`
  }

  // ── Event editor helpers ───────────────────────────────────────────────
  function openNewEvent(date) {
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
  function openProgramar(dia = 0, hora = '07:00') {
    setProgramarDefaults({ dia, hora })
    setShowProgramar(true)
  }
  function openProgramarFromDate(date) {
    openProgramar((date.getDay() + 6) % 7, '07:00')
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

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <TeacherLayout>
      <div className="max-w-5xl mx-auto px-4 py-4">

        {/* Top controls */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {/* Date navigator */}
          <div className="flex items-center gap-0.5 bg-surface-card border border-outline-variant rounded-card shadow-card px-1 py-1">
            <button type="button" onClick={prev} aria-label="Anterior" className="p-1.5 rounded hover:bg-accent-tint text-muted transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold text-on-surface px-3 min-w-[180px] text-center select-none">
              {navLabel()}
            </span>
            <button type="button" onClick={next} aria-label="Siguiente" className="p-1.5 rounded hover:bg-accent-tint text-muted transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>

          <button
            type="button"
            onClick={goToday}
            className="text-xs px-3 py-1.5 rounded border border-outline-variant text-muted hover:bg-accent-tint transition-colors"
          >
            Hoy
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

          {/* Actions */}
          <button
            type="button"
            onClick={() => openNewEvent(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-outline-variant text-sm text-muted hover:bg-accent-tint transition-colors"
          >
            <Plus size={15} /> Evento
          </button>
          <button
            type="button"
            onClick={() => openProgramar(0, '07:00')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-card bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
            data-tooltip="Programar bloques de clases por asignatura"
          >
            <CalendarPlus size={15} /> Crear bloques
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
            <AgendaView events={events} onEventClick={openEditEvent} />
          ) : view === 'mes' ? (
            <MonthView
              year={currentDate.getFullYear()}
              month={currentDate.getMonth()}
              events={events}
              bloques={bloques}
              subjects={subjects}
              onDateClick={openProgramarFromDate}
              onEventClick={openEditEvent}
              onBlockClick={setEditingBloque}
            />
          ) : (
            <WeekView
              weekStart={startOfWeekMon(currentDate)}
              events={events}
              bloques={bloques}
              subjects={subjects}
              onSlotClick={openProgramar}
              onBlockClick={setEditingBloque}
              onEventClick={openEditEvent}
              onMoveBloque={moveBloque}
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
      {showProgramar && (
        <ProgramarBloquesModal
          subjects={subjects}
          defaultDia={programarDefaults.dia}
          defaultHora={programarDefaults.hora}
          onClose={() => setShowProgramar(false)}
          onSaved={() => { /* onSnapshot mantiene bloques sincronizados */ }}
        />
      )}
      {editingBloque && (
        <BloqueEditor
          bloque={editingBloque}
          bloques={bloques}
          subjects={subjects}
          onClose={() => setEditingBloque(null)}
          onUpdated={() => { /* onSnapshot sincroniza */ }}
          onDeleted={() => { /* onSnapshot sincroniza */ }}
        />
      )}
    </TeacherLayout>
  )
}
