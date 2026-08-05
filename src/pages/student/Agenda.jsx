import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, getDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { ArrowLeft, ChevronLeft, ChevronRight, List, Columns3, CalendarRange, LayoutGrid, Plus, Clock } from 'lucide-react'
import { formatHora12 } from '../../utils/formatHora'
import MiniSelect from '../../components/calendar/MiniSelect'
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

  // Rango de horas y días visibles del día — igual que el docente, mismo
  // patrón de guardado en localStorage (Number(null) === 0, por eso hay
  // que distinguir "sin guardar" de un 0 guardado explícitamente).
  const [dayStart, setDayStart] = useState(() => {
    const raw = localStorage.getItem('alumno_cal_dia_ini')
    const v = raw == null || raw === '' ? NaN : Number(raw)
    return Number.isInteger(v) && v >= 0 && v <= 22 ? v : DEFAULT_DAY_START
  })
  const [dayEnd, setDayEnd] = useState(() => {
    const raw = localStorage.getItem('alumno_cal_dia_fin')
    const v = raw == null || raw === '' ? NaN : Number(raw)
    return Number.isInteger(v) && v >= 1 && v <= 24 ? v : DEFAULT_DAY_END
  })
  const [showHoras, setShowHoras] = useState(false)
  function changeDayStart(v) {
    setDayStart(v)
    localStorage.setItem('alumno_cal_dia_ini', String(v))
    if (v >= dayEnd) { setDayEnd(v + 1); localStorage.setItem('alumno_cal_dia_fin', String(v + 1)) }
  }
  function changeDayEnd(v) {
    setDayEnd(v)
    localStorage.setItem('alumno_cal_dia_fin', String(v))
  }
  // Días visibles de la semana (5 = L-V, 6 = L-S, 7 = L-D).
  const [numDays, setNumDays] = useState(() => {
    const raw = localStorage.getItem('alumno_cal_dias_sem')
    const v = raw == null ? NaN : Number(raw)
    return [5, 6, 7].includes(v) ? v : 7
  })
  function changeNumDays(v) {
    setNumDays(v)
    localStorage.setItem('alumno_cal_dias_sem', String(v))
  }

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

    items.forEach(({ activity: a, subject: subj, fecha }) => {
      const pal = subjectColors(subj)
      const numero = activityLabels[a.id]
      const nombreConNumero = numero ? `${numero} ${a.nombre || 'Actividad'}` : (a.nombre || 'Actividad')
      const categoriaLabel = CATEGORIA_LABEL[a.categoria] || CATEGORIA_LABEL.entregable
      const cierraEnFecha = !a.recibirTarde
      // `fechaLimite` puede venir sin hora (fecha límite legada, 'YYYY-MM-DD')
      // — sin normalizar, `timeStr` queda vacío y WeekView (Semana/3 días, a
      // diferencia de AgendaView) NUNCA pinta eventos sin hora: la actividad
      // desaparecía por completo de esas dos vistas. Sin fecha límite
      // capturada, `fecha` ya viene anclada a hoy (ver `items` más arriba) —
      // sin este fallback, la actividad SÍ entraba a `items` pero nunca se
      // dibujaba como evento aquí, desapareciendo de la Agenda visual pese a
      // estar publicada.
      const fechaLimiteConHora = a.fechaLimite ? withDefaultTime(a.fechaLimite, '23:59:59') : `${toDateStr(fecha)}T23:59:59`
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
        estado: deadlineEstado(a.fechaLimite || fechaLimiteConHora),
      })

      // Marca "(Publicada)" — mismo criterio que el Calendario del docente
      // (CalendarPage.jsx): `publishAt` solo queda guardado cuando la
      // publicación se PROGRAMÓ a futuro; si se publicó de inmediato, la
      // fecha real vive en `publishedAt` (permanente).
      const fechaPublicacion = a.publishAt || a.publishedAt
      if (fechaPublicacion) {
        evs.push({
          id: `pub-${a.id}`,
          activityId: a.id,
          titulo: `↑ ${nombreConNumero} (Publicada)`,
          subtitulo: subjectDisplayName(subj),
          tipo: 'publicacion',
          dateStr: fechaPublicacion.substring(0, 10),
          timeStr: fechaPublicacion.substring(11, 16),
          bg: pal.bg, text: pal.text,
          editable: false,
        })
      }
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

  const dayHours = { dayStart, dayEnd }

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

  // Botones del encabezado y de la navegación de fecha: en la WEB del
  // estudiante van dos píxeles más grandes (pedido explícito — se veían
  // diminutos en una pantalla de computadora). En la App se quedan como
  // estaban: ahí el espacio es el que manda y ya estaban calibrados.
  const btnText = IS_NATIVE_APP ? 'text-xs' : 'text-sm'
  const btnTextLg = IS_NATIVE_APP ? 'text-sm' : 'text-base'
  const navText = IS_NATIVE_APP ? 'text-sm' : 'text-base'
  const navIcon = IS_NATIVE_APP ? 18 : 20

  return (
    <StudentLayout>
    <div className="bg-surface flex flex-col min-h-full">
      {/* z-20: el header de días de WeekView (CalendarPage.jsx) es
          `sticky z-10` y, siendo hermano posterior en el DOM dentro del
          mismo stacking context de nivel superior, pintaba ENCIMA de este
          bloque (y de su menú desplegable de Horas) pese al z-40 interno
          del menú — un z-index anidado no compite fuera de su contexto de
          apilamiento. Con z-20 aquí, todo el grupo (header + fecha + menú)
          gana siempre. */}
      <div className="sticky top-0 z-20 safe-top">
      <header className="bg-accent text-white px-4 py-3 shadow-lg">
        {/* Todo en un solo renglón cuando cabe: selector de vista (izquierda,
            junto al botón de regresar), +Evento y Horas del día (derecha) —
            para ganar el espacio vertical que antes ocupaban 3 renglones.

            Antes era un grid de tres columnas (1fr auto 1fr) con
            `justify-self`, y ahí estaba el problema: `justify-self` hace que
            cada celda se mida por su contenido en vez de encogerse a su
            columna, así que en un celular los tres bloques se salían de su
            columna y se encimaban unos sobre otros (el selector de vista por
            debajo de "Evento" y de las horas). Con flex-wrap ya no compiten
            por el mismo espacio: cuando no caben, el grupo de la derecha baja
            a un segundo renglón — mismo criterio que el calendario del
            docente en la App, que también separa el selector de vista. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <button
              type="button"
              onClick={goBack}
              className="md:hidden p-2 -ml-2 hover:bg-white/10 rounded flex-shrink-0 transition-colors"
              aria-label="Regresar"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex gap-0.5 bg-white/10 p-1 rounded-full min-w-0 overflow-x-auto">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => changeView(v.id)}
                  className={`flex items-center gap-1 px-2 py-1.5 ${btnText} font-semibold rounded-full whitespace-nowrap transition-colors ${
                    view === v.id ? 'bg-white text-accent' : 'text-white/80 hover:bg-white/10'
                  }`}
                >
                  <v.Icon size={IS_NATIVE_APP ? 14 : 16} /> {v.label}
                </button>
              ))}
            </div>
          </div>
          {/* Evento + Horas viajan juntos: si no caben junto al selector de
              vista, bajan los dos al segundo renglón, alineados a la derecha
              (ml-auto), en vez de partirse uno de cada lado. */}
          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          <button
            type="button"
            onClick={() => openNewEvent(toDateStr(currentDate))}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 ${btnTextLg} font-medium transition-colors`}
          >
            <Plus size={IS_NATIVE_APP ? 15 : 17} /> Evento
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowHoras((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/15 hover:bg-white/25 ${btnText} font-medium transition-colors`}
              data-tooltip="Horas visibles de tu día (Agenda y Semana)"
              data-tooltip-pos="bottom"
            >
              {/* % 24 — dayEnd puede ser 24 (medianoche, límite exclusivo del
                  rango visible), que formatHora12 debe leer como "12:00 am". */}
              <Clock size={IS_NATIVE_APP ? 13 : 15} /> {formatHora12(`${String(dayStart % 24).padStart(2, '0')}:00`)}–{formatHora12(`${String(dayEnd % 24).padStart(2, '0')}:00`)}
            </button>
            {showHoras && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-30 bg-transparent border-none cursor-default"
                  onClick={() => setShowHoras(false)}
                  aria-label="Cerrar selector de horas"
                />
                <div className="absolute right-0 top-9 z-40 bg-surface-card border border-outline-variant rounded-card shadow-lg p-3 w-64 space-y-2 text-left">
                  <p className="text-xs font-semibold text-muted uppercase tracking-wide">Horas del día en tu agenda</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted w-12 flex-shrink-0">Desde</span>
                    <MiniSelect
                      value={dayStart}
                      onChange={(v) => changeDayStart(v)}
                      options={Array.from({ length: 23 }, (_, h) => h).map((h) => ({
                        value: h, label: formatHora12(`${String(h).padStart(2, '0')}:00`),
                      }))}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted w-12 flex-shrink-0">Hasta</span>
                    <MiniSelect
                      value={dayEnd}
                      onChange={(v) => changeDayEnd(v)}
                      options={Array.from({ length: 24 }, (_, h) => h + 1).filter((h) => h > dayStart).map((h) => ({
                        value: h, label: formatHora12(`${String(h % 24).padStart(2, '0')}:00`),
                      }))}
                    />
                  </div>
                  <p className="text-xs font-semibold text-muted uppercase tracking-wide pt-1">Días de tu semana</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted w-12 flex-shrink-0">Días</span>
                    <MiniSelect
                      value={numDays}
                      onChange={(v) => changeNumDays(v)}
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
          </div>
        </div>
      </header>

      {/* Navegación de fecha — pegada justo debajo del encabezado azul, dentro
          del mismo contenedor sticky, para que no se pierda al hacer scroll
          en ninguna vista (pedido explícito). */}
      {/* Un solo grupo centrado: las flechas van PEGADAS a la fecha. Antes el
          renglón era justify-between, así que en una pantalla ancha "‹" y "›"
          terminaban en las orillas, a medio palmo de la fecha que mueven. */}
      <div className="bg-surface-card border-b border-outline-variant px-4 py-2 flex items-center justify-center gap-1">
        <button type="button" onClick={prev} aria-label="Anterior" className="p-1.5 text-muted hover:text-accent hover:bg-accent-tint rounded transition-colors flex-shrink-0">
          <ChevronLeft size={navIcon} />
        </button>
        <p className={`${navText} font-semibold text-on-surface truncate`}>{navLabel()}</p>
        <button type="button" onClick={next} aria-label="Siguiente" className="p-1.5 text-muted hover:text-accent hover:bg-accent-tint rounded transition-colors flex-shrink-0">
          <ChevronRight size={navIcon} />
        </button>
        <button type="button" onClick={goToday} className={`${btnText} font-medium text-accent border border-accent rounded-full px-2.5 py-0.5 ml-1 flex-shrink-0 hover:bg-accent-tint transition-colors`}>
          Hoy
        </button>
      </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
      ) : (
        <div className={`${padClass} py-4 flex-1 ${CONTAINER_BY_VIEW[view]}`}>
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
                numDays={numDays}
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
          <p className="text-xs text-muted text-center mt-3">
            Los horarios de las materias solo los verás si tu Maestro(a) los ha programado en su propia Agenda.
          </p>
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
