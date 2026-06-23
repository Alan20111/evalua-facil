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
  MessageSquare, Download,
} from 'lucide-react'
import { getFileType, isFileAllowed } from '../../config/fileTypes'
import { subjectDisplayName } from '../../utils/subjectName'
import { isActivityPublished } from '../../utils/activityVisibility'
import { getEnrollmentForSubject } from '../../utils/studentLookup'

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
  // YYYY-MM-DD is parsed as UTC midnight; append T00:00:00 to force local time
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('es-MX', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

export default function StudentActivityPage() {
  const { activityId } = useParams()
  const { currentUser, userProfile } = useAuth()
  const [activity, setActivity] = useState(null)
  const [subject, setSubject] = useState(null)
  const [student, setStudent] = useState(null)
  const [submission, setSubmission] = useState(null)
  const [file, setFile] = useState(null)
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

  // One-time load for everything else (student, subject, submission)
  useEffect(() => { loadOther() }, [activityId, userProfile?.studentId])

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
      // Students must never reach a hidden/scheduled activity, even via a direct URL.
      if (!isActivityPublished(actData)) {
        toast('Esta actividad no está disponible', 'error')
        navigate('/alumno/dashboard')
        return
      }
      setActivity(actData)

      // Resolve this student's enrollment record for the activity's subject.
      const studData = await getEnrollmentForSubject(currentUser, userProfile, actData.asignaturaId)
      setStudent(studData)

      const [subSnap, subsSnap] = await Promise.all([
        getDoc(doc(db, 'subjects', actData.asignaturaId)),
        studData
          ? getDocs(query(
              collection(db, 'submissions'),
              where('actividadId', '==', activityId),
              where('alumnoId', '==', studData.id)
            ))
          : Promise.resolve(null),
      ])
      setSubject({ id: subSnap.id, ...subSnap.data() })
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
      completadoSinArchivo: !!submission?.completadoSinArchivo,
      fechaEntrega: submission?.fechaEntrega ?? null,
    }
  }

  async function handleUpload() {
    if (!file) return
    if (!student) { toast('No se encontró tu perfil. Cierra sesión y vuelve a entrar.', 'error'); return }
    if (!isFileAllowed(file, activity?.tiposArchivo || 'todos')) {
      toast(`Solo se permiten: ${getFileType(activity?.tiposArchivo || 'todos').accept}`, 'error'); return
    }
    if (file.size > 5 * 1024 * 1024) { toast('El archivo no puede superar 5 MB', 'error'); return }
    setUploading(true)
    try {
      const url = await uploadToCloudinary(file)
      if (submission) {
        // Re-submit: archive current version, update doc
        await updateDoc(doc(db, 'submissions', submission.id), {
          archivoURL: url,
          nombreArchivo: file.name,
          completadoSinArchivo: false,
          fechaEntrega: serverTimestamp(),
          calificacion: null,
          comentario: '',
          estado: 'entregado',
          historial: arrayUnion(buildHistoryEntry()),
        })
        toast('Versión corregida entregada')
      } else {
        await addDoc(collection(db, 'submissions'), {
          alumnoId: student.id,
          actividadId: activityId,
          archivoURL: url,
          nombreArchivo: file.name,
          completadoSinArchivo: false,
          fechaEntrega: serverTimestamp(),
          calificacion: null,
          comentario: '',
          estado: 'entregado',
          historial: [],
        })
        toast('Tarea entregada')
      }
      setFile(null)
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
          completadoSinArchivo: true,
          fechaEntrega: serverTimestamp(),
          calificacion: null,
          comentario: '',
          estado: 'entregado',
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

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <Spinner size="lg" />
    </div>
  )

  const isGraded = submission?.calificacion != null
  const isDelivered = !!submission && !isGraded
  const noFile = submission?.completadoSinArchivo

  // Extended deadline for this student (set by teacher)
  const extendedDate = activity?.extensiones?.[student?.id]
  const displayDate = extendedDate || activity?.fechaLimite
  // Can re-submit if teacher gave an extension and task isn't graded yet
  const canResubmit = !!extendedDate && !isGraded && !!submission

  return (
    <div className="min-h-screen bg-surface" data-subject-palette={subject?.colorPalette || 'default'}>
      <header className="bg-surface-card border-b border-outline-variant px-4 py-4 flex items-center gap-3 shadow-card">
        <button
          onClick={() => navigate(`/alumno/materia/${activity?.asignaturaId}`)}
          className="p-2 -ml-2 text-slate-400 hover:text-muted rounded"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-lg font-bold text-on-surface">{activity?.nombre}</h1>
          <p className="text-slate-400 text-xs">{subjectDisplayName(subject)} · Parcial {activity?.parcial}</p>
        </div>
      </header>

      <div className="px-4 py-5 max-w-xl mx-auto space-y-4">
        {/* Status */}
        <div className={`rounded-card p-4 flex items-center gap-3 ${
          isGraded ? 'bg-emerald-50 border border-emerald-200' :
          isDelivered ? 'bg-accent-light border border-accent' :
          'bg-surface border border-outline-variant'
        }`}>
          {isGraded ? <CheckCircle size={24} className="text-emerald-500 flex-shrink-0" />
            : isDelivered ? <Clock size={24} className="text-accent flex-shrink-0" />
            : <FileText size={24} className="text-slate-400 flex-shrink-0" />}
          <div>
            <p className="font-semibold text-on-surface text-sm">
              {isGraded ? 'Calificado'
                : isDelivered ? 'Entregado — pendiente de calificación'
                : 'Pendiente de entrega'}
            </p>
            {isDelivered && (
              <p className="text-xs text-muted mt-0.5 flex items-center gap-1">
                {noFile
                  ? <><CheckCircle size={10} /> Completada sin archivo</>
                  : <><FileText size={10} /> {submission.nombreArchivo}</>}
              </p>
            )}
          </div>
        </div>

        {/* View submitted file */}
        {submission && !submission.completadoSinArchivo && submission.archivoURL && (
          <div className="bg-surface-card rounded-card p-4 shadow-card">
            <p className="text-xs font-medium text-muted mb-2">Tu entrega</p>
            <a
              href={submission.archivoURL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-3 py-2.5 bg-surface rounded border border-outline-variant text-sm text-muted hover:bg-accent-light hover:border-accent transition-colors"
            >
              <Download size={15} className="text-accent flex-shrink-0" />
              <span className="truncate">{submission.nombreArchivo}</span>
            </a>
          </div>
        )}

        {/* Grade */}
        {isGraded && (
          <div className="bg-surface-card rounded-card p-5 shadow-card">
            <div className="flex items-center gap-3 mb-3">
              <Star size={20} className="text-amber-400" />
              <h2 className="font-semibold text-on-surface">Tu calificación</h2>
            </div>
            <div className="flex items-end gap-2 mb-3">
              <span className="text-5xl font-bold text-accent">{submission.calificacion}</span>
              <span className="text-xl text-slate-400 mb-1">/{activity?.maxCalif}</span>
            </div>
            {submission.comentario && (
              <div className="bg-surface rounded p-3 flex gap-2">
                <MessageSquare size={15} className="text-slate-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-muted italic">"{submission.comentario}"</p>
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        {activity?.instrucciones && (
          <div className="bg-surface-card rounded-card p-5 shadow-card">
            <h2 className="font-semibold text-on-surface mb-2">Instrucciones</h2>
            <p className="text-sm text-muted leading-relaxed whitespace-pre-wrap">
              {activity.instrucciones}
            </p>
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

        {/* Upload */}
        {(!submission || canResubmit) && (
          <div className="bg-surface-card rounded-card p-5 shadow-card">
            <h2 className="font-semibold text-on-surface mb-1">
              {canResubmit ? 'Subir versión corregida' : 'Subir entrega'}
            </h2>
            {canResubmit && (
              <p className="text-xs text-orange-500 mb-3">
                Tu maestro extendió la fecha — puedes subir una corrección.
              </p>
            )}
            <div className="space-y-3">
              <label className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded cursor-pointer transition-colors ${
                file ? 'border-accent bg-accent-light' : 'border-outline-variant hover:border-accent hover:bg-surface'
              }`}>
                <input
                  type="file"
                  accept={getFileType(activity?.tiposArchivo || 'todos').accept}
                  className="hidden"
                  onChange={(e) => setFile(e.target.files[0] || null)}
                />
                <Upload size={24} className={file ? 'text-accent' : 'text-slate-400'} />
                <p className="text-sm mt-2 font-medium text-muted">
                  {file ? file.name : 'Toca para seleccionar archivo'}
                </p>
                <p className="text-xs text-slate-400 mt-1">{getFileType(activity?.tiposArchivo || 'todos').accept} · máx 5 MB</p>
              </label>
              <button
                type="button"
                onClick={handleUpload}
                onMouseDown={(e) => e.preventDefault()}
                disabled={!file || uploading}
                style={{ touchAction: 'manipulation' }}
                className="w-full py-3 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {uploading ? <Spinner size="sm" /> : <Upload size={16} />}
                {uploading ? 'Subiendo…' : 'Entregar'}
              </button>
              <button
                type="button"
                onClick={handleMarkComplete}
                onMouseDown={(e) => e.preventDefault()}
                disabled={uploading}
                style={{ touchAction: 'manipulation' }}
                className="w-full py-1.5 text-xs text-slate-400 hover:text-muted transition-colors"
              >
                Marcar como completada sin archivo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
