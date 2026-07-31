import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, getDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { ArrowLeft, ChevronLeft, ChevronRight, List, Columns3, CalendarRange, LayoutGrid, Plus } from 'lucide-react'
import { getEnrollments } from '../../utils/studentLookup'
import { isActivityPublished, estadoAgenda, withDefaultTime } from '../../utils/activityVisibility'
import { toDateStr } from '../../utils/horarioBloques'
import { MESES, DIAS_LARGO, addDays, addMonths, addWeeks, getWeekDays, isToday } from '../../utils/calendarGrid'
import { CATEGORIA_LABEL, deadlineEstado } from '../../utils/calendarEvents'
import { subjectColors } from '../../utils/subjectPalette'
import { subjectDisplayName } from '../../utils/subjectName'
import { AgendaView, WeekView, MonthView } from '../teacher/CalendarPage'
import { EVENT_COLORS } from '../../components/calendar/EventEditor'
import StudentEventEditor from '../../components/agenda/StudentEventEditor'
import StudentLayout from '../../components/StudentLayout'
import { useBackHandler } from '../../hooks/useBackHandler'
import { teacherDisplayName } from '../../utils/studentSearch'
import { STUDENT_CONTAINER_WIDE, TEACHER_CONTAINER } from '../../config/layout'
import { IS_NATIVE_APP } from '../../utils/platform'

// Rediseño: una sola pantalla "Agenda", misma filosofía/experiencia que el
// Calendario del docente (src/pages/teacher/CalendarPage.jsx) — Día/3 días/
// Semana/Mes reutilizando EXACTAMENTE los mismos componentes de vista
// (AgendaView/WeekView/MonthView, exportados desde ahí para esto). La
// diferencia es solo la información y los permisos: el alumno ve su propio
// horario (de sus docentes, no editable), sus actividades/exámenes con fecha
// límite, los eventos académicos publicados para sus materias, y puede
// crear/editar/borrar ÚNICAMENTE sus propios eventos personales
// (`studentEvents`) — los eventos personales del docente nunca se leen aquí.

const DEFAULT_DAY_START = 7
const DEFAULT_DAY_END = 21

const VIEWS = [
  { id: 'agenda', label: 'Día', Icon: List },
  { id: '3dias', label: '3 días', Icon: Columns3 },
  { id: 'semana', label: 'Semana', Icon: CalendarRange },
  { id: 'mes', label: 'Mes', Icon: LayoutGrid },
]

async function fetchActivitiesForSubjects(subjectIds) {
  if (subjectIds.length === 0) return []
  const chunks = []
  for (let i = 0; i < subjectIds.length; i += 30) chunks.push(subjectIds.slice(i, i + 30))
  const snaps = await Promise.all(
    chunks.map((ids) => getDocs(query(collection(db, 'activities'), where('asignaturaId', 'in', ids))))
  )
  return snaps.flatMap((s) => s.docs)
}

// Una consulta `==` por inscripción, en paralelo — NO `in` por lotes: la regla
// de lectura de submissions verifica la propiedad por alumnoId con un get() al
// doc de inscripción, y una disyunción `in` multiplica esos get()s más allá del
// límite por consulta de Firestore. (Mismo patrón que el Dashboard del alumno.)
async function fetchSubmissionsForStudents(studentDocIds) {
  const snaps = await Promise.all(
    studentDocIds.map((id) => getDocs(query(collection(db, 'submissions'), where('alumnoId', '==', id))))
  )
  return snaps.flatMap((s) => s.docs)
}

// horarioBloques/academicEvents no soportan `in` + filtro adicional sin un
// índice compuesto nuevo (ver CLAUDE.md) — se piden por asignaturaId `in`
// nada más, igual que ya hace este archivo con `activities`.
async function fetchByAsignaturaIn(coleccion, subjectIds) {
  if (subjectIds.length === 0) return []
  const chunks = []
  for (let i = 0; i < subjectIds.length; i += 30) chunks.push(subjectIds.slice(i, i + 30))
  const snaps = await Promise.all(
    chunks.map((ids) => getDocs(query(collection(db, coleccion), where('asignaturaId', 'in', ids))))
  )
  return snaps.flatMap((s) => s.docs)
}

