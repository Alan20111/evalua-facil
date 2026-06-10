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
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import {
  ArrowLeft, Plus, ChevronDown, ChevronUp, FileText, Clock,
  CheckCircle, Circle, X,
} from 'lucide-react'

const PARCIALES = [1, 2, 3]

// Fetch all submissions for a set of activities in as few round trips as possible.
// Firestore `in` takes up to 30 values per query, so we chunk and run the chunks
// in parallel — turning N per-activity queries into ceil(N/30) parallel queries.
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

export default function SubjectPage() {
  const { subjectId } = useParams()
  const { currentUser } = useAuth()
  const [subject, setSubject] = useState(null)
  const [group, setGroup] = useState(null)
  const [activities, setActivities] = useState([])
  const [submissionCounts, setSubmissionCounts] = useState({})
  const [openParcial, setOpenParcial] = useState(1)
  const [showModal, setShowModal] = useState(false)
  const [modalParcial, setModalParcial] = useState(1)
  const [form, setForm] = useState({ nombre: '', maxCalif: '10', instrucciones: '', fechaLimite: '' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => { loadAll() }, [subjectId])

  async function loadAll() {
    setLoading(true)
    try {
      // Subject doc and its activities are both keyed by subjectId (from the URL),
      // so fetch them together instead of waiting one for the other.
      const [subSnap, actsSnap] = await Promise.all([
        getDoc(doc(db, 'subjects', subjectId)),
        getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', subjectId))),
      ])
      const subData = { id: subSnap.id, ...subSnap.data() }
      setSubject(subData)
      const acts = actsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setActivities(acts)

      // Group (needs grupoId) and every submission for these activities, in parallel.
      const [grpSnap, subDocs] = await Promise.all([
        getDoc(doc(db, 'groups', subData.grupoId)),
        fetchSubmissionsForActivities(acts.map((a) => a.id)),
      ])
      setGroup({ id: grpSnap.id, ...grpSnap.data() })

      // Tally counts per activity in memory — no extra round trips.
      const counts = {}
      acts.forEach((a) => { counts[a.id] = { delivered: 0, graded: 0, total: 0 } })
      subDocs.forEach((d) => {
        const data = d.data()
        const c = counts[data.actividadId]
        if (!c) return
        c.total++
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

  async function handleCreateActivity(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const ref = await addDoc(collection(db, 'activities'), {
        nombre: form.nombre.trim(),
        tipo: 'archivo',
        parcial: modalParcial,
        maxCalif: parseFloat(form.maxCalif) || 10,
        instrucciones: form.instrucciones.trim(),
        fechaLimite: form.fechaLimite || null,
        asignaturaId: subjectId,
        docenteId: currentUser.uid,
        createdAt: serverTimestamp(),
      })
      setShowModal(false)
      setForm({ nombre: '', maxCalif: '10', instrucciones: '', fechaLimite: '' })
      toast('Actividad creada')
      loadAll()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  function openAdd(parcial) {
    setModalParcial(parcial)
    setShowModal(true)
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
            <div>
              <h1 className="text-xl font-bold text-slate-900">{subject?.nombre}</h1>
              <p className="text-slate-400 text-xs">{group?.nombre} · {group?.ciclo}</p>
            </div>
          </div>
        </div>

        {/* Parciales */}
        <div className="px-4 py-4 space-y-3">
          {PARCIALES.map((p) => {
            const acts = activities.filter((a) => a.parcial === p)
            const isOpen = openParcial === p
            return (
              <div key={p} className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                {/* Parcial header */}
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

                {/* Activities list */}
                {isOpen && (
                  <div className="border-t border-slate-100 px-4 py-3 space-y-2">
                    {acts.length === 0 && (
                      <p className="text-slate-400 text-sm text-center py-3">Sin actividades en este parcial</p>
                    )}
                    {acts.map((a) => {
                      const counts = submissionCounts[a.id] || {}
                      return (
                        <button
                          key={a.id}
                          onClick={() => navigate(`/activity/${a.id}`)}
                          className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors border border-slate-100 text-left"
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
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {counts.graded > 0 && (
                              <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <CheckCircle size={10} /> {counts.graded}
                              </span>
                            )}
                            {counts.delivered > 0 && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <Circle size={10} /> {counts.delivered}
                              </span>
                            )}
                          </div>
                        </button>
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

      {/* Create activity modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">
                Nueva actividad — Parcial {modalParcial}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-2 text-slate-400 rounded-lg"><X size={18} /></button>
            </div>
            <form onSubmit={handleCreateActivity} className="space-y-4">
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
                {saving ? <Spinner size="sm" /> : <Plus size={16} />}
                {saving ? 'Creando…' : 'Crear actividad'}
              </button>
            </form>
          </div>
        </div>
      )}
    </TeacherLayout>
  )
}
