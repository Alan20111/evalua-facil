import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getDoc,
  doc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { BookOpen, ChevronRight, Plus, X, Hash } from 'lucide-react'
import SubjectIcon from '../../components/SubjectIcon'
import { isActivityPublished } from '../../utils/activityVisibility'
import { subjectDisplayName } from '../../utils/subjectName'
import { getEnrollments } from '../../utils/studentLookup'
import StudentLayout from '../../components/StudentLayout'
import { promedioParcial, ponderacionActivaEnParcial } from '../../utils/ponderacion'
import { STUDENT_CONTAINER } from '../../config/layout'

// All activities for a set of subjects in as few round trips as possible.
// Firestore `in` takes up to 30 values, so chunk and run chunks in parallel.
async function fetchActivitiesForSubjects(subjectIds) {
  if (subjectIds.length === 0) return []
  const chunks = []
  for (let i = 0; i < subjectIds.length; i += 30) chunks.push(subjectIds.slice(i, i + 30))
  const snaps = await Promise.all(
    chunks.map((ids) =>
      getDocs(query(collection(db, 'activities'), where('asignaturaId', 'in', ids)))
    )
  )
  return snaps.flatMap((s) => s.docs)
}

// All submissions belonging to a set of student enrollment docs (chunked `in`).
async function fetchSubmissionsForStudents(studentDocIds) {
  if (studentDocIds.length === 0) return []
  const chunks = []
  for (let i = 0; i < studentDocIds.length; i += 30) chunks.push(studentDocIds.slice(i, i + 30))
  const snaps = await Promise.all(
    chunks.map((ids) =>
      getDocs(query(collection(db, 'submissions'), where('alumnoId', 'in', ids)))
    )
  )
  return snaps.flatMap((s) => s.docs)
}

