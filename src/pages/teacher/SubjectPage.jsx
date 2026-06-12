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
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import {
  ArrowLeft, Plus, ChevronDown, ChevronUp, FileText, Clock,
  CheckCircle, Circle, X, Pencil, Trash2, Archive, ArchiveRestore,
} from 'lucide-react'

const PARCIALES = [1, 2, 3]

async function fetchSubmissionsForActivities(actIds) {
  if (actIds.length === 0) return []
  const chunks = []
  for (let i = 0; i < actIds.length; i += 30) chunks.push(actIds.slice(i, i + 30))
  const snaps = await Promise.all(
    chunks.map((ids) =>
      getDocs(query(collection(db, 'submissions'), where('actividadId', 'in', ids)))
    )
  )
  return snaps.flatMap((s) => s.docs)
}

const EMPTY_FORM = { nombre: '', maxCalif: '10', instrucciones: '', fechaLimite: '' }

export default function SubjectPage() {
  const { subjectId } = useParams()
  const { currentUser } = useAuth()
  const [subject, setSubject] = useState(null)
  const [group, setGroup] = useState(null)
  const [activities, setActivities] = useState([])
  const [submissionCounts, setSubmissionCounts] = useState({})
  const [openParcial, setOpenParcial] = useState(1)

  // Modal: create or edit activity
  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState('create') // 'create' | 'edit'
  const [modalParcial, setModalParcial] = useState(1)
  const [editActivityId, setEditActivityId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState(null) // activity object or null
  const [deleting, setDeleting] = useState(false)
  const [archiving, setArchiving] = useState(false)

  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => { loadAll() }, [subjectId])

  async function loadAll() {
    setLoading(true)
    try {
      const [subSnap, actsSnap] = await Promise.all([
        getDoc(doc(db, 'subjects', subjectId)),
        getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', subjectId))),
      ])
      const subData = { id: subSnap.id, ...subSnap.data() }
      setSubject(subData)
      const acts = actsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setActivities(acts)

      const [grpSnap, subDocs] = await Promise.all([
        getDoc(doc(db, 'groups', subData.grupoId)),
        fetchSubmissionsForActivities(acts.map((a) => a.id)),
      ])
      setGroup({ id: grpSnap.id, ...grpSnap.data() })

      const counts = {}
      acts.forEach((a) => { counts[a.id] = { delivered: 0, graded: 0 } })
      subDocs.forEach((d) => {
        const data = d.data()
        const c = counts[data.actividadId]
        if (!c) return
        if (data.estado !== 'pendiente') c.delivered++
        if (data.calificacion != null) c.graded++
      })
      setSubmissionCounts(counts)
    } catch (err) {
      toast('Error al cargar: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  function openAdd(parcial) {
    setModalMode('create')
    setModalParcial(parcial)
    setEditActivityId(null)
    setForm(EMPTY_FORM)
    setShowModal(true)
  }

  function openEdit(activity) {
    setModalMode('edit')
    setModalParcial(activity.parcial)
    setEditActivityId(activity.id)
    setForm({
      nombre: activity.nombre || '',
      maxCalif: String(activity.maxCalif ?? '10'),
      instrucciones: activity.instrucciones || '',
      fechaLimite: activity.fechaLimite || '',
    })
    setShowModal(true)
  }

  async function handleSaveActivity(e) {
    e.preventDefault()
    setSaving(true)
    const payload = {
      nombre: form.nombre.trim(),
      maxCalif: parseFloat(form.maxCalif) || 10,
      instrucciones: form.instrucciones.trim(),
      fechaLimite: form.fechaLimite || null,
    }
    try {
      if (modalMode === 'create') {
        await addDoc(collection(db, 'activities'), {
          ...payload,
          tipo: 'archivo',
          parcial: modalParcial,
          asignaturaId: subjectId,
          docenteId: currentUser.uid,
          createdAt: serverTimestamp(),
        })
        toast('Actividad creada')
      } else {
        await updateDoc(doc(db, 'activities', editActivityId), payload)
        toast('Actividad actualizada')
      }
      setShowModal(false)
      setForm(EMPTY_FORM)
      loadAll()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteActivity() {
    if (!deleteConfirm) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'activities', deleteConfirm.id))
      toast('Actividad eliminada')
      setDeleteConfirm(null)
      loadAll()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setDeleting(false)
    }
  }

  async function handleToggleArchive() {
    if (!subject) return
    const next = !subject.archived
    setArchiving(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), { archived: next })
      setSubject((s) => ({ ...s, archived: next }))
      toast(next ? 'Asignatura archivada' : 'Asignatura restaurada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setArchiving(false)
    }
  }

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
              onClick={() => navigate(`/group/${group?.id}`)}
              className="p-2 -ml-2 text-slate-400 hover:text-slate-600 rounded-lg"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900 truncate">{subject?.nombre}</h1>
                {subject?.archived && (
                  <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full flex-shrink-0">
                    Archivada
                  </span>
                )}
              </div>
              <p className="text-slate-400 text-xs">{group?.nombre} · {group?.ciclo}</p>
            </div>
            <button
              type="button"
              onClick={handleToggleArchive}
              disabled={archiving}
              title={subject?.archived ? 'Restaurar asignatura' : 'Archivar asignatura'}
              className="p-2 text-slate-400 hover:text-amber-600 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
            >
              {subject?.archived ? <ArchiveRestore size={19} /> : <Archive size={19} />}
            </button>
          </div>
        </div>

        {/* Parciales */}
        <div className="px-4 py-4 space-y-3">
          {PARCIALES.map((p) => {
            const acts = activities.filter((a) => a.parcial === p)
            const isOpen = openParcial === p
            return (
              <div key={p} className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                <button
                  onClick={() => setOpenParcial(isOpen ? 0 : p)}
                  className="w-full px-4 py-4 flex items-center gap-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-indigo-700 font-bold text-sm">{p}</span>
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-slate-900">Parcial {p}</p>
                    <p className="text-xs text-slate-400">{acts.length} actividad{acts.length !== 1 ? 'es' : ''}</p>
                  </div>
                  {isOpen ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100 px-4 py-3 space-y-2">
                    {acts.length === 0 && (
                      <p className="text-slate-400 text-sm text-center py-3">Sin actividades en este parcial</p>
                    )}
                    {acts.map((a) => {
                      const counts = submissionCounts[a.id] || {}
                      return (
                        <div
                          key={a.id}
                          className="flex items-center gap-1 rounded-xl border border-slate-100 bg-white hover:border-indigo-100 transition-colors"
                        >
                          {/* Main clickable area → activity detail */}
                          <button
                            onClick={() => navigate(`/activity/${a.id}`)}
                            className="flex items-center gap-3 flex-1 min-w-0 px-3 py-3 text-left"
                          >
                            <FileText size={18} className="text-slate-400 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-900 truncate">{a.nombre}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs text-slate-400">Máx: {a.maxCalif}</span>
                                {a.fechaLimite && (
                                  <span className="text-xs text-amber-600 flex items-center gap-0.5">
                                    <Clock size={10} /> {new Date(a.fechaLimite).toLocaleDateString('es-MX')}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {counts.graded > 0 && (
                                <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                  <CheckCircle size={9} /> {counts.graded}
                                </span>
                              )}
                              {counts.delivered > 0 && (
                                <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                  <Circle size={9} /> {counts.delivered}
                                </span>
                              )}
                            </div>
                          </button>

                          {/* Edit */}
                          <button
                            onClick={() => openEdit(a)}
                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors flex-shrink-0 mr-0.5"
                            title="Editar"
                          >
                            <Pencil size={14} />
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => setDeleteConfirm(a)}
                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0 mr-1"
                            title="Eliminar"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )
                    })}
                    <button
                      onClick={() => openAdd(p)}
                      className="w-full py-2.5 border-2 border-dashed border-indigo-200 rounded-xl text-indigo-600 text-sm font-medium hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2"
                    >
                      <Plus size={15} /> Agregar actividad
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Create / Edit activity modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">
                {modalMode === 'create' ? `Nueva actividad — Parcial ${modalParcial}` : 'Editar actividad'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-2 text-slate-400 rounded-lg"><X size={18} /></button>
            </div>
            <form onSubmit={handleSaveActivity} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nombre</label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                  required
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
                  placeholder="Ej: Tarea 1, Examen parcial"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Calificación máxima</label>
                <input
                  type="number"
                  value={form.maxCalif}
                  onChange={(e) => setForm((f) => ({ ...f, maxCalif: e.target.value }))}
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
                  value={form.instrucciones}
                  onChange={(e) => setForm((f) => ({ ...f, instrucciones: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50 resize-none"
                  placeholder="Describe la tarea para tus alumnos…"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Fecha límite <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                <input
                  type="date"
                  value={form.fechaLimite}
                  onChange={(e) => setForm((f) => ({ ...f, fechaLimite: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? <Spinner size="sm" /> : modalMode === 'create' ? <Plus size={16} /> : <Pencil size={16} />}
                {saving ? 'Guardando…' : modalMode === 'create' ? 'Crear actividad' : 'Guardar cambios'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteConfirm(null)} />
          <div className="relative bg-white rounded-2xl p-6 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-slate-900 mb-1">¿Eliminar actividad?</h3>
            <p className="text-sm text-slate-500 mb-5">
              "<strong>{deleteConfirm.nombre}</strong>" se eliminará permanentemente.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteActivity}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {deleting ? <Spinner size="sm" /> : <Trash2 size={14} />}
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </TeacherLayout>
  )
}
