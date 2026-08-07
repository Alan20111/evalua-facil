import { useState, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  updateDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  setDoc,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import {
  ArrowLeft, Upload, CheckCircle, Clock, FileText, Star,
  MessageSquare, Download, X,
} from 'lucide-react'
import { resolveFileTypes, isFileAllowed, allowsMultipleFiles, fileTypesInstructions, MAX_IMAGES_PER_SUBMISSION } from '../../config/fileTypes'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import { isActivityPublished, cuentaParaCalificacion } from '../../utils/activityVisibility'
import { publicacionVisible } from '../../utils/evaluacionGrading'
import { normalizeGrade } from '../../utils/ponderacion'
import { getEnrollmentForSubject } from '../../utils/studentLookup'
import { sanitizeHtml, richTextContentClass, toRichHtml } from '../../utils/sanitizeHtml'
import AttachmentList from '../../components/AttachmentList'
import { downloadUrl } from '../../utils/cloudinary'
import StudentLayout from '../../components/StudentLayout'
import Fireworks from '../../components/Fireworks'
import RubricaTable from '../../components/rubrica/RubricaTable'
import { ClipboardList } from 'lucide-react'
import { PlayCircle, ListChecks, Timer, RotateCcw } from 'lucide-react'
import { STUDENT_CONTAINER_NARROW } from '../../config/layout'
import { useBackHandler } from '../../hooks/useBackHandler'
import { formatHora12FromDate } from '../../utils/formatHora'

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
  return `${datePart}, ${formatHora12FromDate(d)}`
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
  // Celebración de "ya entregaste": una tanda breve de fuegos artificiales
  // que confirma la entrega sin que el estudiante tenga que preguntarle al
  // maestro "¿ya le llegó mi trabajo?" — se le pregunta "¿te salieron fuegos
  // artificiales?" en su lugar.
  const [showFireworks, setShowFireworks] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const goBack = () => navigate(`/alumno/materia/${activity?.asignaturaId}`)
  useBackHandler(goBack)

  // Al volver de EvaluacionRunner justo después de finalizar un cuestionario
  // o examen, dispara la celebración UNA sola vez (no en cada visita/recarga
  // posterior a esta misma actividad ya finalizada).
  useEffect(() => {
    if (location.state?.justFinished) {
      setShowFireworks(true)
      navigate(location.pathname, { replace: true, state: {} })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps -- se dispara solo al llegar con el flag, no en cada cambio de location
  }, [])

  // Real-time listener: keeps activity fresh when teacher saves changes (extensions, edits)
  useEffect(() => {
    if (!activityId) return
    const unsub = onSnapshot(doc(db, 'activities', activityId), (snap) => {
      if (snap.exists()) setActivity({ id: snap.id, ...snap.data() })
    })
    return () => unsub()
  }, [activityId])

  // La calificación de una evaluación la escribe el SERVIDOR (Cloud Function
  // onEvaluacionFinalizada) unos instantes después de que el alumno finaliza —
  // este listener refleja esa nota (y cualquier calificación del docente) en
  // vivo, sin que el alumno tenga que recargar.
  useEffect(() => {
    if (!submission?.id) return
    const unsub = onSnapshot(doc(db, 'submissions', submission.id), (snap) => {
      if (snap.exists()) setSubmission({ id: snap.id, ...snap.data() })
    })
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps -- solo re-suscribe al cambiar el doc
  }, [submission?.id])

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
        const sibs = sibSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .filter((a) => cuentaParaCalificacion(a))
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
      // Sin inscripción, fuera: las actividades son de lectura pública y sin este
      // guard cualquier estudiante con la URL vería (e intentaría entregar) una
      // actividad de una asignatura ajena.
      const studData = await getEnrollmentForSubject(currentUser, userProfile, actData.asignaturaId)
      if (!studData) {
        toast('No estás inscrito en esta asignatura', 'error')
        navigate('/alumno/dashboard')
        return
      }
      setStudent(studData)

      const subsSnap = await getDocs(query(
        collection(db, 'submissions'),
        where('actividadId', '==', activityId),
        where('alumnoId', '==', studData.id)
      ))
      if (subsSnap && !subsSnap.empty) {
        setSubmission({ id: subsSnap.docs[0].id, ...subsSnap.docs[0].data() })
      }
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setLoading(false)
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
    // Una sola ocasión de entrega: si ya existe una entrega (por una condición
    // de carrera, doble clic, o una pestaña vieja), rechazar aquí también —
    // no solo ocultar el formulario en el render.
    if (submission) { toast('Ya entregaste esta actividad — espera a que tu maestro la revise.', 'error'); return }
    for (const f of files) {
      if (!isFileAllowed(f, activity?.tiposArchivo || 'todos', activity?.extensionesCustom)) {
        toast(`Solo se permite: ${fileTypesInstructions(activity?.tiposArchivo || 'todos', activity?.extensionesCustom).join(' o ')}`, 'error'); return
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
      await setDoc(doc(db, 'submissions', `${activityId}_${student.id}`), {
        alumnoId: student.id,
        actividadId: activityId,
        archivoURL: uploaded[0].url,
        nombreArchivo: uploaded[0].nombre,
        archivos: uploaded,
        completadoSinArchivo: false,
        fechaEntrega: serverTimestamp(),
        calificacion: null,
        comentario: '',
        estado: 'entregado',
        tarde: isPastDeadline,
        historial: [],
      })
      toast(files.length > 1 ? `Tarea entregada — ${files.length} imágenes` : 'Tarea entregada')
      setFiles([])
      setShowFireworks(true)
      loadOther()
    } catch (err) {
      toast('Error al subir: ' + err.message, 'error')
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
        // Nuevo intento: el mismo documento de submission se reutiliza (ver
        // intentos[] más abajo), pero las respuestas de la subcolección son
        // del intento ANTERIOR — sin limpiarlas, el Runner las encontraba y
        // arrancaba el intento nuevo con todo pre-llenado, como si el alumno
        // ya hubiera contestado sin haber tocado nada.
        // Se limpian (no se borran): las reglas de Firestore permiten
        // ESCRIBIR esta subcolección (el alumno autoguarda su respuesta),
        // pero no están pensadas para DELETE — y esas reglas no las puedo
        // desplegar desde aquí. Dejar los campos en null logra lo mismo:
        // el Runner ya trata un valor null como "sin responder".
        const respAnterioresSnap = await getDocs(collection(db, 'submissions', submission.id, 'respuestas'))
        if (!respAnterioresSnap.empty) {
          const batch = writeBatch(db)
          respAnterioresSnap.docs.forEach((d) => batch.set(d.ref, {
            opcionSeleccionada: null, textoRespuesta: null, otraTexto: null,
            archivoURL: null, nombreArchivo: null, tamanoArchivo: null,
          }, { merge: true }))
          await batch.commit()
        }
        await updateDoc(doc(db, 'submissions', submission.id), {
          estadoEvaluacion: 'en_progreso',
          intentoActual: (submission.intentos?.length || 0) + 1,
          tiempoInicio: serverTimestamp(),
          // La semilla del barajado se BORRA en cada intento nuevo. Vive en el
          // documento para que el orden no cambie si el estudiante recarga a
          // media evaluación, pero como el documento se reutiliza en los
          // reintentos, se quedaba pegada la del primer intento: el Runner
          // hacía `seed = subData.ordenSeed || …`, encontraba la vieja y
          // barajaba EXACTAMENTE igual las 5 veces. Con esto, el Runner
          // calcula una nueva a partir de intentoActual y cada intento sale
          // en distinto orden (ver EvaluacionRunner.jsx).
          ordenSeed: null,
          // El mismo documento se reutiliza en cada reintento (ver intentos[]
          // más abajo) — sin esto, notificadoEntregaDocente se quedaba en true
          // desde el primer intento para siempre, y la Cloud Function
          // (onSubmissionEntregada) nunca volvía a avisarle al docente ni a
          // registrar nada en la Bitácora en los intentos 2, 3, ... N.
          notificadoEntregaDocente: false,
        })
      } else {
        await setDoc(doc(db, 'submissions', `${activityId}_${student.id}`), {
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
    // Deadline gating for evaluaciones — honors this student's per-student extension
    // (set by the teacher via "Modificar fecha de entrega"). An attempt already in
    // progress can always be finished; only starting a NEW one is blocked once closed.
    // Mismo criterio que abajo para las entregas con archivo: la prórroga solo
    // cuenta si hay fecha límite que ampliar. Si no, no hay plazo que vencer.
    const extendedDateEv = activity?.fechaLimite ? activity?.extensiones?.[student?.id] : null
    const deadlineEv = extendedDateEv || activity?.fechaLimite
    // Asignatura archivada = ciclo cerrado: no se empiezan evaluaciones nuevas.
    // Un intento EN CURSO sí se puede terminar (`enProgreso`), igual que con la
    // fecha límite: dejar a alguien a media evaluación sería peor.
    const evaluacionCerrada = (!!subject?.archived && !enProgreso) || (!!deadlineEv && new Date(
      deadlineEv.includes('T') ? deadlineEv : `${deadlineEv}T23:59:59`
    ).getTime() < Date.now() && !enProgreso)
    const ahoraISO = new Date().toISOString()
    // Grade and answers publish independently (see teacher config). Both gate on the
    // attempt being finished first.
    // Sin puntos no hay resultado que mostrar: una encuesta no tiene aciertos
    // que contar, así que no se le enseña un "0" que no significa nada. Con
    // puntos sí se muestra, aunque la actividad no cuente para su calificación
    // (un diagnóstico: sirve saber cómo salió).
    const conPuntos = ev.ponderarReactivos !== false
    const resultadosVisibles = finalizado && conPuntos &&
      publicacionVisible(ev.publicarResultados, ev.publicarResultadosFecha, ev.resultadosPublicados, ahoraISO)
    const respuestasVisibles = finalizado &&
      publicacionVisible(ev.publicarRespuestas || 'inmediato', ev.publicarRespuestasFecha, ev.respuestasPublicadas, ahoraISO)
    // `submission.calificacion` es la que MANDA (la que fija la política
    // "Calificación a conservar" — mejor/primero/promedio/último) y no se
    // toca: es la que cuenta para la materia. Pero con más de un intento eso
    // puede esconder lo que el alumno sacó realmente la última vez — pedido
    // explícito: siempre se le dice el resultado de su última oportunidad, y
    // si su calificación registrada vino de otro intento (porque la política
    // guarda "la más alta" y no fue la última), se le dice en cuál la sacó.
    const intentos = submission?.intentos || []
    const ultimoIntento = intentos[intentos.length - 1] || null
    // Con empate se reporta el PRIMERO en que llegó a esa marca (reduce en vez
    // de Math.max: necesita conservar a qué intento pertenece, no solo el
    // valor). Si el mejor y el último son el mismo puntaje, no hay nada extra
    // que decir — ya se ve en la línea de "última oportunidad".
    const mejorIntento = intentos.reduce((mejor, i) =>
      (!mejor || i.calificacion > mejor.calificacion) ? i : mejor, null)
    return (
      <StudentLayout>
        <Fireworks active={showFireworks} onDone={() => setShowFireworks(false)} />
        <div className="bg-surface" {...subjectPaletteProps(subject?.colorPalette)}>
          <header className="bg-surface-card border-b border-outline-variant px-4 py-3 flex items-center gap-3 shadow-card">
            <button type="button" aria-label="Volver" onClick={goBack} className="p-2 -ml-2 text-slate-400 hover:text-muted rounded flex-shrink-0">
              <ArrowLeft size={22} />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-on-surface truncate">
            {activityLabel && <span className="text-accent">{activityLabel} </span>}
            {activity?.nombre}
          </h1>
              <p className="text-slate-400 text-xs truncate">{subjectDisplayName(subject)} · Parcial {activity?.parcial}</p>
              {((activity?.publishedAt || activity?.publishAt) || deadlineEv) && (
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {(activity?.publishedAt || activity?.publishAt) && (
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <Clock size={12} className="flex-shrink-0" /> Publicado: {fmtDate(activity.publishedAt || activity.publishAt)}
                    </span>
                  )}
                  {deadlineEv && (
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <Clock size={12} className="flex-shrink-0" /> {extendedDateEv ? 'Cierra (extendida):' : 'Cierra:'} {fmtDate(deadlineEv)}
                    </span>
                  )}
                </div>
              )}
            </div>
          </header>

          <div className={`px-4 py-5 space-y-3 ${STUDENT_CONTAINER_NARROW}`}>
            {finalizado && (
              <div className="bg-surface-card rounded-card p-4 shadow-card">
                {/* Grade — published independently from answers */}
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
                        <span className="text-sm text-muted mb-1.5">({Math.round(normalizeGrade(submission.calificacion, activity?.maxCalif, { base: 100 }))}%)</span>
                      )}
                    </div>
                    {/* Con más de un intento: siempre se dice qué sacó en el
                        ÚLTIMO, sin importar que la calificación de arriba —
                        gobernada por "Calificación a conservar" — venga de otro
                        intento distinto (típicamente el mejor). Y si de verdad
                        viene de otro, se dice de cuál. */}
                    {intentos.length > 1 && ultimoIntento && (
                      <div className="mt-3 pt-3 border-t border-outline-variant space-y-1 text-sm text-muted">
                        <p>
                          Resultado de tu última oportunidad (intento {ultimoIntento.numero} de {intentos.length}):{' '}
                          <strong className="text-on-surface">{ultimoIntento.calificacion}/{activity?.maxCalif}</strong>
                        </p>
                        {mejorIntento && mejorIntento.calificacion !== ultimoIntento.calificacion && (
                          <p>
                            Tu calificación más alta fue <strong className="text-on-surface">{mejorIntento.calificacion}/{activity?.maxCalif}</strong>,
                            {' '}obtenida en el intento {mejorIntento.numero}.
                          </p>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted flex items-center gap-2"><Clock size={17} /> Calificación pendiente de publicación</p>
                )}
                {/* Answers — published independently from the grade */}
                {respuestasVisibles && (
                  <button
                    type="button"
                    onClick={() => navigate(`/alumno/evaluacion/${activityId}/revision`)}
                    className="mt-3 text-sm font-medium text-accent hover:underline"
                  >
                    Ver revisión de tus respuestas
                  </button>
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
            ) : evaluacionCerrada ? (
              <div className="bg-surface-card rounded-card p-4 shadow-card text-center text-sm text-slate-400">
                La fecha límite ya pasó — esta evaluación está cerrada.
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

  // Prórroga individual de este estudiante (la pone el docente).
  //
  // Solo cuenta si la actividad TIENE fecha límite. Una prórroga amplía un
  // plazo; no puede inventar uno donde no había. Antes se tomaba la prórroga
  // como `displayDate` aunque `fechaLimite` fuera null, así que en una
  // actividad sin plazo la prórroga se volvía la única fecha y, al pasar,
  // CERRABA una actividad que nunca tuvo vencimiento. Encontrado en
  // producción: "Apunte de la actividad del dia de hoy" (fechaLimite: null,
  // extensiones al 16–20 de julio) le decía a sus estudiantes que el plazo ya
  // había cerrado. Solo se notaba después de anular la entrega, porque hasta
  // entonces la pantalla mostraba la entrega en vez del aviso.
  const extendedDate = activity?.fechaLimite ? activity?.extensiones?.[student?.id] : null
  const displayDate = extendedDate || activity?.fechaLimite
  // Legacy deadlines stored as a plain date (no time) close at end of day
  const isPastDeadline = !!displayDate && new Date(
    displayDate.includes('T') ? displayDate : `${displayDate}T23:59:59`
  ).getTime() < Date.now()
  // A student inside their own extension can always deliver, even if the
  // activity was closed for everyone else.
  const withinExtension = !!extendedDate && !isPastDeadline
  // Activity is closed to new submissions when the teacher closed it manually,
  // or the deadline passed and late delivery is NOT enabled.
  // Asignatura archivada = ciclo cerrado. Va ANTES del `withinExtension`, no
  // dentro: una prórroga individual no puede reabrir una materia que ya
  // terminó. Antes nada de esto miraba el estado de la asignatura, así que el
  // alumno podía seguir entregando en una materia archivada meses atrás.
  const asignaturaArchivada = !!subject?.archived
  const cerrada = asignaturaArchivada || (!withinExtension && (
    !!activity?.cerradaManual || (isPastDeadline && !activity?.recibirTarde)
  ))

  return (
    <StudentLayout>
    <Fireworks active={showFireworks} onDone={() => setShowFireworks(false)} />
    <div className="bg-surface" {...subjectPaletteProps(subject?.colorPalette)}>
      <header className="bg-surface-card border-b border-outline-variant px-4 py-3 flex items-center gap-3 shadow-card">
        <button
          type="button"
          aria-label="Volver"
          onClick={goBack}
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
          {((activity?.publishedAt || activity?.publishAt) || displayDate) && (
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              {(activity?.publishedAt || activity?.publishAt) && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Clock size={12} className="flex-shrink-0" /> Publicado: {fmtDate(activity.publishedAt || activity.publishAt)}
                </span>
              )}
              {displayDate && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Clock size={12} className="flex-shrink-0" /> {extendedDate ? 'Cierra (extendida):' : 'Cierra:'} {fmtDate(displayDate)}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      <div className={`px-4 py-5 space-y-3 ${STUDENT_CONTAINER_NARROW}`}>
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
                  /* bg-surface-card (blanco), no bg-surface: desde que el lienzo
                     es azul cielo, `bg-surface` pinta de azul y este botón se
                     confundía con el fondo en vez de recortarse contra él. */
                  className="flex items-center gap-3 px-3 py-2.5 bg-surface-card rounded border border-outline-variant text-sm text-muted hover:bg-accent-light hover:border-accent transition-colors"
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
                <p className="text-sm text-muted italic">&ldquo;{submission.comentario}&rdquo;</p>
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

        {/* Rúbrica de evaluación: visible desde antes de entregar (así el
            estudiante sabe cómo será evaluado); ya calificado, las celdas que
            el docente eligió aparecen resaltadas. */}
        {activity?.rubrica?.criterios?.length > 0 && (
          <div className="bg-surface-card rounded-card p-4 shadow-card">
            <div className="flex items-center gap-2 mb-1">
              <ClipboardList size={18} className="text-accent flex-shrink-0" />
              <h2 className="font-semibold text-on-surface">Rúbrica de evaluación</h2>
            </div>
            <p className="text-xs text-muted mb-3">
              {isGraded && submission?.rubricaEval?.some((v) => v != null)
                ? 'Tu profesor evaluó tu trabajo con esta rúbrica — los niveles que obtuviste están resaltados.'
                : 'Tu trabajo será evaluado con esta rúbrica. La calificación total es sobre 10 puntos.'}
            </p>
            {activity.rubrica.descripcion && (
              <p className="text-sm text-muted mb-3">{activity.rubrica.descripcion}</p>
            )}
            <RubricaTable
              rubrica={activity.rubrica}
              seleccion={isGraded ? submission?.rubricaEval : null}
            />
          </div>
        )}

        {/* Upload (never shown for observación — nothing to deliver, nor once
            ya hay una entrega: el estudiante tiene una sola ocasión; solo
            vuelve a aparecer si el docente anula la entrega) */}
        {!isObservacion && !submission && cerrada && (
          <div className="bg-surface-card rounded-card p-4 shadow-card text-center text-sm text-slate-400">
            {asignaturaArchivada
              ? 'Tu maestro archivó esta asignatura. Ya no se reciben entregas — puedes seguir consultando lo que entregaste.'
              : activity?.cerradaManual
              ? 'El docente cerró esta actividad. Ya no se reciben entregas.'
              : 'El plazo de entrega para esta actividad ya cerró.'}
          </div>
        )}
        {!isObservacion && !submission && !cerrada && (
          <div className="bg-surface-card rounded-card p-4 shadow-card">
            <h2 className="font-semibold text-on-surface mb-1">Subir entrega</h2>
            {isPastDeadline && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 mb-3">
                La fecha límite ya pasó. Tu entrega se registrará como <strong>entrega tarde</strong>.
              </p>
            )}
            {/* Instrucciones claras de qué se acepta — antes solo se veía la
                lista técnica de extensiones (".jpg,.pdf,.doc"), confusa. Cada
                línea es una opción independiente ("o"): la entrega es UN
                tipo de archivo (hasta 5 fotos cuentan como uno), nunca varios
                tipos combinados. */}
            <div className="mb-3 p-3 bg-accent-light border border-accent rounded text-sm">
              <p className="font-medium text-on-surface mb-1">Archivos que puedes enviar para esta actividad:</p>
              <ul className="space-y-0.5 text-muted">
                {fileTypesInstructions(activity?.tiposArchivo || 'todos', activity?.extensionesCustom).map((line, i, arr) => (
                  <li key={line}>• {line}{i < arr.length - 1 ? ' o' : ''}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-3">
              {/* min-h en vez de h: con altura FIJA el texto se salía de la caja
                  punteada y se recortaba a media letra en pantallas angostas o
                  con la fuente del sistema en grande. Así conserva el mismo alto
                  cuando el contenido cabe, y crece cuando no. */}
              <label className={`flex flex-col items-center justify-center w-full min-h-[7rem] sm:min-h-[8rem] px-3 py-3 border-2 border-dashed rounded cursor-pointer transition-colors ${
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
                {/* Solo la ACCIÓN, sin repetir el límite: cuántas fotos caben ya
                    lo dice el recuadro "Archivos que puedes enviar…" de arriba
                    ("De 1 a 5 fotos o imágenes"). Antes el mismo dato salía tres
                    veces seguidas en la misma pantalla — en el recuadro, en esta
                    línea y en un tercer renglón debajo — y a fuerza de repetirlo
                    dejaba de leerse. */}
                <p className="text-sm mt-2 font-medium text-muted text-center break-words line-clamp-2 max-w-full">
                  {files.length === 0
                    ? (allowsMultipleFiles(activity?.tiposArchivo || 'todos')
                        ? 'Toca para seleccionar tus fotos o un archivo'
                        : 'Toca para seleccionar archivo')
                    : files.length === 1
                      ? files[0].name
                      : `${files.length} imágenes seleccionadas`}
                </p>
                <p className="text-sm text-slate-500 mt-1 text-center break-words max-w-full">
                  Máx 5 MB cada uno
                </p>
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
            </div>
          </div>
        )}
      </div>
    </div>
    </StudentLayout>
  )
}
