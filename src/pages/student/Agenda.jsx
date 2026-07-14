import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { ArrowLeft, List, CalendarDays } from 'lucide-react'
import { getEnrollments } from '../../utils/studentLookup'
import { isActivityPublished, estadoAgenda } from '../../utils/activityVisibility'
import { toDateStr } from '../../utils/horarioBloques'
import { STUDENT_CONTAINER_NARROW } from '../../config/layout'
import AgendaLista from '../../components/agenda/AgendaLista'
import AgendaCalendario from '../../components/agenda/AgendaCalendario'

// Pantalla completa (mismo patrón que NotificationSettings.jsx/EvaluacionRunner:
// overlay fixed inset-0, sin la barra lateral de asignaturas) — la Agenda del
// estudiante, con dos pestañas: Lista (vencidas/hoy/próximas, cronológica) y
// Calendario (Día/Semana/Mes).

async function fetchActivitiesForSubjects(subjectIds) {
  if (subjectIds.length === 0) return []
  const chunks = []
  for (let i = 0; i < subjectIds.length; i += 30) chunks.push(subjectIds.slice(i, i + 30))
  const snaps = await Promise.all(
    chunks.map((ids) => getDocs(query(collection(db, 'activities'), where('asignaturaId', 'in', ids))))
  )
  return snaps.flatMap((s) => s.docs)
}

async function fetchSubmissionsForStudents(studentDocIds) {
  if (studentDocIds.length === 0) return []
  const chunks = []
  for (let i = 0; i < studentDocIds.length; i += 30) chunks.push(studentDocIds.slice(i, i + 30))
  const snaps = await Promise.all(
    chunks.map((ids) => getDocs(query(collection(db, 'submissions'), where('alumnoId', 'in', ids))))
  )
  return snaps.flatMap((s) => s.docs)
}

const TABS = [
  { key: 'lista', label: 'Lista', Icon: List },
  { key: 'calendario', label: 'Calendario', Icon: CalendarDays },
]

export default function Agenda() {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [tab, setTab] = useState('lista')
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([]) // { id, activity, submission, subject, teacherName, estado, fecha (Date) }

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

      const teacherIds = [...new Set(Object.values(subjectById).map((s) => s.docenteId).filter(Boolean))]
      const [teacherSnaps, actDocs, subDocs] = await Promise.all([
        Promise.all(teacherIds.map((tid) => getDoc(doc(db, 'users', tid)))),
        fetchActivitiesForSubjects(subjectIds),
        fetchSubmissionsForStudents(Object.values(docIdBySubject)),
      ])
      const teacherName = {}
      teacherSnaps.forEach((t) => { if (t.exists()) { const d = t.data(); teacherName[t.id] = d.nombreMostrar || d.nombre || d.username || '' } })

      const submissionByActivity = {}
      subDocs.forEach((d) => { submissionByActivity[d.data().actividadId] = { id: d.id, ...d.data() } })

      const built = actDocs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => {
          const subj = subjectById[a.asignaturaId]
          if (!subj) return false
          const parcialesOcultos = subj.parcialesOcultos || []
          return isActivityPublished(a, parcialesOcultos.includes(a.parcial)) && !!a.fechaLimite
        })
        .map((a) => {
          const subj = subjectById[a.asignaturaId]
          const submission = submissionByActivity[a.id] || null
          const estado = estadoAgenda(a, submission)
          const fecha = new Date(a.fechaLimite.includes('T') ? a.fechaLimite : `${a.fechaLimite}T23:59:59`)
          return { id: a.id, activity: a, submission, subject: subj, teacherName: teacherName[subj.docenteId] || '', estado, fecha }
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

  // Agrupado por fecha — lo consumen tanto Lista como Calendario.
  const itemsByDate = useMemo(() => {
    const map = {}
    items.forEach((it) => {
      const key = toDateStr(it.fecha)
      ;(map[key] ||= []).push(it)
    })
    return map
  }, [items])

  return (
    <div className="fixed inset-0 z-50 bg-surface overflow-y-auto">
      <header className="bg-accent text-white px-4 py-3 shadow-lg sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/alumno/dashboard')}
            className="p-2 -ml-2 hover:bg-white/10 rounded flex-shrink-0 transition-colors"
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
        <div className={`px-4 py-5 ${STUDENT_CONTAINER_NARROW}`}>
          {tab === 'lista' ? (
            <AgendaLista itemsByDate={itemsByDate} todayStr={todayStr} onActivityClick={(id) => navigate(`/alumno/actividad/${id}`)} />
          ) : (
            <AgendaCalendario itemsByDate={itemsByDate} todayStr={todayStr} onActivityClick={(id) => navigate(`/alumno/actividad/${id}`)} />
          )}
        </div>
      )}
    </div>
  )
}
