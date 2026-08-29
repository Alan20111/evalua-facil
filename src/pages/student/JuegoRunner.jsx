// Crucigrama / Sopa de letras — pantalla de juego del alumno (22-ago-2026).
//
// Mismo patrón que EvaluacionRunner.jsx: carga la submission 'en_progreso'
// creada por ActivityPage (handleStartOrContinueJuego), autoguarda el
// progreso, y al finalizar SOLO marca `estadoEvaluacion: 'finalizado'` — la
// calificación la calcula el servidor (Cloud Function onJuegoFinalizado en
// functions/index.js, contra `juego.estructura`, la fuente de verdad). Las
// reglas de Firestore bloquean que el alumno escriba `calificacion`
// directamente, así que este cliente nunca lo intenta.
//
// Los tableros (CrucigramaBoard / SopaDeLetrasBoard) se usan SIN `readOnly`,
// con estado local de `celdas`/`encontradas` — el cliente solo lleva el
// progreso de juego, nunca decide si algo es correcto ni calcula una nota.

import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { doc, getDoc, getDocs, collection, query, where, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { Timer, CheckCircle2, LogOut } from 'lucide-react'
import { getEnrollmentForSubject } from '../../utils/studentLookup'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import { STUDENT_CONTAINER_NARROW } from '../../config/layout'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { studentFullName } from '../../utils/studentSearch'
import { formatTiempo } from '../../utils/formatTiempo'
import CrucigramaBoard from '../../components/juego/CrucigramaBoard'
import SopaDeLetrasBoard from '../../components/juego/SopaDeLetrasBoard'

export default function JuegoRunner() {
  const { activityId } = useParams()
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [activity, setActivity] = useState(null)
  const [subject, setSubject] = useState(null)
  const [student, setStudent] = useState(null)
  const [submission, setSubmission] = useState(null)
  const [celdas, setCeldas] = useState({})
  const [encontradas, setEncontradas] = useState([])
  const [loading, setLoading] = useState(true)
  const [finishing, setFinishing] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(null)
  const [showExitModal, setShowExitModal] = useState(false)
  // Cronómetro ascendente: inicioMs viene de tiempoInicio del servidor →
  // sobrevive recarga porque se lee de Firestore, no de estado local.
  const [inicioMs, setInicioMs] = useState(null)
  const [tiempoDisplay, setTiempoDisplay] = useState('00:00')
  const finishedRef = useRef(false)
  const saveTimer = useRef(null)

  useBackHandler(() => setShowExitModal(false), showExitModal)
  useBackHandler(() => setShowExitModal(true), !showExitModal)
  useScrollLock(showExitModal)

  async function load() {
    setLoading(true)
    try {
      const actSnap = await getDoc(doc(db, 'activities', activityId))
      if (!actSnap.exists() || actSnap.data().categoria !== 'juego' || !actSnap.data().juego?.estructura) {
        navigate(`/alumno/actividad/${activityId}`); return
      }
      const actData = { id: actSnap.id, ...actSnap.data() }
      setActivity(actData)
      const subSnap = await getDoc(doc(db, 'subjects', actData.asignaturaId))
      setSubject({ id: subSnap.id, ...subSnap.data() })

      const studData = await getEnrollmentForSubject(currentUser, userProfile, actData.asignaturaId)
      if (!studData) {
        toast('No estás inscrito en esta asignatura', 'error')
        navigate('/alumno/dashboard')
        return
      }
      setStudent(studData)

      const subsSnap = await getDocs(query(
        collection(db, 'submissions'), where('actividadId', '==', activityId), where('alumnoId', '==', studData.id)
      ))
      if (subsSnap.empty || subsSnap.docs[0].data().estadoEvaluacion !== 'en_progreso') {
        navigate(`/alumno/actividad/${activityId}`); return
      }
      const subData = { id: subsSnap.docs[0].id, ...subsSnap.docs[0].data() }
      setSubmission(subData)
      setCeldas(subData.respuestasJuego?.celdas || {})
      setEncontradas(Array.isArray(subData.respuestasJuego?.encontradas) ? subData.respuestasJuego.encontradas : [])

      if (actData.evaluacion?.tiempoLimiteMin && subData.tiempoInicio?.seconds) {
        const limitMs = actData.evaluacion.tiempoLimiteMin * 60 * 1000
        const elapsedMs = Date.now() - subData.tiempoInicio.seconds * 1000
        setSecondsLeft(Math.max(0, Math.floor((limitMs - elapsedMs) / 1000)))
      }
      // Cronómetro: tiempoInicio es un Timestamp de servidor (escrito por
      // handleStartOrContinueJuego). Se carga aquí para sobrevivir recargas.
      if (subData.tiempoInicio?.seconds) {
        setInicioMs(subData.tiempoInicio.seconds * 1000)
      }
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only intencional
  useEffect(() => { if (currentUser) load() }, [activityId, currentUser])

  function guardarProgreso(nuevoCeldas, nuevoEncontradas) {
    if (!submission) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      updateDoc(doc(db, 'submissions', submission.id), {
        respuestasJuego: { celdas: nuevoCeldas, encontradas: nuevoEncontradas },
      }).catch((err) => toast('No se pudo guardar tu progreso: ' + err.message, 'error'))
    }, 400)
  }

  function handleCambioCelda(r, c, letra) {
    setCeldas((prev) => {
      const next = { ...prev, [`${r}-${c}`]: letra }
      guardarProgreso(next, encontradas)
      return next
    })
  }

  function handleEncontrada(index) {
    setEncontradas((prev) => {
      if (prev.includes(index)) return prev
      const next = [...prev, index]
      guardarProgreso(celdas, next)
      return next
    })
  }

  async function handleFinalizar() {
    if (finishedRef.current) return
    finishedRef.current = true
    setFinishing(true)
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      await updateDoc(doc(db, 'submissions', submission.id), {
        respuestasJuego: { celdas, encontradas },
        estadoEvaluacion: 'finalizado',
        estado: 'entregado',
        fechaEntrega: serverTimestamp(),
      })
      toast('Juego finalizado')
      navigate(`/alumno/actividad/${activityId}`, { state: { justFinished: true } })
    } catch (err) {
      finishedRef.current = false
      toast('Error al finalizar: ' + err.message, 'error')
    } finally {
      setFinishing(false)
    }
  }

  useEffect(() => {
    if (secondsLeft == null) return
    if (secondsLeft <= 0) {
      if (!finishedRef.current) handleFinalizar()
      return
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft])

  // Cronómetro ascendente — actualiza cada segundo el texto del display;
  // setTiempoDisplay es suficientemente barato para no causar renders pesados.
  useEffect(() => {
    if (inicioMs == null) return
    const tick = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - inicioMs) / 1000))
      setTiempoDisplay(formatTiempo(elapsed) || '00:00')
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [inicioMs])

  if (loading || !activity) return (
    <div className="fixed inset-0 z-50 bg-surface flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  )

  const estructura = activity.juego?.estructura
  const mm = secondsLeft != null ? Math.floor(secondsLeft / 60) : null
  const ss = secondsLeft != null ? secondsLeft % 60 : null

  return (
    <div className="fixed inset-0 z-50 bg-surface overflow-y-auto" {...subjectPaletteProps(subject?.colorPalette)}>
      <header className="bg-accent text-white px-4 py-3 shadow-lg sticky top-0 z-10 safe-top">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {student && <p className="text-xl font-bold truncate">{studentFullName(student)}</p>}
            <p className="text-xs text-white/60 truncate">{subject ? subjectDisplayNameSafe(subject) : ''}</p>
            <p className="text-xs text-white/60 mt-0.5 truncate">{activity.nombre}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {secondsLeft != null && (
              <span className={`flex items-center gap-1 text-sm font-semibold ${secondsLeft < 60 ? 'text-red-200' : 'text-white/90'}`}>
                <Timer size={16} /> {mm}:{String(ss).padStart(2, '0')}
              </span>
            )}
            {inicioMs != null && secondsLeft == null && (
              <span className="flex items-center gap-1 text-xs text-white/70 tabular-nums">
                <Timer size={13} /> {tiempoDisplay}
              </span>
            )}
            <button type="button" onClick={() => setShowExitModal(true)}
              className="flex items-center gap-1 text-xs text-white/70 hover:text-white border border-white/30 rounded px-2 py-1 hover:bg-white/10">
              <LogOut size={13} /> Salir
            </button>
          </div>
        </div>
      </header>

      {showExitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-surface-card rounded-card shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-base font-bold text-on-surface mb-2">¿Salir del juego?</h3>
            <p className="text-sm text-muted mb-3">
              Puedes salir y continuar después desde donde lo dejaste — tu progreso ya está guardado.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowExitModal(false)}
                className="flex-1 py-2 text-sm text-muted border border-outline-variant rounded">
                Seguir jugando
              </button>
              <button type="button" onClick={() => navigate(`/alumno/actividad/${activityId}`)}
                className="flex-1 py-2 text-sm font-medium bg-error text-white rounded">
                Salir ahora
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`px-4 py-6 ${STUDENT_CONTAINER_NARROW}`}>
        {estructura.tipo === 'sopa_letras'
          ? <SopaDeLetrasBoard estructura={estructura} encontradas={encontradas} onEncontrada={handleEncontrada} />
          : <CrucigramaBoard estructura={estructura} celdas={celdas} onCambioCelda={handleCambioCelda} />}

        <div className="flex justify-end mt-4 safe-bottom">
          <button type="button" onClick={handleFinalizar} disabled={finishing}
            className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white font-semibold rounded disabled:opacity-60">
            {finishing ? <Spinner size="sm" /> : <CheckCircle2 size={18} />}
            {finishing ? 'Finalizando…' : 'Finalizar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function subjectDisplayNameSafe(subject) {
  return `${subject?.nombre || ''}${subject?.grupo ? ` — ${subject.grupo}` : ''}`
}
