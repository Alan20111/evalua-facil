import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  arrayUnion,
  doc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import {
  ArrowLeft, Upload, CheckCircle, Clock, FileText, Star,
  MessageSquare, Download, X,
} from 'lucide-react'
import { resolveFileTypes, isFileAllowed, allowsMultipleFiles, MAX_IMAGES_PER_SUBMISSION } from '../../config/fileTypes'
import { subjectDisplayName } from '../../utils/subjectName'
import { isActivityPublished } from '../../utils/activityVisibility'
import { getEnrollmentForSubject } from '../../utils/studentLookup'
import { sanitizeHtml, richTextContentClass, toRichHtml } from '../../utils/sanitizeHtml'
import AttachmentList from '../../components/AttachmentList'
import { downloadUrl } from '../../utils/cloudinary'
import StudentLayout from '../../components/StudentLayout'
import { PlayCircle, ListChecks, Timer, RotateCcw } from 'lucide-react'
import { STUDENT_CONTAINER_NARROW } from '../../config/layout'

async function uploadToCloudinary(file) {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
  const formData = new FormData()
  formData.append('file', file)
  formData.append('upload_preset', uploadPreset)
  formData.append('folder', 'evalua-facil/submissions')
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
    { method: 'POST', body: formData }
  )
  if (!res.ok) throw new Error('Error al subir archivo a Cloudinary')
  return (await res.json()).secure_url
}

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const hasTime = dateStr.includes('T')
  // YYYY-MM-DD is parsed as UTC midnight; append T00:00:00 to force local time
  const d = new Date(hasTime ? dateStr : dateStr + 'T00:00:00')
  const datePart = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
  if (!hasTime) return datePart
  const timePart = d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })
  return `${datePart}, ${timePart} hrs`
}

