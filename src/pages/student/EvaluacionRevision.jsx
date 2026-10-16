import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getDoc, doc } from 'firebase/firestore'
import { db, auth } from '../../firebase'
import { fetchApi } from '../../utils/apiBase'
import { fetchActivity, fetchMisEntregas } from '../../utils/apiContent'
import { TEXTO_NOTA_OCULTA } from '../../components/NotaOculta'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import { ArrowLeft } from 'lucide-react'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import { getEnrollmentForSubject } from '../../utils/studentLookup'
import StudentLayout from '../../components/StudentLayout'
import EvaluacionAnswerList from '../../components/EvaluacionAnswerList'
import { publicacionVisible } from '../../utils/evaluacionGrading'
import { mostrarSeccionesAlEstudiante, preguntasEnOrden, seccionesDe } from '../../utils/secciones'
import { STUDENT_CONTAINER } from '../../config/layout'
import { useBackHandler } from '../../hooks/useBackHandler'
import { SkeletonList } from '../../components/ui'
import { ICONO } from '../../config/iconos'

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
  const goBack = () => navigate(`/alumno/actividad/${activityId}`)
  useBackHandler(goBack)

  async function load() {
    setLoading(true)
    try {
      const actData = await fetchActivity(activityId)
      if (!actData || actData.tipo !== 'evaluacion') {
        navigate(`/alumno/actividad/${activityId}`); return
      }
      setActivity(actData)
      const subSnap = await getDoc(doc(db, 'subjects', actData.asignaturaId))
      setSubject({ id: subSnap.id, ...subSnap.data() })

      // Sin inscripción no hay revisión que mostrar — mismo guard que en el
      // resto de páginas del alumno para URLs directas de asignaturas ajenas.
      const studData = await getEnrollmentForSubject(currentUser, userProfile, actData.asignaturaId)
      if (!studData) {
        navigate('/alumno/dashboard'); return
      }
      // La entrega y sus respuestas llegan por el servidor en UNA llamada. Las claves y
      // los puntos solo vienen si el docente publicó las respuestas Y la nota está a la
      // vista; si la nota está oculta, esta pantalla no existe para el estudiante.
      const { entregas, respuestas: respuestasGuardadas } = await fetchMisEntregas({ actividadId: activityId, respuestas: true })
      const subData = entregas[0]
      if (!subData || subData.estadoEvaluacion !== 'finalizado') {
        navigate(`/alumno/actividad/${activityId}`); return
      }
      if (subData.notaOculta) {
        toast(TEXTO_NOTA_OCULTA)
        navigate(`/alumno/actividad/${activityId}`); return
      }

      // The answer sheet is only reachable once the teacher publishes answers
      // (independent from the grade). Otherwise bounce back to the activity.
      const ev = actData.evaluacion || {}
      const answersVisible = publicacionVisible(ev.publicarRespuestas || 'inmediato', ev.publicarRespuestasFecha, ev.respuestasPublicadas, new Date().toISOString())
      if (!answersVisible) { navigate(`/alumno/actividad/${activityId}`); return }

      const idToken = await auth.currentUser.getIdToken()
      const pregResp = await fetchApi('/api/exam/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ activityId }),
      })
      if (!pregResp.ok) {
        const errData = await pregResp.json().catch(() => ({}))
        throw new Error(errData.error || 'Error al cargar las preguntas')
      }
      // `orden` es relativo a la sección: se reagrupa para verlas en el mismo
      // orden en que se presentaron.
      const crudas = (await pregResp.json()).questions
      const lista = preguntasEnOrden(crudas, seccionesDe(actData?.evaluacion))
      setPreguntas(lista)

      const respMap = {}
      respuestasGuardadas.forEach((r) => { respMap[r.id] = r })
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
      <SkeletonList rows={5} icon={false} className="p-4 sm:p-6 max-w-3xl mx-auto" />
    </StudentLayout>
  )

  return (
    <StudentLayout>
      <div className="bg-surface min-h-screen" {...subjectPaletteProps(subject?.colorPalette)}>
        <header className="bg-surface-card border-b border-outline-variant px-4 py-3 flex items-center gap-3 shadow-card">
          <button type="button" onClick={goBack} aria-label="Volver" className="size-control inline-flex items-center justify-center -ml-2 text-hint hover:text-muted rounded-full flex-shrink-0">
            <ArrowLeft size={ICONO.md} />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-on-surface truncate">{activity.nombre}</h1>
            <p className="text-hint text-xs truncate">{subjectDisplayName(subject)} · Revisión</p>
          </div>
        </header>

        <div className={`px-4 py-5 ${STUDENT_CONTAINER}`}>
          {/* Reached only when the teacher published answers, so reveal everything:
              the student's picks, the correct answers and any feedback. */}
          <EvaluacionAnswerList
            preguntas={preguntas}
            respuestas={respuestas}
            mostrarSecciones={mostrarSeccionesAlEstudiante(activity?.evaluacion)}
            mostrarCorrectas
            mostrarRetro
          />
        </div>
      </div>
    </StudentLayout>
  )
}
