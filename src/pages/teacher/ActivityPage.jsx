import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../../components/Toast'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import SearchInput from '../../components/SearchInput'
import {
  ArrowLeft, Clock,
  Download, Star, CalendarDays, ArrowDownAZ,
  ChevronLeft, ChevronRight, FolderDown, Pencil, Trash2,
} from 'lucide-react'
import { FilePreview, FilePreviewModal, canPreviewFile } from '../../components/AttachmentList'
import { getResourceIcon } from '../../utils/resourceTypes'
import ZoomableImage from '../../components/ZoomableImage'
import { downloadUrl } from '../../utils/cloudinary'
import { buildJobsForActivity, downloadSubmissionsZip } from '../../utils/downloadSubmissions'
import { subjectDisplayName } from '../../utils/subjectName'
import { IS_NATIVE_APP } from '../../utils/platform'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import { useSubscription } from '../../hooks/useSubscription'
import { canCreateContent } from '../../utils/subscriptionHelpers'
import { sanitizeHtml, richTextContentClass, toRichHtml } from '../../utils/sanitizeHtml'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'
import EFDateTimePicker from '../../components/EFDateTimePicker'
import { nowIsoLocal } from '../../utils/nowIso'
import { formatDeadline, formatPublishAt } from '../../utils/activityVisibility'
import { ALL_FILES_KEY, CUSTOM_FILE_TYPE, normalizeFileTypeKeys, parseCustomExts } from '../../config/fileTypes'
import AttachmentList from '../../components/AttachmentList'
import { matchesStudentSearch, studentFullName } from '../../utils/studentSearch'
import EvaluacionManager from '../../components/EvaluacionManager'
import EntregableEditor from '../../components/EntregableEditor'
import NuevaFechaEntregaModal from '../../components/NuevaFechaEntregaModal'
import RubricaGradeTable from '../../components/rubrica/RubricaGradeTable'
import { ClipboardList, X } from 'lucide-react'
import { totalRubrica, RUBRICA_TOTAL } from '../../utils/rubrica'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'

// La evaluación con rúbrica de un alumno "no existe" hasta que se elige algún
// nivel — un arreglo todo-null equivale a no tener rúbrica evaluada (permite
// comparar contra submissions calificadas antes de agregar la rúbrica).
function normRubricaEval(arr) {
  return Array.isArray(arr) && arr.some((v) => v != null) ? arr : null
}

