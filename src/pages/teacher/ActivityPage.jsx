import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  updateDoc,
  addDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../../components/Toast'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import {
  ArrowLeft, Clock,
  Download, Star, CalendarDays, Search, ArrowDownAZ,
  ChevronLeft, ChevronRight, FolderDown,
} from 'lucide-react'
import { FilePreview, canPreviewFile } from '../../components/AttachmentList'
import { downloadUrl } from '../../utils/cloudinary'
import { buildJobsForActivity, downloadSubmissionsZip } from '../../utils/downloadSubmissions'
import { subjectDisplayName } from '../../utils/subjectName'
import { useSubscription } from '../../hooks/useSubscription'
import { canCreateContent } from '../../utils/subscriptionHelpers'
import { sanitizeHtml, richTextContentClass, toRichHtml } from '../../utils/sanitizeHtml'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'
import EFDateTimePicker from '../../components/EFDateTimePicker'
import { formatDeadline, formatPublishAt } from '../../utils/activityVisibility'
import { ALL_FILES_KEY, CUSTOM_FILE_TYPE, normalizeFileTypeKeys, parseCustomExts } from '../../config/fileTypes'
import AttachmentList from '../../components/AttachmentList'
import { matchesStudentSearch } from '../../utils/studentSearch'
import EvaluacionManager from '../../components/EvaluacionManager'

// Short display names for the accepted file-type chips
const FILE_TYPE_SHORT_LABELS = {
  imagenes: 'Imágenes (JPG, PNG)', pdf: 'PDF', word: 'Word',
  powerpoint: 'PowerPoint', excel: 'Excel',
  [ALL_FILES_KEY]: 'Cualquier tipo de archivo',
}

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
// Filter-tab labels (plural, aligned with the badges): 'entregado' filters
// what's delivered but not yet graded → 'Por calificar'
const FILTER_LABELS = {
  todos: 'Todos',
  pendiente: 'Pendientes',
  calificado: 'Calificados',
  entregado: 'Por calificar',
}