export default function StudentDashboard() {
  const { currentUser, userProfile } = useAuth()
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showJoin, setShowJoin] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const navigate = useNavigate()
  const toast = useToast()

  function handleJoinSubject(e) {
    e.preventDefault()
    const code = joinCode.trim().toUpperCase()
    if (!code) return
    navigate(`/activate/${code}`)
  }

  useEffect(() => {
    if (currentUser) loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps -- mount-only intencional
  }, [currentUser])

  async function loadData() {
    setLoading(true)
    try {
      // A student account can be enrolled in several subjects (one `students` doc per
      // subject, all sharing the same auth uid). Load every enrollment.
      const enrollments = await getEnrollments(currentUser, userProfile)
      if (enrollments.length === 0) {
        toast('No se encontró tu perfil de estudiante', 'error')
        setSubjects([])
        return
      }
      // Map each subject → the enrollment doc id (used as alumnoId for submissions).
      const docIdBySubject = {}
      enrollments.forEach((s) => { if (s.asignaturaId) docIdBySubject[s.asignaturaId] = s.id })
      const asignaturaIds = Object.keys(docIdBySubject)
      if (asignaturaIds.length === 0) { setSubjects([]); return }

      const subjSnaps = await Promise.all(asignaturaIds.map((id) => getDoc(doc(db, 'subjects', id))))
      const subs = subjSnaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }))
      if (subs.length === 0) { setSubjects([]); return }
      const subjectById = {}
      subs.forEach((s) => { subjectById[s.id] = s })

      // Everything else in ONE parallel batch — a constant number of round trips:
      //  · teacher names  · all activities (chunked `in`)  · all my submissions (chunked `in`)
      const teacherIds = [...new Set(subs.map((s) => s.docenteId).filter(Boolean))]
      const subjectIds = subs.map((s) => s.id)
      const myDocIds = Object.values(docIdBySubject)
      const [teacherSnaps, actDocs, mySubmissions] = await Promise.all([
        Promise.all(teacherIds.map((tid) => getDoc(doc(db, 'users', tid)))),
        fetchActivitiesForSubjects(subjectIds),
        fetchSubmissionsForStudents(myDocIds),
      ])

      const teachers = {}
      teacherSnaps.forEach((t) => {
        if (!t.exists()) return
        const td = t.data()
        teachers[t.id] = td.nombreMostrar || td.username || td.nombre || '—'
      })

      // Group activities by subject and index this student's grade per activity
      // (activities are subject-unique, so keying by activity id never collides).
      const actsBySubject = {}
      actDocs.forEach((d) => {
        const a = { id: d.id, ...d.data() }
        const parcialesOcultos = subjectById[a.asignaturaId]?.parcialesOcultos || []
        if (!isActivityPublished(a, parcialesOcultos.includes(a.parcial))) return
        if (!actsBySubject[a.asignaturaId]) actsBySubject[a.asignaturaId] = []
        actsBySubject[a.asignaturaId].push(a)
      })
      const gradeByActivity = {}
      mySubmissions.forEach((d) => {
        const data = d.data()
        if (data.calificacion != null) gradeByActivity[data.actividadId] = data.calificacion
      })

      // Compute each subject's average in memory.
      const enriched = subs.map((s) => {
        const acts = actsBySubject[s.id] || []
        // Same math as the teacher: per-parcial (weighted when applicable),
        // then the mean of parcial averages
        const PARC = Array.from({ length: s.parciales || 3 }, (_, i) => i + 1)
        const parcAvgs = PARC.map((p) => {
          const pacts = acts.filter((a) => a.parcial === p)
          const grades = pacts.map((a) =>
            gradeByActivity[a.id] != null ? (gradeByActivity[a.id] / (a.maxCalif || 10)) * 10 : null
          )
          return promedioParcial(pacts, grades, ponderacionActivaEnParcial(s, p))
        }).filter((v) => v !== null)
        const avg = parcAvgs.length
          ? (parcAvgs.reduce((x, y) => x + y, 0) / parcAvgs.length).toFixed(1)
          : null
        return { ...s, teacherName: teachers[s.docenteId] || '—', avg }
      })
      setSubjects(enriched)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <StudentLayout>
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    </StudentLayout>
  )

  return (
    <StudentLayout>
      <div className={`px-4 py-6 ${STUDENT_CONTAINER}`}>
        <h1 className="text-xl font-bold text-on-surface mb-1">Mis asignaturas</h1>
        <p className="text-slate-400 text-sm mb-5">{subjects.length} asignatura{subjects.length !== 1 ? 's' : ''} activas</p>

        {subjects.length === 0 ? (
          <div className="bg-surface-card rounded-card border border-outline-variant p-10 text-center">
            <BookOpen size={32} className="text-slate-300 mx-auto mb-3" />
            <p className="text-muted mb-1">Aún no tienes asignaturas</p>
            <p className="text-slate-400 text-sm">Usa el botón de abajo para unirte a una.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {subjects.map((s) => (
              <button
                type="button"
                key={s.id}
                data-subject-palette={s.colorPalette || 'default'}
                onClick={() => navigate(`/alumno/materia/${s.id}`)}
                className="w-full bg-surface-card rounded-card p-3 text-left shadow-card hover:shadow-md transition-shadow flex items-center gap-3"
              >
                <div className="w-12 h-12 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
                  <SubjectIcon iconKey={s.icon} size={22} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-on-surface truncate">{subjectDisplayName(s)}</p>
                  <p className="text-slate-400 text-xs mt-0.5 truncate">{s.teacherName}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {s.avg != null && (
                    <div className="text-right">
                      <p className="text-lg font-bold text-accent">{s.avg}</p>
                      <p className="text-sm text-slate-500">promedio</p>
                    </div>
                  )}
                  <ChevronRight size={18} className="text-slate-300" />
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Join another subject */}
        <button
          type="button"
          onClick={() => { setJoinCode(''); setShowJoin(true) }}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-card border border-dashed border-accent text-accent text-sm font-semibold hover:bg-accent-light transition-colors"
        >
          <Plus size={18} /> Unirme a otra asignatura
        </button>
      </div>

      {/* ── Join-subject modal ── */}
      {showJoin && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowJoin(false)} />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-lg font-semibold text-on-surface truncate">Unirme a otra asignatura</h3>
              <button type="button" aria-label="Cerrar" onClick={() => setShowJoin(false)} className="p-2 text-slate-400 rounded flex-shrink-0"><X size={20} /></button>
            </div>
            <p className="text-sm text-muted mb-3">
              Ingresa el <strong>código de acceso</strong> de tu nueva asignatura (o escanea su QR). Como ya tienes cuenta, solo confirmarás tu contraseña.
            </p>
            <form onSubmit={handleJoinSubject} className="flex gap-2">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={8}
                placeholder="Ej: A3B7K2"
                className="flex-1 px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface font-mono tracking-widest text-center"
              />
              <button
                type="submit"
                disabled={!joinCode.trim()}
                className="px-4 py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
              >
                <Hash size={18} /> Ir
              </button>
            </form>
          </div>
        </div>
      )}
    </StudentLayout>
  )
}
