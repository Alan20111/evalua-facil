import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  updateDoc,
  doc,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../../components/Toast'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import {
  ArrowLeft, FileText, CheckCircle, Clock, Circle, X,
  Download, Star, Pencil, CalendarDays,
} from 'lucide-react'

const STATUS_COLORS = {
  pendiente: 'bg-slate-100 text-slate-500',
  entregado: 'bg-blue-100 text-blue-700',
  calificado: 'bg-emerald-100 text-emerald-700',
}
const STATUS_LABELS = {
  pendiente: 'Pendiente',
  entregado: 'Entregado',
  calificado: 'Calificado',
}

export default function ActivityPage() {
  const { activityId } = useParams()
  const [activity, setActivity] = useState(null)
  const [subject, setSubject] = useState(null)
  const [students, setStudents] = useState([])
  const [submissions, setSubmissions] = useState({})
  const [filter, setFilter] = useState('todos')
  const [selected, setSelected] = useState(null)
  const [gradeForm, setGradeForm] = useState({ calificacion: '', comentario: '' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({ nombre: '', maxCalif: '10', instrucciones: '', fechaLimite: '' })
  const [editSaving, setEditSaving] = useState(false)
  // Per-student deadline extension
  const [extendMode, setExtendMode] = useState(false)
  const [extendDate, setExtendDate] = useState('')
  const [savingExtension, setSavingExtension] = useState(false)
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
      const subData = { id: subSnap.id, ...subSnap.data() }
      setSubject(subData)
      const [studsSnap, subsSnap] = await Promise.all([
        getDocs(query(collection(db, 'students'), where('grupoId', '==', subData.grupoId))),
        getDocs(query(collection(db, 'submissions'), where('actividadId', '==', activityId))),
      ])
      const studList = studsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => a.orden - b.orden)
      setStudents(studList)
      const subsMap = {}
      subsSnap.docs.forEach((d) => { subsMap[d.data().alumnoId] = { id: d.id, ...d.data() } })
      setSubmissions(subsMap)
    } catch (err) {
      toast('Error al cargar: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  function openEditModal() {
    setEditForm({
      nombre: activity?.nombre || '',
      maxCalif: String(activity?.maxCalif ?? '10'),
      instrucciones: activity?.instrucciones || '',
      fechaLimite: activity?.fechaLimite || '',
    })
    setShowEditModal(true)
  }

  async function handleEditActivity(e) {
    e.preventDefault()
    setEditSaving(true)
    try {
      await updateDoc(doc(db, 'activities', activityId), {
        nombre: editForm.nombre.trim(),
        maxCalif: parseFloat(editForm.maxCalif) || 10,
        instrucciones: editForm.instrucciones.trim(),
        fechaLimite: editForm.fechaLimite || null,
      })
      toast('Actividad actualizada')
      setShowEditModal(false)
      loadAll()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setEditSaving(false)
    }
  }

  function getStatus(studentId) {
    const sub = submissions[studentId]
    if (!sub) return 'pendiente'
    if (sub.calificacion != null) return 'calificado'
    return 'entregado'
  }

  function openGrade(student) {
    const sub = submissions[student.id]
    setSelected({ student, sub })
    setGradeForm({
      calificacion: sub?.calificacion != null ? String(sub.calificacion) : '',
      comentario: sub?.comentario || '',
    })
    setExtendMode(false)
    setExtendDate(activity?.extensiones?.[student.id] || '')
  }

  function closeModal() {
    setSelected(null)
    setExtendMode(false)
    setExtendDate('')
  }

  async function saveGrade(e) {
    e.preventDefault()
    if (!selected?.sub) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'submissions', selected.sub.id), {
        calificacion: parseFloat(gradeForm.calificacion),
        comentario: gradeForm.comentario.trim(),
        estado: 'calificado',
      })
      toast('Calificación guardada')
      closeModal()
      loadAll()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function saveExtension() {
    if (!selected || !extendDate) return
    setSavingExtension(true)
    try {
      await updateDoc(doc(db, 'activities', activityId), {
        [`extensiones.${selected.student.id}`]: extendDate,
      })
      setActivity((prev) => ({
        ...prev,
        extensiones: { ...(prev.extensiones || {}), [selected.student.id]: extendDate },
      }))
      toast('Fecha de entrega actualizada')
      setExtendMode(false)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingExtension(false)
    }
  }

  const counts = {
    pendiente: students.filter((s) => getStatus(s.id) === 'pendiente').length,
    entregado: students.filter((s) => getStatus(s.id) === 'entregado').length,
    calificado: students.filter((s) => getStatus(s.id) === 'calificado').length,
  }

  const filtered =
    filter === 'todos'
      ? students
      : students.filter((s) => getStatus(s.id) === filter)

  if (loading) return (
    <TeacherLayout>
      <div className="flex justify-center py-20"><Spinner size="lg" /></div>
    </TeacherLayout>
  )

  return (
    <TeacherLayout>
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-white border-b border-slate-100 px-4 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/subject/${activity?.asignaturaId}`)}
              className="p-2 -ml-2 text-slate-400 hover:text-slate-600 rounded-lg"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-slate-900">{activity?.nombre}</h1>
              <p className="text-slate-400 text-xs">{subject?.nombre} · Parcial {activity?.parcial}</p>
            </div>
            <button
              onClick={openEditModal}
              className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors flex-shrink-0"
              title="Editar actividad"
            >
              <Pencil size={18} />
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            {[
              { key: 'pendiente', label: 'Pendientes', icon: Circle, color: 'text-slate-500', bg: 'bg-slate-50' },
              { key: 'entregado', label: 'Entregados', icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50' },
              { key: 'calificado', label: 'Calificados', icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
            ].map(({ key, label, icon: Icon, color, bg }) => (
              <div key={key} className={`${bg} rounded-xl p-3 text-center`}>
                <Icon size={18} className={`${color} mx-auto mb-1`} />
                <p className="text-2xl font-bold text-slate-800">{counts[key]}</p>
                <p className="text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 mt-3 bg-slate-100 p-1 rounded-xl">
            {['todos', 'pendiente', 'entregado', 'calificado'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  filter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                {f === 'todos' ? 'Todos' : STATUS_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        {/* Student list */}
        <div className="px-4 py-4 space-y-2">
          {filtered.length === 0 && (
            <p className="text-center text-slate-400 text-sm py-8">Sin alumnos en esta categoría</p>
          )}
          {filtered.map((s) => {
            const status = getStatus(s.id)
            const sub = submissions[s.id]
            const hasExtension = !!activity?.extensiones?.[s.id]
            return (
              <button
                key={s.id}
                onClick={() => openGrade(s)}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-slate-100 bg-white text-left transition-colors shadow-sm hover:border-indigo-200 hover:shadow-md cursor-pointer"
              >
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-semibold text-slate-500">{s.orden}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {s.apellidoPaterno} {s.apellidoMaterno} {s.nombre}
                  </p>
                  {sub?.fechaEntrega && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {new Date(sub.fechaEntrega?.seconds * 1000).toLocaleString('es-MX')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {hasExtension && (
                    <CalendarDays size={13} className="text-orange-400" title="Fecha extendida" />
                  )}
                  {sub?.calificacion != null && (
                    <span className="text-sm font-bold text-emerald-600 flex items-center gap-0.5">
                      <Star size={12} /> {sub.calificacion}/{activity?.maxCalif}
                    </span>
                  )}
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[status]}`}>
                    {STATUS_LABELS[status]}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Grade / detail modal */}
      {selected && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeModal} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {selected.student.apellidoPaterno} {selected.student.nombre}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selected.sub
                    ? selected.sub.completadoSinArchivo
                      ? 'Completada sin archivo'
                      : selected.sub.nombreArchivo
                    : 'Sin entrega aún'}
                </p>
              </div>
              <button onClick={closeModal} className="p-2 text-slate-400 rounded-lg"><X size={18} /></button>
            </div>

            {/* File download (only when there's a file) */}
            {selected.sub && !selected.sub.completadoSinArchivo && selected.sub.archivoURL && (
              <a
                href={selected.sub.archivoURL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-100 transition-colors mb-4"
              >
                <Download size={16} className="text-indigo-500" />
                Ver / Descargar entrega
              </a>
            )}

            {/* Grade form (only when submission exists) */}
            {selected.sub ? (
              <form onSubmit={saveGrade} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Calificación <span className="text-slate-400">(máx. {activity?.maxCalif})</span>
                  </label>
                  <input
                    type="number"
                    value={gradeForm.calificacion}
                    onChange={(e) => setGradeForm((f) => ({ ...f, calificacion: e.target.value }))}
                    required
                    min="0"
                    max={activity?.maxCalif}
                    step="0.1"
                    autoFocus
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Comentario <span className="text-slate-400">(opcional)</span>
                  </label>
                  <textarea
                    value={gradeForm.comentario}
                    onChange={(e) => setGradeForm((f) => ({ ...f, comentario: e.target.value }))}
                    rows={2}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50 resize-none"
                    placeholder="Retroalimentación para el alumno…"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {saving ? <Spinner size="sm" /> : <Star size={16} />}
                  {saving ? 'Guardando…' : 'Guardar calificación'}
                </button>
              </form>
            ) : (
              <p className="text-sm text-slate-400 text-center py-4">
                El alumno aún no ha entregado esta tarea.
              </p>
            )}

            {/* Extend deadline — subtle text, always visible */}
            <div className="mt-4 pt-3 border-t border-slate-100">
              {!extendMode ? (
                <button
                  type="button"
                  onClick={() => setExtendMode(true)}
                  className="text-xs text-slate-400 hover:text-slate-500 transition-colors"
                >
                  Modificar fecha de entrega
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-600">Nueva fecha límite para este alumno</p>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={extendDate}
                      onChange={(e) => setExtendDate(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
                    />
                    <button
                      type="button"
                      onClick={saveExtension}
                      disabled={!extendDate || savingExtension}
                      className="px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-xl disabled:opacity-50 transition-colors"
                    >
                      {savingExtension ? '…' : 'Guardar'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExtendMode(false)}
                    className="text-xs text-slate-400"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit activity modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowEditModal(false)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">Editar actividad</h3>
              <button onClick={() => setShowEditModal(false)} className="p-2 text-slate-400 rounded-lg"><X size={18} /></button>
            </div>
            <form onSubmit={handleEditActivity} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nombre</label>
                <input
                  type="text"
                  value={editForm.nombre}
                  onChange={(e) => setEditForm((f) => ({ ...f, nombre: e.target.value }))}
                  required
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Calificación máxima</label>
                <input
                  type="number"
                  value={editForm.maxCalif}
                  onChange={(e) => setEditForm((f) => ({ ...f, maxCalif: e.target.value }))}
                  required
                  min="1"
                  max="100"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Instrucciones <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                <textarea
                  value={editForm.instrucciones}
                  onChange={(e) => setEditForm((f) => ({ ...f, instrucciones: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50 resize-none"
                  placeholder="Instrucciones para los alumnos…"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Fecha límite <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                <input
                  type="date"
                  value={editForm.fechaLimite}
                  onChange={(e) => setEditForm((f) => ({ ...f, fechaLimite: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
                />
              </div>
              <button
                type="submit"
                disabled={editSaving}
                className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {editSaving ? <Spinner size="sm" /> : <Pencil size={16} />}
                {editSaving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </form>
          </div>
        </div>
      )}
    </TeacherLayout>
  )
}