export default function ActivityPage() {
  const { activityId } = useParams()
  const { userProfile } = useAuth()
  const [activity, setActivity] = useState(null)
  const [activityLabel, setActivityLabel] = useState(null)
  const [subject, setSubject] = useState(null)
  const [students, setStudents] = useState([])
  const [submissions, setSubmissions] = useState({})
  const [filter, setFilter] = useState('todos')
  const [selected, setSelected] = useState(null)
  // Navigation order frozen when the grading view opens — autosaving a grade can
  // remove the student from the active filter (e.g. "Por calificar"), which would
  // otherwise reshuffle Anterior/Siguiente mid-session.
  const [navList, setNavList] = useState([])
  // Opt-in: when checked, Anterior/Siguiente save the grade; when unchecked the
  // teacher is just browsing and only the explicit Guardar button saves.
  // Remembered across sessions so it's a one-time choice.
  const [autoSaveOnNav, setAutoSaveOnNav] = useState(() => localStorage.getItem('ef-autosave-nav') === '1')
  const [gradeForm, setGradeForm] = useState({ calificacion: '', comentario: '' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [searchStudents, setSearchStudents] = useState('')
  const [sortAlpha, setSortAlpha] = useState(false)
  // Per-student deadline extension
  const [extendMode, setExtendMode] = useState(false)
  const [extendDate, setExtendDate] = useState('')
  const [extendMotivo, setExtendMotivo] = useState('')
  const [savingExtension, setSavingExtension] = useState(false)
  // ZIP download
  const [zipDownloading, setZipDownloading] = useState(false)
  const [zipProgress, setZipProgress] = useState({ done: 0, total: 0 })
  const navigate = useNavigate()
  const toast = useToast()
  const { subscription } = useSubscription()
  const canCreate = canCreateContent(subscription)
  // Observación: no student submission — the teacher observes and grades directly,
  // so the grade form is always available and saving creates the submission doc.
  const isObservacion = activity?.tipo === 'observacion' || activity?.categoria === 'observacion'

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
      // Delivered but ungraded (or observación, which never has a delivery) →
      // prefill the max grade so paging with Siguiente/Anterior grades with 10
      // by default (adjust exceptions only).
      calificacion: sub?.calificacion != null
        ? String(sub.calificacion)
        : (sub || isObservacion) ? String(activity?.maxCalif ?? 10) : '',
      comentario: sub?.comentario || '',
    })
    setExtendMode(false)
    setExtendDate(activity?.extensiones?.[student.id] || '')
    setExtendMotivo(activity?.extensionesMotivo?.[student.id] || '')
  }

  // Entry point from the student list: freezes the navigation order.
  function openGradeFromList(student) {
    setNavList(filtered)
    openGrade(student)
  }

  async function closeModal() {
    // With autosave on, closing counts as leaving the student (otherwise the
    // LAST student in the list — who has no Siguiente — would lose their grade).
    if (autoSaveOnNav && isDirty()) {
      try {
        await persistGrade()
      } catch (err) {
        toast('Error al guardar: ' + err.message, 'error')
        return
      }
    }
    setSelected(null)
    setExtendMode(false)
    setExtendDate('')
  }

  // True when the form differs from what's stored — this is what makes
  // Siguiente/Anterior save without duplicating the Guardar logic.
  function isDirty() {
    if (!selected) return false
    if (!selected.sub) {
      // Observación without a grade yet: any valid grade in the box is unsaved
      if (!isObservacion) return false
      const cal = parseFloat(gradeForm.calificacion)
      return !isNaN(cal) || !!gradeForm.comentario.trim()
    }
    const cal = parseFloat(gradeForm.calificacion)
    const calChanged = !isNaN(cal) && cal !== selected.sub.calificacion
    const comChanged = gradeForm.comentario.trim() !== (selected.sub.comentario || '')
    return calChanged || comChanged
  }

  // Single save path shared by the Guardar button and Anterior/Siguiente.
  // Updates local state in place (no reload) so navigation stays fluid.
  // For observación, the first grade CREATES the submission doc (there is no
  // student delivery to attach to).
  async function persistGrade() {
    if (!selected || !canCreate) return false
    if (!selected.sub && !isObservacion) return false
    const cal = parseFloat(gradeForm.calificacion)
    if (isNaN(cal) || cal < 0 || cal > (activity?.maxCalif ?? 10)) return false
    const comentario = gradeForm.comentario.trim()
    let updated
    if (selected.sub) {
      await updateDoc(doc(db, 'submissions', selected.sub.id), {
        calificacion: cal,
        comentario,
        estado: 'calificado',
      })
      updated = { ...selected.sub, calificacion: cal, comentario, estado: 'calificado' }
    } else {
      const data = {
        actividadId: activityId,
        alumnoId: selected.student.id,
        calificacion: cal,
        comentario,
        estado: 'calificado',
        sinEntrega: true,
        fechaEntrega: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'submissions'), data)
      updated = { id: ref.id, ...data }
    }
    setSubmissions((prev) => ({ ...prev, [selected.student.id]: updated }))
    setSelected((sel) => (sel && sel.student.id === selected.student.id ? { ...sel, sub: updated } : sel))
    return true
  }

  async function saveGrade(e) {
    e.preventDefault()
    if (!selected?.sub && !isObservacion) return
    if (!canCreate) {
      toast('Activa tu suscripción mensual para registrar calificaciones — toda tu información sigue disponible')
      return
    }
    setSaving(true)
    try {
      if (await persistGrade()) toast('Calificación guardada')
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
      const motivo = extendMotivo.trim()
      await updateDoc(doc(db, 'activities', activityId), {
        [`extensiones.${selected.student.id}`]: extendDate,
        [`extensionesMotivo.${selected.student.id}`]: motivo,
      })
      setActivity((prev) => ({
        ...prev,
        extensiones: { ...(prev.extensiones || {}), [selected.student.id]: extendDate },
        extensionesMotivo: { ...(prev.extensionesMotivo || {}), [selected.student.id]: motivo },
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

  // Shared by the list page and the fullscreen grading view (its filter tabs
  // need the would-be list for a filter BEFORE the state re-renders).
  function applyStudentFilters(f) {
    let list = f === 'todos' ? students : students.filter((s) => getStatus(s.id) === f)
    if (searchStudents.trim()) {
      list = list.filter((s) => matchesStudentSearch(s, searchStudents))
    }
    if (sortAlpha) {
      list = [...list].sort((a, b) =>
        `${a.apellidoPaterno} ${a.nombre}`.localeCompare(`${b.apellidoPaterno} ${b.nombre}`, 'es')
      )
    }
    return list
  }
  const filtered = applyStudentFilters(filter)

  async function handleZipDownload() {
    setZipDownloading(true)
    setZipProgress({ done: 0, total: 0 })
    try {
      const submissionsArr = Object.values(submissions)
      const jobs = buildJobsForActivity({ students, submissions: submissionsArr })
      if (jobs.length === 0) { toast('No hay archivos entregados para descargar'); return }
      const { escritos, errores } = await downloadSubmissionsZip({
        zipName: [activityLabel, activity?.nombre || 'Entregas'].filter(Boolean).join(' '),
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

  const curIdx = selected ? navList.findIndex((s) => s.id === selected.student.id) : -1
  // Clamp while typing: never above maxCalif, never below 0, at most 1 decimal.
  // Partial input like "9." is left alone so decimals can still be typed.
  function onCalifChange(e) {
    let raw = e.target.value
    const max = activity?.maxCalif ?? 10
    const n = parseFloat(raw)
    if (!isNaN(n)) {
      if (n > max) raw = String(max)
      else if (n < 0) raw = '0'
      else {
        const m = raw.match(/^(\d+\.\d)\d+$/)
        if (m) raw = m[1]
      }
    }
    setGradeForm((f) => ({ ...f, calificacion: raw }))
  }

  function toggleAutoSave() {
    setAutoSaveOnNav((v) => {
      localStorage.setItem('ef-autosave-nav', v ? '0' : '1')
      return !v
    })
  }

  // Filter tabs inside the grading view: re-freeze the navigation list to the new
  // filter and, if the current student doesn't belong to it, jump to its first
  // student (saving pending changes first when autosave is on).
  async function changeFilterInView(f) {
    const list = applyStudentFilters(f)
    setFilter(f)
    setNavList(list)
    if (list.length && !list.some((s) => s.id === selected.student.id)) {
      if (autoSaveOnNav && isDirty()) {
        try {
          await persistGrade()
        } catch (err) {
          toast('Error al guardar: ' + err.message, 'error')
          return
        }
      }
      openGrade(list[0])
    }
  }

  // Navigating away saves pending changes first (shared persistGrade) — only when
  // the teacher opted in via the checkbox; a save error keeps you on the current
  // student instead of silently dropping the grade.
  async function goToOffset(off) {
    const next = navList[curIdx + off]
    if (!next) return
    if (autoSaveOnNav && isDirty()) {
      try {
        await persistGrade()
      } catch (err) {
        toast('Error al guardar: ' + err.message, 'error')
        return
      }
    }
    openGrade(next)
  }

  // Navigate submissions with the keyboard arrows while the grading view is open.
  useEffect(() => {
    if (!selected) return
    function onKey(e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      // Don't hijack the caret while typing in the grade/comment fields
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      goToOffset(e.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, navList, gradeForm, submissions, autoSaveOnNav])

  if (loading) return (
    <TeacherLayout>
      <div className="flex justify-center py-20"><Spinner size="lg" /></div>
    </TeacherLayout>
  )

  if (activity?.tipo === 'evaluacion') {
    return (
      <TeacherLayout>
        <div data-subject-palette={subject?.colorPalette || 'default'}>
          <EvaluacionManager
            activity={activity}
            subject={subject}
            activityId={activityId}
            activityLabel={activityLabel}
            contextLine={[subjectDisplayName(subject), userProfile?.nombreMostrar || userProfile?.nombre].filter(Boolean).join(' — ')}
            students={students}
            submissions={submissions}
            onActivityChange={setActivity}
            resultadosOnly
          />
        </div>
      </TeacherLayout>
    )
  }

  return (
    <TeacherLayout>
      <div data-subject-palette={subject?.colorPalette || 'default'}>
      <div className={TEACHER_CONTAINER_NARROW}>
        {/* Header */}
        {/* Header on the page background — the Instrucciones card floats like Entregas below */}
        <div className="px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
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
              <p className="text-slate-400 text-xs">
                {subjectDisplayName(subject)}
                {(userProfile?.nombreMostrar || userProfile?.nombre) && <span> — {userProfile.nombreMostrar || userProfile.nombre}</span>}
                {' · '}Parcial {activity?.parcial}
              </p>
            </div>
          </div>
          {(activity?.publishedAt || activity?.publishAt || activity?.fechaLimite) && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {activity?.publishedAt && (
                <span data-tooltip="Publicado" className="text-xs text-emerald-600 flex items-center gap-0.5">
                  <Clock size={14} /> {formatPublishAt(activity.publishedAt)}
                </span>
              )}
              {activity?.publishAt && (
                <span data-tooltip="Publicación programada" className="text-xs text-accent flex items-center gap-0.5">
                  <Clock size={14} /> {formatPublishAt(activity.publishAt)}
                </span>
              )}
              {activity?.fechaLimite && (
                <span data-tooltip="Cierre" className="text-xs text-amber-600 flex items-center gap-0.5">
                  <Clock size={14} /> {formatDeadline(activity.fechaLimite)}
                </span>
              )}
            </div>
          )}
          {activity?.instrucciones && (
            <div className="mt-2 rounded-card overflow-hidden bg-surface-card shadow-card" style={{ border: '1px solid var(--accent)' }}>
              <div className="px-4 py-2" style={{ background: 'var(--accent-light)', borderBottom: '1px solid var(--accent)' }}>
                <h2 className="font-semibold text-sm" style={{ color: 'var(--accent)' }}>Instrucciones</h2>
              </div>
              <div
                className={`text-sm text-on-surface p-4 ${richTextContentClass}`}
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(toRichHtml(activity.instrucciones)) }}
              />
            </div>
          )}
          {/* Accepted file types for this entregable (observación has no delivery) */}
          {!isObservacion && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap text-xs text-muted">
            <span className="font-medium">Archivos aceptados:</span>
            {normalizeFileTypeKeys(activity?.tiposArchivo).map((k) => (
              <span key={k} className="bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full">
                {k === CUSTOM_FILE_TYPE
                  ? (parseCustomExts(activity?.extensionesCustom).map((e) => `.${e}`).join(', ') || 'Personalizado')
                  : (FILE_TYPE_SHORT_LABELS[k] || k)}
              </span>
            ))}
          </div>
          )}

          <AttachmentList files={activity?.archivosAdjuntos} />

        </div>

        {/* ── Entregas — same accent container as Preguntas/Configuración ── */}
        <div id="entregas-container" className="mx-4 my-4 rounded-card overflow-hidden bg-surface-card shadow-card" style={{ border: '1px solid var(--accent)' }}>
          <div className="px-4 py-3" style={{ background: 'var(--accent-light)', borderBottom: '1px solid var(--accent)' }}>
            <h2 className="font-semibold" style={{ color: 'var(--accent)' }}>Entregas</h2>
          </div>

        {/* ZIP download — first thing in the container */}
        {Object.values(submissions).some((s) => s.archivoURL && !s.completadoSinArchivo) && (
          <div className="px-4 pt-3">
            <button
              type="button"
              onClick={handleZipDownload}
              disabled={zipDownloading}
              className="w-full flex items-center justify-center gap-2 py-1.5 rounded border border-accent text-accent text-sm font-medium hover:bg-[var(--accent-medium)] transition-colors disabled:opacity-40"
            >
              {zipDownloading ? <Spinner size="sm" /> : <FolderDown size={18} />}
              {zipDownloading
                ? `Comprimiendo ${zipProgress.done}/${zipProgress.total}…`
                : 'Descargar entregas como ZIP'}
            </button>
          </div>
        )}

          {/* Filter tabs — they belong to the Entregas list, so they live inside
              its container; clicking one scrolls the list into full view */}
          <div className="flex gap-1 mx-4 mt-3 bg-surface-container p-1 rounded">
            {['todos', 'pendiente', 'calificado', 'entregado'].map((f) => (
              <button
                type="button"
                key={f}
                onClick={() => {
                  setFilter(f)
                  setTimeout(() => document.getElementById('entregas-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
                }}
                className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
                  filter === f ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'
                }`}
              >
                {FILTER_LABELS[f]} ({f === 'todos' ? students.length : counts[f]})
              </button>
            ))}
          </div>

        {/* Search + sort */}
        <div className="px-4 pt-4 pb-2 flex gap-2">
          <div className="flex-1 relative">
            <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              value={searchStudents}
              onChange={(e) => setSearchStudents(e.target.value)}
              placeholder="Buscar por nombre o por número de lista…"
              className="w-full pl-9 pr-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface-card"
            />
          </div>
          <button
            type="button"
            onClick={() => setSortAlpha((v) => !v)}
            data-tooltip="Ordenar por nombre"
            className={`p-2 rounded border transition-colors ${
              sortAlpha ? 'border-accent bg-accent-light text-accent' : 'border-outline-variant text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)]'
            }`}
          >
            <ArrowDownAZ size={20} />
          </button>
        </div>

        {/* Student list */}
        <div className="px-4 pb-4">
          {filtered.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-8">Sin estudiantes en esta categoría</p>
          ) : (
            <div className="bg-surface-card rounded-card overflow-hidden shadow-card">
              {filtered.map((s, i) => {
                const status = getStatus(s.id)
                const sub = submissions[s.id]
                const hasExtension = !!activity?.extensiones?.[s.id]
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => openGradeFromList(s)}
                    className={`w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-[var(--accent-tint)] transition-colors cursor-pointer ${
                      i > 0 ? 'border-t border-outline-variant' : ''
                    }`}
                  >
                    <span className="w-5 text-xs text-slate-500 text-right flex-shrink-0">{s.orden}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">
                        {s.apellidoPaterno} {s.apellidoMaterno} {s.nombre}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {hasExtension && <CalendarDays size={15} className="text-orange-400" />}
                      {sub?.calificacion != null && (
                        <span className="text-xs font-bold text-emerald-600 flex items-center gap-0.5">
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
        </div>{/* end Entregas container */}
      </div>

      {/* Fullscreen grading view — preview left (full height), grading panel right */}
      {selected && (
        <div className="fixed inset-0 z-40 flex flex-col bg-surface">

          {/* Top bar: back + subject being graded */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-card border-b border-outline-variant flex-shrink-0">
            <button
              type="button"
              onClick={closeModal}
              className="flex items-center gap-1 p-2 -ml-2 text-muted hover:text-accent rounded text-sm font-medium flex-shrink-0 transition-colors"
            >
              <ArrowLeft size={20} /> Regresar
            </button>
            {/* Same header pattern as the activity page: activity title with its
                accent number, then "Asignatura — Profesor · Parcial N" below */}
            <div className="flex-1 min-w-0 text-right sm:text-left">
              <h3 className="text-xl font-bold text-on-surface truncate">
                {activityLabel && <span className="text-accent">{activityLabel} </span>}
                {activity?.nombre}
              </h3>
              <p className="text-slate-400 text-xs truncate">
                {subjectDisplayName(subject)}
                {(userProfile?.nombreMostrar || userProfile?.nombre) && <span> — {userProfile.nombreMostrar || userProfile.nombre}</span>}
                {' · '}Parcial {activity?.parcial}
              </p>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col md:flex-row">

            {/* Left: file preview, top to bottom */}
            <div className="h-[45vh] md:h-auto md:flex-1 min-w-0 bg-surface-container flex flex-col">
              {selected.sub && !selected.sub.completadoSinArchivo && selected.sub.archivoURL ? (
                isImageFile(selected.sub.nombreArchivo, selected.sub.archivoURL) ? (
                  <a
                    href={selected.sub.archivoURL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 min-h-0 flex items-center justify-center p-3"
                    data-tooltip="Abrir en tamaño completo"
                  >
                    <img
                      src={selected.sub.archivoURL}
                      alt="Entrega del estudiante"
                      className="max-w-full max-h-full object-contain rounded"
                    />
                  </a>
                ) : canPreviewFile(selected.sub.nombreArchivo) ? (
                  <div className="flex-1 min-h-0">
                    <FilePreview url={selected.sub.archivoURL} nombre={selected.sub.nombreArchivo} fill />
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 text-sm p-6 text-center">
                    <p>Sin vista previa disponible para este tipo de archivo.</p>
                    <a
                      href={downloadUrl(selected.sub.archivoURL, selected.sub.nombreArchivo)}
                      download={selected.sub.nombreArchivo}
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2 bg-surface-card rounded border border-outline-variant text-sm text-muted hover:bg-[var(--accent-tint)] transition-colors"
                    >
                      <Download size={18} className="text-accent" />
                      Descargar entrega
                    </a>
                  </div>
                )
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-400 text-sm p-6 text-center">
                  {isObservacion
                    ? 'Actividad de observación — no requiere entrega. Califica directamente en el panel.'
                    : selected.sub?.completadoSinArchivo
                      ? 'Actividad completada sin archivo.'
                      : 'El estudiante aún no ha entregado esta tarea.'}
                </div>
              )}
            </div>

            {/* Right: grading panel */}
            <div className="flex-1 md:flex-none w-full md:w-[380px] bg-surface-card border-t md:border-t-0 md:border-l border-outline-variant overflow-y-auto">
              <div className="p-4 space-y-3">

                {/* Filter tabs — same sets as the list; switching re-freezes navigation */}
                <div className="grid grid-cols-2 gap-1.5 bg-surface-container p-1.5 rounded-card">
                  {['todos', 'pendiente', 'calificado', 'entregado'].map((f) => (
                    <button
                      type="button"
                      key={f}
                      onClick={() => changeFilterInView(f)}
                      className={`py-2 px-2 text-sm font-semibold rounded transition-colors ${
                        filter === f
                          ? 'bg-accent text-white shadow-card'
                          : 'bg-surface-card text-muted hover:text-accent hover:bg-[var(--accent-tint)]'
                      }`}
                    >
                      {FILTER_LABELS[f]} ({f === 'todos' ? students.length : counts[f]})
                    </button>
                  ))}
                </div>

                {/* Student */}
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-base font-semibold text-on-surface truncate">
                      {selected.student.apellidoPaterno} {selected.student.apellidoMaterno} {selected.student.nombre}
                    </h4>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_COLORS[getStatus(selected.student.id)]}`}>
                      {STATUS_LABELS[getStatus(selected.student.id)]}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5 truncate">
                    {isObservacion
                      ? 'Observación — se califica sin entrega'
                      : selected.sub
                        ? selected.sub.completadoSinArchivo
                          ? 'Completada sin archivo'
                          : selected.sub.nombreArchivo
                        : 'Sin entrega aún'}
                  </p>
                </div>

                {/* Autosave opt-in above the navigation. The checkbox keeps its
                    space (invisible) when there's no submission so Anterior/
                    Siguiente — and the grade right below — never jump around. */}
                {navList.length > 1 && (
                  <div className="space-y-1.5">
                  <label className={`flex items-center gap-2 text-sm text-muted select-none ${(selected.sub || isObservacion) ? 'cursor-pointer' : 'invisible'}`}>
                    <input
                      type="checkbox"
                      checked={autoSaveOnNav}
                      onChange={toggleAutoSave}
                      className="w-4 h-4 accent-[var(--accent)] flex-shrink-0"
                    />
                    Guardar calificación al avanzar o al retroceder
                  </label>
                  {/* Big, prominent prev/next — the most used controls here */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => goToOffset(-1)}
                      disabled={curIdx <= 0}
                      className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded border border-accent text-accent text-base font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-30"
                    >
                      <ChevronLeft size={20} /> Anterior
                    </button>
                    <span className="text-sm text-slate-500 flex-shrink-0 px-1 whitespace-nowrap">{curIdx + 1} / {navList.length}</span>
                    <button
                      type="button"
                      onClick={() => goToOffset(1)}
                      disabled={curIdx >= navList.length - 1}
                      className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded bg-accent text-white text-base font-semibold hover:bg-accent-hover transition-colors disabled:opacity-30"
                    >
                      Siguiente <ChevronRight size={20} />
                    </button>
                  </div>
                  </div>
                )}

                {/* Grade form (when a submission exists — or always for observación) */}
                {(selected.sub || isObservacion) ? (
                  <form onSubmit={saveGrade} className="space-y-3">
                    {/* Download on the left, grade (with its own header) on the
                        right — narrow input keeps the spinner arrows by the number */}
                    <div className="flex gap-2 items-end">
                      {selected.sub && !selected.sub.completadoSinArchivo && selected.sub.archivoURL && (
                        <a
                          href={downloadUrl(selected.sub.archivoURL, selected.sub.nombreArchivo)}
                          download={selected.sub.nombreArchivo}
                          rel="noopener noreferrer"
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface rounded border border-outline-variant text-sm text-muted hover:bg-[var(--accent-tint)] transition-colors min-w-0"
                        >
                          <Download size={18} className="text-accent flex-shrink-0" />
                          <span className="truncate">Descargar entrega</span>
                        </a>
                      )}
                      <div className="flex-shrink-0">
                        <label className="block text-sm font-medium text-muted mb-1">
                          Calificación <span className="text-slate-400">(máx. {activity?.maxCalif})</span>
                        </label>
                        <input
                          type="number"
                          value={gradeForm.calificacion}
                          onChange={onCalifChange}
                          required
                          min="0"
                          max={activity?.maxCalif}
                          step="0.1"
                          autoFocus
                          className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-base font-semibold text-center bg-surface"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-muted mb-1">
                        Comentario <span className="text-slate-400">(opcional)</span>
                      </label>
                      <textarea
                        value={gradeForm.comentario}
                        onChange={(e) => setGradeForm((f) => ({ ...f, comentario: e.target.value }))}
                        rows={3}
                        className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface resize-none"
                        placeholder="Retroalimentación para el estudiante…"
                      />
                    </div>
                    {!canCreate && (
                      <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 leading-relaxed">
                        Activa tu suscripción mensual para registrar calificaciones nuevas — toda la información de este estudiante sigue disponible.
                      </p>
                    )}
                    {/* With autosave on, Siguiente/Anterior already save — showing
                        this button too would be redundant and confusing. */}
                    {autoSaveOnNav && navList.length > 1 ? (
                      <p className="text-xs text-slate-400 text-center py-1">
                        La calificación se guarda al avanzar o al retroceder.
                      </p>
                    ) : (
                      <button
                        type="submit"
                        disabled={saving || !canCreate || !isDirty()}
                        className="w-full py-2 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                      >
                        {saving ? <Spinner size="sm" /> : <Star size={18} />}
                        {saving ? 'Guardando…' : 'Guardar calificación'}
                      </button>
                    )}
                  </form>
                ) : (
                  <p className="text-sm text-slate-400 text-center py-2">
                    El estudiante aún no ha entregado esta tarea.
                  </p>
                )}

                {/* Submission history */}
                {selected.sub?.historial?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-slate-400 mb-2">Versiones anteriores</p>
                    <div className="space-y-1.5">
                      {[...selected.sub.historial].reverse().map((v, i) => (
                        <div key={`${v.fechaEntrega?.seconds ?? 'v'}-${i}`} className="flex items-center gap-2 px-3 py-2 bg-surface rounded border border-outline-variant text-xs">
                          <span className="text-slate-400 flex-shrink-0">
                            {v.fechaEntrega?.seconds
                              ? new Date(v.fechaEntrega.seconds * 1000).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                              : '—'}
                          </span>
                          {v.completadoSinArchivo
                            ? <span className="text-slate-400 italic">sin archivo</span>
                            : v.archivoURL
                              ? <a href={downloadUrl(v.archivoURL, v.nombreArchivo)} download={v.nombreArchivo} rel="noopener noreferrer" className="text-accent hover:underline truncate flex items-center gap-1">
                                  <Download size={14} /> {v.nombreArchivo}
                                </a>
                              : <span className="text-slate-300 italic">sin archivo</span>
                          }
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Extend deadline for this student (no deadline in observación) */}
                {!isObservacion && (
                <div className="pt-3 border-t border-outline-variant space-y-2">
                  {!extendMode ? (
                    <button
                      type="button"
                      onClick={() => setExtendMode(true)}
                      className="block mx-auto text-sm text-slate-500 hover:text-muted transition-colors"
                    >
                      Modificar fecha de entrega para este estudiante
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-on-surface">Nueva fecha y hora límite para este estudiante</p>
                      <EFDateTimePicker
                        mode="datetime"
                        value={extendDate}
                        onChange={setExtendDate}
                        clearable={false}
                      />
                      <div>
                        <label className="block text-sm font-medium text-muted mb-1">Motivo</label>
                        <textarea
                          value={extendMotivo}
                          onChange={(e) => setExtendMotivo(e.target.value)}
                          rows={2}
                          placeholder="Motivo de la extensión…"
                          className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface resize-none"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setExtendMode(false)}
                          className="flex-1 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={saveExtension}
                          disabled={!extendDate || savingExtension}
                          className="flex-1 py-2 bg-accent text-white text-sm font-semibold rounded disabled:opacity-50 transition-colors"
                        >
                          {savingExtension ? 'Guardando…' : 'Guardar'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                )}

              </div>
            </div>
          </div>
        </div>
      )}

      </div>
    </TeacherLayout>
  )
}
