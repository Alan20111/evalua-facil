import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { ArrowLeft, CheckCircle2, XCircle, MessageSquare } from 'lucide-react'
import { subjectDisplayName } from '../../utils/subjectName'
import { getEnrollmentForSubject } from '../../utils/studentLookup'
import StudentLayout from '../../components/StudentLayout'
import { STUDENT_CONTAINER_NARROW } from '../../config/layout'

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

  const ev = activity.evaluacion || {}

  return (
    <StudentLayout>
      <div className="bg-surface min-h-screen" data-subject-palette={subject?.colorPalette || 'default'}>
        <header className="bg-surface-card border-b border-outline-variant px-4 py-3 flex items-center gap-3 shadow-card">
          <button type="button" onClick={() => navigate(`/alumno/actividad/${activityId}`)} className="p-2 -ml-2 text-slate-400 hover:text-muted rounded flex-shrink-0">
            <ArrowLeft size={22} />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-on-surface truncate">{activity.nombre}</h1>
            <p className="text-slate-400 text-xs truncate">{subjectDisplayName(subject)} · Revisión</p>
          </div>
        </header>

        <div className={`px-4 py-5 ${STUDENT_CONTAINER_NARROW} space-y-3`}>
          {preguntas.map((p, i) => {
            const respuesta = respuestas[p.id] || {}
            const esObjetiva = p.tipo !== 'respuesta_corta'
            const correcta = esObjetiva && respuesta.opcionSeleccionada === p.respuestaCorrecta
            return (
              <div key={p.id} className="bg-surface-card rounded-card p-4 shadow-card">
                <p className="text-sm font-medium text-on-surface mb-2">{i + 1}. {p.enunciado}</p>
                {p.imagenUrl && <img src={p.imagenUrl} alt="" className="max-h-48 rounded border border-outline-variant mb-2" />}

                {esObjetiva ? (
                  <div className="space-y-1.5">
                    {p.opciones.map((o) => {
                      const esSeleccion = respuesta.opcionSeleccionada === o.id
                      const esCorrecta = ev.mostrarRespuestasCorrectas && o.id === p.respuestaCorrecta
                      return (
                        <div key={o.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded border text-sm ${
                            esCorrecta ? 'border-emerald-300 bg-emerald-50 text-emerald-700' :
                            esSeleccion ? 'border-accent bg-accent-light' : 'border-outline-variant'
                          }`}>
                          {esSeleccion && (correcta ? <CheckCircle2 size={15} className="text-emerald-600 flex-shrink-0" /> : <XCircle size={15} className="text-error flex-shrink-0" />)}
                          <span>{o.texto}</span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-sm text-muted bg-surface rounded p-2 whitespace-pre-wrap">{respuesta.textoRespuesta || '(sin respuesta)'}</p>
                    {respuesta.puntosObtenidos != null ? (
                      <p className="text-xs text-muted">Puntos: {respuesta.puntosObtenidos}/{p.ponderacion}</p>
                    ) : (
                      <p className="text-xs text-amber-600">Pendiente de revisión</p>
                    )}
                  </div>
                )}

                {ev.mostrarRetroalimentacion && p.retroalimentacion && (
                  <div className="mt-2 bg-surface rounded p-2.5 flex gap-2">
                    <MessageSquare size={15} className="text-slate-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-muted">{p.retroalimentacion}</p>
                  </div>
                )}
                {respuesta.comentarioDocente && (
                  <div className="mt-2 bg-surface rounded p-2.5 flex gap-2">
                    <MessageSquare size={15} className="text-slate-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-muted italic">"{respuesta.comentarioDocente}"</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </StudentLayout>
  )
}