export default function StudentActivityPage() {
  const { activityId } = useParams()
  const { currentUser, userProfile } = useAuth()
  const [activity, setActivity] = useState(null)
  const [activityLabel, setActivityLabel] = useState(null)
  const [subject, setSubject] = useState(null)
  const [student, setStudent] = useState(null)
  const [submission, setSubmission] = useState(null)
  // Up to MAX_IMAGES_PER_SUBMISSION images per submission; 1 file for other types
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const toast = useToast()

  // Real-time listener: keeps activity fresh when teacher saves changes (extensions, edits)
  useEffect(() => {
    if (!activityId) return
    const unsub = onSnapshot(doc(db, 'activities', activityId), (snap) => {
      if (snap.exists()) setActivity({ id: snap.id, ...snap.data() })
    })
    return () => unsub()
  }, [activityId])

  // One-time load for everything else (student, subject, submission). Guarded on
  // `currentUser` — on a fresh/incognito session Firebase Auth may not have restored
  // yet on first mount, and firing these reads before then gets rejected by Firestore
  // rules with no retry since this effect didn't depend on `currentUser`.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps -- mount-only intencional
  useEffect(() => { if (currentUser) loadOther() }, [activityId, userProfile?.studentId, currentUser])

  async function loadOther() {
    setLoading(true)
    try {
      const actSnap = await getDoc(doc(db, 'activities', activityId))
      if (!actSnap.exists()) {
        toast('Actividad no encontrada', 'error')
        navigate('/alumno/dashboard')
        return
      }
      const actData = { id: actSnap.id, ...actSnap.data() }

      // Subject is needed before the gate check below — a whole parcial can be
      // hidden from students at the subject level, which must override an
      // individual activity's own visibility.
      const subSnap = await getDoc(doc(db, 'subjects', actData.asignaturaId))
      const subData = { id: subSnap.id, ...subSnap.data() }
      const parcialOculto = (subData.parcialesOcultos || []).includes(actData.parcial)

      // Students must never reach a hidden/scheduled activity, even via a direct URL.
      if (!isActivityPublished(actData, parcialOculto)) {
        toast('Esta actividad no está disponible', 'error')
        navigate('/alumno/dashboard')
        return
      }
      setActivity(actData)
      setSubject(subData)

      // Número de actividad (1.1., 1.2., …): igual que en la lista y en la vista
      // del docente — posición entre las hermanas NO borrador del mismo parcial,
      // ordenadas por `orden`.
      try {
        const sibSnap = await getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', actData.asignaturaId)))
        const isDraftAct = (a) => a.oculta && !a.publishedAt && !a.publishAt
        const sibs = sibSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .filter((a) => !isDraftAct(a))
          .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        const countByParcial = {}
        let label = null
        for (const a of sibs) {
          countByParcial[a.parcial] = (countByParcial[a.parcial] || 0) + 1
          if (a.id === actData.id) { label = `${a.parcial}.${countByParcial[a.parcial]}.`; break }
        }
        setActivityLabel(label)
      } catch {
        setActivityLabel(null)
      }

      // Resolve this student's enrollment record for the activity's subject.
      const studData = await getEnrollmentForSubject(currentUser, userProfile, actData.asignaturaId)
      setStudent(studData)

      const subsSnap = studData
        ? await getDocs(query(
            collection(db, 'submissions'),
            where('actividadId', '==', activityId),
            where('alumnoId', '==', studData.id)
          ))
        : null
      if (subsSnap && !subsSnap.empty) {
        setSubmission({ id: subsSnap.docs[0].id, ...subsSnap.docs[0].data() })
      }
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  function buildHistoryEntry() {
    return {
      archivoURL: submission?.archivoURL ?? null,
      nombreArchivo: submission?.nombreArchivo ?? null,
      archivos: submission?.archivos ?? null,
      completadoSinArchivo: !!submission?.completadoSinArchivo,
      fechaEntrega: submission?.fechaEntrega ?? null,
    }
  }

  const isImageFile = (f) => (f.type || '').startsWith('image/') || /\.(jpe?g|png)$/i.test(f.name)

  // Handles a fresh selection from the file input. Photos ADD to the current
  // selection (several rounds allowed, up to the max) so the student can remove
  // one and browse for another; any non-image pick replaces the selection and
  // goes alone.
  function selectFiles(list) {
    if (!list.length) return
    if (!list.every(isImageFile) || !files.every(isImageFile)) {
      if (list.length > 1) {
        toast('Para subir varios archivos a la vez, todos deben ser imágenes (JPG, PNG). Otros tipos se suben de uno en uno.', 'error')
        return
      }
      setFiles([list[0]])
      return
    }
    // Merge, ignoring files already in the selection (same name and size)
    let combined = [...files, ...list].filter(
      (f, i, arr) => arr.findIndex((g) => g.name === f.name && g.size === f.size) === i
    )
    if (combined.length > MAX_IMAGES_PER_SUBMISSION) {
      toast(`Máximo ${MAX_IMAGES_PER_SUBMISSION} imágenes por entrega — se tomaron las primeras ${MAX_IMAGES_PER_SUBMISSION}`, 'error')
      combined = combined.slice(0, MAX_IMAGES_PER_SUBMISSION)
    }
    setFiles(combined)
  }

  function removeSelectedFile(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleUpload() {
    if (!files.length) return
    if (!student) { toast('No se encontró tu perfil. Cierra sesión y vuelve a entrar.', 'error'); return }
    for (const f of files) {
      if (!isFileAllowed(f, activity?.tiposArchivo || 'todos', activity?.extensionesCustom)) {
        toast(`Solo se permiten: ${resolveFileTypes(activity?.tiposArchivo || 'todos', activity?.extensionesCustom).accept}`, 'error'); return
      }
      if (f.size > 5 * 1024 * 1024) { toast(`"${f.name}" supera los 5 MB — cada archivo debe pesar menos de 5 MB`, 'error'); return }
    }
    setUploading(true)
    try {
      const uploaded = await Promise.all(
        files.map(async (f) => ({ url: await uploadToCloudinary(f), nombre: f.name, tamano: f.size }))
      )
      // `archivoURL`/`nombreArchivo` stay as the FIRST file so every existing
      // reader (teacher list, previews, ZIP export) keeps working; `archivos`
      // carries the full set when there is more than one.
      const payload = {
        archivoURL: uploaded[0].url,
        nombreArchivo: uploaded[0].nombre,
        archivos: uploaded,
        completadoSinArchivo: false,
        fechaEntrega: serverTimestamp(),
        calificacion: null,
        comentario: '',
        estado: 'entregado',
        tarde: isPastDeadline,
      }
      if (submission) {
        // Re-submit: archive current version, update doc
        await updateDoc(doc(db, 'submissions', submission.id), {
          ...payload,
          historial: arrayUnion(buildHistoryEntry()),
        })
        toast('Versión corregida entregada')
      } else {
        await addDoc(collection(db, 'submissions'), {
          alumnoId: student.id,
          actividadId: activityId,
          ...payload,
          historial: [],
        })
        toast(files.length > 1 ? `Tarea entregada — ${files.length} imágenes` : 'Tarea entregada')
      }
      setFiles([])
      loadOther()
    } catch (err) {
      toast('Error al subir: ' + err.message, 'error')
    } finally {
      setUploading(false)
    }
  }

  async function handleMarkComplete() {
    if (!student) { toast('No se encontró tu perfil. Cierra sesión y vuelve a entrar.', 'error'); return }
    setUploading(true)
    try {
      if (submission) {
        await updateDoc(doc(db, 'submissions', submission.id), {
          archivoURL: null,
          nombreArchivo: null,
          archivos: null,
          completadoSinArchivo: true,
          fechaEntrega: serverTimestamp(),
          calificacion: null,
          comentario: '',
          estado: 'entregado',
          tarde: isPastDeadline,
          historial: arrayUnion(buildHistoryEntry()),
        })
        toast('Versión corregida marcada como completada')
      } else {
        await addDoc(collection(db, 'submissions'), {
          alumnoId: student.id,
          actividadId: activityId,
          archivoURL: null,
          nombreArchivo: null,
          completadoSinArchivo: true,
          fechaEntrega: serverTimestamp(),
          calificacion: null,
          comentario: '',
          estado: 'entregado',
          tarde: isPastDeadline,
          historial: [],
        })
        toast('Tarea marcada como completada')
      }
      loadOther()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setUploading(false)
    }
  }

  async function handleStartOrContinueEvaluacion() {
    if (!student) { toast('No se encontró tu perfil. Cierra sesión y vuelve a entrar.', 'error'); return }
    setUploading(true)
    try {
      if (submission && submission.estadoEvaluacion === 'en_progreso') {
        navigate(`/alumno/evaluacion/${activityId}`)
        return
      }
      if (submission) {
        await updateDoc(doc(db, 'submissions', submission.id), {
          estadoEvaluacion: 'en_progreso',
          intentoActual: (submission.intentos?.length || 0) + 1,
          tiempoInicio: serverTimestamp(),
        })
      } else {
        await addDoc(collection(db, 'submissions'), {
          alumnoId: student.id,
          alumnoUid: currentUser.uid,
          actividadId: activityId,
          calificacion: null,
          comentario: '',
          estado: 'pendiente',
          historial: [],
          estadoEvaluacion: 'en_progreso',
          intentoActual: 1,
          intentos: [],
          tiempoInicio: serverTimestamp(),
        })
      }
      navigate(`/alumno/evaluacion/${activityId}`)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setUploading(false)
    }
  }

  if (loading) return (
    <StudentLayout>
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    </StudentLayout>
  )

  if (activity?.tipo === 'evaluacion') {
    const ev = activity.evaluacion || {}
    const intentosUsados = submission?.intentos?.length || 0
    const enProgreso = submission?.estadoEvaluacion === 'en_progreso'
    const finalizado = submission?.estadoEvaluacion === 'finalizado'
    const sinIntentosRestantes = ev.intentosPermitidos != null && intentosUsados >= ev.intentosPermitidos && !enProgreso
    const ahoraISO = new Date().toISOString()
    const resultadosVisibles = finalizado && (
      ev.publicarResultados === 'inmediato' ||
      (ev.publicarResultados === 'fecha' && ev.publicarResultadosFecha && ahoraISO >= ev.publicarResultadosFecha) ||
      (ev.publicarResultados === 'manual' && ev.resultadosPublicados)
    )
    return (
      <StudentLayout>
        <div className="bg-surface" data-subject-palette={subject?.colorPalette || 'default'}>
          <header className="bg-surface-card border-b border-outline-variant px-4 py-3 flex items-center gap-3 shadow-card">
            <button type="button" aria-label="Volver" onClick={() => navigate(`/alumno/materia/${activity?.asignaturaId}`)} className="p-2 -ml-2 text-slate-400 hover:text-muted rounded flex-shrink-0">
              <ArrowLeft size={22} />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-on-surface truncate">
            {activityLabel && <span className="text-accent">{activityLabel} </span>}
            {activity?.nombre}
          </h1>
              <p className="text-slate-400 text-xs truncate">{subjectDisplayName(subject)} · Parcial {activity?.parcial}</p>
            </div>
          </header>

          <div className={`px-4 py-5 ${STUDENT_CONTAINER_NARROW} space-y-3`}>
            {finalizado && (
              <div className="bg-surface-card rounded-card p-4 shadow-card">
                {submission.pendienteRevision ? (
                  <p className="text-sm text-muted flex items-center gap-2">
                    <Clock size={17} className="flex-shrink-0" />
                    Tu evaluación fue entregada — algunas preguntas requieren revisión de tu maestro, tu calificación se actualizará cuando termine.
                  </p>
                ) : resultadosVisibles ? (
                  <>
                    <div className="flex items-center gap-3 mb-3">
                      <Star size={22} className="text-amber-400" />
                      <h2 className="font-semibold text-on-surface">Tu calificación</h2>
                    </div>
                    <div className="flex items-end gap-2">
                      <span className="text-5xl font-bold text-accent">{submission.calificacion}</span>
                      <span className="text-xl text-slate-400 mb-1">/{activity?.maxCalif}</span>
                      {ev.mostrarPorcentaje && (
                        <span className="text-sm text-muted mb-1.5">({Math.round((submission.calificacion / (activity?.maxCalif || 10)) * 100)}%)</span>
                      )}
                    </div>
                    {(ev.mostrarRespuestasCorrectas || ev.mostrarRetroalimentacion) && (
                      <button
                        type="button"
                        onClick={() => navigate(`/alumno/evaluacion/${activityId}/revision`)}
                        className="mt-3 text-sm font-medium text-accent hover:underline"
                      >
                        Ver revisión de tus respuestas
                      </button>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted flex items-center gap-2"><Clock size={17} /> Resultados pendientes de publicación</p>
                )}
              </div>
            )}

            {activity?.instrucciones && (
              <div className="bg-surface-card rounded-card p-4 shadow-card">
                <h2 className="font-semibold text-on-surface mb-2">Instrucciones</h2>
                <div
                  className={`text-sm text-on-surface leading-relaxed break-words [overflow-wrap:anywhere] ${richTextContentClass}`}
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(toRichHtml(activity.instrucciones)) }}
                />
              </div>
            )}

            <div className="bg-surface-card rounded-card p-4 shadow-card space-y-2">
              <h2 className="font-semibold text-on-surface mb-1">Resumen</h2>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted flex items-center gap-1.5"><ListChecks size={16} /> Número de preguntas</span>
                <span className="font-semibold text-on-surface">{ev.numPreguntas || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted flex items-center gap-1.5"><Timer size={16} /> Tiempo disponible</span>
                <span className="font-semibold text-on-surface">{ev.tiempoLimiteMin ? `${ev.tiempoLimiteMin} min` : 'Sin límite'}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted flex items-center gap-1.5"><RotateCcw size={16} /> Intentos</span>
                <span className="font-semibold text-on-surface">
                  {ev.intentosPermitidos ? `${intentosUsados}/${ev.intentosPermitidos}` : `${intentosUsados} (ilimitados)`}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Navegación</span>
                <span className="font-semibold text-on-surface">{ev.navegacion === 'secuencial' ? 'Secuencial — no puedes regresar' : 'Libre'}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Calificación a conservar</span>
                <span className="font-semibold text-on-surface">
                  {ev.conservar === 'mejor' ? 'La más alta' : ev.conservar === 'primero' ? 'El primer intento' : ev.conservar === 'promedio' ? 'El promedio de tus intentos' : 'El último intento'}
                </span>
              </div>
            </div>

            {!enProgreso && !finalizado && (
              <p className="text-xs text-muted bg-surface-container rounded p-3">
                Una vez que inicies, el cronómetro comenzará y tus respuestas se guardarán automáticamente.
              </p>
            )}

            {(ev.numPreguntas || 0) === 0 ? (
              <div className="bg-surface-card rounded-card p-4 shadow-card text-center text-sm text-slate-400">
                Tu maestro aún no ha agregado preguntas a esta evaluación.
              </div>
            ) : sinIntentosRestantes ? (
              <div className="bg-surface-card rounded-card p-4 shadow-card text-center text-sm text-slate-400">
                Ya usaste todos tus intentos disponibles.
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStartOrContinueEvaluacion}
                disabled={uploading}
                className="w-full py-2.5 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {uploading ? <Spinner size="sm" /> : <PlayCircle size={20} />}
                {uploading ? 'Cargando…' : enProgreso ? 'Continuar evaluación' : finalizado ? 'Nuevo intento' : 'Comenzar'}
              </button>
            )}
          </div>
        </div>
      </StudentLayout>
    )
  }

  const isGraded = submission?.calificacion != null
  const isDelivered = !!submission && !isGraded
  const noFile = submission?.completadoSinArchivo
  // Observación: no delivery from the student — the teacher grades directly
  const isObservacion = activity?.tipo === 'observacion' || activity?.categoria === 'observacion'

  // Extended deadline for this student (set by teacher)
  const extendedDate = activity?.extensiones?.[student?.id]
  const displayDate = extendedDate || activity?.fechaLimite
  // Can re-submit if teacher gave an extension and task isn't graded yet
  const canResubmit = !!extendedDate && !isGraded && !!submission
  // Legacy deadlines stored as a plain date (no time) close at end of day
  const isPastDeadline = !!displayDate && new Date(
    displayDate.includes('T') ? displayDate : `${displayDate}T23:59:59`
  ).getTime() < Date.now()
  // A student inside their own extension can always deliver, even if the
  // activity was closed for everyone else.
  const withinExtension = !!extendedDate && !isPastDeadline
  // Activity is closed to new submissions when the teacher closed it manually,
  // or the deadline passed and late delivery is NOT enabled.
  const cerrada = !withinExtension && (
    !!activity?.cerradaManual || (isPastDeadline && !activity?.recibirTarde)
  )

  return (
    <StudentLayout>
    <div className="bg-surface" data-subject-palette={subject?.colorPalette || 'default'}>
      <header className="bg-surface-card border-b border-outline-variant px-4 py-3 flex items-center gap-3 shadow-card">
        <button
          type="button"
          aria-label="Volver"
          onClick={() => navigate(`/alumno/materia/${activity?.asignaturaId}`)}
          className="p-2 -ml-2 text-slate-400 hover:text-muted rounded flex-shrink-0"
        >
          <ArrowLeft size={22} />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-on-surface truncate">
            {activityLabel && <span className="text-accent">{activityLabel} </span>}
            {activity?.nombre}
          </h1>
          <p className="text-slate-400 text-xs truncate">{subjectDisplayName(subject)} · Parcial {activity?.parcial}</p>
        </div>
      </header>

      <div className={`px-4 py-5 ${STUDENT_CONTAINER_NARROW} space-y-3`}>
        {/* Status */}
        <div className={`rounded-card p-4 flex items-center gap-3 ${
          isGraded ? 'bg-emerald-50 border border-emerald-200' :
          isDelivered ? 'bg-accent-light border border-accent' :
          'bg-surface border border-outline-variant'
        }`}>
          {isGraded ? <CheckCircle size={26} className="text-emerald-500 flex-shrink-0" />
            : isDelivered ? <Clock size={26} className="text-accent flex-shrink-0" />
            : <FileText size={26} className="text-slate-400 flex-shrink-0" />}
          <div className="min-w-0">
            <p className="font-semibold text-on-surface text-sm">
              {isGraded ? 'Calificado'
                : isDelivered ? 'Entregado — pendiente de calificación'
                : isObservacion ? 'Por calificar — tu profesor evalúa esta actividad directamente, no requiere entrega'
                : 'Pendiente de entrega'}
            </p>
            {isDelivered && (
              <p className="text-xs text-muted mt-0.5 flex items-center gap-1 min-w-0">
                {noFile
                  ? <><CheckCircle size={14} className="flex-shrink-0" /> Completada sin archivo</>
                  : <><FileText size={14} className="flex-shrink-0" /> <span className="truncate">{submission.nombreArchivo}</span></>}
              </p>
            )}
          </div>
        </div>

        {/* View submitted file(s) */}
        {submission && !submission.completadoSinArchivo && submission.archivoURL && (
          <div className="bg-surface-card rounded-card p-4 shadow-card">
            <p className="text-xs font-medium text-muted mb-2">
              Tu entrega{submission.archivos?.length > 1 ? ` — ${submission.archivos.length} imágenes` : ''}
            </p>
            <div className="space-y-1.5">
              {(submission.archivos?.length ? submission.archivos : [{ url: submission.archivoURL, nombre: submission.nombreArchivo }]).map((f, i) => (
                <a
                  key={`${f.url}-${i}`}
                  href={downloadUrl(f.url, f.nombre)}
                  download={f.nombre}
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-2.5 bg-surface rounded border border-outline-variant text-sm text-muted hover:bg-accent-light hover:border-accent transition-colors"
                >
                  <Download size={17} className="text-accent flex-shrink-0" />
                  <span className="truncate">{f.nombre}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Grade */}
        {isGraded && (
          <div className="bg-surface-card rounded-card p-4 shadow-card">
            <div className="flex items-center gap-3 mb-3">
              <Star size={22} className="text-amber-400" />
              <h2 className="font-semibold text-on-surface">Tu calificación</h2>
            </div>
            <div className="flex items-end gap-2 mb-3">
              <span className="text-5xl font-bold text-accent">{submission.calificacion}</span>
              <span className="text-xl text-slate-400 mb-1">/{activity?.maxCalif}</span>
            </div>
            {submission.comentario && (
              <div className="bg-surface rounded p-3 flex gap-2">
                <MessageSquare size={17} className="text-slate-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-muted italic">"{submission.comentario}"</p>
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        {activity?.instrucciones && (
          <div className="bg-surface-card rounded-card p-4 shadow-card">
            <h2 className="font-semibold text-on-surface mb-2">Instrucciones</h2>
            <div
              className={`text-sm text-on-surface leading-relaxed break-words [overflow-wrap:anywhere] ${richTextContentClass}`}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(toRichHtml(activity.instrucciones)) }}
            />
            <AttachmentList files={activity?.archivosAdjuntos} />
          </div>
        )}

        {/* Info */}
        <div className="bg-surface-card rounded-card p-4 shadow-card">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Calificación máxima</span>
            <span className="font-semibold text-on-surface">{activity?.maxCalif} pts</span>
          </div>
          {displayDate && (
            <div className="flex items-center justify-between text-sm mt-2">
              <span className="text-muted">
                {extendedDate ? 'Fecha límite (extendida)' : 'Fecha límite'}
              </span>
              <span className={`font-semibold ${extendedDate ? 'text-orange-600' : 'text-on-surface'}`}>
                {fmtDate(displayDate)}
              </span>
            </div>
          )}
        </div>

        {/* Upload (never shown for observación — nothing to deliver) */}
        {!isObservacion && (!submission || canResubmit) && cerrada && (
          <div className="bg-surface-card rounded-card p-4 shadow-card text-center text-sm text-slate-400">
            {activity?.cerradaManual
              ? 'El docente cerró esta actividad. Ya no se reciben entregas.'
              : 'El plazo de entrega para esta actividad ya cerró.'}
          </div>
        )}
        {!isObservacion && (!submission || canResubmit) && !cerrada && (
          <div className="bg-surface-card rounded-card p-4 shadow-card">
            <h2 className="font-semibold text-on-surface mb-1">
              {canResubmit ? 'Subir versión corregida' : 'Subir entrega'}
            </h2>
            {isPastDeadline && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 mb-3">
                La fecha límite ya pasó. Tu entrega se registrará como <strong>entrega tarde</strong>.
              </p>
            )}
            {canResubmit && (
              <p className="text-xs text-orange-500 mb-3">
                Tu maestro extendió la fecha — puedes subir una corrección.
              </p>
            )}
            <div className="space-y-3">
              <label className={`flex flex-col items-center justify-center w-full h-28 sm:h-32 px-3 border-2 border-dashed rounded cursor-pointer transition-colors ${
                files.length ? 'border-accent bg-accent-light' : 'border-outline-variant hover:border-accent hover:bg-surface'
              }`}>
                <input
                  type="file"
                  accept={resolveFileTypes(activity?.tiposArchivo || 'todos', activity?.extensionesCustom).accept}
                  multiple={allowsMultipleFiles(activity?.tiposArchivo || 'todos')}
                  className="hidden"
                  onChange={(e) => {
                    selectFiles(Array.from(e.target.files || []))
                    // Reset so picking the same file again still fires onChange
                    e.target.value = ''
                  }}
                />
                <Upload size={26} className={`flex-shrink-0 ${files.length ? 'text-accent' : 'text-slate-400'}`} />
                <p className="text-sm mt-2 font-medium text-muted text-center break-words line-clamp-2 max-w-full">
                  {files.length === 0
                    ? (allowsMultipleFiles(activity?.tiposArchivo || 'todos')
                        ? `Toca para seleccionar hasta ${MAX_IMAGES_PER_SUBMISSION} fotos o un archivo`
                        : 'Toca para seleccionar archivo')
                    : files.length === 1
                      ? files[0].name
                      : `${files.length} imágenes seleccionadas`}
                </p>
                <p className="text-sm text-slate-500 mt-1 text-center break-words max-w-full">
                  {resolveFileTypes(activity?.tiposArchivo || 'todos', activity?.extensionesCustom).accept} · máx 5 MB cada uno
                </p>
                {allowsMultipleFiles(activity?.tiposArchivo || 'todos') && files.length === 0 && (
                  <p className="text-xs text-accent mt-0.5 text-center max-w-full">
                    Puedes subir hasta {MAX_IMAGES_PER_SUBMISSION} imágenes a la vez
                  </p>
                )}
              </label>
              {files.length > 0 && (
                <div className="space-y-1">
                  {files.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="flex items-center gap-2 px-3 py-1.5 bg-surface rounded border border-outline-variant text-xs text-muted">
                      <span className="flex-1 truncate">{i + 1}. {f.name}</span>
                      <button
                        type="button"
                        onClick={() => removeSelectedFile(i)}
                        aria-label={`Quitar ${f.name}`}
                        className="p-1 -mr-1 text-slate-400 hover:text-red-500 rounded flex-shrink-0"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                  {allowsMultipleFiles(activity?.tiposArchivo || 'todos') && files.length < MAX_IMAGES_PER_SUBMISSION && files.every(isImageFile) && (
                    <p className="text-xs text-slate-400 text-center pt-0.5">
                      Puedes tocar arriba para agregar más fotos ({files.length}/{MAX_IMAGES_PER_SUBMISSION})
                    </p>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={handleUpload}
                onMouseDown={(e) => e.preventDefault()}
                disabled={!files.length || uploading}
                style={{ touchAction: 'manipulation' }}
                className="w-full py-2.5 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {uploading ? <Spinner size="sm" /> : <Upload size={18} />}
                {uploading ? 'Subiendo…' : files.length > 1 ? `Entregar ${files.length} imágenes` : 'Entregar'}
              </button>
              <button
                type="button"
                onClick={handleMarkComplete}
                onMouseDown={(e) => e.preventDefault()}
                disabled={uploading}
                style={{ touchAction: 'manipulation' }}
                className="w-full py-1.5 text-sm text-slate-500 hover:text-muted transition-colors"
              >
                Marcar como completada sin archivo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </StudentLayout>
  )
}
