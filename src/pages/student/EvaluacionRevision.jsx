import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { ArrowLeft } from 'lucide-react'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import { getEnrollmentForSubject } from '../../utils/studentLookup'
import StudentLayout from '../../components/StudentLayout'
import EvaluacionAnswerList from '../../components/EvaluacionAnswerList'
import { publicacionVisible } from '../../utils/evaluacionGrading'

// Read-only post-evaluación review: shows the student's own answers, whether
// each was correct (if the teacher enabled mostrarRespuestasCorrectas), and
// per-question feedback (if mostrarRetroalimentacion). Reuses the same data
// shapes as EvaluacionRunner but never writes anything.
export default function EvaluacionRevision() {
  const { activityId } = useParams()
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [activity, setActivity] = useState(null)
  const [subject, setSubject] = useState(null)
  const [preguntas, setPreguntas] = useState([])
  const [respuestas, setRespuestas] = useState({})
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const actSnap = await getDoc(doc(db, 'activities', activityId))
      if (!actSnap.exists() || actSnap.data().tipo !== 'evaluacion') {
        navigate(`/alumno/actividad/${activityId}`); return
      }
      const actData = { id: actSnap.id, ...actSnap.data() }
      setActivity(actData)
      const subSnap = await getDoc(doc(db, 'subjects', actData.asignaturaId))
      setSubject({ id: subSnap.id, ...subSnap.data() })

      const studData = await getEnrollmentForSubject(currentUser, userProfile, actData.asignaturaId)
      const subsSnap = await getDocs(query(
        collection(db, 'submissions'), where('actividadId', '==', activityId), where('alumnoId', '==', studData.id)
      ))
      if (subsSnap.empty || subsSnap.docs[0].data().estadoEvaluacion !== 'finalizado') {
        navigate(`/alumno/actividad/${activityId}`); return
      }
      const subData = { id: subsSnap.docs[0].id, ...subsSnap.docs[0].data() }

      // The answer sheet is only reachable once the teacher publishes answers
      // (independent from the grade). Otherwise bounce back to the activity.
      const ev = actData.evaluacion || {}
      const answersVisible = publicacionVisible(ev.publicarRespuestas || 'inmediato', ev.publicarRespuestasFecha, ev.respuestasPublicadas, new Date().toISOString())
      if (!answersVisible) { navigate(`/alumno/actividad/${activityId}`); return }

      const pregSnap = await getDocs(collection(db, 'activities', activityId, 'preguntas'))
      const lista = pregSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      setPreguntas(lista)

      const respSnap = await getDocs(collection(db, 'submissions', subData.id, 'respuestas'))
      const respMap = {}
      respSnap.docs.forEach((d) => { respMap[d.id] = d.data() })
      setRespuestas(respMap)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps -- mount-only intencional
  useEffect(() => { if (currentUser) load() }, [activityId, currentUser])

  if (loading || !activity) return (
    <StudentLayout>
      <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
    </StudentLayout>
  )

  return (
    <StudentLayout>
      <div className="bg-surface min-h-screen" {...subjectPaletteProps(subject?.colorPalette)}>
        <header className="bg-surface-card border-b border-outline-variant px-4 py-3 flex items-center gap-3 shadow-card">
          <button type="button" onClick={() => navigate(`/alumno/actividad/${activityId}`)} className="p-2 -ml-2 text-slate-400 hover:text-muted rounded flex-shrink-0">
            <ArrowLeft size={22} />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-on-surface truncate">{activity.nombre}</h1>
            <p className="text-slate-400 text-xs truncate">{subjectDisplayName(subject)} · Revisión</p>
          </div>
        </header>

        <div className="px-4 py-5 max-w-xl mx-auto">
          {/* Reached only when the teacher published answers, so reveal everything:
              the student's picks, the correct answers and any feedback. */}
          <EvaluacionAnswerList
            preguntas={preguntas}
            respuestas={respuestas}
            mostrarCorrectas
            mostrarRetro
          />
        </div>
      </div>
    </StudentLayout>
  )
}
