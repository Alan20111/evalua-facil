import { useState, useEffect, useMemo } from 'react'
import { collection, query, where, getDocs, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import EventEditor, { EVENT_COLORS } from '../../components/calendar/EventEditor'
import HorarioEditor from '../../components/calendar/HorarioEditor'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectColors } from '../../utils/subjectPalette'
import {
  Clock, Eye, CalendarDays, ChevronLeft, ChevronRight, Plus,
  List, LayoutGrid, CalendarRange, BookOpen, AlertTriangle,
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

const HOURS_RANGE = Array.from({ length: 14 }, (_, i) => i + 7) // 7–20

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

function MonthView({ year, month, events, onDateClick, onEventClick }) {
  const cells = getMonthGrid(year, month)
  const todayStr = toDateStr(new Date())

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-outline-variant bg-surface">
        {DIAS_CORTO.map(d => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-muted uppercase tracking-wide">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell, i) => {
          const isThisMonth = cell.getMonth() === month
          const dateStr = toDateStr(cell)
          const dayEvs = events
            .filter(ev => ev.dateStr === dateStr)
            .sort((a, b) => (a.timeStr || '').localeCompare(b.timeStr || ''))
          const extra = dayEvs.length > 3 ? dayEvs.length - 3 : 0

          return (
            <div
              key={dateStr}
              onClick={() => onDateClick?.(cell)}
              className={`min-h-[88px] border-b border-r border-outline-variant p-1 cursor-pointer hover:bg-accent-tint transition-colors ${!isThisMonth ? 'opacity-35' : ''}`}
            >
              <div className={`w-6 h-6 flex items-center justify-center text-xs font-semibold mb-1 rounded-full mx-auto ${isToday(cell) ? 'bg-accent text-white' : 'text-on-surface'}`}>
                {cell.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayEvs.slice(0, 3).map(ev => (
                  <EventPill key={ev.id} ev={ev} compact onClick={onEventClick} />
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

function WeekView({ weekStart, events, horario, subjects }) {
  const days = getWeekDays(weekStart)
  const todayStr = toDateStr(new Date())

  function horarioForDayHour(dayOfWeek, hour) {
    return horario.filter(h => {
      if (h.diaSemana !== dayOfWeek) return false
      const hStart = parseInt(h.horaInicio.split(':')[0])
      const hEnd = parseInt(h.horaFin.split(':')[0])
      return hour >= hStart && hour < hEnd
    })
  }

  function eventsForDayHour(dateStr, hour) {
    return events.filter(ev => {
      if (ev.dateStr !== dateStr) return false
      if (!ev.timeStr) return hour === 8
      const h = parseInt(ev.timeStr.split(':')[0])
      return h === hour
    })
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        {/* Day headers */}
        <div className="grid grid-cols-8 border-b border-outline-variant sticky top-0 bg-surface-card z-10">
          <div className="py-2 px-2 w-14" />
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
        {/* Time rows */}
        {HOURS_RANGE.map(hour => (
          <div key={hour} className="grid grid-cols-8 border-b border-outline-variant" style={{ minHeight: '52px' }}>
            <div className="px-2 py-1 text-xs text-muted w-14 flex items-start pt-1 flex-shrink-0">
              {hour}:00
            </div>
            {days.map((d, i) => {
              const dStr = toDateStr(d)
              const dayOfWeek = (d.getDay() + 6) % 7 // 0=Mon
              const horBlocks = horarioForDayHour(dayOfWeek, hour)
              const dayEvs = eventsForDayHour(dStr, hour)
              const isFirstHorHour = (b) => parseInt(b.horaInicio.split(':')[0]) === hour

              return (
                <div key={dStr} className="border-l border-outline-variant p-0.5 space-y-0.5 min-h-[52px]">
                  {horBlocks.filter(isFirstHorHour).map(b => {
                    const subj = subjects[b.asignaturaId]
                    const pal = subjectColors(subj)
                    const startH = parseInt(b.horaInicio.split(':')[0])
                    const endH = parseInt(b.horaFin.split(':')[0])
                    const span = Math.max(1, endH - startH)
                    return (
                      <div
                        key={b.id}
                        className="rounded px-1 py-0.5 text-xs font-medium"
                        style={{ background: pal.bg, color: pal.text, minHeight: `${span * 52 - 4}px` }}
                      >
                        <span className="truncate block">{subjectDisplayName(subj)}</span>
                        {b.aula && <span className="opacity-60 block text-xs">{b.aula}</span>}
                        <span className="opacity-50 block text-xs">{b.horaInicio}–{b.horaFin}</span>
                      </div>
                    )
                  })}
                  {dayEvs.map(ev => <EventPill key={ev.id} ev={ev} compact />)}
                </div>
              )
            })}
          </div>
        ))}
      </div>
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
  { id: 'mes',    label: 'Mes',    Icon: LayoutGrid },
  { id: 'semana', label: 'Semana', Icon: CalendarRange },
]

export default function CalendarPage() {
  const { currentUser } = useAuth()

  const [view, setView] = useState(() => localStorage.getItem('cal_view') || 'agenda')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [subjects, setSubjects] = useState({})
  const [activities, setActivities] = useState([])
  const [personalEvents, setPersonalEvents] = useState([])
  const [horario, setHorario] = useState([])
  const [loading, setLoading] = useState(true)

  const [showEventEditor, setShowEventEditor] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  const [showHorario, setShowHorario] = useState(false)

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
      }).catch(() => {}).finally(finish)

    getDocs(query(collection(db, 'activities'), where('docenteId', '==', currentUser.uid)))
      .then(snap => setActivities(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {}).finally(finish)

    const unsubEv = onSnapshot(
      query(collection(db, 'events'), where('docenteId', '==', currentUser.uid)),
      snap => { setPersonalEvents(snap.docs.map(d => ({ id: d.id, ...d.data() }))); finish() },
      () => finish()
    )
    const unsubH = onSnapshot(
      query(collection(db, 'horario'), where('docenteId', '==', currentUser.uid)),
      snap => { setHorario(snap.docs.map(d => ({ id: d.id, ...d.data() }))); finish() },
      () => finish()
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

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <TeacherLayout>
      <div className="max-w-5xl mx-auto px-4 py-4">

        {/* Top controls */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {/* Date navigator */}
          <div className="flex items-center gap-0.5 bg-surface-card border border-outline-variant rounded-card shadow-card px-1 py-1">
            <button type="button" onClick={prev} className="p-1.5 rounded hover:bg-accent-tint text-muted transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold text-on-surface px-3 min-w-[180px] text-center select-none">
              {navLabel()}
            </span>
            <button type="button" onClick={next} className="p-1.5 rounded hover:bg-accent-tint text-muted transition-colors">
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
            onClick={() => setShowHorario(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-outline-variant text-sm text-muted hover:bg-accent-tint transition-colors"
            data-tooltip="Configurar horario de clases"
          >
            <BookOpen size={15} /> Mi Horario
          </button>
          <button
            type="button"
            onClick={() => openNewEvent(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-card bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            <Plus size={15} /> Evento
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
              onDateClick={openNewEvent}
              onEventClick={openEditEvent}
            />
          ) : (
            <WeekView
              weekStart={startOfWeekMon(currentDate)}
              events={events}
              horario={horario}
              subjects={subjects}
            />
          )}
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted px-1">
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
      {showHorario && (
        <HorarioEditor
          horario={horario}
          subjects={subjects}
          onClose={() => setShowHorario(false)}
          onSaved={block => setHorario(prev =>
            prev.some(h => h.id === block.id) ? prev : [...prev, block]
          )}
          onDeleted={id => setHorario(prev => prev.filter(h => h.id !== id))}
        />
      )}
    </TeacherLayout>
  )
}
