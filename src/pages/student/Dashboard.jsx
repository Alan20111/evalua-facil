import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
} from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { auth, db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { BookOpen, ChevronRight, LogOut, GraduationCap } from 'lucide-react'

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

export default function StudentDashboard() {
  const { currentUser } = useAuth()
  const [student, setStudent] = useState(null)
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    if (currentUser) loadData()
  }, [currentUser])

  async function loadData() {
    setLoading(true)
    try {
      // Find student profile from Firebase Auth email
      const emailParts = currentUser.email.split('@')[0]
      const dotIdx = emailParts.indexOf('.')
      const username = emailParts.slice(0, dotIdx)
      const escuelaId = emailParts.slice(dotIdx + 1)
      const studs = await getDocs(
        query(
          collection(db, 'students'),
          where('escuelaId', '==', escuelaId),
          where('username', '==', username.toUpperCase())
        )
      )
      if (studs.empty) {
        toast('No se encontró tu perfil de alumno', 'error')
        return
      }
      const studData = { id: studs.docs[0].id, ...studs.docs[0].data() }
      setStudent(studData)

      // Subjects for the student's group.
      const subsSnap = await getDocs(
        query(collection(db, 'subjects'), where('grupoId', '==', studData.grupoId))
      )
      const subs = subsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      if (subs.length === 0) { setSubjects([]); return }

      // Everything else in ONE parallel batch — a constant number of round trips no
      // matter how many subjects/activities there are (was O(subjects × activities)):
      //  · teacher names  · all activities (chunked `in`)  · all my submissions (1 query)
      const teacherIds = [...new Set(subs.map((s) => s.docenteId))]
      const subjectIds = subs.map((s) => s.id)
      const [teacherSnaps, actDocs, mySubsSnap] = await Promise.all([
        Promise.all(teacherIds.map((tid) => getDoc(doc(db, 'users', tid)))),
        fetchActivitiesForSubjects(subjectIds),
        getDocs(query(collection(db, 'submissions'), where('alumnoId', '==', studData.id))),
      ])

      const teachers = {}
      teacherSnaps.forEach((t) => { if (t.exists()) teachers[t.id] = t.data().nombre })

      // Group activities by subject and index this student's grade per activity.
      const actsBySubject = {}
      actDocs.forEach((d) => {
        const a = { id: d.id, ...d.data() }
        if (!actsBySubject[a.asignaturaId]) actsBySubject[a.asignaturaId] = []
        actsBySubject[a.asignaturaId].push(a)
      })
      const gradeByActivity = {}
      mySubsSnap.docs.forEach((d) => {
        const data = d.data()
        if (data.calificacion != null) gradeByActivity[data.actividadId] = data.calificacion
      })

      // Compute each subject's average in memory.
      const enriched = subs.map((s) => {
        const acts = actsBySubject[s.id] || []
        const grades = acts
          .filter((a) => gradeByActivity[a.id] != null)
          .map((a) => (gradeByActivity[a.id] / (a.maxCalif || 10)) * 10)
        const avg = grades.length
          ? (grades.reduce((x, y) => x + y, 0) / grades.length).toFixed(1)
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

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/alumno')
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Spinner size="lg" />
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-100 px-4 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center">
            <GraduationCap size={18} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {student?.nombre} {student?.apellidoPaterno}
            </p>
            <p className="text-xs text-indigo-600 font-mono">{student?.username}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="p-2 text-slate-400 hover:text-red-500 rounded-lg transition-colors"
        >
          <LogOut size={18} />
        </button>
      </header>

      <div className="px-4 py-6 max-w-2xl mx-auto">
        <h1 className="text-xl font-bold text-slate-900 mb-1">Mis materias</h1>
        <p className="text-slate-400 text-sm mb-5">{subjects.length} asignatura{subjects.length !== 1 ? 's' : ''} activas</p>

        {subjects.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
            <BookOpen size={32} className="text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">Aún no hay asignaturas en tu grupo</p>
          </div>
        ) : (
          <div className="space-y-3">
            {subjects.map((s) => (
              <button
                key={s.id}
                onClick={() => navigate(`/alumno/materia/${s.id}`)}
                className="w-full bg-white rounded-2xl border border-slate-100 p-4 text-left shadow-sm hover:shadow-md transition-shadow flex items-center gap-4"
              >
                <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <BookOpen size={20} className="text-indigo-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900">{s.nombre}</p>
                  <p className="text-slate-400 text-xs mt-0.5">{s.teacherName}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {s.avg != null && (
                    <div className="text-right">
                      <p className="text-lg font-bold text-indigo-600">{s.avg}</p>
                      <p className="text-xs text-slate-400">promedio</p>
                    </div>
                  )}
                  <ChevronRight size={16} className="text-slate-300" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
