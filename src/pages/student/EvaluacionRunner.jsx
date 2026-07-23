import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  collection, query, where, getDocs, getDoc, doc, setDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { ChevronLeft, ChevronRight, Timer, CheckCircle2, LogOut, Upload, FileText } from 'lucide-react'
import { getEnrollmentForSubject } from '../../utils/studentLookup'
import { uploadToCloudinary } from '../../utils/cloudinary'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import { resolveFileTypes, isFileAllowed, ALL_FILES_KEY } from '../../config/fileTypes'
import StudentLayout from '../../components/StudentLayout'
import { STUDENT_CONTAINER_NARROW } from '../../config/layout'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { teacherDisplayName } from '../../utils/studentSearch'

// Extensiones aceptadas para preguntas de tipo "subir documento": las mismas
// que maneja toda la app (imágenes, PDF, Word, PowerPoint, Excel, ZIP/RAR).
const ARCHIVO_TYPES = [ALL_FILES_KEY]
const MAX_ARCHIVO_MB = 15

// Fisher-Yates with a numeric seed so the shuffled order is reproducible
// across reloads of the same attempt (the seed is persisted on the submission).
function shuffleWithSeed(arr, seed) {
  const a = [...arr]
  let s = seed
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280
    const j = Math.floor((s / 233280) * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Small deterministic string->int hash, used to derive a per-pregunta shuffle
// seed from its id (combined with the attempt's seed) — no crypto needed,
// just needs to be stable across reloads of the same attempt.
function hashSeed(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 233280
  return h
}

export default function EvaluacionRunner() {
  const { activityId } = useParams()
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [activity, setActivity] = useState(null)
  const [subject, setSubject] = useState(null)
  const [student, setStudent] = useState(null)
  const [teacherName, setTeacherName] = useState('')
  const [submission, setSubmission] = useState(null)
  const [preguntas, setPreguntas] = useState([])
  const [respuestas, setRespuestas] = useState({})
  const [idx, setIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [finishing, setFinishing] = useState(false)
  const [uploadingPregunta, setUploadingPregunta] = useState(null) // pregunta.id mientras sube archivo
  const [secondsLeft, setSecondsLeft] = useState(null)
  const [showExitModal, setShowExitModal] = useState(false)
  const finishedRef = useRef(false)

  // Botón físico de Android: si el modal de "¿Salir?" ya está abierto, atrás lo
  // cierra (cancela el intento de salir); si no está abierto, atrás lo abre en
  // vez de salir directamente — el cronómetro sigue corriendo y el estudiante
  // debe confirmar, igual que con el botón "Salir" en pantalla.
  useBackHandler(() => setShowExitModal(false), showExitModal)
  useBackHandler(() => setShowExitModal(true), !showExitModal)
  useScrollLock(showExitModal)

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

      // Sin inscripción no hay evaluación que correr — mismo guard que en
      // SubjectPage/ActivityPage para URLs directas de asignaturas ajenas.
      const studData = await getEnrollmentForSubject(currentUser, userProfile, actData.asignaturaId)
      if (!studData) {
        toast('No estás inscrito en esta asignatura', 'error')
        navigate('/alumno/dashboard')
        return
      }
      setStudent(studData)
      if (actData.docenteId) {
        getDoc(doc(db, 'users', actData.docenteId))
          .then((s) => { if (s.exists()) { const d = s.data(); setTeacherName(teacherDisplayName(d)) } })
          .catch(() => {})
      }
      const subsSnap = await getDocs(query(
        collection(db, 'submissions'), where('actividadId', '==', activityId), where('alumnoId', '==', studData.id)
      ))
      if (subsSnap.empty || subsSnap.docs[0].data().estadoEvaluacion !== 'en_progreso') {
        navigate(`/alumno/actividad/${activityId}`); return
      }
      const subData = { id: subsSnap.docs[0].id, ...subsSnap.docs[0].data() }
      setSubmission(subData)

      const pregSnap = await getDocs(collection(db, 'activities', activityId, 'preguntas'))
      let lista = pregSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      let seed = subData.ordenSeed
      if (actData.evaluacion?.ordenPreguntas === 'aleatorio') {
        seed = seed || (subData.intentoActual || 1) * 7919 + lista.length
        lista = shuffleWithSeed(lista, seed)
      }
      if (actData.evaluacion?.barajarRespuestas) {
        const baseSeed = seed || (subData.intentoActual || 1) * 7919 + lista.length
        lista = lista.map((p) => p.opciones
          ? { ...p, opciones: shuffleWithSeed(p.opciones, baseSeed + hashSeed(p.id)) }
          : p)
      }
      if (!subData.ordenSeed && (actData.evaluacion?.ordenPreguntas === 'aleatorio' || actData.evaluacion?.barajarRespuestas)) {
        await updateDoc(doc(db, 'submissions', subData.id), { ordenSeed: seed })
      }
      setPreguntas(lista)

      const respSnap = await getDocs(collection(db, 'submissions', subData.id, 'respuestas'))
      const respMap = {}
      respSnap.docs.forEach((d) => {
        const data = d.data()
        respMap[d.id] = data.opcionSeleccionada
          ?? data.textoRespuesta
          ?? (data.archivoURL ? { archivoURL: data.archivoURL, nombreArchivo: data.nombreArchivo || 'Documento' } : null)
      })
      setRespuestas(respMap)

      // Resume the countdown from the original start time, not from now.
      if (actData.evaluacion?.tiempoLimiteMin && subData.tiempoInicio?.seconds) {
        const limitMs = actData.evaluacion.tiempoLimiteMin * 60 * 1000
        const elapsedMs = Date.now() - subData.tiempoInicio.seconds * 1000
        setSecondsLeft(Math.max(0, Math.floor((limitMs - elapsedMs) / 1000)))
      }
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps -- mount-only intencional
  useEffect(() => { if (currentUser) load() }, [activityId, currentUser])

  async function handleSelectOpcion(preguntaId, opcionId) {
    setRespuestas((prev) => ({ ...prev, [preguntaId]: opcionId }))
    try {
      await setDoc(
        doc(db, 'submissions', submission.id, 'respuestas', preguntaId),
        { opcionSeleccionada: opcionId, textoRespuesta: null, respondidaEn: serverTimestamp() },
        { merge: true }
      )
    } catch (err) {
      toast('No se pudo guardar tu respuesta: ' + err.message, 'error')
    }
  }

  async function handleTextoChange(preguntaId, texto) {
    setRespuestas((prev) => ({ ...prev, [preguntaId]: texto }))
    try {
      await setDoc(
        doc(db, 'submissions', submission.id, 'respuestas', preguntaId),
        { textoRespuesta: texto, opcionSeleccionada: null, respondidaEn: serverTimestamp() },
        { merge: true }
      )
    } catch (err) {
      toast('No se pudo guardar tu respuesta: ' + err.message, 'error')
    }
  }

  // Pregunta de tipo "subir documento": validar extensión/tamaño, subir a
  // Cloudinary y persistir la referencia como respuesta de esta pregunta.
  async function handleArchivoChange(preguntaId, file) {
    if (!file) return
    if (!isFileAllowed(file, ARCHIVO_TYPES, '')) {
      toast('Tipo de archivo no permitido. Usa imágenes, PDF, Word, PowerPoint, Excel o ZIP/RAR.', 'error')
      return
    }
    if (file.size > MAX_ARCHIVO_MB * 1024 * 1024) {
      toast(`El archivo supera el máximo de ${MAX_ARCHIVO_MB} MB`, 'error')
      return
    }
    setUploadingPregunta(preguntaId)
    try {
      const url = await uploadToCloudinary(file, 'evalua-facil/submissions')
      await setDoc(
        doc(db, 'submissions', submission.id, 'respuestas', preguntaId),
        {
          archivoURL: url, nombreArchivo: file.name, tamanoArchivo: file.size,
          opcionSeleccionada: null, textoRespuesta: null, respondidaEn: serverTimestamp(),
        },
        { merge: true }
      )
      setRespuestas((prev) => ({ ...prev, [preguntaId]: { archivoURL: url, nombreArchivo: file.name } }))
    } catch (err) {
      toast('No se pudo subir tu archivo: ' + err.message, 'error')
    } finally {
      setUploadingPregunta(null)
    }
  }

  async function handleFinalizar() {
    if (finishedRef.current) return
    finishedRef.current = true
    setFinishing(true)
    try {
      // La calificación se calcula en el SERVIDOR (Cloud Function
      // onEvaluacionFinalizada) a partir de las respuestas ya autoguardadas —
      // el cliente solo marca el intento como finalizado. Las reglas de
      // Firestore le prohíben al alumno escribir calificacion/intentos/
      // puntosObtenidos, así que un cliente modificado no puede inventarse
      // su nota.
      await updateDoc(doc(db, 'submissions', submission.id), {
        estadoEvaluacion: 'finalizado',
        estado: 'entregado',
        fechaEntrega: serverTimestamp(),
      })
      toast('Evaluación finalizada')
      // El flag en el state de navegación le dice a ActivityPage que dispare
      // la celebración de "ya entregaste" — solo la primera vez que llega ahí
      // desde este finalizar, no en cada visita/recarga posterior.
      navigate(`/alumno/actividad/${activityId}`, { state: { justFinished: true } })
    } catch (err) {
      finishedRef.current = false
      toast('Error al finalizar: ' + err.message, 'error')
    } finally {
      setFinishing(false)
    }
  }

  // Countdown tick + auto-finish when it hits zero.
  useEffect(() => {
    if (secondsLeft == null) return
    if (secondsLeft <= 0) {
      if (!finishedRef.current) handleFinalizar()
      return
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps
  }, [secondsLeft])

  if (loading || !activity) return (
    <div className="fixed inset-0 z-50 bg-surface flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  )

  if (preguntas.length === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-surface flex items-center justify-center">
        <p className="text-sm text-slate-400">Esta evaluación no tiene preguntas.</p>
      </div>
    )
  }

  const navegacionLibre = activity.evaluacion?.navegacion !== 'secuencial'
  const pregunta = preguntas[idx]
  const isLast = idx === preguntas.length - 1
  const mm = secondsLeft != null ? Math.floor(secondsLeft / 60) : null
  const ss = secondsLeft != null ? secondsLeft % 60 : null

  return (
    <div className="fixed inset-0 z-50 bg-surface overflow-y-auto" {...subjectPaletteProps(subject?.colorPalette)}>
        <header className="bg-accent text-white px-4 py-3 shadow-lg sticky top-0 z-10 safe-top">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {student && (
                <p className="text-xl font-bold truncate">
                  {[student.apellidoPaterno, student.apellidoMaterno, student.nombre].filter(Boolean).join(' ')}
                </p>
              )}
              <p className="text-xs text-white/60 truncate">
                {subject ? `${subject.nombre}${subject.grupo ? ` — ${subject.grupo}` : ''}` : ''}
                {teacherName ? ` · ${teacherName}` : ''}
              </p>
              <p className="text-xs text-white/60 mt-0.5 truncate">
                {activity.nombre}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {secondsLeft != null && (
                <span className={`flex items-center gap-1 text-sm font-semibold ${secondsLeft < 60 ? 'text-red-200' : 'text-white/90'}`}>
                  <Timer size={16} /> {mm}:{String(ss).padStart(2, '0')}
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
              <h3 className="text-base font-bold text-on-surface mb-2">¿Salir de la evaluación?</h3>
              <p className="text-sm text-muted mb-1">
                Puedes salir y continuar después desde donde lo dejaste — tus respuestas ya están guardadas.
              </p>
              {activity.evaluacion?.tiempoLimiteMin && (
                <p className="text-sm text-amber-600 font-medium mb-3">
                  ⚠ El tiempo sigue corriendo aunque salgas. Tienes {activity.evaluacion.tiempoLimiteMin} min en total y el cronómetro no se detiene.
                </p>
              )}
              {!activity.evaluacion?.tiempoLimiteMin && (
                <p className="text-sm text-muted mb-3">Esta evaluación no tiene límite de tiempo.</p>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowExitModal(false)}
                  className="flex-1 py-2 text-sm text-muted border border-outline-variant rounded">
                  Continuar respondiendo
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
          <div className="flex items-center justify-between mb-2">
            <span className="inline-flex items-center gap-1.5 bg-accent-light text-accent text-sm font-bold px-3 py-1 rounded-full">
              Pregunta {idx + 1} <span className="font-medium text-accent/70">de {preguntas.length}</span>
            </span>
          </div>
          <div className="w-full h-1.5 bg-surface-container rounded-full mb-5 overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${((idx + 1) / preguntas.length) * 100}%` }} />
          </div>

          <div className="bg-surface-card rounded-card p-4 shadow-card mb-4">
            {pregunta.imagenUrl && (
              <img src={pregunta.imagenUrl} alt="" className="w-full max-h-64 object-contain rounded mb-3 border border-outline-variant" />
            )}
            <p className="text-base font-medium text-on-surface mb-4 break-words">{pregunta.enunciado}</p>

            {pregunta.tipo === 'respuesta_corta' ? (
              <textarea
                value={respuestas[pregunta.id] || ''}
                onChange={(e) => handleTextoChange(pregunta.id, e.target.value)}
                rows={4}
                placeholder="Escribe tu respuesta…"
                className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
              />
            ) : pregunta.tipo === 'subir_archivo' ? (
              <div className="space-y-2">
                {respuestas[pregunta.id]?.archivoURL && (
                  <div className="flex items-center gap-2 p-3 rounded border border-emerald-300 bg-emerald-50 text-sm text-emerald-700">
                    <FileText size={17} className="flex-shrink-0" />
                    <span className="truncate flex-1">{respuestas[pregunta.id].nombreArchivo}</span>
                    <CheckCircle2 size={16} className="flex-shrink-0" />
                  </div>
                )}
                <label className={`flex flex-col items-center justify-center gap-1.5 p-5 rounded border-2 border-dashed cursor-pointer transition-colors ${
                  uploadingPregunta === pregunta.id ? 'border-outline-variant opacity-60 pointer-events-none' : 'border-accent/40 hover:bg-[var(--accent-tint)]'
                }`}>
                  {uploadingPregunta === pregunta.id ? <Spinner size="sm" /> : <Upload size={22} className="text-accent" />}
                  <span className="text-sm font-medium text-on-surface">
                    {uploadingPregunta === pregunta.id
                      ? 'Subiendo…'
                      : respuestas[pregunta.id]?.archivoURL ? 'Cambiar documento' : 'Toca para subir tu documento'}
                  </span>
                  <span className="text-xs text-muted text-center">
                    Imágenes, PDF, Word, PowerPoint, Excel o ZIP/RAR · máx. {MAX_ARCHIVO_MB} MB
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    accept={resolveFileTypes(ARCHIVO_TYPES, '').accept}
                    onChange={(e) => { handleArchivoChange(pregunta.id, e.target.files?.[0] || null); e.target.value = '' }}
                  />
                </label>
                <p className="text-xs text-slate-400 italic">Tu maestro revisará el documento para asignar los puntos.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {pregunta.opciones.map((o) => (
                  <label key={o.id}
                    className="flex items-center gap-3 p-3 rounded border cursor-pointer transition-colors hover:bg-[var(--accent-tint)]"
                    style={{
                      borderColor: respuestas[pregunta.id] === o.id ? 'var(--accent)' : '#e2e8f0',
                      background: respuestas[pregunta.id] === o.id ? 'var(--accent-light)' : '',
                    }}>
                    <input type="radio" name={`pregunta-${pregunta.id}`} checked={respuestas[pregunta.id] === o.id}
                      onChange={() => handleSelectOpcion(pregunta.id, o.id)} className="accent-[var(--accent)] flex-shrink-0" />
                    <span className="text-sm text-on-surface break-words">{o.texto}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 safe-bottom">
            {navegacionLibre ? (
              <button type="button" disabled={idx === 0} onClick={() => setIdx((i) => i - 1)}
                className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-muted disabled:opacity-60 rounded">
                <ChevronLeft size={18} /> Anterior
              </button>
            ) : <span />}

            {isLast ? (
              <button type="button" onClick={handleFinalizar} disabled={finishing}
                className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white font-semibold rounded disabled:opacity-60">
                {finishing ? <Spinner size="sm" /> : <CheckCircle2 size={18} />}
                {finishing ? 'Finalizando…' : 'Finalizar evaluación'}
              </button>
            ) : (
              <button type="button" onClick={() => setIdx((i) => i + 1)}
                className="flex items-center gap-1 px-5 py-2.5 bg-accent text-white font-semibold rounded">
                Siguiente <ChevronRight size={18} />
              </button>
            )}
          </div>
        </div>
    </div>
  )
}
