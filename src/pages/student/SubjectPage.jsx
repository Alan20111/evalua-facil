import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { isActivityPublished } from '../../utils/activityVisibility'
import { subjectDisplayName } from '../../utils/subjectName'
import { getEnrollmentForSubject } from '../../utils/studentLookup'
import SubjectIcon from '../../components/SubjectIcon'
import {
  ArrowLeft, ChevronDown, ChevronUp, CheckCircle,
  Clock, Circle, Star,
} from 'lucide-react'

export default function StudentSubjectPage() {
  const { subjectId } = useParams()
  const { currentUser, userProfile } = useAuth()
  const [subject, setSubject] = useState(null)
  const [activities, setActivities] = useState([])
  const [submissions, setSubmissions] = useState({})
  const [openParcial, setOpenParcial] = useState(1)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => { loadAll() }, [subjectId])

  async function loadAll() {
    setLoading(true)
    try {
      // Resolve THIS student's enrollment record for the subject being viewed.
      const [subSnap, studData, actsSnap] = await Promise.all([
        getDoc(doc(db, 'subjects', subjectId)),
        getEnrollmentForSubject(currentUser, userProfile, subjectId),
        getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', subjectId))),
      ])
      setSubject({ id: subSnap.id, ...subSnap.data() })
      const acts = actsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(isActivityPublished)
      setActivities(acts)
      if (!studData) return

      // One query for ALL of this student's submissions, then map to activities in memory
      // (was one query per activity).
      const subsSnap = await getDocs(
        query(collection(db, 'submissions'), where('alumnoId', '==', studData.id))
      )
      const actIds = new Set(acts.map((a) => a.id))
      const subsMap = {}
      subsSnap.docs.forEach((d) => {
        const data = d.data()
        if (actIds.has(data.actividadId)) subsMap[data.actividadId] = { id: d.id, ...data }
      })
      setSubmissions(subsMap)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  function calcParcialAvg(parcial) {
    const acts = activities.filter((a) => a.parcial === parcial)
    const grades = acts
      .map((a) => submissions[a.id])
      .filter((s) => s?.calificacion != null)
      .map((s) => {
        const act = activities.find((a) => a.id === s.actividadId)
        return (s.calificacion / (act?.maxCalif || 10)) * 10
      })
    return grades.length ? (grades.reduce((a, b) => a + b, 0) / grades.length).toFixed(1) : null
  }

  const PARCIALES = Array.from({ length: subject?.parciales || 3 }, (_, i) => i + 1)

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <Spinner size="lg" />
    </div>
  )

  return (
    <div className="min-h-screen bg-surface" data-subject-palette={subject?.colorPalette || 'default'}>
      <header className="bg-surface-card border-b border-outline-variant px-4 py-4 flex items-center gap-3 shadow-card">
        <button
          onClick={() => navigate('/alumno/dashboard')}
          className="p-2 -ml-2 text-slate-400 hover:text-muted rounded"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="w-9 h-9 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
          <SubjectIcon iconKey={subject?.icon} size={18} className="text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-on-surface">{subjectDisplayName(subject)}</h1>
          <p className="text-slate-400 text-xs">{subject?.parciales || 3} parciales</p>
        </div>
      </header>

      <div className="px-4 py-5 max-w-2xl mx-auto space-y-3">
        {PARCIALES.map((p) => {
          const acts = activities.filter((a) => a.parcial === p)
          const avg = calcParcialAvg(p)
          const isOpen = openParcial === p
          return (
            <div key={p} className="bg-surface-card rounded-card overflow-hidden shadow-card">
              <button
                onClick={() => setOpenParcial(isOpen ? 0 : p)}
                className="w-full px-4 py-4 flex items-center gap-3 hover:bg-surface transition-colors"
              >
                <div className="w-9 h-9 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
                  <span className="text-accent font-bold text-sm">{p}</span>
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-on-surface">Parcial {p}</p>
                  <p className="text-xs text-slate-400">{acts.length} actividad{acts.length !== 1 ? 'es' : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  {avg != null && (
                    <div className="text-right">
                      <span className="text-lg font-bold text-accent">{avg}</span>
                    </div>
                  )}
                  {isOpen ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-outline-variant px-4 py-3 space-y-2">
                  {acts.length === 0 && (
                    <p className="text-slate-400 text-sm text-center py-3">Sin actividades</p>
                  )}
                  {acts.map((a) => {
                    const sub = submissions[a.id]
                    const graded = sub?.calificacion != null
                    const delivered = sub && !graded
                    return (
                      <button
                        key={a.id}
                        onClick={() => navigate(`/alumno/actividad/${a.id}`)}
                        className="w-full flex items-center gap-3 px-3 py-3.5 rounded hover:bg-surface transition-colors border border-outline-variant text-left"
                      >
                        <div className="flex-shrink-0">
                          {graded ? (
                            <CheckCircle size={18} className="text-emerald-500" />
                          ) : delivered ? (
                            <Clock size={18} className="text-accent" />
                          ) : (
                            <Circle size={18} className="text-slate-300" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-on-surface truncate">{a.nombre}</p>
                          {sub?.comentario && (
                            <p className="text-xs text-slate-400 truncate mt-0.5">"{sub.comentario}"</p>
                          )}
                        </div>
                        <div className="flex-shrink-0 text-right">
                          {graded ? (
                            <div>
                              <p className="text-sm font-bold text-emerald-600 flex items-center gap-0.5">
                                <Star size={11} /> {sub.calificacion}
                              </p>
                              <p className="text-xs text-slate-400">/{a.maxCalif}</p>
                            </div>
                          ) : delivered ? (
                            <span className="text-xs bg-accent-light text-accent px-2 py-1 rounded-full">Entregado</span>
                          ) : (
                            <span className="text-xs bg-surface-container text-muted px-2 py-1 rounded-full">Pendiente</span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
