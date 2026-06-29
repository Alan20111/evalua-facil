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
  ArrowLeft, CheckCircle, Clock, Circle, X,
  Download, Star, CalendarDays, Search, ArrowDownAZ,
  ChevronLeft, ChevronRight, FolderDown,
} from 'lucide-react'
import { buildJobsForActivity, downloadSubmissionsZip } from '../../utils/downloadSubmissions'
import { subjectDisplayName } from '../../utils/subjectName'
import { useSubscription } from '../../hooks/useSubscription'
import { canCreateContent } from '../../utils/subscriptionHelpers'
import { sanitizeHtml, richTextContentClass, toRichHtml } from '../../utils/sanitizeHtml'

function isImageFile(name, url) {
  const s = `${name || ''} ${url || ''}`.toLowerCase()
  return /\.(jpg|jpeg|png|gif|webp)(\?|$|\s)/.test(s) || /\.(jpg|jpeg|png|gif|webp)$/.test((name || '').toLowerCase())
}

const STATUS_COLORS = {
  pendiente: 'bg-surface-container text-muted',
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
  const [activityLabel, setActivityLabel] = useState(null)
  const [subject, setSubject] = useState(null)
  const [students, setStudents] = useState([])
  const [submissions, setSubmissions] = useState({})
  const [filter, setFilter] = useState('todos')
  const [selected, setSelected] = useState(null)
  const [gradeForm, setGradeForm] = useState({ calificacion: '', comentario: '' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [searchStudents, setSearchStudents] = useState('')
  const [sortAlpha, setSortAlpha] = useState(false)
  // Per-student deadline extension
  const [extendMode, setExtendMode] = useState(false)
  const [extendDate, setExtendDate] = useState('')
  const [savingExtension, setSavingExtension] = useState(false)
  // ZIP download
  const [zipDownloading, setZipDownloading] = useState(false)
  const [zipProgress, setZipProgress] = useState({ done: 0, total: 0 })
  const navigate = useNavigate()
  const toast = useToast()
  const { subscription } = useSubscription()
  const canCreate = canCreateContent(subscription)

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
      const [studsSnap, subsSnap, siblingActsSnap] = await Promise.all([
        getDocs(query(collection(db, 'students'), where('asignaturaId', '==', actData.asignaturaId))),
        getDocs(query(collection(db, 'submissions'), where('actividadId', '==', activityId))),
        getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', actData.asignaturaId))),
      ])
      // "Actividad" (1.1, 1.2…) is presentation, derived from this activity's
      // position among its parcial siblings — never trusted from the stored
      // field, so it always matches what the subject page currently shows.
      const siblings = siblingActsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => a.parcial === actData.parcial)
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      const idx = siblings.findIndex((a) => a.id === activityId)
      setActivityLabel(idx >= 0 ? `${actData.parcial}.${idx + 1}` : null)
      const studList = studsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
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
    if (!canCreate) {
      toast('Activa tu suscripción mensual para registrar calificaciones — toda tu información sigue disponible')
      return
    }
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

  let filtered = filter === 'todos' ? students : students.filter((s) => getStatus(s.id) === filter)
  if (searchStudents.trim()) {
    const q = searchStudents.trim().toLowerCase()
    filtered = filtered.filter((s) =>
      `${s.apellidoPaterno} ${s.apellidoMaterno} ${s.nombre}`.toLowerCase().includes(q)
    )
  }
  if (sortAlpha) {
    filtered = [...filtered].sort((a, b) =>
      `${a.apellidoPaterno} ${a.nombre}`.localeCompare(`${b.apellidoPaterno} ${b.nombre}`, 'es')
    )
  }

  async function handleZipDownload() {
    setZipDownloading(true)
    setZipProgress({ done: 0, total: 0 })
    try {
      const submissionsArr = Object.values(submissions)
      const jobs = buildJobsForActivity({ students, submissions: submissionsArr })
      if (jobs.length === 0) { toast('No hay archivos entregados para descargar'); return }
      const { escritos, errores } = await downloadSubmissionsZip({
        zipName: activity?.nombre || 'Entregas',
        jobs,
        onProgress: (done, total) => setZipProgress({ done, total }),
      })
      toast(errores > 0
        ? `Descargadas ${escritos} de ${escritos + errores} entregas (${errores} con error)`
        : `${escritos} entrega${escritos !== 1 ? 's' : ''} en ZIP`)
    } catch (err) {
      toast('Error al generar ZIP: ' + err.message, 'error')
    } finally {
      setZipDownloading(false)
      setZipProgress({ done: 0, total: 0 })
    }
  }

  const curIdx = selected ? filtered.findIndex((s) => s.id === selected.student.id) : -1
  function goToOffset(off) {
    const next = filtered[curIdx + off]
    if (next) openGrade(next)
  }

  // Navigate submissions with the keyboard arrows while the modal is open.
  useEffect(() => {
    if (!selected) return
    function onKey(e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const idx = filtered.findIndex((s) => s.id === selected.student.id)
      if (idx === -1) return
      const next = filtered[idx + (e.key === 'ArrowRight' ? 1 : -1)]
      if (next) openGrade(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, filtered])

  if (loading) return (
    <TeacherLayout>
      <div className="flex justify-center py-20"><Spinner size="lg" /></div>
    </TeacherLayout>
  )

  return (
    <TeacherLayout>
      <div data-subject-palette={subject?.colorPalette || 'default'}>
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-surface-card border-b border-outline-variant px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/subject/${activity?.asignaturaId}`)}
              className="p-2 -ml-2 text-slate-400 hover:text-muted rounded"
            >
              <ArrowLeft size={22} />
            </button>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-on-surface flex items-baseline gap-2">
                {activityLabel && <span className="text-accent">{activityLabel}</span>}
                {activity?.nombre}
              </h1>
              <p className="text-slate-400 text-xs">{subjectDisplayName(subject)} · Parcial {activity?.parcial}</p>
            </div>
          </div>
          {activity?.instrucciones && (
            <div
              className={`text-sm text-on-surface mt-3 ${richTextContentClass}`}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(toRichHtml(activity.instrucciones)) }}
            />
          )}

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 mt-3">
            {[
              { key: 'pendiente', label: 'Pendientes', icon: Circle, color: 'text-muted', bg: 'bg-surface' },
              { key: 'entregado', label: 'Entregados', icon: Clock, color: 'text-accent', bg: 'bg-accent-light' },
              { key: 'calificado', label: 'Calificados', icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
            ].map(({ key, label, icon: Icon, color, bg }) => (
              <div key={key} className={`${bg} rounded p-3.5 text-center`}>
                <Icon size={20} className={`${color} mx-auto mb-1.5`} />
                <p className="text-2xl font-bold text-on-surface">{counts[key]}</p>
                <p className="text-xs text-muted">{label}</p>
              </div>
            ))}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 mt-3 bg-surface-container p-1 rounded">
            {['todos', 'pendiente', 'entregado', 'calificado'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
                  filter === f ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted'
                }`}
              >
                {f === 'todos' ? 'Todos' : STATUS_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        {/* Search + sort */}
        <div className="px-4 pt-4 pb-2 flex gap-2">
          <div className="flex-1 relative">
            <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              value={searchStudents}
              onChange={(e) => setSearchStudents(e.target.value)}
              placeholder="Buscar alumno…"
              className="w-full pl-9 pr-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface-card"
            />
          </div>
          <button
            onClick={() => setSortAlpha((v) => !v)}
            title="Ordenar por nombre"
            className={`p-2 rounded border transition-colors ${
              sortAlpha ? 'border-accent bg-accent-light text-accent' : 'border-outline-variant text-slate-400 hover:text-muted'
            }`}
          >
            <ArrowDownAZ size={20} />
          </button>
        </div>

        {/* ZIP download */}
        {Object.values(submissions).some((s) => s.archivoURL && !s.completadoSinArchivo) && (
          <div className="px-4 pb-2">
            <button
              onClick={handleZipDownload}
              disabled={zipDownloading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded border border-accent text-accent text-sm font-medium hover:bg-accent-light transition-colors disabled:opacity-40"
            >
              {zipDownloading ? <Spinner size="sm" /> : <FolderDown size={18} />}
              {zipDownloading
                ? `Comprimiendo ${zipProgress.done}/${zipProgress.total}…`
                : 'Descargar entregas como ZIP'}
            </button>
          </div>
        )}

        {/* Student list */}
        <div className="px-4 pb-4">
          {filtered.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-8">Sin alumnos en esta categoría</p>
          ) : (
            <div className="bg-surface-card rounded-card overflow-hidden shadow-card">
              {filtered.map((s, i) => {
                const status = getStatus(s.id)
                const sub = submissions[s.id]
                const hasExtension = !!activity?.extensiones?.[s.id]
                return (
                  <button
                    key={s.id}
                    onClick={() => openGrade(s)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface transition-colors cursor-pointer ${
                      i > 0 ? 'border-t border-outline-variant' : ''
                    }`}
                  >
                    <span className="w-5 text-sm text-slate-500 text-right flex-shrink-0">{s.orden}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">
                        {s.apellidoPaterno} {s.apellidoMaterno} {s.nombre}
                      </p>
                      {sub?.fechaEntrega?.seconds && (
                        <p className="text-sm text-slate-500 mt-0.5">
                          {new Date(sub.fechaEntrega.seconds * 1000).toLocaleString('es-MX', {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          })}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {hasExtension && <CalendarDays size={15} className="text-orange-400" />}
                      {sub?.calificacion != null && (
                        <span className="text-sm font-bold text-emerald-600 flex items-center gap-0.5">
                          <Star size={14} /> {sub.calificacion}/{activity?.maxCalif}
                        </span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[status]}`}>
                        {STATUS_LABELS[status]}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Grade / detail modal */}
      {selected && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeModal} />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-on-surface truncate">
                  {selected.student.apellidoPaterno} {selected.student.nombre}
                </h3>
                <p className="text-sm text-slate-500 mt-0.5 truncate">
                  {selected.sub
                    ? selected.sub.completadoSinArchivo
                      ? 'Completada sin archivo'
                      : selected.sub.nombreArchivo
                    : 'Sin entrega aún'}
                </p>
              </div>
              <button onClick={closeModal} className="p-2 text-slate-400 rounded flex-shrink-0"><X size={20} /></button>
            </div>

            {/* Prev / next navigation across the student row */}
            {filtered.length > 1 && (
              <div className="flex items-center justify-between mb-3">
                <button
                  type="button"
                  onClick={() => goToOffset(-1)}
                  disabled={curIdx <= 0}
                  className="flex items-center gap-1 text-xs font-medium text-muted hover:text-accent disabled:opacity-30 disabled:hover:text-muted transition-colors"
                >
                  <ChevronLeft size={18} /> Anterior
                </button>
                <span className="text-sm text-slate-500">{curIdx + 1} / {filtered.length}</span>
                <button
                  type="button"
                  onClick={() => goToOffset(1)}
                  disabled={curIdx >= filtered.length - 1}
                  className="flex items-center gap-1 text-xs font-medium text-muted hover:text-accent disabled:opacity-30 disabled:hover:text-muted transition-colors"
                >
                  Siguiente <ChevronRight size={18} />
                </button>
              </div>
            )}

            {/* Image preview (when the submission is an image) */}
            {selected.sub && !selected.sub.completadoSinArchivo && selected.sub.archivoURL &&
              isImageFile(selected.sub.nombreArchivo, selected.sub.archivoURL) && (
              <a href={selected.sub.archivoURL} target="_blank" rel="noopener noreferrer" className="block mb-3">
                <img
                  src={selected.sub.archivoURL}
                  alt="Entrega del alumno"
                  className="w-full max-h-72 object-contain rounded border border-outline-variant bg-surface"
                />
              </a>
            )}

            {/* Current submission */}
            {selected.sub && !selected.sub.completadoSinArchivo && selected.sub.archivoURL && (
              <a
                href={selected.sub.archivoURL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 bg-surface rounded border border-outline-variant text-sm text-muted hover:bg-surface-container transition-colors mb-3"
              >
                <Download size={18} className="text-accent" />
                Ver / Descargar entrega
              </a>
            )}

            {/* Submission history */}
            {selected.sub?.historial?.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-slate-400 mb-2">Versiones anteriores</p>
                <div className="space-y-1.5">
                  {[...selected.sub.historial].reverse().map((v, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 bg-surface rounded border border-outline-variant text-xs">
                      <span className="text-slate-400 flex-shrink-0">
                        {v.fechaEntrega?.seconds
                          ? new Date(v.fechaEntrega.seconds * 1000).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </span>
                      {v.completadoSinArchivo
                        ? <span className="text-slate-400 italic">sin archivo</span>
                        : v.archivoURL
                          ? <a href={v.archivoURL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline truncate flex items-center gap-1">
                              <Download size={14} /> {v.nombreArchivo}
                            </a>
                          : <span className="text-slate-300 italic">sin archivo</span>
                      }
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Grade form (only when submission exists) */}
            {selected.sub ? (
              <form onSubmit={saveGrade} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">
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
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">
                    Comentario <span className="text-slate-400">(opcional)</span>
                  </label>
                  <textarea
                    value={gradeForm.comentario}
                    onChange={(e) => setGradeForm((f) => ({ ...f, comentario: e.target.value }))}
                    rows={2}
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface resize-none"
                    placeholder="Retroalimentación para el alumno…"
                  />
                </div>
                {!canCreate && (
                  <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 leading-relaxed">
                    Activa tu suscripción mensual para registrar calificaciones nuevas — toda la información de este alumno sigue disponible.
                  </p>
                )}
                <button
                  type="submit"
                  disabled={saving || !canCreate}
                  className="w-full py-2.5 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {saving ? <Spinner size="sm" /> : <Star size={18} />}
                  {saving ? 'Guardando…' : 'Guardar calificación'}
                </button>
              </form>
            ) : (
              <p className="text-sm text-slate-400 text-center py-3">
                El alumno aún no ha entregado esta tarea.
              </p>
            )}

            {/* Bottom actions — extend date */}
            <div className="mt-3 pt-3 border-t border-outline-variant space-y-2">

              {/* Extend deadline */}
              {!extendMode ? (
                <button
                  type="button"
                  onClick={() => setExtendMode(true)}
                  className="text-sm text-slate-500 hover:text-muted transition-colors"
                >
                  Modificar fecha de entrega
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted">Nueva fecha límite para este alumno</p>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={extendDate}
                      onChange={(e) => setExtendDate(e.target.value)}
                      className="flex-1 px-3 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                    />
                    <button
                      type="button"
                      onClick={saveExtension}
                      disabled={!extendDate || savingExtension}
                      className="px-4 py-2 bg-accent text-white text-xs font-semibold rounded disabled:opacity-50 transition-colors"
                    >
                      {savingExtension ? '…' : 'Guardar'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExtendMode(false)}
                    className="text-sm text-slate-500"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      </div>
    </TeacherLayout>
  )
}
