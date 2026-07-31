import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { ArrowLeft, LayoutDashboard, CalendarDays } from 'lucide-react'
import { getEnrollments } from '../../utils/studentLookup'
import { isActivityPublished, estadoAgenda } from '../../utils/activityVisibility'
import { toDateStr } from '../../utils/horarioBloques'
import { normalizeGrade } from '../../utils/ponderacion'
import { STUDENT_CONTAINER_NARROW, STUDENT_CONTAINER_WIDE } from '../../config/layout'
import AgendaDashboard from '../../components/agenda/AgendaDashboard'
import AgendaCalendario from '../../components/agenda/AgendaCalendario'
import StudentEventEditor from '../../components/agenda/StudentEventEditor'
import StudentLayout from '../../components/StudentLayout'
import { useBackHandler } from '../../hooks/useBackHandler'
import { teacherDisplayName } from '../../utils/studentSearch'

// Dentro de StudentLayout (no "pantalla completa" como NotificationSettings/
// EvaluacionRunner): en escritorio debe quedar visible y clicable el sidebar
// azul de asignaturas a la izquierda — pedido explícito, antes un overlay
// fixed inset-0 lo tapaba por completo.
//
// Rediseño: la Agenda deja de ser una lista cronológica agrupada por fecha
// (Hoy/Ayer/Viernes…) y se vuelve un dashboard organizado por PRIORIDAD (ver
// src/utils/agendaEngine.js). El tab "Calendario" (Día/Semana/Mes) se
// mantiene tal cual por ahora — su propio rediseño (bloques de horario +
// eventos con los indicadores de color del pedido) queda para una entrega
// aparte, no se toca aquí para no dejarlo a medias.

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

// horarioBloques/events no soportan `in` + filtro adicional sin un índice
// compuesto nuevo (ver CLAUDE.md) — se piden por asignaturaId `in` nada más y
// se filtra `tipo`/fecha del lado cliente, igual que ya hace este archivo con
// `activities`.
async function fetchByAsignaturaIn(coleccion, subjectIds) {
  if (subjectIds.length === 0) return []
  const chunks = []
  for (let i = 0; i < subjectIds.length; i += 30) chunks.push(subjectIds.slice(i, i + 30))
  const snaps = await Promise.all(
    chunks.map((ids) => getDocs(query(collection(db, coleccion), where('asignaturaId', 'in', ids))))
  )
  return snaps.flatMap((s) => s.docs)
}