export default function Agenda() {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [view, setView] = useState(() => {
    const raw = localStorage.getItem('alumno_cal_view')
    return VIEWS.some((v) => v.id === raw) ? raw : 'agenda'
  })
  const [currentDate, setCurrentDate] = useState(new Date())
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([]) // { id, activity, submission, subject, teacherName, estado, fecha (Date) }
  const [bloques, setBloques] = useState([])
  const [academicEvents, setAcademicEvents] = useState([])
  const [studentEvents, setStudentEvents] = useState([])
  const [subjectsById, setSubjectsById] = useState({})
  const [editingEvent, setEditingEvent] = useState(null) // null=cerrado, {}=nuevo, {...}=editar
  const [selectedDate, setSelectedDate] = useState(null)
  const goBack = () => navigate('/alumno/dashboard')
  useBackHandler(goBack)
  useBackHandler(closeEventEditor, !!editingEvent)

  function changeView(v) {
    setView(v)
    localStorage.setItem('alumno_cal_view', v)
  }

  async function loadData() {
    try {
      const enrollments = await getEnrollments(currentUser, userProfile)
      if (enrollments.length === 0) { setItems([]); setLoading(false); return }

      const docIdBySubject = {}
      enrollments.forEach((e) => { docIdBySubject[e.asignaturaId] = e.id })
      const subjectIds = [...new Set(enrollments.map((e) => e.asignaturaId).filter(Boolean))]

      const subjectSnaps = await Promise.all(subjectIds.map((id) => getDoc(doc(db, 'subjects', id))))
      const subjectById = {}
      subjectSnaps.forEach((s) => { if (s.exists()) subjectById[s.id] = { id: s.id, ...s.data() } })
      setSubjectsById(subjectById)

      // Una materia archivada nunca aparece en la Agenda — ciclo cerrado.
      const activeSubjectIds = subjectIds.filter((id) => subjectById[id] && !subjectById[id].archived)
      const activeDocIds = activeSubjectIds.map((id) => docIdBySubject[id])
      const teacherIds = [...new Set(activeSubjectIds.map((id) => subjectById[id].docenteId).filter(Boolean))]
      const [teacherSnaps, actDocs, subDocs, bloqueDocs, academicEventDocs, studentEventDocs] = await Promise.all([
        Promise.all(teacherIds.map((tid) => getDoc(doc(db, 'users', tid)))),
        fetchActivitiesForSubjects(activeSubjectIds),
        fetchSubmissionsForStudents(activeDocIds),
        fetchByAsignaturaIn('horarioBloques', activeSubjectIds),
        fetchByAsignaturaIn('academicEvents', activeSubjectIds),
        getDocs(query(collection(db, 'studentEvents'), where('alumnoId', '==', currentUser.uid))),
      ])
      const teacherName = {}
      teacherSnaps.forEach((t) => { if (t.exists()) { const d = t.data(); teacherName[t.id] = teacherDisplayName(d) } })

      setBloques(bloqueDocs.map((d) => ({ id: d.id, ...d.data() })))
      setAcademicEvents(academicEventDocs.map((d) => ({ id: d.id, ...d.data() })))
      setStudentEvents(studentEventDocs.docs.map((d) => ({ id: d.id, ...d.data() })))

      const submissionByActivity = {}
      subDocs.forEach((d) => { submissionByActivity[d.data().actividadId] = { id: d.id, ...d.data() } })

      const built = actDocs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => {
          const subj = subjectById[a.asignaturaId]
          if (!subj) return false
          if (subj.archived) return false
          const parcialesOcultos = subj.parcialesOcultos || []
          return isActivityPublished(a, parcialesOcultos.includes(a.parcial))
        })
        .map((a) => {
          const subj = subjectById[a.asignaturaId]
          const submission = submissionByActivity[a.id] || null
          // Prórroga individual de este alumno para esta actividad.
          const extendedDate = a.extensiones?.[docIdBySubject[a.asignaturaId]] || null
          const displayDeadline = extendedDate || a.fechaLimite
          const estado = estadoAgenda({ ...a, fechaLimite: displayDeadline }, submission)
          const fecha = !displayDeadline
            ? new Date()
            : new Date(displayDeadline.includes('T') ? displayDeadline : `${displayDeadline}T23:59:59`)
          return { id: a.id, activity: { ...a, fechaLimite: displayDeadline }, submission, subject: subj, teacherName: teacherName[subj.docenteId] || '', estado, fecha, extendedDate }
        })
        .filter((it) => it.estado)

      setItems(built)
    } catch (err) {
      toast('Error al cargar tu agenda: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect -- mount-only intencional
  useEffect(() => { if (currentUser) loadData() }, [currentUser])

  // Numeración "1.3." — misma regla que en la web del docente: posición entre
  // las hermanas del mismo parcial+asignatura, ordenadas por `orden`.
  const activityLabels = useMemo(() => {
    const labels = {}
    const groups = {}
    items.forEach((it) => { (groups[`${it.activity.asignaturaId}|${it.activity.parcial}`] ||= []).push(it.activity) })
    Object.values(groups).forEach((group) => {
      group.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      group.forEach((a, idx) => { labels[a.id] = `${a.parcial}.${idx + 1}.` })
    })
    return labels
  }, [items])

  // Mismo "shape" de evento que usa el Calendario del docente — así
  // AgendaView/WeekView/MonthView (reutilizados tal cual) los pintan sin
  // ningún cambio.
  const events = useMemo(() => {
    const evs = []

    items.forEach(({ activity: a, subject: subj }) => {
      if (!a.fechaLimite) return
      const pal = subjectColors(subj)
      const numero = activityLabels[a.id]
      const nombreConNumero = numero ? `${numero} ${a.nombre || 'Actividad'}` : (a.nombre || 'Actividad')
      const categoriaLabel = CATEGORIA_LABEL[a.categoria] || CATEGORIA_LABEL.entregable
      const cierraEnFecha = !a.recibirTarde
      // `fechaLimite` puede venir sin hora (fecha límite legada, 'YYYY-MM-DD')
      // — sin normalizar, `timeStr` queda vacío y WeekView (Semana/3 días, a
      // diferencia de AgendaView) NUNCA pinta eventos sin hora: la actividad
      // desaparecía por completo de esas dos vistas.
      const fechaLimiteConHora = withDefaultTime(a.fechaLimite, '23:59:59')
      evs.push({
        id: `dl-${a.id}`,
        activityId: a.id,
        titulo: cierraEnFecha ? `${nombreConNumero} (Cierre)` : nombreConNumero,
        subtitulo: `${subjectDisplayName(subj)} · Parcial ${a.parcial ?? '–'} · ${categoriaLabel}`,
        tipo: 'deadline',
        dateStr: fechaLimiteConHora.substring(0, 10),
        timeStr: fechaLimiteConHora.substring(11, 16),
        bg: pal.bg, text: pal.text,
        editable: false,
        cierraEnFecha,
        estado: deadlineEstado(a.fechaLimite),
      })
    })

    academicEvents.forEach((e) => {
      const subj = subjectsById[e.asignaturaId]
      const colorDef = EVENT_COLORS.find((c) => c.id === e.color) || EVENT_COLORS[0]
      evs.push({
        id: e.id,
        titulo: e.titulo || '',
        subtitulo: subj ? subjectDisplayName(subj) : (e.descripcion || ''),
        tipo: 'academico',
        dateStr: (e.inicio || '').substring(0, 10),
        timeStr: (e.inicio || '').substring(11, 16),
        endDateStr: (e.fin || '').substring(0, 10),
        endTimeStr: (e.fin || '').substring(11, 16),
        bg: colorDef.bg, text: colorDef.text,
        editable: false,
        descripcion: e.descripcion,
      })
    })

    studentEvents.forEach((e) => {
      const colorDef = EVENT_COLORS.find((c) => c.id === e.color) || EVENT_COLORS[0]
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

    return evs.filter((ev) => ev.dateStr)
  }, [items, academicEvents, studentEvents, subjectsById, activityLabels])

  // ── Navegación ────────────────────────────────────────────────────────
  function prev() {
    if (view === 'mes') setCurrentDate((d) => addMonths(d, -1))
    else if (view === 'semana') setCurrentDate((d) => addWeeks(d, -1))
    else if (view === '3dias') setCurrentDate((d) => addDays(d, -3))
    else setCurrentDate((d) => addDays(d, -1))
  }
  function next() {
    if (view === 'mes') setCurrentDate((d) => addMonths(d, 1))
    else if (view === 'semana') setCurrentDate((d) => addWeeks(d, 1))
    else if (view === '3dias') setCurrentDate((d) => addDays(d, 3))
    else setCurrentDate((d) => addDays(d, 1))
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
      if (first.getMonth() === last.getMonth()) return `${first.getDate()}–${last.getDate()} ${MESES[first.getMonth()]} ${first.getFullYear()}`
      return `${first.getDate()} ${MESES[first.getMonth()]} – ${last.getDate()} ${MESES[last.getMonth()]}`
    }
    const days = getWeekDays(currentDate)
    const first = days[0]; const last = days[6]
    if (first.getMonth() === last.getMonth()) return `${first.getDate()}–${last.getDate()} ${MESES[first.getMonth()]} ${first.getFullYear()}`
    return `${first.getDate()} ${MESES[first.getMonth()]} – ${last.getDate()} ${MESES[last.getMonth()]}`
  }

  // ── Eventos personales ───────────────────────────────────────────────
  function openNewEvent(dateStr, hora) {
    setEditingEvent({})
    setSelectedDate(dateStr ? `${dateStr}T${hora || '08:00'}` : '')
  }
  function openEvent(ev) {
    if (ev.activityId) { navigate(`/alumno/actividad/${ev.activityId}`); return }
    if (ev.tipo === 'academico') { toast(ev.descripcion || ev.titulo); return }
    if (!ev.editable) return
    setEditingEvent(ev.rawEvent)
    setSelectedDate(null)
  }
  function closeEventEditor() {
    setEditingEvent(null)
    setSelectedDate(null)
  }

  async function moveEvent(rawEvent, nuevaFecha, nuevaHora) {
    // Solo los eventos personales del alumno llegan aquí (son los únicos con
    // `editable: true`, la única condición que activa el arrastre en las
    // vistas reutilizadas del docente).
    const inicio = rawEvent.inicio || ''
    const fecha = nuevaFecha || inicio.substring(0, 10)
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
    setStudentEvents((prev) => prev.map((x) => (x.id === rawEvent.id ? { ...x, inicio: nuevoInicio, fin: nuevoFin } : x)))
    try {
      await updateDoc(doc(db, 'studentEvents', rawEvent.id), { inicio: nuevoInicio, fin: nuevoFin })
    } catch (err) {
      toast('No se pudo mover el evento: ' + err.message, 'error')
      loadData()
    }
  }

  const dayHours = { dayStart: DEFAULT_DAY_START, dayEnd: DEFAULT_DAY_END }

  // Ancho por vista — pedido explícito, valores fijos en px SOLO para Web
  // (la App se queda tal cual estaba, ver WEB_CONTAINER_BY_VIEW más abajo).
  const WEB_CONTAINER_BY_VIEW = {
    agenda: 'w-full max-w-[450px] mx-auto',
    '3dias': 'w-full max-w-[600px] mx-auto',
    semana: 'w-full max-w-[900px] mx-auto',
    mes: 'w-full max-w-[1024px] mx-auto',
  }
  // Anchos de la App — sin cambios respecto a la entrega anterior.
  const APP_CONTAINER_BY_VIEW = {
    agenda: STUDENT_CONTAINER_WIDE,
    '3dias': STUDENT_CONTAINER_WIDE,
    semana: TEACHER_CONTAINER,
    mes: STUDENT_CONTAINER_WIDE,
  }
  const CONTAINER_BY_VIEW = IS_NATIVE_APP ? APP_CONTAINER_BY_VIEW : WEB_CONTAINER_BY_VIEW
  // En la app, la vista Semana debe aprovechar todo el ancho de pantalla —
  // el padding horizontal de la página le resta espacio a una rejilla de 7
  // columnas que ya de por sí es angosta en un teléfono.
  const padClass = IS_NATIVE_APP && view === 'semana' ? 'px-1' : 'px-4'

  return (
    <StudentLayout>
    <div className="bg-surface flex flex-col min-h-full">
      <header className="bg-accent text-white px-4 py-3 shadow-lg sticky top-0 z-10 safe-top">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            className="md:hidden p-2 -ml-2 hover:bg-white/10 rounded flex-shrink-0 transition-colors"
            aria-label="Regresar"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-bold truncate flex-1">Agenda</h1>
          <button
            type="button"
            onClick={() => openNewEvent(toDateStr(currentDate))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-sm font-medium transition-colors flex-shrink-0"
          >
            <Plus size={15} /> Evento
          </button>
        </div>
        <div className="flex gap-1 mt-3 bg-white/10 p-1 rounded-full">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => changeView(v.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-sm font-semibold rounded-full transition-colors ${
                view === v.id ? 'bg-white text-accent' : 'text-white/80 hover:bg-white/10'
              }`}
            >
              <v.Icon size={15} /> {v.label}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
      ) : (
        <div className={`${padClass} py-4 flex-1 ${CONTAINER_BY_VIEW[view]}`}>
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={prev} aria-label="Anterior" className="p-1.5 text-muted hover:text-accent hover:bg-accent-tint rounded transition-colors">
              <ChevronLeft size={18} />
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-sm font-semibold text-on-surface truncate">{navLabel()}</p>
              <button type="button" onClick={goToday} className="text-xs font-medium text-accent border border-accent rounded-full px-2 py-0.5 flex-shrink-0 hover:bg-accent-tint transition-colors">
                Hoy
              </button>
            </div>
            <button type="button" onClick={next} aria-label="Siguiente" className="p-1.5 text-muted hover:text-accent hover:bg-accent-tint rounded transition-colors">
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="bg-surface-card rounded-card shadow-card border border-outline-variant overflow-hidden">
            {view === 'agenda' && (
              <AgendaView
                date={currentDate}
                events={events}
                bloques={bloques}
                subjects={subjectsById}
                dayStart={dayHours.dayStart}
                dayEnd={dayHours.dayEnd}
                onEventClick={openEvent}
                onMoveEvent={moveEvent}
                onSlotClick={openNewEvent}
                editableBloques={false}
              />
            )}
            {view === '3dias' && (
              <WeekView
                weekStart={currentDate}
                events={events}
                bloques={bloques}
                subjects={subjectsById}
                dayStart={dayHours.dayStart}
                dayEnd={dayHours.dayEnd}
                numDays={3}
                anchorToday
                onSlotClick={openNewEvent}
                onEventClick={openEvent}
                onMoveEvent={moveEvent}
                editable={false}
              />
            )}
            {view === 'semana' && (
              <WeekView
                weekStart={currentDate}
                events={events}
                bloques={bloques}
                subjects={subjectsById}
                dayStart={dayHours.dayStart}
                dayEnd={dayHours.dayEnd}
                onSlotClick={openNewEvent}
                onEventClick={openEvent}
                onMoveEvent={moveEvent}
                editable={false}
              />
            )}
            {view === 'mes' && (
              <MonthView
                year={currentDate.getFullYear()}
                month={currentDate.getMonth()}
                events={events}
                bloques={bloques}
                subjects={subjectsById}
                onDateClick={(d) => { setCurrentDate(d); changeView('agenda') }}
                onEventClick={openEvent}
                onMoveEvent={moveEvent}
                editable={false}
              />
            )}
          </div>
        </div>
      )}
    </div>

    {editingEvent && (
      <StudentEventEditor
        event={editingEvent.id ? editingEvent : null}
        defaultDate={selectedDate}
        onClose={closeEventEditor}
        onSaved={() => loadData()}
        onDeleted={() => loadData()}
      />
    )}
    </StudentLayout>
  )
}
