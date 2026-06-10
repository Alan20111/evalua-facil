import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import {
  ArrowLeft, Upload, CheckCircle, Clock, FileText, Star,
  MessageSquare,
} from 'lucide-react'

const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/jpg',
]
const ALLOWED_EXT = '.doc, .docx, .pdf, .jpg, .jpeg, .png'

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
  const data = await res.json()
  return data.secure_url
}

export default function StudentActivityPage() {
  const { activityId } = useParams()
  const { currentUser } = useAuth()
  const [activity, setActivity] = useState(null)
  const [subject, setSubject] = useState(null)
  const [student, setStudent] = useState(null)
  const [submission, setSubmission] = useState(null)
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => { loadAll() }, [activityId])

  async function loadAll() {
    setLoading(true)
    try {
      const actSnap = await getDoc(doc(db, 'activities', activityId))
      const actData = { id: actSnap.id, ...actSnap.data() }
      setActivity(actData)
      const subSnap = await getDoc(doc(db, 'subjects', actData.asignaturaId))
      setSubject({ id: subSnap.id, ...subSnap.data() })

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
      if (!studs.empty) {
        const studData = { id: studs.docs[0].id, ...studs.docs[0].data() }
        setStudent(studData)
        const subsSnap = await getDocs(
          query(
            collection(db, 'submissions'),
            where('actividadId', '==', activityId),
            where('alumnoId', '==', studData.id)
          )
        )
        if (!subsSnap.empty) setSubmission({ id: subsSnap.docs[0].id, ...subsSnap.docs[0].data() })
      }
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload() {
    if (!file) return
    if (!student) {
      toast('No se encontró tu perfil de alumno. Intenta cerrar sesión y volver a entrar.', 'error')
      return
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast('Tipo de archivo no permitido', 'error')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast('El archivo no puede superar 10 MB', 'error')
      return
    }
    setUploading(true)
    try {
      const url = await uploadToCloudinary(file)
      await addDoc(collection(db, 'submissions'), {
        alumnoId: student.id,
        actividadId: activityId,
        archivoURL: url,
        nombreArchivo: file.name,
        fechaEntrega: serverTimestamp(),
        calificacion: null,
        comentario: '',
        estado: 'entregado',
      })
      toast('Tarea entregada exitosamente')
      setFile(null)
      loadAll()
    } catch (err) {
      toast('Error al subir: ' + err.message, 'error')
    } finally {
      setUploading(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Spinner size="lg" />
    </div>
  )

  const isGraded = submission?.calificacion != null
  const isDelivered = !!submission && !isGraded

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-100 px-4 py-4 flex items-center gap-3 shadow-sm">
        <button
          onClick={() => navigate(`/alumno/materia/${activity?.asignaturaId}`)}
          className="p-2 -ml-2 text-slate-400 hover:text-slate-600 rounded-lg"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-lg font-bold text-slate-900">{activity?.nombre}</h1>
          <p className="text-slate-400 text-xs">{subject?.nombre} · Parcial {activity?.parcial}</p>
        </div>
      </header>

      <div className="px-4 py-5 max-w-xl mx-auto space-y-4">
        {/* Status */}
        <div className={`rounded-2xl p-4 flex items-center gap-3 ${
          isGraded ? 'bg-emerald-50 border border-emerald-200' :
          isDelivered ? 'bg-blue-50 border border-blue-200' :
          'bg-slate-50 border border-slate-200'
        }`}>
          {isGraded ? <CheckCircle size={24} className="text-emerald-500 flex-shrink-0" />
            : isDelivered ? <Clock size={24} className="text-blue-500 flex-shrink-0" />
            : <FileText size={24} className="text-slate-400 flex-shrink-0" />}
          <div>
            <p className="font-semibold text-slate-900 text-sm">
              {isGraded ? 'Calificado' : isDelivered ? 'Entregado — pendiente de calificación' : 'Pendiente de entrega'}
            </p>
            {isDelivered && (
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                <FileText size={10} /> {submission.nombreArchivo}
              </p>
            )}
          </div>
        </div>

        {/* Grade */}
        {isGraded && (
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <Star size={20} className="text-amber-400" />
              <h2 className="font-semibold text-slate-900">Tu calificación</h2>
            </div>
            <div className="flex items-end gap-2 mb-3">
              <span className="text-5xl font-bold text-indigo-600">{submission.calificacion}</span>
              <span className="text-xl text-slate-400 mb-1">/{activity?.maxCalif}</span>
            </div>
            {submission.comentario && (
              <div className="bg-slate-50 rounded-xl p-3 flex gap-2">
                <MessageSquare size={15} className="text-slate-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-slate-600 italic">"{submission.comentario}"</p>
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        {activity?.instrucciones && (
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900 mb-2">Instrucciones</h2>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
              {activity.instrucciones}
            </p>
          </div>
        )}

        {/* Info */}
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Calificación máxima</span>
            <span className="font-semibold text-slate-900">{activity?.maxCalif} pts</span>
          </div>
          {activity?.fechaLimite && (
            <div className="flex items-center justify-between text-sm mt-2">
              <span className="text-slate-500">Fecha límite</span>
              <span className="font-semibold text-slate-900">
                {new Date(activity.fechaLimite).toLocaleDateString('es-MX', {
                  day: 'numeric', month: 'long', year: 'numeric',
                })}
              </span>
            </div>
          )}
        </div>

        {/* Upload */}
        {!submission && (
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900 mb-4">Subir entrega</h2>
            <div className="space-y-4">
              <label className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                file ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
              }`}>
                <input
                  type="file"
                  accept={ALLOWED_EXT}
                  className="hidden"
                  onChange={(e) => setFile(e.target.files[0] || null)}
                />
                <Upload size={24} className={file ? 'text-indigo-500' : 'text-slate-400'} />
                <p className="text-sm mt-2 font-medium text-slate-700">
                  {file ? file.name : 'Toca para seleccionar archivo'}
                </p>
                <p className="text-xs text-slate-400 mt-1">{ALLOWED_EXT} · máx 10 MB</p>
              </label>
              <button
                type="button"
                onClick={handleUpload}
                onMouseDown={(e) => e.preventDefault()}
                disabled={!file || uploading}
                style={{ touchAction: 'manipulation' }}
                className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {uploading ? <Spinner size="sm" /> : <Upload size={16} />}
                {uploading ? 'Subiendo…' : 'Entregar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