const TABS = [
  { key: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { key: 'calendario', label: 'Calendario', Icon: CalendarDays },
]

export default function Agenda() {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [tab, setTab] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([]) // { id, activity, submission, subject, teacherName, estado, fecha (Date) }
  const [bloquesHoy, setBloquesHoy] = useState([]) // horarioBloques de HOY, enriquecidos con subject/teacherName
  const [eventos, setEventos] = useState([]) // académicos + personales, { id, titulo, tipo, fechaInicio, fechaFin, color, subject? }
  const [editingEvent, setEditingEvent] = useState(null) // null=cerrado, {}=nuevo, {...}=editar
  const goBack = () => navigate('/alumno/dashboard')
  useBackHandler(goBack)
  useBackHandler(() => setEditingEvent(null), !!editingEvent)

  // `loading` ya inicia en true y loadData() solo corre al montar — sin
  // setState síncrono aquí (react-hooks/set-state-in-effect).
  async function loadData() {
    try {
      const enrollments = await getEnrollments(currentUser, userProfile)
      if (enrollments.length === 0) { setItems([]); return }

      const docIdBySubject = {}
      enrollments.forEach((e) => { docIdBySubject[e.asignaturaId] = e.id })
      const subjectIds = [...new Set(enrollments.map((e) => e.asignaturaId).filter(Boolean))]

      const subjectSnaps = await Promise.all(subjectIds.map((id) => getDoc(doc(db, 'subjects', id))))
      const subjectById = {}
      subjectSnaps.forEach((s) => { if (s.exists()) subjectById[s.id] = { id: s.id, ...s.data() } })

      // Una materia archivada nunca aparece en la Agenda (ver el filtro `built`
      // de abajo: `if (subj.archived) return false`), así que sus actividades
      // y entregas no hacen falta aquí — pedirlas de todos modos era lectura
      // desperdiciada en cada carga para cualquier alumno con ciclos cerrados.
      const activeSubjectIds = subjectIds.filter((id) => subjectById[id] && !subjectById[id].archived)
      const activeDocIds = activeSubjectIds.map((id) => docIdBySubject[id])
      const teacherIds = [...new Set(activeSubjectIds.map((id) => subjectById[id].docenteId).filter(Boolean))]
      // `eventDocs` = academicEvents (compartidos por materia).
      const [teacherSnaps, actDocs, subDocs, bloqueDocs, eventDocs, studentEventDocs] = await Promise.all([
        Promise.all(teacherIds.map((tid) => getDoc(doc(db, 'users', tid)))),
        fetchActivitiesForSubjects(activeSubjectIds),
        fetchSubmissionsForStudents(activeDocIds),
        fetchByAsignaturaIn('horarioBloques', activeSubjectIds),
        fetchByAsignaturaIn('academicEvents', activeSubjectIds),
        getDocs(query(collection(db, 'studentEvents'), where('alumnoId', '==', currentUser.uid))),
      ])
      const teacherName = {}
      teacherSnaps.forEach((t) => { if (t.exists()) { const d = t.data(); teacherName[t.id] = teacherDisplayName(d) } })

      // "Ahora" / "Próxima clase" — solo los bloques de HOY, con la materia
      // y el docente ya resueltos (mismo patrón que las actividades).
      const todayKey = toDateStr(new Date())
      const bloquesDeHoy = bloqueDocs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((b) => b.fecha === todayKey && activeSubjectIds.includes(b.asignaturaId))
        .map((b) => ({ ...b, subject: subjectById[b.asignaturaId], teacherName: teacherName[subjectById[b.asignaturaId]?.docenteId] || '' }))
      setBloquesHoy(bloquesDeHoy)

      // Eventos académicos (del docente, compartidos con el grupo) + personales
      // del propio alumno — unificados en una sola lista para las secciones
      // "Prioridad de hoy" y "Próximos 7 días".
      const eventosAcademicos = eventDocs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((e) => activeSubjectIds.includes(e.asignaturaId))
        .map((e) => ({
          id: e.id, titulo: e.titulo, tipo: 'academico', color: e.color,
          subject: subjectById[e.asignaturaId],
          fechaInicio: new Date(e.inicio), fechaFin: new Date(e.fin || e.inicio),
        }))
      const eventosPersonales = studentEventDocs.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .map((e) => ({
          id: e.id, titulo: e.titulo, tipo: 'personal', color: e.color,
          fechaInicio: new Date(e.inicio), fechaFin: new Date(e.fin || e.inicio),
        }))
      setEventos([...eventosAcademicos, ...eventosPersonales].sort((a, b) => a.fechaInicio - b.fechaInicio))

      const submissionByActivity = {}
      subDocs.forEach((d) => { submissionByActivity[d.data().actividadId] = { id: d.id, ...d.data() } })

      const built = actDocs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => {
          const subj = subjectById[a.asignaturaId]
          if (!subj) return false
          // Asignatura archivada = ciclo cerrado. Sus fechas límite no son
          // pendientes de nadie, así que no tienen nada que hacer en la agenda
          // ni en el calendario. Este renglón faltaba: el filtro ya tenía la
          // asignatura en la mano y solo revisaba los parciales ocultos, así
          // que una materia terminada seguía apareciendo con sus entregas
          // vencidas para siempre.
          if (subj.archived) return false
          const parcialesOcultos = subj.parcialesOcultos || []
          return isActivityPublished(a, parcialesOcultos.includes(a.parcial))
        })
        .map((a) => {
          const subj = subjectById[a.asignaturaId]
          const submission = submissionByActivity[a.id] || null
          // Prórroga individual de este alumno para esta actividad — sin esto,
          // una actividad con prórroga vigente aparecía "vencida" (roja) en la
          // Agenda aunque su propia página de detalle, correctamente, siguiera
          // aceptando la entrega. docIdBySubject[a.asignaturaId] es el id de
          // SU inscripción en esa materia, la misma llave con la que
          // `extensiones` guarda las prórrogas.
          const extendedDate = a.extensiones?.[docIdBySubject[a.asignaturaId]] || null
          const displayDeadline = extendedDate || a.fechaLimite
          const estado = estadoAgenda({ ...a, fechaLimite: displayDeadline }, submission)
          // Sin fecha límite, la actividad se ancla al día de hoy (persistente
          // hasta que el maestro capture una fecha) — ver comentario en
          // estadoAgenda sobre por qué antes desaparecía de la Agenda.
          const fecha = !displayDeadline
            ? new Date()
            : new Date(displayDeadline.includes('T') ? displayDeadline : `${displayDeadline}T23:59:59`)
          return { id: a.id, activity: a, submission, subject: subj, teacherName: teacherName[subj.docenteId] || '', estado, fecha, extendedDate }
        })
        .filter((it) => it.estado)
        .sort((a, b) => a.fecha - b.fecha)

      setItems(built)
    } catch (err) {
      toast('Error al cargar tu agenda: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect -- mount-only intencional
  useEffect(() => { if (currentUser) loadData() }, [currentUser])

  const firstName = userProfile?.nombre || 'Estudiante'
  const todayStr = toDateStr(new Date())

  // Agrupado por fecha — lo sigue usando el tab Calendario (Día/Semana/Mes).
  const itemsByDate = useMemo(() => {
    const map = {}
    items.forEach((it) => {
      const key = toDateStr(it.fecha)
      ;(map[key] ||= []).push(it)
    })
    return map
  }, [items])

  // Promedio actual: media de las actividades ya calificadas, normalizadas a
  // /10 (mismo helper que usa el resto de la plataforma) — una sola cifra
  // global entre todas las materias para el panel del Dashboard, no un
  // promedio por parcial/materia (eso ya vive en cada SubjectPage).
  const promedioActual = useMemo(() => {
    const notas = items
      .filter((it) => it.estado === 'calificada')
      .map((it) => normalizeGrade(it.submission.calificacion, it.activity.maxCalif))
      .filter((n) => n != null)
    return notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : null
  }, [items])

  const porcentajeEntregado = useMemo(() => {
    if (items.length === 0) return null
    const entregadas = items.filter((it) => it.estado === 'entregada' || it.estado === 'calificada').length
    return Math.round((entregadas / items.length) * 100)
  }, [items])

  return (
    <StudentLayout>
    <div className="bg-surface">
      <header className="bg-accent text-white px-4 py-3 shadow-lg sticky top-0 z-10 safe-top">
        <div className="flex items-center gap-3">
          {/* Solo móvil: en escritorio el sidebar ya permite navegar a otro
              lado, la flecha ahí sería redundante (mismo criterio que
              asignatura/actividad). */}
          <button
            type="button"
            onClick={goBack}
            className="md:hidden p-2 -ml-2 hover:bg-white/10 rounded flex-shrink-0 transition-colors"
            aria-label="Regresar"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold truncate">Agenda</h1>
            <p className="text-xs text-white/60 truncate">{firstName}</p>
          </div>
        </div>
        <div className="flex gap-1 mt-3 bg-white/10 p-1 rounded-full">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-sm font-semibold rounded-full transition-colors ${
                tab === t.key ? 'bg-white text-accent' : 'text-white/80 hover:bg-white/10'
              }`}
            >
              <t.Icon size={15} /> {t.label}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
      ) : (
        <div className={`px-4 py-5 ${tab === 'dashboard' ? STUDENT_CONTAINER_WIDE : STUDENT_CONTAINER_NARROW}`}>
          {tab === 'dashboard' ? (
            <AgendaDashboard
              items={items}
              eventos={eventos}
              bloquesHoy={bloquesHoy}
              todayStr={todayStr}
              ahora={new Date()}
              promedioActual={promedioActual}
              porcentajeEntregado={porcentajeEntregado}
              onActivityClick={(id) => navigate(`/alumno/actividad/${id}`)}
              onEventClick={(evento) => { if (evento.tipo === 'personal') setEditingEvent(evento) }}
              onCreateEvent={() => setEditingEvent({})}
            />
          ) : (
            <AgendaCalendario itemsByDate={itemsByDate} todayStr={todayStr} onActivityClick={(id) => navigate(`/alumno/actividad/${id}`)} />
          )}
        </div>
      )}
    </div>

    {editingEvent && (
      <StudentEventEditor
        event={editingEvent.id ? editingEvent : null}
        onClose={() => setEditingEvent(null)}
        onSaved={() => loadData()}
        onDeleted={() => loadData()}
      />
    )}
    </StudentLayout>
  )
}