// How late a submission was, relative to that student's effective deadline
// (their extension if any, otherwise the activity deadline).
function formatLateness(sub, student, activity) {
  if (!sub?.tarde) return null
  const dl = activity?.extensiones?.[student?.id] || activity?.fechaLimite
  const submitMs = sub.fechaEntrega?.seconds ? sub.fechaEntrega.seconds * 1000 : null
  if (!dl || !submitMs) return 'Entrega tarde'
  const dlMs = new Date(dl.includes('T') ? dl : `${dl}T23:59:59`).getTime()
  const diff = submitMs - dlMs
  if (diff <= 60000) return 'Entrega tarde'
  const mins = Math.floor(diff / 60000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const rem = mins % 60
  const parts = []
  if (days) parts.push(`${days} día${days !== 1 ? 's' : ''}`)
  if (hours) parts.push(`${hours} h`)
  if (!days && rem) parts.push(`${rem} min`)
  return `Entrega tarde — ${parts.join(' ') || 'menos de 1 min'}`
}

// Short display names for the accepted file-type chips
const FILE_TYPE_SHORT_LABELS = {
  imagenes: 'Imágenes (JPG, PNG) — hasta 5', pdf: 'PDF', word: 'Word',
  powerpoint: 'PowerPoint', excel: 'Excel', zip: 'ZIP/RAR',
  [ALL_FILES_KEY]: 'Cualquier tipo de archivo',
}

function isImageFile(name, url) {
  const s = `${name || ''} ${url || ''}`.toLowerCase()
  return /\.(jpg|jpeg|png|gif|webp)(\?|$|\s)/.test(s) || /\.(jpg|jpeg|png|gif|webp)$/.test((name || '').toLowerCase())
}

// All files of a submission: `archivos[]` when present (multi-photo uploads),
// falling back to the legacy single archivoURL/nombreArchivo pair.
function submissionFiles(sub) {
  if (!sub || sub.completadoSinArchivo) return []
  if (sub.archivos?.length) return sub.archivos.map((f) => ({ url: f.url, nombre: f.nombre }))
  return sub.archivoURL ? [{ url: sub.archivoURL, nombre: sub.nombreArchivo }] : []
}

// Miniatura cuadrada para un archivo NO imagen dentro de la tira de entrega
// de Android (alto fijo) — toca para abrir la vista previa a pantalla
// completa ya existente (FilePreviewModal), sin ocupar espacio inline.
function EntregaFileTile({ f }) {
  const [open, setOpen] = useState(false)
  const { icon: Icon, color } = getResourceIcon(f.nombre)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-tooltip="Ver"
        className="h-full aspect-square flex-shrink-0 flex flex-col items-center justify-center gap-1 rounded border border-outline-variant bg-surface-card px-1"
      >
        <Icon size={26} className={color} />
        <span className="text-[10px] text-muted truncate max-w-full px-1">{f.nombre}</span>
      </button>
      {open && <FilePreviewModal url={f.url} nombre={f.nombre} onClose={() => setOpen(false)} />}
    </>
  )
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
  // "Nueva fecha de entrega" modal, offered from within the activity editor
  const [newDateOpen, setNewDateOpen] = useState(false)
  const [subject, setSubject] = useState(null)
  const [students, setStudents] = useState([])
  const [submissions, setSubmissions] = useState({})
  const [filter, setFilter] = useState('todos')
  const [selected, setSelected] = useState(null)
  // Full grading view overlay: locks background scroll while it's open.
  useScrollLock(selected)
  // Navigation order frozen when the grading view opens — autosaving a grade can
  // remove the student from the active filter (e.g. "Por calificar"), which would
  // otherwise reshuffle Anterior/Siguiente mid-session.
  const [navList, setNavList] = useState([])
  // Which file of a multi-photo submission is showing in the preview pane.
  // -1 = ALL images stacked (scrollable) — the default overview.
  const [previewIdx, setPreviewIdx] = useState(-1)
  // ZIP of the current student's files only
  const [studentZipDownloading, setStudentZipDownloading] = useState(false)
  // Opt-in: when checked, Anterior/Siguiente save the grade; when unchecked the
  // teacher is just browsing and only the explicit Guardar button saves.
  // Remembered across sessions so it's a one-time choice.
  const [autoSaveOnNav, setAutoSaveOnNav] = useState(() => localStorage.getItem('ef-autosave-nav') === '1')
  const [gradeForm, setGradeForm] = useState({ calificacion: '', comentario: '' })
  // Nivel elegido por criterio cuando la actividad tiene rúbrica (null = sin elegir)
  const [rubricEval, setRubricEval] = useState(null)
  // "Ver rúbrica": ventana flotante sobrepuesta que abre abajo del botón,
  // hacia la izquierda hasta media pantalla — la entrega sigue visible detrás
  const [rubricaViewOpen, setRubricaViewOpen] = useState(false)
  const [rubricaWinTop, setRubricaWinTop] = useState(120)
  // En Android la rúbrica se abre hacia ARRIBA del botón (en vez de hacia
  // abajo como en la web) — se ancla por `bottom` en vez de por `top`.
  const [rubricaWinBottom, setRubricaWinBottom] = useState(80)
  const rubricaBtnRef = useRef(null)
  // La ventana se ancla DEBAJO del renglón de la calificación oficial, para
  // que ésta quede siempre a la vista mientras se marca la rúbrica
  const califRowRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [searchStudents, setSearchStudents] = useState('')
  const [sortAlpha, setSortAlpha] = useState(false)
  // Per-student deadline extension
  const [extendMode, setExtendMode] = useState(false)
  const [extendDate, setExtendDate] = useState('')
  const [extendMotivo, setExtendMotivo] = useState('')
  const [savingExtension, setSavingExtension] = useState(false)
  // Annul the current submission (student sent the wrong thing → back to Pendiente)
  const [annulMode, setAnnulMode] = useState(false)
  const [annulling, setAnnulling] = useState(false)
  // Grade a student who has no submission (e.g. handed the file on a USB stick)
  const [sinEntregaMode, setSinEntregaMode] = useState(false)
  const [sinEntregaGrade, setSinEntregaGrade] = useState('')
  const [sinEntregaMotivo, setSinEntregaMotivo] = useState('')
  const [savingSinEntrega, setSavingSinEntrega] = useState(false)
  // ZIP download
  const [zipDownloading, setZipDownloading] = useState(false)
  const [zipProgress, setZipProgress] = useState({ done: 0, total: 0 })
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  // Grade-table cells navigate here with the student to open right away —
  // and closing the grading view must land back on that Calificaciones screen.
  const [pendingOpenId, setPendingOpenId] = useState(location.state?.openStudentId || null)
  const returnToGrades = location.state?.returnTo === 'calificaciones'
  const { subscription } = useSubscription()
  const canCreate = canCreateContent(subscription)
  // Observación: no student submission — the teacher observes and grades directly,
  // so the grade form is always available and saving creates the submission doc.
  const isObservacion = activity?.tipo === 'observacion' || activity?.categoria === 'observacion'
  // Evaluación (cuestionario/examen): the grade comes from the student's attempt;
  // the grading panel allows a manual override but no prefill/annul/extension.
  const isEvaluacion = activity?.tipo === 'evaluacion'
  // Rúbrica: solo entregables (nunca observación ni evaluación)
  const hasRubrica = !!activity?.rubrica?.criterios?.length && !isObservacion && !isEvaluacion
  // Edit activity modal
  const [editingActivity, setEditingActivity] = useState(false)
  // Parcial cerrado: no grade can be changed until the teacher reverts the close.
  const parcialCerrado = !!(subject?.parcialesCerrados && activity?.parcial != null && subject.parcialesCerrados[activity.parcial])

  useEffect(() => { loadAll() }, [activityId])

  // Coming from a grade-table cell: open that student's grading view once the
  // data is committed (openGrade reads `submissions`/`activity` from state).
  // While pendingOpenId is set we keep showing the spinner (see the loading
  // guard below) so the list never flashes before the grading view opens.
  // Evaluaciones are excluded: EvaluacionManager owns opening that student's
  // answer review itself (via its own `openStudentId` prop) — calling
  // openGrade here too would ALSO mount this page's generic grading overlay
  // (the "Evaluación — la calificación proviene del intento…" panel), which
  // briefly flashes before EvaluacionManager's own review view covers it.
  useEffect(() => {
    if (loading || !pendingOpenId) return
    const st = students.find((s) => s.id === pendingOpenId)
    // Clear it in the same commit that opens the grading view, so pendingOpenId
    // turning false and `selected` turning true happen together (no list flash).
    setPendingOpenId(null)
    if (st && !isEvaluacion) {
      setNavList(students)
      openGrade(st)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, pendingOpenId, students])

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
      // Drafts are EXCLUDED from the numbering, same rule as the subject page
      // (otherwise clicking "1.6" in the grades table lands on a page titled
      // "1.9" when drafts sit earlier in the orden).
      const isDraft = (a) => a.oculta && !a.publishedAt && !a.publishAt
      const siblings = siblingActsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => a.parcial === actData.parcial && !isDraft(a))
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      const idx = siblings.findIndex((a) => a.id === activityId)
      setActivityLabel(idx >= 0 ? `${actData.parcial}.${idx + 1}.` : null)
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
      // En Android siempre arranca en el máximo (el docente baja si hace
      // falta) — en web solo se prellena cuando ya hay entrega u observación.
      calificacion: sub?.calificacion != null
        ? String(sub.calificacion)
        : (IS_NATIVE_APP || (sub && !isEvaluacion) || isObservacion) ? String(activity?.maxCalif ?? 10) : '',
      comentario: sub?.comentario || '',
    })
    // Con rúbrica: cargar la evaluación guardada; si aún no hay calificación,
    // prellenar todo en el nivel máximo (equivale al prellenado de 10 de arriba
    // — el docente solo ajusta las excepciones).
    if (activity?.rubrica?.criterios?.length && !isObservacion && !isEvaluacion) {
      const n = activity.rubrica.criterios.length
      const previa = Array.isArray(sub?.rubricaEval) && sub.rubricaEval.length === n ? [...sub.rubricaEval] : null
      setRubricEval(previa || (sub && sub.calificacion == null ? Array(n).fill(0) : Array(n).fill(null)))
    } else {
      setRubricEval(null)
    }
    setExtendMode(false)
    setExtendDate(activity?.extensiones?.[student.id] || '')
    setExtendMotivo(activity?.extensionesMotivo?.[student.id] || '')
    setPreviewIdx(-1)
    setAnnulMode(false)
    setSinEntregaMode(false)
    setSinEntregaGrade('')
    setSinEntregaMotivo('')
  }

  // Entry point from the student list: freezes the navigation order.
  function openGradeFromList(student) {
    setNavList(filtered)
    openGrade(student)
  }

  // Header back arrow — also reused by the physical Android back button.
  function goBack() {
    navigate(`/subject/${activity?.asignaturaId}`, returnToGrades ? { state: { tab: 'calificaciones' } } : undefined)
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
    // Opened from a Calificaciones cell → Regresar goes back to that screen
    if (returnToGrades) {
      navigate(`/subject/${activity?.asignaturaId}`, { state: { tab: 'calificaciones' } })
    }
  }

  // True when the form differs from what's stored — this is what makes
  // Siguiente/Anterior save without duplicating the Guardar logic.
  function isDirty() {
    if (!selected) return false
    if (!selected.sub) {
      // Sin entrega: solo observación (siempre) o entregable con rúbrica
      // (rubricar a quien no entregó) pueden tener calificación pendiente
      if (!isObservacion && !hasRubrica) return false
      const cal = parseFloat(gradeForm.calificacion)
      return !isNaN(cal) || !!gradeForm.comentario.trim()
    }
    const cal = parseFloat(gradeForm.calificacion)
    const calChanged = !isNaN(cal) && cal !== selected.sub.calificacion
    const comChanged = gradeForm.comentario.trim() !== (selected.sub.comentario || '')
    const rubChanged = hasRubrica &&
      JSON.stringify(normRubricaEval(rubricEval)) !== JSON.stringify(normRubricaEval(selected.sub.rubricaEval))
    return calChanged || comChanged || rubChanged
  }

  // Tocar un nivel en la rúbrica: guarda la elección y, cuando todos los
  // criterios tienen nivel, escribe el total calculado en la calificación.
  function selectRubricaNivel(ci, ni) {
    if (parcialCerrado) return
    setRubricEval((prev) => {
      const next = [...(prev || Array(activity.rubrica.criterios.length).fill(null))]
      next[ci] = ni
      const total = totalRubrica(activity.rubrica, next)
      if (total != null) setGradeForm((f) => ({ ...f, calificacion: String(total) }))
      return next
    })
  }

  // Single save path shared by the Guardar button and Anterior/Siguiente.
  // Updates local state in place (no reload) so navigation stays fluid.
  // For observación, the first grade CREATES the submission doc (there is no
  // student delivery to attach to).
  async function persistGrade() {
    if (!selected || !canCreate) return false
    if (parcialCerrado) return false
    // Sin entrega solo se puede calificar en observación o rubricando (la
    // rúbrica permite evaluar en cero o en lo que corresponda a quien no entregó)
    if (!selected.sub && !isObservacion && !hasRubrica) return false
    const cal = parseFloat(gradeForm.calificacion)
    if (isNaN(cal) || cal < 0 || cal > (activity?.maxCalif ?? 10)) return false
    const comentario = gradeForm.comentario.trim()
    // La rúbrica evaluada viaja junto con la calificación (null si no se tocó)
    const rubricaEvalPayload = hasRubrica ? { rubricaEval: normRubricaEval(rubricEval) } : {}
    let updated
    if (selected.sub) {
      await updateDoc(doc(db, 'submissions', selected.sub.id), {
        calificacion: cal,
        comentario,
        estado: 'calificado',
        ...rubricaEvalPayload,
      })
      updated = { ...selected.sub, calificacion: cal, comentario, estado: 'calificado', ...rubricaEvalPayload }
    } else {
      const data = {
        actividadId: activityId,
        alumnoId: selected.student.id,
        calificacion: cal,
        comentario,
        estado: 'calificado',
        sinEntrega: true,
        fechaEntrega: serverTimestamp(),
        ...rubricaEvalPayload,
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
    if (!selected?.sub && !isObservacion && !hasRubrica) return
    if (parcialCerrado) {
      toast('El parcial está cerrado. Primero revierte el cierre del parcial para cambiar calificaciones.', 'error')
      return
    }
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

  // ZIP with just the current student's files, named "1.3 Actividad - Alumno.zip"
  async function downloadStudentZip() {
    if (!selected || selFiles.length < 2) return
    setStudentZipDownloading(true)
    try {
      const studentName = studentFullName(selected.student)
      const jobs = selFiles.map((f, i) => ({
        path: [],
        fileBaseName: `${studentName} ${String(i + 1).padStart(2, '0')}`,
        url: f.url,
        nombreArchivo: f.nombre,
      }))
      const { escritos, errores } = await downloadSubmissionsZip({
        zipName: [activityLabel, activity?.nombre, '-', studentName].filter(Boolean).join(' '),
        jobs,
      })
      toast(errores > 0
        ? `Descargadas ${escritos} de ${escritos + errores} imágenes (${errores} con error)`
        : `${escritos} imágenes en ZIP`)
    } catch (err) {
      toast('Error al generar ZIP: ' + err.message, 'error')
    } finally {
      setStudentZipDownloading(false)
    }
  }

  // Deletes the current submission doc: the student goes back to "Pendiente"
  // and can submit again (any grade it had is removed with it).
  async function annulSubmission() {
    if (!selected?.sub) return
    if (parcialCerrado) {
      toast('El parcial está cerrado. Primero revierte el cierre del parcial.', 'error')
      return
    }
    setAnnulling(true)
    try {
      await deleteDoc(doc(db, 'submissions', selected.sub.id))
      setSubmissions((prev) => {
        const next = { ...prev }
        delete next[selected.student.id]
        return next
      })
      setSelected((sel) => (sel && sel.student.id === selected.student.id ? { ...sel, sub: undefined } : sel))
      setGradeForm({ calificacion: isObservacion ? String(activity?.maxCalif ?? 10) : '', comentario: '' })
      setAnnulMode(false)
      toast('Entrega anulada — el estudiante queda en Pendiente y puede volver a entregar')
    } catch (err) {
      toast('Error al anular: ' + err.message, 'error')
    } finally {
      setAnnulling(false)
    }
  }

  // Grade a student with no submission (e.g. handed it in on a USB stick).
  // Creates a submission marked sinEntrega with the reason, so it counts and
  // shows in the grades. NOT cierreParcial → it stays as a manual (black) grade.
  async function saveSinEntrega() {
    if (!selected || selected.sub) return
    if (parcialCerrado) {
      toast('El parcial está cerrado. Primero revierte el cierre del parcial.', 'error')
      return
    }
    if (!canCreate) {
      toast('Activa tu suscripción mensual para registrar calificaciones — toda tu información sigue disponible')
      return
    }
    const cal = parseFloat(sinEntregaGrade)
    if (isNaN(cal) || cal < 0 || cal > (activity?.maxCalif ?? 10)) {
      toast(`Escribe una calificación válida (0 a ${activity?.maxCalif ?? 10})`, 'error')
      return
    }
    setSavingSinEntrega(true)
    try {
      const data = {
        actividadId: activityId,
        alumnoId: selected.student.id,
        calificacion: cal,
        comentario: '',
        motivoSinEntrega: sinEntregaMotivo.trim(),
        estado: 'calificado',
        sinEntrega: true,
        fechaEntrega: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'submissions'), data)
      const updated = { id: ref.id, ...data }
      setSubmissions((prev) => ({ ...prev, [selected.student.id]: updated }))
      setSelected((sel) => (sel && sel.student.id === selected.student.id ? { ...sel, sub: updated } : sel))
      setGradeForm({ calificacion: String(cal), comentario: '' })
      setSinEntregaMode(false)
      toast('Calificación sin entrega guardada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingSinEntrega(false)
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

  // Already published? The "Nueva fecha límite de entrega" action lives in the
  // editor and is offered once the activity is published (a student may fall
  // behind the group deadline and need their own extension).
  const isPublished = !!activity?.publishedAt && new Date(
    activity.publishedAt.includes('T') ? activity.publishedAt : `${activity.publishedAt}T00:00:00`
  ).getTime() <= Date.now()

  // Merges the result of NuevaFechaEntregaModal into local activity state.
  function applyNewDateResult(result) {
    setActivity((prev) => {
      if (result.mode === 'todos') return { ...prev, fechaLimite: result.date, cerradaManual: false }
      const ext = { ...(prev.extensiones || {}) }
      const em = { ...(prev.extensionesMotivo || {}) }
      result.ids.forEach((id) => { ext[id] = result.date; em[id] = result.motivo })
      return { ...prev, extensiones: ext, extensionesMotivo: em }
    })
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
        studentFullName(a).localeCompare(studentFullName(b), 'es')
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
  // Files of the submission being graded (multi-photo entregas have several)
  const selFiles = selected ? submissionFiles(selected.sub) : []
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

  // Botones +/- de la calificación grande en Android — saltos de 0.5,
  // acotados entre 0 y el máximo de la actividad.
  function stepCalif(delta) {
    const max = activity?.maxCalif ?? 10
    const current = parseFloat(gradeForm.calificacion)
    const base = isNaN(current) ? 0 : current
    const next = Math.min(max, Math.max(0, Math.round((base + delta) * 2) / 2))
    setGradeForm((f) => ({ ...f, calificacion: String(next) }))
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
    if (navList.length < 2 || curIdx < 0) return
    // Wrap around: past the last student loops to the first, and vice versa.
    const nextIdx = (curIdx + off + navList.length) % navList.length
    const next = navList[nextIdx]
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

  // Physical Android back button: mirrors the on-screen back arrow / close
  // buttons already wired above. Order doesn't matter here — the module-level
  // stack in useBackHandler only activates whichever of these is actually open.
  useBackHandler(goBack)
  useBackHandler(() => setEditingActivity(false), editingActivity)
  useBackHandler(closeModal, !!selected)
  useBackHandler(() => setNewDateOpen(false), newDateOpen)

  // Keep the spinner while a grades-table cell is about to open a student, so the
  // list never flashes before the grading view opens.
  if (loading || pendingOpenId) return (
    <TeacherLayout>
      <div className="flex justify-center py-20"><Spinner size="lg" /></div>
    </TeacherLayout>
  )

  return (
    <TeacherLayout>
      <div {...subjectPaletteProps(subject?.colorPalette)}>
      {/* Evaluaciones render their manager as the page body, but share the
          fullscreen per-student grading overlay below (so a grades-table cell
          opens the SAME panel for every activity type). */}
      {activity?.tipo === 'evaluacion' ? (
        <EvaluacionManager
          activity={activity}
          subject={subject}
          activityId={activityId}
          activityLabel={activityLabel}
          contextLine={[subjectDisplayName(subject), userProfile?.nombreMostrar || userProfile?.nombre].filter(Boolean).join(' — ')}
          students={students}
          submissions={submissions}
          onActivityChange={setActivity}
          onSubmissionRemoved={(studentId) => setSubmissions((prev) => {
            const next = { ...prev }
            delete next[studentId]
            return next
          })}
          onSubmissionUpdated={(studentId, sub) => setSubmissions((prev) => ({ ...prev, [studentId]: sub }))}
          resultadosOnly
          backState={returnToGrades ? { tab: 'calificaciones' } : null}
          openStudentId={location.state?.openStudentId || null}
        />
      ) : (
      <div className={TEACHER_CONTAINER_NARROW}>
        {/* Header */}
        {/* Header on the page background — the Instrucciones card floats like Entregas below */}
        <div className="px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goBack}
              aria-label="Volver"
              className="p-2 -ml-2 text-slate-400 hover:text-muted rounded"
            >
              <ArrowLeft size={22} />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-muted truncate">
                {subjectDisplayName(subject)}
                {(userProfile?.nombreMostrar || userProfile?.nombre) && <span> — {userProfile.nombreMostrar || userProfile.nombre}</span>}
              </p>
              <p className="text-sm font-bold uppercase tracking-wide text-accent">Evaluar</p>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-on-surface truncate">
                  {activityLabel && <span className="text-accent">{activityLabel} </span>}
                  {activity?.nombre}
                </h1>
                <button
                  type="button"
                  onClick={() => setEditingActivity(true)}
                  data-tooltip="Editar actividad"
                  aria-label="Editar actividad"
                  className="p-1 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0"
                >
                  <Pencil size={18} />
                </button>
              </div>
              <p className="text-sm font-medium text-muted">
                Parcial {activity?.parcial} · {activity?.categoria === 'examen' ? 'Examen' : activity?.categoria === 'cuestionario' ? 'Cuestionario' : activity?.categoria === 'observacion' ? 'Observación' : 'Entregable'}
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
              {activity?.recibirTarde && !activity?.cerradaManual && (
                <span data-tooltip="Se aceptan entregas tarde" className="text-xs text-slate-500 flex items-center gap-0.5">
                  Recibe entregas tarde
                </span>
              )}
            </div>
          )}
          {activity?.instrucciones && (
            <div className="mt-2 rounded-card overflow-hidden bg-surface-card shadow-card border border-accent">
              <div className="px-4 py-2 bg-accent-light border-b border-accent">
                <h2 className="font-semibold text-sm text-accent">Instrucciones</h2>
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
        <div id="entregas-container" className="mx-4 my-4 rounded-card overflow-hidden bg-surface-card shadow-card border border-accent">
          <div className="px-4 py-3 bg-accent-light border-b border-accent">
            <h2 className="font-semibold text-accent">Entregas</h2>
          </div>

        {/* ZIP download — solo en la web. Primero en el contenedor. */}
        {!IS_NATIVE_APP && Object.values(submissions).some((s) => s.archivoURL && !s.completadoSinArchivo) && (
          <div className="px-4 pt-3">
            <button
              type="button"
              onClick={handleZipDownload}
              disabled={zipDownloading}
              className="w-full flex items-center justify-center gap-2 py-1.5 rounded border border-accent text-accent text-sm font-medium hover:bg-[var(--accent-medium)] transition-colors disabled:opacity-60"
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

        {/* Search — misma barra en web y en Android; ordenar por nombre solo en web */}
        <div className="px-4 pt-4 pb-2 flex gap-2">
          <div className="flex-1">
            <SearchInput
              value={searchStudents}
              onChange={setSearchStudents}
              placeholder="Buscar por nombre o por número de lista…"
            />
          </div>
          {!IS_NATIVE_APP && (
            <button
              type="button"
              onClick={() => setSortAlpha((v) => !v)}
              data-tooltip="Ordenar por nombre"
              aria-label="Ordenar por nombre"
              className={`p-2 rounded border transition-colors ${
                sortAlpha ? 'border-accent bg-accent-light text-accent' : 'border-outline-variant text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)]'
              }`}
            >
              <ArrowDownAZ size={20} />
            </button>
          )}
        </div>

        {/* Student list — nombre a la izquierda, estatus a la derecha */}
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
                    <div className="flex-1 min-w-0" data-tooltip="Evaluar" data-tooltip-pos="bottom">
                      <p className="text-sm font-medium text-on-surface truncate">
                        {studentFullName(s)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {hasExtension && <CalendarDays size={15} className="text-orange-400" />}
                      {sub?.tarde && (
                        <span data-tooltip="Entregó después de la fecha límite" className="text-[11px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                          Tarde
                        </span>
                      )}
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
      )}

      {/* Fullscreen grading view — preview left (full height), grading panel right.
          Android has its own single-column layout below (IS_NATIVE_APP) — this one
          is web/desktop only. */}
      {selected && !IS_NATIVE_APP && (
        <div className="fixed inset-0 z-40 flex flex-col bg-surface">

          {/* Top bar: back + subject being graded.
              md:pr-[380px] reserva el mismo ancho que el panel de calificación
              de la derecha (md:w-[380px] más abajo), así el grupo botón+título
              se centra en la MISMA franja que la vista previa de la izquierda
              — y el botón "Regresar" vive DENTRO de ese grupo centrado, pegado
              al título, en vez de quedar solo en el borde izquierdo de la
              pantalla. Mismo patrón en EvaluacionManager.jsx (md:pr-72, aside
              más angosto). */}
          <div className="flex items-center px-4 py-2.5 bg-surface-card border-b border-outline-variant flex-shrink-0 safe-top">
            <div className="flex-1 min-w-0 md:pr-[380px]">
              <div className="max-w-3xl mx-auto flex items-start gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex items-center gap-1 p-2 -ml-2 mt-0.5 text-muted hover:text-accent rounded text-sm font-medium flex-shrink-0 transition-colors"
                >
                  <ArrowLeft size={20} /> Regresar
                </button>
                {/* Mismo patrón homogeneizado en las 4 variantes de este encabezado:
                    Asignatura — Docente / Evaluar(ción) / Número y nombre + lápiz /
                    Parcial N · Tipo — ver también EvaluacionManager.jsx. */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-muted truncate">
                    {subjectDisplayName(subject)}
                    {(userProfile?.nombreMostrar || userProfile?.nombre) && <span> — {userProfile.nombreMostrar || userProfile.nombre}</span>}
                  </p>
                  <p className="text-sm font-bold uppercase tracking-wide text-accent">Evaluar</p>
                  <h3 className="text-xl font-bold text-on-surface truncate">
                    {activityLabel && <span className="text-accent">{activityLabel} </span>}
                    {activity?.nombre}
                  </h3>
                  <p className="text-sm font-medium text-muted truncate">
                    Parcial {activity?.parcial} · {activity?.categoria === 'examen' ? 'Examen' : activity?.categoria === 'cuestionario' ? 'Cuestionario' : activity?.categoria === 'observacion' ? 'Observación' : 'Entregable'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col md:flex-row">

            {/* Left: file preview, top to bottom */}
            <div className="h-[45vh] md:h-auto md:flex-1 min-w-0 bg-surface-container flex flex-col">
              {selFiles.length > 1 && previewIdx === -1 ? (
                /* "Todas las imágenes": every file stacked, scrollable */
                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                  {selFiles.map((f, i) => (
                    isImageFile(f.nombre, f.url) ? (
                      <a key={`${f.url}-${i}`} href={f.url} target="_blank" rel="noopener noreferrer" className="block" data-tooltip="Abrir en tamaño completo">
                        <img src={f.url} alt={f.nombre} className="max-w-full rounded mx-auto" />
                      </a>
                    ) : (
                      <a key={`${f.url}-${i}`} href={downloadUrl(f.url, f.nombre)} download={f.nombre} rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-surface-card rounded border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors">
                        <Download size={18} className="text-accent flex-shrink-0" />
                        <span className="truncate">{f.nombre}</span>
                      </a>
                    )
                  ))}
                </div>
              ) : selFiles.length > 1 ? (
                /* Preview ONE image — the one picked from the file list */
                (() => {
                  const f = selFiles[Math.min(previewIdx, selFiles.length - 1)]
                  return isImageFile(f.nombre, f.url) ? (
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-h-0 flex items-center justify-center p-3"
                      data-tooltip="Abrir en tamaño completo"
                    >
                      <img src={f.url} alt={f.nombre} className="max-w-full max-h-full object-contain rounded" />
                    </a>
                  ) : canPreviewFile(f.nombre) ? (
                    <div className="flex-1 min-h-0">
                      <FilePreview url={f.url} nombre={f.nombre} fill />
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 text-sm p-6 text-center">
                      <p>Sin vista previa disponible para este archivo.</p>
                      <a
                        href={downloadUrl(f.url, f.nombre)}
                        download={f.nombre}
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-surface-card rounded border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors"
                      >
                        <Download size={18} className="text-accent" />
                        Descargar archivo
                      </a>
                    </div>
                  )
                })()
              ) : selected.sub && !selected.sub.completadoSinArchivo && selected.sub.archivoURL ? (
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
                      className="flex items-center gap-2 px-4 py-2 bg-surface-card rounded border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors"
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
                    : isEvaluacion
                      ? 'Evaluación — la calificación proviene del intento del alumno; puedes ajustarla en el panel.'
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
                <div className="grid grid-cols-2 gap-1.5 bg-surface-container p-1 rounded">
                  {['todos', 'pendiente', 'calificado', 'entregado'].map((f) => (
                    <button
                      type="button"
                      key={f}
                      onClick={() => changeFilterInView(f)}
                      className={`py-2 px-2 text-sm font-semibold rounded transition-colors ${
                        filter === f
                          ? 'bg-surface-card text-on-surface shadow-card'
                          : 'text-muted hover:bg-[var(--accent-medium)]'
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
                      {selected.student.orden != null && <span className="text-on-surface">{selected.student.orden}. </span>}
                      {studentFullName(selected.student)}
                    </h4>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_COLORS[getStatus(selected.student.id)]}`}>
                      {STATUS_LABELS[getStatus(selected.student.id)]}
                    </span>
                  </div>
                  {/* Always one line tall (min-h) so Anterior/Siguiente never move */}
                  <p className="text-sm text-slate-500 mt-0.5 truncate min-h-5">
                    {isObservacion
                      ? 'Observación — se califica sin entrega'
                      : isEvaluacion
                        ? (selected.sub ? `Evaluación — intento ${selected.sub.intentoActual || 1}` : 'Evaluación — sin intento aún')
                        : selFiles.length > 1
                          ? `${selFiles.length} archivos entregados`
                          : selected.sub
                            ? selected.sub.completadoSinArchivo
                              ? 'Completada sin archivo'
                              : (selected.sub.nombreArchivo || (selected.sub.sinEntrega ? `Sin entrega — calificada en ${selected.sub.calificacion ?? 0}` : 'Sin archivo'))
                            : 'Sin entrega aún'}
                  </p>
                  {/* Always reserve one line so Anterior/Siguiente don't jump
                      between students with and without a motivo */}
                  {selected.sub?.tarde && (
                    <p className="text-xs text-amber-600 font-medium mt-0.5 truncate">
                      {formatLateness(selected.sub, selected.student, activity)}
                    </p>
                  )}
                  <p className={`text-xs text-slate-500 mt-0.5 italic truncate min-h-4 ${selected.sub?.motivoSinEntrega ? '' : 'invisible'}`}>
                    {selected.sub?.motivoSinEntrega ? `Motivo: ${selected.sub.motivoSinEntrega}` : ' '}
                  </p>
                </div>

                {/* Autosave opt-in above the navigation. The checkbox keeps its
                    space (invisible) when there's no submission so Anterior/
                    Siguiente — and the grade right below — never jump around. */}
                {navList.length > 1 && (
                  <div className="space-y-1.5">
                  <label className={`flex items-center gap-2 text-sm text-muted select-none ${(selected.sub || isObservacion || hasRubrica) && !parcialCerrado ? 'cursor-pointer' : 'invisible'}`}>
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
                      className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded border border-accent text-accent text-base font-semibold hover:bg-[var(--accent-medium)] transition-colors"
                    >
                      <ChevronLeft size={20} /> Anterior
                    </button>
                    <span className="text-sm text-slate-500 flex-shrink-0 px-1 whitespace-nowrap">{curIdx + 1} / {navList.length}</span>
                    <button
                      type="button"
                      onClick={() => goToOffset(1)}
                      className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded bg-accent text-white text-base font-semibold hover:bg-accent-hover transition-colors"
                    >
                      Siguiente <ChevronRight size={20} />
                    </button>
                  </div>
                  </div>
                )}

                {/* Grade form: cuando hay entrega, siempre para observación y
                    siempre con rúbrica (así un no-entregado se puede rubricar y
                    la sección mantiene posiciones fijas al navegar) */}
                {(selected.sub || isObservacion || hasRubrica) ? (
                  <form onSubmit={saveGrade} className="space-y-3">
                    {parcialCerrado && (
                      <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 leading-relaxed">
                        <strong>El Parcial {activity?.parcial} está cerrado.</strong> No se pueden cambiar calificaciones.
                        Para modificarlas, primero <strong>revierte el cierre del parcial</strong> desde Calificaciones.
                        Al revertir, las calificaciones asignadas automáticamente volverán a como estaban antes de cerrar.
                      </div>
                    )}
                    {/* Rúbrica: abre la tabla en la zona izquierda (donde la vista
                        previa) para marcar una opción por renglón — el total se
                        escribe en la calificación y se guarda del modo conocido
                        (Guardar o autoguardado al navegar) */}
                    {hasRubrica && (() => {
                      const totalR = totalRubrica(activity.rubrica, rubricEval)
                      const faltan = activity.rubrica.criterios.filter((_, i) => rubricEval?.[i] == null).length
                      return (
                        <button
                          type="button"
                          ref={rubricaBtnRef}
                          onClick={() => {
                            // La ventana abre DEBAJO de la calificación oficial,
                            // que así queda siempre a la vista al rubricar
                            const anchor = califRowRef.current || rubricaBtnRef.current
                            const rect = anchor?.getBoundingClientRect()
                            if (rect) setRubricaWinTop(Math.round(rect.bottom + 6))
                            setRubricaViewOpen((v) => !v)
                          }}
                          className={`w-full py-2.5 text-sm font-semibold rounded transition-colors flex items-center justify-center gap-2 ${
                            rubricaViewOpen
                              ? 'bg-accent text-white hover:bg-accent-hover'
                              : 'border border-accent text-accent hover:bg-[var(--accent-medium)]'
                          }`}
                        >
                          <ClipboardList size={17} />
                          {rubricaViewOpen ? 'Ocultar rúbrica' : 'Ver rúbrica'}
                          <span className="font-bold">
                            {totalR != null ? `— ${totalR} / ${RUBRICA_TOTAL}` : `— faltan ${faltan} criterio${faltan !== 1 ? 's' : ''}`}
                          </span>
                        </button>
                      )
                    })()}

                    {/* Download on the left, grade (with its own header) on the
                        right — narrow input keeps the spinner arrows by the number */}
                    {/* Grade on its own row; the file list (if several) goes below.
                        Con rúbrica, el hueco del botón Descargar se conserva
                        (invisible) cuando no hay archivo, para que la calificación
                        oficial NUNCA cambie de lugar al navegar entre alumnos. */}
                    <div ref={califRowRef} className="flex gap-2 items-end">
                      {selFiles.length === 1 ? (
                        <a
                          href={downloadUrl(selFiles[0].url, selFiles[0].nombre)}
                          download={selFiles[0].nombre}
                          rel="noopener noreferrer"
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface rounded border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors min-w-0"
                        >
                          <Download size={18} className="text-accent flex-shrink-0" />
                          <span className="truncate">Descargar entrega</span>
                        </a>
                      ) : hasRubrica ? (
                        <div aria-hidden="true" className="flex-1 invisible flex items-center justify-center gap-2 px-3 py-2 rounded border text-sm min-w-0">
                          <span className="truncate">Descargar entrega</span>
                        </div>
                      ) : null}
                      <div className={selFiles.length === 1 || hasRubrica ? 'flex-shrink-0' : 'flex-1'}>
                        <label htmlFor="act-calificacion" className="block text-sm font-medium text-muted mb-1 text-center">
                          Calificación <span className="text-slate-400">(máx. {activity?.maxCalif})</span>
                        </label>
                        <input
                          id="act-calificacion"
                          type="number"
                          value={gradeForm.calificacion}
                          onChange={onCalifChange}
                          required
                          min="0"
                          max={activity?.maxCalif}
                          step="0.1"
                          placeholder="—"
                          // Primer campo del panel de calificación, abierto con intención de escribir.
                          autoFocus={!parcialCerrado}
                          disabled={parcialCerrado}
                          className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-base font-semibold text-center bg-surface disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                      </div>
                    </div>

                    {/* Several files: click the name to PREVIEW that image on the
                        left; only the download icon downloads it */}
                    {selFiles.length > 1 && (
                      <div className="space-y-1">
                        {/* All images: icon downloads everything as a ZIP; the
                            name shows them all stacked in the preview */}
                        <div
                          className={`flex items-center gap-1 rounded border text-xs font-semibold transition-colors ${
                            previewIdx === -1
                              ? 'border-accent bg-[var(--accent-tint)] text-on-surface'
                              : 'border-outline-variant bg-surface text-muted hover:border-accent'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={downloadStudentZip}
                            disabled={studentZipDownloading}
                            data-tooltip="Descargar todas en ZIP"
                            aria-label="Descargar todas en ZIP"
                            className="p-2 text-accent hover:bg-[var(--accent-medium)] rounded flex-shrink-0 disabled:opacity-40"
                          >
                            {studentZipDownloading ? <Spinner size="sm" /> : <Download size={15} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPreviewIdx(-1)}
                            data-tooltip="Ver todas las imágenes"
                            className="flex-1 min-w-0 py-2 pr-2 text-left truncate"
                          >
                            Todas las imágenes entregadas ({selFiles.length})
                          </button>
                        </div>
                        {selFiles.map((f, i) => (
                          <div
                            key={`${f.url}-${i}`}
                            className={`flex items-center gap-1 rounded border text-xs transition-colors ${
                              i === previewIdx
                                ? 'border-accent bg-[var(--accent-tint)] text-on-surface'
                                : 'border-outline-variant bg-surface text-muted hover:border-accent'
                            }`}
                          >
                            <a
                              href={downloadUrl(f.url, f.nombre)}
                              download={f.nombre}
                              rel="noopener noreferrer"
                              data-tooltip="Descargar esta imagen"
                              aria-label="Descargar esta imagen"
                              className="p-2 text-accent hover:bg-[var(--accent-medium)] rounded flex-shrink-0"
                            >
                              <Download size={15} />
                            </a>
                            <button
                              type="button"
                              onClick={() => setPreviewIdx(i)}
                              data-tooltip="Ver esta imagen"
                              className="flex-1 min-w-0 py-2 pr-2 text-left truncate"
                            >
                              {i + 1}. {f.nombre}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div>
                      <label htmlFor="act-comentario" className="block text-sm font-medium text-muted mb-1">
                        Comentario <span className="text-slate-400">(opcional)</span>
                      </label>
                      <textarea
                        id="act-comentario"
                        value={gradeForm.comentario}
                        onChange={(e) => setGradeForm((f) => ({ ...f, comentario: e.target.value }))}
                        rows={3}
                        disabled={parcialCerrado}
                        className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-none disabled:opacity-60 disabled:cursor-not-allowed"
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
                    {parcialCerrado ? null : autoSaveOnNav && navList.length > 1 ? (
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

                {/* Extend deadline for this student (no deadline in observación;
                    evaluaciones manage attempts/deadlines in their own page) */}
                {!isObservacion && !isEvaluacion && (
                <div className="pt-3 border-t border-outline-variant space-y-2">
                  {/* Annul the current submission — above the extend-date action */}
                  {selected.sub && !parcialCerrado && (
                    !annulMode ? (
                      <button
                        type="button"
                        onClick={() => setAnnulMode(true)}
                        className="block mx-auto text-sm text-slate-500 hover:text-red-600 transition-colors"
                      >
                        Anular la entrega actual para este estudiante
                      </button>
                    ) : (
                      <div className="rounded border border-red-200 bg-red-50 p-3 space-y-2">
                        <p className="text-sm text-red-700">
                          ¿Anular la entrega de <strong>{studentFullName(selected.student)}</strong>?
                          Volverá a quedar <strong>Pendiente</strong> y podrá entregar de nuevo.
                          {selected.sub.calificacion != null && ' La calificación actual se eliminará.'}
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setAnnulMode(false)}
                            disabled={annulling}
                            className="flex-1 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={annulSubmission}
                            disabled={annulling}
                            className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 transition-colors"
                          >
                            {annulling ? 'Anulando…' : 'Anular entrega'}
                          </button>
                        </div>
                      </div>
                    )
                  )}
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
                        minDateTime={nowIsoLocal()}
                      />
                      <div>
                        <label htmlFor="act-extend-motivo" className="block text-sm font-medium text-muted mb-1">Motivo</label>
                        <textarea
                          id="act-extend-motivo"
                          value={extendMotivo}
                          onChange={(e) => setExtendMotivo(e.target.value)}
                          rows={2}
                          placeholder="Motivo de la extensión…"
                          className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-none"
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
                          className="flex-1 py-2 bg-accent text-white text-sm font-semibold rounded disabled:opacity-60 transition-colors"
                        >
                          {savingExtension ? 'Guardando…' : 'Guardar'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Grade a student who never submitted (e.g. handed it in on a USB) */}
                  {!selected.sub && !parcialCerrado && (
                    !sinEntregaMode ? (
                      <button
                        type="button"
                        onClick={() => setSinEntregaMode(true)}
                        className="block mx-auto text-sm text-slate-500 hover:text-accent transition-colors"
                      >
                        Evaluar sin entrega
                      </button>
                    ) : (
                      <div className="space-y-2 rounded border border-outline-variant bg-surface p-3">
                        <p className="text-sm font-medium text-on-surface">Evaluar sin entrega</p>
                        <div>
                          <label htmlFor="act-sinentrega-calif" className="block text-sm font-medium text-muted mb-1">
                            Calificación <span className="text-slate-400">(máx. {activity?.maxCalif})</span>
                          </label>
                          <input
                            id="act-sinentrega-calif"
                            type="number"
                            value={sinEntregaGrade}
                            onChange={(e) => setSinEntregaGrade(e.target.value)}
                            min="0"
                            max={activity?.maxCalif}
                            step="0.1"
                            // Primer campo del panel "Evaluar sin entrega", abierto con intención de escribir.
                            autoFocus
                            className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-base font-semibold text-center bg-surface"
                          />
                        </div>
                        <div>
                          <label htmlFor="act-sinentrega-motivo" className="block text-sm font-medium text-muted mb-1">Motivo</label>
                          <textarea
                            id="act-sinentrega-motivo"
                            value={sinEntregaMotivo}
                            onChange={(e) => setSinEntregaMotivo(e.target.value)}
                            rows={2}
                            placeholder="Ej.: Entregó el archivo en memoria USB"
                            className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-none"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setSinEntregaMode(false)}
                            className="flex-1 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={saveSinEntrega}
                            disabled={savingSinEntrega || sinEntregaGrade === ''}
                            className="flex-1 py-2 bg-accent text-white text-sm font-semibold rounded disabled:opacity-60 transition-colors"
                          >
                            {savingSinEntrega ? 'Guardando…' : 'Guardar'}
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
                )}

                <div className="h-2 safe-bottom" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Vista de evaluar en Android — compacta, pensada para que quepa
          completa en una sola pantalla sin necesidad de bajar (docente
          experimentado). Orden: encabezado mínimo (flecha + nombre de
          actividad) → entrega en tira horizontal de alto fijo (mismo
          espacio haya o no archivos) → tabs Todos/Por calificar → número+
          nombre del alumno (sin descripción de archivo) → checkbox +
          Anterior/Siguiente → rúbrica (abre hacia arriba) → calificación
          grande (arranca en el máximo) con pasos de 0.5 e íconos de
          anular/modificar fecha al lado → Guardar calificación → historial.
          Sin comentarios ni "Evaluar sin entrega". */}
      {selected && IS_NATIVE_APP && (
        <div className="fixed inset-0 z-40 flex flex-col bg-surface">
          <div className="flex items-center gap-2 px-3 py-2 bg-surface-card border-b border-outline-variant flex-shrink-0 safe-top">
            <button
              type="button"
              onClick={closeModal}
              aria-label="Regresar"
              data-tooltip="Regresar"
              className="p-2 -ml-1 text-muted hover:text-accent rounded flex-shrink-0 transition-colors"
            >
              <ArrowLeft size={22} />
            </button>
            <h3 className="text-sm font-semibold text-on-surface truncate flex-1 min-w-0">
              {activityLabel && <span className="text-accent">{activityLabel} </span>}
              {activity?.nombre}
            </h3>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-3 space-y-2">

              {/* Entrega: tira horizontal de alto fijo — mismo espacio haya o
                  no archivos. Imagen con zoom, pdf/office/otro como
                  miniatura que abre la vista previa a pantalla completa. */}
              <div className="rounded-card overflow-hidden bg-surface-container h-36">
                {selFiles.length > 0 ? (
                  <div className="h-full flex gap-2 overflow-x-auto p-2">
                    {selFiles.map((f, i) => (
                      isImageFile(f.nombre, f.url) ? (
                        <ZoomableImage key={`${f.url}-${i}`} src={f.url} alt={f.nombre} fit="height" />
                      ) : canPreviewFile(f.nombre) ? (
                        <EntregaFileTile key={`${f.url}-${i}`} f={f} />
                      ) : (
                        <a
                          key={`${f.url}-${i}`}
                          href={downloadUrl(f.url, f.nombre)}
                          download={f.nombre}
                          rel="noopener noreferrer"
                          data-tooltip="Descargar"
                          className="h-full aspect-square flex-shrink-0 flex flex-col items-center justify-center gap-1 rounded border border-outline-variant bg-surface-card px-1"
                        >
                          <Download size={26} className="text-accent" />
                          <span className="text-[10px] text-muted truncate max-w-full px-1">{f.nombre}</span>
                        </a>
                      )
                    ))}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 text-sm p-3 text-center">
                    {isObservacion
                      ? 'Observación — no requiere entrega.'
                      : isEvaluacion
                        ? 'Evaluación — calificación del intento del alumno.'
                        : selected.sub?.completadoSinArchivo
                          ? 'Completada sin archivo.'
                          : 'Aún no ha entregado esta tarea.'}
                  </div>
                )}
              </div>

              {/* Tabs de filtro — solo Todos y Por calificar en Android, en
                  la misma posición siempre */}
              <div className="grid grid-cols-2 gap-1.5 bg-surface-container p-1 rounded">
                {['todos', 'entregado'].map((f) => (
                  <button
                    type="button"
                    key={f}
                    onClick={() => changeFilterInView(f)}
                    className={`py-2 px-2 text-sm font-semibold rounded transition-colors ${
                      filter === f ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'
                    }`}
                  >
                    {FILTER_LABELS[f]} ({f === 'todos' ? students.length : counts[f]})
                  </button>
                ))}
              </div>

              {/* Número y nombre del estudiante, mismo renglón — sin la
                  descripción del archivo entregado debajo */}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-base font-semibold text-on-surface truncate">
                    {selected.student.orden != null && <span className="text-on-surface">{selected.student.orden}. </span>}
                    {studentFullName(selected.student)}
                  </h4>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_COLORS[getStatus(selected.student.id)]}`}>
                    {STATUS_LABELS[getStatus(selected.student.id)]}
                  </span>
                </div>
                {selected.sub?.tarde && (
                  <p className="text-xs text-amber-600 font-medium mt-0.5 truncate">
                    {formatLateness(selected.sub, selected.student, activity)}
                  </p>
                )}
                {selected.sub?.motivoSinEntrega && (
                  <p className="text-xs text-slate-500 mt-0.5 italic truncate">
                    Motivo: {selected.sub.motivoSinEntrega}
                  </p>
                )}
              </div>

              {/* Guardar al avanzar/retroceder + Anterior/Siguiente */}
              {navList.length > 1 && (
                <div className="space-y-1.5">
                  <label className={`flex items-center gap-2 text-sm text-muted select-none ${(selected.sub || isObservacion || hasRubrica) && !parcialCerrado ? 'cursor-pointer' : 'invisible'}`}>
                    <input
                      type="checkbox"
                      checked={autoSaveOnNav}
                      onChange={toggleAutoSave}
                      className="w-4 h-4 accent-[var(--accent)] flex-shrink-0"
                    />
                    Guardar al avanzar o retroceder
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => goToOffset(-1)}
                      className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded border border-accent text-accent text-base font-semibold hover:bg-[var(--accent-medium)] transition-colors"
                    >
                      <ChevronLeft size={20} /> Anterior
                    </button>
                    <span className="text-sm text-slate-500 flex-shrink-0 px-1 whitespace-nowrap">{curIdx + 1} / {navList.length}</span>
                    <button
                      type="button"
                      onClick={() => goToOffset(1)}
                      className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded bg-accent text-white text-base font-semibold hover:bg-accent-hover transition-colors"
                    >
                      Siguiente <ChevronRight size={20} />
                    </button>
                  </div>
                </div>
              )}

              {(selected.sub || isObservacion || hasRubrica) ? (
                <form onSubmit={saveGrade} className="space-y-2">
                  {parcialCerrado && (
                    <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 leading-relaxed">
                      <strong>El Parcial {activity?.parcial} está cerrado.</strong> No se pueden cambiar calificaciones.
                      Para modificarlas, primero <strong>revierte el cierre del parcial</strong> desde Calificaciones.
                      Al revertir, las calificaciones asignadas automáticamente volverán a como estaban antes de cerrar.
                    </div>
                  )}

                  {/* Rúbrica — se abre hacia ARRIBA del botón (ver ventana flotante más abajo) */}
                  {hasRubrica && (() => {
                    const totalR = totalRubrica(activity.rubrica, rubricEval)
                    const faltan = activity.rubrica.criterios.filter((_, i) => rubricEval?.[i] == null).length
                    return (
                      <button
                        type="button"
                        ref={rubricaBtnRef}
                        onClick={() => {
                          const rect = rubricaBtnRef.current?.getBoundingClientRect()
                          if (rect) setRubricaWinBottom(Math.round(window.innerHeight - rect.top + 6))
                          setRubricaViewOpen((v) => !v)
                        }}
                        className={`w-full py-2.5 text-sm font-semibold rounded transition-colors flex items-center justify-center gap-2 ${
                          rubricaViewOpen
                            ? 'bg-accent text-white hover:bg-accent-hover'
                            : 'border border-accent text-accent hover:bg-[var(--accent-medium)]'
                        }`}
                      >
                        <ClipboardList size={17} />
                        {rubricaViewOpen ? 'Ocultar rúbrica' : 'Ver rúbrica'}
                        <span className="font-bold">
                          {totalR != null ? `— ${totalR} / ${RUBRICA_TOTAL}` : `— faltan ${faltan} criterio${faltan !== 1 ? 's' : ''}`}
                        </span>
                      </button>
                    )
                  })()}

                  {/* Calificación grande (arranca en el máximo) — pasos de 0.5
                      con los botones +/-, e íconos de anular/modificar fecha
                      al lado */}
                  <div>
                    <p className="text-sm font-medium text-muted mb-1 text-center">
                      Calificación <span className="text-slate-400">(máx. {activity?.maxCalif})</span>
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => stepCalif(-0.5)}
                        disabled={parcialCerrado}
                        aria-label="Restar medio punto"
                        className="w-11 h-11 flex-shrink-0 rounded-full border border-accent text-accent text-2xl font-bold flex items-center justify-center hover:bg-[var(--accent-medium)] transition-colors disabled:opacity-40"
                      >
                        −
                      </button>
                      <input
                        id="act-calificacion-native"
                        type="number"
                        value={gradeForm.calificacion}
                        onChange={onCalifChange}
                        required
                        min="0"
                        max={activity?.maxCalif}
                        step="0.5"
                        placeholder="—"
                        disabled={parcialCerrado}
                        className="w-24 py-1 text-center text-5xl font-bold bg-transparent border-b-2 border-accent focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                      <button
                        type="button"
                        onClick={() => stepCalif(0.5)}
                        disabled={parcialCerrado}
                        aria-label="Sumar medio punto"
                        className="w-11 h-11 flex-shrink-0 rounded-full bg-accent text-white text-2xl font-bold flex items-center justify-center hover:bg-accent-hover transition-colors disabled:opacity-40"
                      >
                        +
                      </button>
                      {!isObservacion && !isEvaluacion && (
                        <div className="flex flex-col gap-1 ml-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => setExtendMode((v) => !v)}
                            disabled={parcialCerrado}
                            aria-label="Modificar fecha de entrega"
                            data-tooltip="Modificar fecha de entrega"
                            className={`w-8 h-8 rounded border flex items-center justify-center transition-colors disabled:opacity-40 ${
                              extendMode ? 'border-accent bg-accent-light text-accent' : 'border-outline-variant text-muted hover:text-accent hover:border-accent'
                            }`}
                          >
                            <CalendarDays size={16} />
                          </button>
                          {selected.sub && (
                            <button
                              type="button"
                              onClick={() => setAnnulMode((v) => !v)}
                              disabled={parcialCerrado}
                              aria-label="Anular la entrega"
                              data-tooltip="Anular la entrega"
                              className={`w-8 h-8 rounded border flex items-center justify-center transition-colors disabled:opacity-40 ${
                                annulMode ? 'border-red-300 bg-red-50 text-red-600' : 'border-outline-variant text-muted hover:text-red-600 hover:border-red-300'
                              }`}
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {!isObservacion && !isEvaluacion && annulMode && selected.sub && (
                    <div className="rounded border border-red-200 bg-red-50 p-3 space-y-2">
                      <p className="text-sm text-red-700">
                        ¿Anular la entrega de <strong>{studentFullName(selected.student)}</strong>?
                        Volverá a quedar <strong>Pendiente</strong> y podrá entregar de nuevo.
                        {selected.sub.calificacion != null && ' La calificación actual se eliminará.'}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setAnnulMode(false)}
                          disabled={annulling}
                          className="flex-1 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={annulSubmission}
                          disabled={annulling}
                          className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 transition-colors"
                        >
                          {annulling ? 'Anulando…' : 'Anular entrega'}
                        </button>
                      </div>
                    </div>
                  )}

                  {!isObservacion && !isEvaluacion && extendMode && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-on-surface">Nueva fecha y hora límite para este estudiante</p>
                      <EFDateTimePicker
                        mode="datetime"
                        value={extendDate}
                        onChange={setExtendDate}
                        clearable={false}
                        minDateTime={nowIsoLocal()}
                      />
                      <div>
                        <label htmlFor="act-extend-motivo-native" className="block text-sm font-medium text-muted mb-1">Motivo</label>
                        <textarea
                          id="act-extend-motivo-native"
                          value={extendMotivo}
                          onChange={(e) => setExtendMotivo(e.target.value)}
                          rows={2}
                          placeholder="Motivo de la extensión…"
                          className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-none"
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
                          className="flex-1 py-2 bg-accent text-white text-sm font-semibold rounded disabled:opacity-60 transition-colors"
                        >
                          {savingExtension ? 'Guardando…' : 'Guardar'}
                        </button>
                      </div>
                    </div>
                  )}

                  {!canCreate && (
                    <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 leading-relaxed">
                      Activa tu suscripción mensual para registrar calificaciones nuevas — toda la información de este estudiante sigue disponible.
                    </p>
                  )}

                  {parcialCerrado ? null : autoSaveOnNav && navList.length > 1 ? (
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

              <div className="h-2 safe-bottom" />
            </div>
          </div>
        </div>
      )}

      {/* Ventana flotante de la rúbrica: inicia abajo del botón "Ver rúbrica" y
          se extiende hacia la izquierda hasta media pantalla, SOBREPUESTA a todo
          — la entrega sigue visible detrás para no perder contexto. Se cierra
          con el mismo botón, con la X o con "Aplicar calificación". */}
      {rubricaViewOpen && hasRubrica && selected && (() => {
        const totalR = totalRubrica(activity.rubrica, rubricEval)
        const faltan = activity.rubrica.criterios.filter((_, i) => rubricEval?.[i] == null).length
        return (
          <div
            className="fixed left-2 right-2 md:left-1/2 z-50 bg-surface-card border border-outline-variant rounded-card shadow-2xl flex flex-col overflow-hidden"
            // En Android se ancla por `bottom` y crece hacia arriba (pedido
            // explícitamente); en web sigue anclada por `top`, hacia abajo.
            style={IS_NATIVE_APP
              ? { bottom: rubricaWinBottom, maxHeight: `calc(100vh - ${rubricaWinBottom + 60}px)` }
              : { top: rubricaWinTop, maxHeight: `calc(100vh - ${rubricaWinTop + 10}px)` }}
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-outline-variant flex-shrink-0" style={{ background: 'var(--accent-light)' }}>
              <ClipboardList size={17} className="text-accent flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-on-surface truncate">Rúbrica: {activity.rubrica.titulo}</p>
                <p className="text-[11px] text-muted truncate">Marca una opción por renglón — la calificación se calcula sola</p>
              </div>
              <button
                type="button"
                onClick={() => setRubricaViewOpen(false)}
                aria-label="Cerrar rúbrica"
                data-tooltip="Cerrar rúbrica"
                className="p-1.5 text-slate-400 hover:text-accent rounded flex-shrink-0"
              >
                <X size={17} />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-3">
              <RubricaGradeTable
                rubrica={activity.rubrica}
                seleccion={rubricEval}
                onSelect={selectRubricaNivel}
                disabled={parcialCerrado}
              />
            </div>
            {/* Con el autoguardado activo, Siguiente/Anterior ya aplican la
                calificación — el botón sería redundante */}
            {!autoSaveOnNav && (
              <div className="p-2 border-t border-outline-variant flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setRubricaViewOpen(false)}
                  className="w-full py-2 bg-accent text-white text-sm font-semibold rounded flex items-center justify-center gap-2 hover:bg-accent-hover transition-colors"
                >
                  Aplicar calificación{totalR != null ? ` — ${totalR} / ${RUBRICA_TOTAL}` : ` (faltan ${faltan})`}
                </button>
              </div>
            )}
          </div>
        )
      })()}

      {editingActivity && activity && (
        <EntregableEditor
          activityId={activityId}
          parcial={activity.parcial}
          categoria={activity.categoria || 'entregable'}
          subjectId={activity.asignaturaId}
          docenteId={activity.docenteId}
          existingActivities={[]}
          activityLabel={activityLabel}
          onClose={() => setEditingActivity(false)}
          onActivityUpdated={(updated) => {
            setActivity((prev) => ({ ...prev, ...updated }))
            setEditingActivity(false)
          }}
          initialForm={{
            nombre: activity.nombre || '',
            instrucciones: activity.instrucciones || '',
            fechaLimite: activity.fechaLimite || '',
            tiposArchivo: activity.tiposArchivo || ['todos'],
            extensionesCustom: activity.extensionesCustom || '',
            oculta: activity.oculta ?? false,
            publishAt: activity.publishAt || '',
            publishedAt: activity.publishedAt || '',
            visibilidadMode: activity.publishedAt ? 'show' : (activity.publishAt ? 'schedule' : 'hide'),
            // Checkbox reads the positive framing ("cerrar en fecha"); the real DB field
            // (recibirTarde) is the inverse — see EntregableEditor's save payload.
            cerrarEntregasEnFecha: !activity.recibirTarde,
            rubrica: activity.rubrica || null,
            rubricaId: activity.rubricaId || null,
          }}
          initialExistingFiles={activity.archivosAdjuntos || []}
          contextLine={[subjectDisplayName(subject), userProfile?.nombreMostrar || userProfile?.nombre].filter(Boolean).join(' — ')}
          onNuevaFecha={isPublished ? () => setNewDateOpen(true) : undefined}
          externalFechaLimite={activity.fechaLimite || ''}
          students={students}
          extensiones={activity.extensiones || {}}
          extensionesMotivo={activity.extensionesMotivo || {}}
        />
      )}

      {/* Nueva fecha de entrega: for the whole group or for selected students.
          Renders above the EntregableEditor (its z-[60] > editor's z-50) when opened from it. */}
      {newDateOpen && (
        <NuevaFechaEntregaModal
          activityId={activityId}
          students={students}
          onClose={() => setNewDateOpen(false)}
          onSaved={applyNewDateResult}
        />
      )}

      </div>
    </TeacherLayout>
  )
}
