import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  serverTimestamp,
  onSnapshot,
} from 'firebase/firestore'
// Escrituras a través del candado de suscripción vencida (ver utils/firestoreGuard.js).
import { updateDoc, setDoc, deleteDoc, writeBatch } from '../../utils/firestoreGuard'
import { deleteSubmissionsByActivity } from '../../utils/deleteSubjectCascade'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../../firebase'
import { submissionDocId } from '../../utils/submissionId'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import SearchInput from '../../components/SearchInput'
import {
  ArrowLeft, Clock,
  Download, Star, CalendarDays,
  ChevronLeft, ChevronRight, FolderDown, Pencil, Trash2, ExternalLink,
  CheckCheck,
} from 'lucide-react'
import { FilePreview, canPreviewFile } from '../../components/AttachmentList'
import ZoomableImage from '../../components/ZoomableImage'
import { downloadUrl } from '../../utils/cloudinary'
import { buildJobsForActivity, downloadSubmissionsZip } from '../../utils/downloadSubmissions'
import { subjectDisplayName } from '../../utils/subjectName'
import { IS_NATIVE_APP } from '../../utils/platform'
import { descargaSoloWeb } from '../../utils/descargaSoloWeb'
import { abrirArchivoNativo } from '../../utils/nativeSave'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import { sanitizeHtml, richTextContentClass, toRichHtml } from '../../utils/sanitizeHtml'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'
import EFDateTimePicker from '../../components/EFDateTimePicker'
import { nowIsoLocal } from '../../utils/nowIso'
import { formatDeadline, formatPublishAt, parseFechaLimite, withDefaultTime, cuentaParaCalificacion } from '../../utils/activityVisibility'
import { ALL_FILES_KEY, CUSTOM_FILE_TYPE, normalizeFileTypeKeys, parseCustomExts } from '../../config/fileTypes'
import AttachmentList from '../../components/AttachmentList'
import { matchesStudentSearch, studentFullName } from '../../utils/studentSearch'
import EvaluacionManager from '../../components/EvaluacionManager'
import EntregableEditor from '../../components/EntregableEditor'
import JuegoManager from '../../components/juego/JuegoManager'
import NuevaFechaEntregaModal from '../../components/NuevaFechaEntregaModal'
import RubricaGradeTable from '../../components/rubrica/RubricaGradeTable'
import CalificarConIAModal from '../../components/rubrica/CalificarConIAModal'
import ConfirmacionCreditosModal from '../../components/ConfirmacionCreditosModal'
import ConfirmModal from '../../components/ConfirmModal'
import { ClipboardList, ListChecks, X, Sparkles } from 'lucide-react'
import { totalRubrica, RUBRICA_TOTAL, esCotejo, instrumentoColors } from '../../utils/rubrica'
import useCreditosIA from '../../hooks/useCreditosIA'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { formatHora12FromDate } from '../../utils/formatHora'

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
  const dlMs = parseFechaLimite(dl).getTime()
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

// Formatos que "Calificar con IA" (OP-11) puede analizar en esta primera
// versión — mismo criterio que evidenciasEntrega.js del servidor (JPG/PNG
// imagen, PDF nativo, DOCX por texto extraído); .doc antiguo y cualquier
// otro formato quedan fuera. Solo decide si el botón se MUESTRA — el
// servidor vuelve a validar todo desde Firestore, nunca confía en esto.
function isEvidenciaSoportada(name, url) {
  const s = `${name || ''} ${url || ''}`.toLowerCase().split('?')[0]
  return /\.(jpe?g|png|pdf|docx)$/.test(s)
}

// Botón para archivos sin vista previa en la App (Excel, ZIP, y cualquier
// otro formato que canPreviewFile no cubra): en vez de mandar a la web sin
// más, descarga el archivo y abre el panel "Compartir" de Android, que
// también ofrece las apps que pueden ABRIRLO (Sheets, Excel, WPS…) — el
// docente ve el archivo real, con lo que ya tenga instalado. Ver
// abrirArchivoNativo en utils/nativeSave.js.
function AbrirConNativoButton({ url, nombre, className }) {
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  async function handleClick() {
    setLoading(true)
    try {
      await abrirArchivoNativo(url, nombre)
    } catch (err) {
      toast('No se pudo abrir el archivo: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button type="button" onClick={handleClick} disabled={loading} className={className}>
      {loading ? <Spinner size="sm" /> : <ExternalLink size={18} className="text-accent flex-shrink-0" />}
      <span className="truncate">{nombre}</span>
    </button>
  )
}

// All files of a submission: `archivos[]` when present (multi-photo uploads),
// falling back to the legacy single archivoURL/nombreArchivo pair.
function submissionFiles(sub) {
  if (!sub || sub.completadoSinArchivo) return []
  if (sub.archivos?.length) return sub.archivos.map((f) => ({ url: f.url, nombre: f.nombre }))
  return sub.archivoURL ? [{ url: sub.archivoURL, nombre: sub.nombreArchivo }] : []
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
  const [activity, setActivity] = useState(null)
  const [activityLabel, setActivityLabel] = useState(null)
  // "Nueva fecha de entrega" modal, offered from within the activity editor
  const [newDateOpen, setNewDateOpen] = useState(false)
  // Eliminar actividad — disponible desde la propia edición, para entregable/
  // observación y evaluación por igual, incluidos borradores. Pedido explícito.
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deletingActivity, setDeletingActivity] = useState(false)
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
  // "Calificar con IA" (OP-11, 21-ago-2026) — abre CalificarConIAModal, que
  // PRELLENA rubricEval/comentario con la propuesta; el guardado sigue
  // siendo el mismo botón "Guardar calificación" de siempre.
  const [calificarIAAbierto, setCalificarIAAbierto] = useState(false)
  // Snapshot de rubricEval/gradeForm tomado justo ANTES de abrir "Calificar
  // con IA" — la propuesta se precarga sola en cuanto llega (ver
  // aplicarPropuestaIA), así que "Descartar" necesita a qué volver. Solo
  // vive mientras el modal está abierto.
  const [previoAntesDeIA, setPrevioAntesDeIA] = useState(null)
  // Id de la sugerencia de lote (activities/{id}/iaSugerenciasEntregable/{x})
  // que quedó precargada en el formulario — null si la propuesta vino del
  // flujo individual (no persistido). Solo se marca 'aplicada' cuando el
  // docente de verdad GUARDA la calificación (persistGrade), nunca por solo
  // verla o precargarla — así "Ver propuesta de IA" sigue siendo gratis si
  // el docente termina sin guardar.
  const [iaPropuestaDocId, setIaPropuestaDocId] = useState(null)
  // Resultado completo de una evaluación INDIVIDUAL (sin doc persistido
  // todavía) — persistGrade() lo usa para crear el registro en
  // iaSugerenciasEntregable recién cuando el docente guarda de verdad.
  const [iaResultadoAplicado, setIaResultadoAplicado] = useState(null)
  function abrirCalificarIA() {
    setPrevioAntesDeIA({ rubricEval, gradeForm })
    setCalificarIAAbierto(true)
  }
  function cerrarCalificarIA() {
    // Cierre "normal" (X, backdrop, Escape, o el botón Cerrar del modal):
    // la propuesta ya precargada en el formulario se CONSERVA — el docente
    // pudo haberla editado y seguir queriendo guardarla después.
    setPrevioAntesDeIA(null)
    setCalificarIAAbierto(false)
  }
  function descartarPropuestaIA() {
    if (previoAntesDeIA) {
      setRubricEval(previoAntesDeIA.rubricEval)
      setGradeForm(previoAntesDeIA.gradeForm)
    }
    setIaPropuestaDocId(null)
    setIaResultadoAplicado(null)
    setPrevioAntesDeIA(null)
    setCalificarIAAbierto(false)
  }
  const creditosIA = useCreditosIA()
  // "Calificar todas con IA" (lote) — mismo patrón que C-02 en
  // EvaluacionManager.jsx: el servidor persiste cada propuesta en
  // activities/{id}/iaSugerenciasEntregable/{submissionId} (estado
  // 'pendiente') y este snapshot las recupera solo — sobreviven un cierre de
  // pestaña, y verlas de nuevo jamás cobra. Al aplicar una se marca
  // 'aplicada' (ver aplicarPropuestaIA).
  const [sugerenciasLoteIA, setSugerenciasLoteIA] = useState({}) // { [submissionId]: sugerencia }
  const [loteIAConteo, setLoteIAConteo] = useState(null) // { entregas } → abre el modal de costo
  const [loteIATrabajando, setLoteIATrabajando] = useState(false)
  // La ventana se ancla DEBAJO del renglón de la calificación oficial, para
  // que ésta quede siempre a la vista mientras se marca la rúbrica
  const califRowRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [searchStudents, setSearchStudents] = useState('')
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
  const { currentUser } = useAuth()
  // Grade-table cells navigate here with the student to open right away —
  // and closing the grading view must land back on that Calificaciones screen.
  const [pendingOpenId, setPendingOpenId] = useState(location.state?.openStudentId || null)
  const returnToGrades = location.state?.returnTo === 'calificaciones'
  // Llegó aquí desde un clic en el evento de la actividad en Horario y
  // agenda: al cerrar el editor debe regresar directo al calendario (que ya
  // conserva su vista/fecha en localStorage), no quedarse en esta pantalla.
  const returnToCalendar = location.state?.returnTo === 'calendario'
  // Modelo de créditos puros (20-ago-2026): crear/editar contenido ya no
  // depende de ninguna suscripción — todo lo no-IA es gratis para cualquier
  // docente.
  const canCreate = true
  // Observación: no student submission — the teacher observes and grades directly,
  // so the grade form is always available and saving creates the submission doc.
  const isObservacion = activity?.tipo === 'observacion' || activity?.categoria === 'observacion'
  // Evaluación (cuestionario/examen): the grade comes from the student's attempt;
  // the grading panel allows a manual override but no prefill/annul/extension.
  const isEvaluacion = activity?.tipo === 'evaluacion'
  // Crucigrama / Sopa de letras: flujo propio (contenido → construcción →
  // confirmación) en JuegoManager, ver comentario de esa página.
  const esJuego = activity?.categoria === 'juego'
  // Rúbrica: solo entregables (nunca observación ni evaluación)
  // La observación también puede llevar rúbrica: no tiene entrega, pero sí
  // criterios que calificar (actitud, exposición, participación). El resto del
  // flujo ya sabe calificar sin entrega, así que basta con no excluirla aquí.
  const hasRubrica = !!activity?.rubrica?.criterios?.length && !isEvaluacion
  // Etiqueta según el instrumento (rúbrica o lista de cotejo) para los botones.
  const instrumentoLabel = esCotejo(activity?.rubrica) ? 'lista de cotejo' : 'rúbrica'
  // Edit activity modal — el calendario navega aquí con openEditActivity para
  // abrir el editor de una vez (clic en el evento de fecha límite/publicación).
  const [editingActivity, setEditingActivity] = useState(!!location.state?.openEditActivity)
  // Parcial cerrado: no grade can be changed until the teacher reverts the close.
  const parcialCerrado = !!(subject?.parcialesCerrados && activity?.parcial != null && subject.parcialesCerrados[activity.parcial])

  // Guard on currentUser + depend on it — mismo patrón que SubjectPage: en un
  // cold load Firebase Auth puede no haber restaurado la sesión todavía y el
  // guard de propiedad (docenteId !== currentUser.uid) expulsaría a un docente
  // legítimo antes de tiempo.
  useEffect(() => { if (currentUser) loadAll() }, [activityId, currentUser])

  // Evaluaciones de IA persistidas por el servidor — tanto 'pendiente' (de
  // un lote sin aplicar todavía) como 'aplicada' (23-ago-2026, pedido de
  // Kike: "toda evaluación realizada por IA debe quedar consultable
  // posteriormente sin volver a cobrar" — ya no se pierden de la interfaz
  // una vez aplicadas). `_estado` decide la etiqueta del botón: 'pendiente'
  // → "Ver propuesta de IA", 'aplicada' → "Ver evaluación de IA". Mismo
  // patrón que iaSugerencias de C-02 (EvaluacionManager.jsx).
  useEffect(() => {
    if (!activityId) return undefined
    const q = query(
      collection(db, 'activities', activityId, 'iaSugerenciasEntregable'),
      where('estado', 'in', ['pendiente', 'aplicada']),
    )
    const unsub = onSnapshot(q, (snap) => {
      const mapa = {}
      snap.docs.forEach((d) => { mapa[d.data().sub] = { ...d.data().sugerencia, _docId: d.id, _estado: d.data().estado } })
      setSugerenciasLoteIA(mapa)
    }, () => { /* sin permiso u offline: sin sugerencias que recuperar */ })
    return unsub
  }, [activityId])

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
      // Una actividad ajena jamás se muestra — mismo guard que en SubjectPage:
      // sin él, cualquier cuenta con la URL vería las entregas del grupo.
      if (!actSnap.exists() || actSnap.data().docenteId !== currentUser.uid) {
        toast('Esta actividad no pertenece a tu cuenta', 'error')
        navigate('/dashboard')
        return
      }
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
      const siblings = siblingActsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => a.parcial === actData.parcial && cuentaParaCalificacion(a))
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
    // Cambiar de estudiante deja atrás cualquier propuesta de IA precargada
    // sin guardar — nunca debe seguir "colgada" y aplicarse sobre otro alumno.
    setIaPropuestaDocId(null)
    setIaResultadoAplicado(null)
    setPrevioAntesDeIA(null)
    setGradeForm({
      // Delivered but ungraded (or observación, which never has a delivery) →
      // prefill the max grade so paging with Siguiente/Anterior grades with 10
      // by default (adjust exceptions only).
      // En Android arranca vacío ("—") mientras no haya calificación —
      // muchos alumnos ni siquiera han entregado, prellenar el máximo ahí
      // sería engañoso. Los botones +/- (stepCalif) son los que saltan a
      // máximo/mitad desde vacío. En web se mantiene el prellenado previo.
      calificacion: sub?.calificacion != null
        ? String(sub.calificacion)
        : (!IS_NATIVE_APP && ((sub && !isEvaluacion) || isObservacion)) ? String(activity?.maxCalif ?? 10) : '',
      comentario: sub?.comentario || '',
    })
    // Con rúbrica: cargar la evaluación guardada; si aún no hay calificación,
    // prellenar todo en el nivel máximo (equivale al prellenado de 10 de arriba
    // — el docente solo ajusta las excepciones).
    if (activity?.rubrica?.criterios?.length && !isEvaluacion) {
      const n = activity.rubrica.criterios.length
      const previa = Array.isArray(sub?.rubricaEval) && sub.rubricaEval.length === n ? [...sub.rubricaEval] : null
      // En observación nunca hay entrega, así que `sub` falta hasta la primera
      // calificación: sin contarla aquí, la rúbrica arrancaría vacía y no
      // prellenada al máximo como en un entregable ya entregado.
      const sinCalificar = (sub || isObservacion) && sub?.calificacion == null
      const prefill = previa || (sinCalificar ? Array(n).fill(0) : Array(n).fill(null))
      setRubricEval(prefill)
      // Sincroniza la calificación prellenada con el total real: una lista de
      // cotejo puede sumar menos de 10, así que el prellenado genérico de 10 de
      // arriba no siempre aplica.
      if (!IS_NATIVE_APP && sinCalificar) {
        const t = totalRubrica(activity.rubrica, prefill)
        if (t != null) setGradeForm((f) => ({ ...f, calificacion: String(t) }))
      }
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
    if (returnToCalendar) { navigate('/calendario'); return }
    navigate(`/subject/${activity?.asignaturaId}`, returnToGrades ? { state: { tab: 'calificaciones' } } : undefined)
  }

  // Eliminar la actividad desde su propia pantalla — entregable, observación
  // o evaluación, publicada o borrador, todas por igual. Mismo criterio de
  // cascada y reindexado de `orden` que el borrado desde el listado del
  // parcial en SubjectPage.jsx (ver deleteSubmissionsByActivity).
  async function handleDeleteActivity() {
    if (!activity) return
    setDeletingActivity(true)
    try {
      await deleteSubmissionsByActivity(activity.id)
      await deleteDoc(doc(db, 'activities', activity.id))
      const siblingsSnap = await getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', activity.asignaturaId)))
      const remaining = siblingsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => a.id !== activity.id && a.parcial === activity.parcial)
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      const batch = writeBatch(db)
      remaining.forEach((a, i) => {
        const orden = i + 1
        if (a.orden !== orden) batch.update(doc(db, 'activities', a.id), { orden })
      })
      await batch.commit()
      toast('Actividad eliminada')
      navigate(`/subject/${activity.asignaturaId}`, returnToGrades ? { state: { tab: 'calificaciones' } } : undefined)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
      setDeletingActivity(false)
    }
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
      // Sin entrega: solo observación (siempre), entregable con rúbrica
      // (rubricar a quien no entregó), o en Android cualquier entregable —
      // ahí la calificación grande siempre está disponible, sin necesidad
      // de una entrega o una rúbrica (es el estándar de esa vista).
      if (!isObservacion && !hasRubrica && !(IS_NATIVE_APP && !isEvaluacion)) return false
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

  // Aplicar la propuesta de "Calificar con IA": PRELLENA rubricEval y el
  // comentario con lo que propuso la IA — exactamente el mismo estado que
  // llena selectRubricaNivel a mano. No guarda nada por sí sola: el docente
  // sigue viendo la rúbrica de siempre, puede ajustar cualquier nivel, y el
  // guardado real sigue siendo el botón "Guardar calificación" existente.
  function aplicarPropuestaIA(resultado, docId = null) {
    const next = resultado.criterios.map((c) => c.nivel)
    setRubricEval(next)
    const total = totalRubrica(activity.rubrica, next)
    setGradeForm((f) => ({
      ...f,
      calificacion: total != null ? String(total) : f.calificacion,
      comentario: resultado.retroalimentacionGeneral || f.comentario,
    }))
    setIaPropuestaDocId(docId)
    // Sin docId: viene del flujo INDIVIDUAL, que nunca queda persistido solo
    // — se guarda el resultado completo para que persistGrade() lo escriba
    // en iaSugerenciasEntregable recién cuando el docente de verdad guarde
    // (23-ago-2026: "toda evaluación de IA debe quedar consultable sin
    // volver a cobrar", también para "Calificar con IA" individual).
    setIaResultadoAplicado(docId ? null : resultado)
  }

  // ── "Calificar todas con IA" (lote) — mismo patrón que contarRespuestasIA
  // de C-02 en EvaluacionManager.jsx. Cuenta EXACTAMENTE las entregas
  // pendientes (sin calificar) con evidencia en un formato legible que
  // TODAVÍA no tienen propuesta persistida — esas se recuperan gratis, sin
  // volver a contarlas ni cobrarlas.
  function contarEntregasIA() {
    const elegibles = students.filter((s) => {
      const sub = submissions[s.id]
      if (!sub || sub.calificacion != null) return false
      if (sugerenciasLoteIA[sub.id]) return false
      return submissionFiles(sub).some((f) => isEvidenciaSoportada(f.nombre, f.url))
    })
    if (!elegibles.length) {
      const yaListas = Object.keys(sugerenciasLoteIA).length
      toast(yaListas
        ? 'Todas las entregas pendientes con evidencia ya tienen propuesta de IA — ábrelas al calificar, sin costo adicional'
        : 'No hay entregas pendientes con evidencia en un formato legible (JPG, PNG, PDF o Word)', 'error')
      return
    }
    setLoteIAConteo({ entregas: elegibles.length, recalificar: false })
  }

  // "Recalificar todas con IA" — para cuando el docente YA cambió la
  // rúbrica/lista de cotejo y quiere propuestas nuevas con el instrumento
  // actual. A diferencia de "Calificar todas con IA", cuenta TODA entrega
  // con evidencia legible sin importar si ya tiene calificación o propuesta
  // — el servidor regenera cada propuesta desde cero (ver recalificar=true
  // en precheckCalificarEntregableLote/ejecutarCalificarEntregableIALote).
  // No crea entregas nuevas, no toca archivos ni calificaciones existentes:
  // solo dEJA LISTAS propuestas nuevas para que el docente las revise.
  function contarRecalificarIA() {
    const elegibles = students.filter((s) => {
      const sub = submissions[s.id]
      if (!sub) return false
      return submissionFiles(sub).some((f) => isEvidenciaSoportada(f.nombre, f.url))
    })
    if (!elegibles.length) {
      toast('No hay entregas con evidencia en un formato legible (JPG, PNG, PDF o Word)', 'error')
      return
    }
    setLoteIAConteo({ entregas: elegibles.length, recalificar: true })
  }

  // Ejecuta el lote tras la confirmación del docente. El servidor relee todo
  // por ID (nunca confía en el cliente), persiste cada propuesta y cobra
  // solo lo realmente generado — las sugerencias NUNCA se guardan como
  // calificación (regla O3): el snapshot de arriba las entrega y el docente
  // las aplica una por una si le convencen.
  async function ejecutarLoteIA() {
    const recalificar = loteIAConteo?.recalificar === true
    setLoteIATrabajando(true)
    try {
      const data = await creditosIA.ejecutar(
        'calificar_entregable_ia_lote',
        { actividadId: activityId, recalificar },
        loteIAConteo.entregas,
        { timeoutMs: 300000 },
      )
      setLoteIAConteo(null)
      const n = data?.resultado?.generadas || 0
      const previas = data?.resultado?.yaProcesadas || 0
      const fallidas = data?.resultado?.fallidas || 0
      const aplicadas = data?.resultado?.aplicadasAuto || 0
      // Recalificar reescribe `submissions.calificacion` directo en el
      // servidor — sin esto el docente seguiría viendo las calificaciones
      // viejas hasta recargar la página. Solo submissions (no loadAll
      // completo): no queremos el parpadeo de "cargando" ni perder dónde
      // estaba parado el docente en la lista.
      if (recalificar && aplicadas > 0) {
        const subsSnap = await getDocs(query(collection(db, 'submissions'), where('actividadId', '==', activityId)))
        const subsMap = {}
        subsSnap.docs.forEach((d) => { subsMap[d.data().alumnoId] = { id: d.id, ...d.data() } })
        setSubmissions(subsMap)
        setSelected((sel) => (sel?.sub && subsMap[sel.student.id]) ? { ...sel, sub: subsMap[sel.student.id] } : sel)
      }
      toast(recalificar
        // Recalificar SÍ sobrescribe sola la calificación real (23-ago-2026,
        // pedido de Kike) — salvo la entrega puntual que quedó sin evidencia
        // suficiente para un total, esa sí se deja como propuesta a revisar.
        ? `${aplicadas} calificación${aplicadas !== 1 ? 'es' : ''} actualizada${aplicadas !== 1 ? 's' : ''} con la IA` +
          `${n - aplicadas > 0 ? ` (${n - aplicadas} quedaron como propuesta — revísalas a mano, falta evidencia clara en algún criterio)` : ''}` +
          `${fallidas ? ` — ${fallidas} no se pudo${fallidas !== 1 ? 'ieron' : ''} procesar` : ''}`
        : `${n} propuesta${n !== 1 ? 's' : ''} de IA lista${n !== 1 ? 's' : ''}` +
          `${previas ? ` (${previas} ya existían y no se cobraron)` : ''}` +
          `${fallidas ? ` — ${fallidas} no se pudo${fallidas !== 1 ? 'ieron' : ''} procesar` : ''}` +
          ' — revísalas al calificar a cada estudiante. Tú decides.',
      )
    } catch (err) {
      toast(err.codigo === 'SALDO_INSUFICIENTE' ? 'No tienes créditos suficientes para este lote' : 'No se pudo completar: ' + err.message, 'error')
    } finally {
      setLoteIATrabajando(false)
    }
  }

  // ── "Aplicar calificaciones de IA a todas" (Modo 1, 23-ago-2026) ───────────
  // Trabaja SOLO con sugerencias que YA EXISTEN y están 'pendiente' — nunca
  // llama a Anthropic, nunca pasa por ejecutarOperacionIA ni por el ledger de
  // créditos. Útil cuando el docente ya afinó la rúbrica y confía en que la
  // IA está evaluando bien: en vez de abrir entrega por entrega, aplica todas
  // las propuestas pendientes de un solo golpe. Distinto de "Recalificar
  // todas con IA", que sí genera evaluaciones NUEVAS y sí cobra.
  const [aplicarTodasConteo, setAplicarTodasConteo] = useState(null) // { entregas } → confirmación sin costo
  const [aplicarTodasTrabajando, setAplicarTodasTrabajando] = useState(false)

  function contarAplicarTodasIA() {
    const pendientes = Object.values(sugerenciasLoteIA).filter((s) => s._estado === 'pendiente')
    if (!pendientes.length) {
      toast('No hay propuestas de IA pendientes por aplicar', 'error')
      return
    }
    setAplicarTodasConteo({ entregas: pendientes.length })
  }

  async function ejecutarAplicarTodasIA() {
    setAplicarTodasTrabajando(true)
    try {
      const aplicar = httpsCallable(functions, 'aplicarEvaluacionesIAPendientes', { timeout: 120000 })
      const { data } = await aplicar({ actividadId: activityId })
      setAplicarTodasConteo(null)
      const aplicadas = data?.aplicadas || 0
      const noAplicadas = data?.noAplicadas || 0
      if (aplicadas > 0) {
        const subsSnap = await getDocs(query(collection(db, 'submissions'), where('actividadId', '==', activityId)))
        const subsMap = {}
        subsSnap.docs.forEach((d) => { subsMap[d.data().alumnoId] = { id: d.id, ...d.data() } })
        setSubmissions(subsMap)
        setSelected((sel) => (sel?.sub && subsMap[sel.student.id]) ? { ...sel, sub: subsMap[sel.student.id] } : sel)
      }
      toast(
        `${aplicadas} calificación${aplicadas !== 1 ? 'es' : ''} aplicada${aplicadas !== 1 ? 's' : ''}` +
        `${noAplicadas ? ` — ${noAplicadas} no se pudo${noAplicadas !== 1 ? 'ieron' : ''} aplicar` : ''}`,
      )
    } catch (err) {
      toast('No se pudo completar: ' + err.message, 'error')
    } finally {
      setAplicarTodasTrabajando(false)
    }
  }

  // Single save path shared by the Guardar button and Anterior/Siguiente.
  // Updates local state in place (no reload) so navigation stays fluid.
  // For observación, the first grade CREATES the submission doc (there is no
  // student delivery to attach to).
  async function persistGrade() {
    if (!selected || !canCreate) return false
    if (parcialCerrado) return false
    // Sin entrega solo se puede calificar en observación, rubricando (la
    // rúbrica permite evaluar en cero o en lo que corresponda a quien no
    // entregó), o en Android para cualquier entregable — mismo estándar
    // que isDirty() de arriba.
    if (!selected.sub && !isObservacion && !hasRubrica && !(IS_NATIVE_APP && !isEvaluacion)) return false
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
      // Id determinista (A12 · H5 · R22) — merge:true por la misma razón que
      // en ActivityPage.jsx del alumno: si `selected.sub` está desactualizado
      // y ya existe una entrega real, no la reemplaza a ciegas.
      const id = submissionDocId(activityId, selected.student.id)
      await setDoc(doc(db, 'submissions', id), data, { merge: true })
      updated = { id, ...data }
    }
    setSubmissions((prev) => ({ ...prev, [selected.student.id]: updated }))
    setSelected((sel) => (sel && sel.student.id === selected.student.id ? { ...sel, sub: updated } : sel))
    // La calificación que se acaba de guardar venía precargada de una
    // propuesta de lote — hasta AHORA, con el guardado real ya hecho, se
    // marca 'aplicada' (nunca antes, para no cobrar de más ni perder la
    // recuperación gratis de "Ver propuesta de IA" si el docente no guarda).
    if (iaPropuestaDocId) {
      updateDoc(doc(db, 'activities', activityId, 'iaSugerenciasEntregable', iaPropuestaDocId), { estado: 'aplicada' }).catch(() => {})
      setIaPropuestaDocId(null)
    } else if (iaResultadoAplicado) {
      // Flujo INDIVIDUAL: no había ningún doc que marcar — se crea aquí,
      // recién con la calificación ya guardada, para que "Ver evaluación de
      // IA" pueda consultarla después sin volver a cobrar (23-ago-2026).
      // Un fallo aquí no debe tumbar el guardado de la calificación, que ya
      // se hizo — solo se pierde el registro histórico, no la nota.
      httpsCallable(functions, 'guardarEvaluacionIndividualAplicada')({
        actividadId: activityId,
        submissionId: updated.id,
        sugerencia: iaResultadoAplicado,
      }).catch((err) => console.error('guardarEvaluacionIndividualAplicada falló:', err))
      setIaResultadoAplicado(null)
    }
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
    if (descargaSoloWeb(toast)) return
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
      // Id determinista + merge:true — ver persistGrade() más arriba.
      const id = submissionDocId(activityId, selected.student.id)
      await setDoc(doc(db, 'submissions', id), data, { merge: true })
      const updated = { id, ...data }
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

  // El botón "Guardar" de la prórroga se apaga si lo tecleado es igual a la
  // que ya tenía este alumno: openGrade() precarga extendDate/extendMotivo
  // con la prórroga existente, así que reabrir el panel de un alumno YA
  // extendido mostraba el botón activo sin que se hubiera tocado nada.
  const extensionUnchanged = !!selected &&
    extendDate === (activity?.extensiones?.[selected.student.id] || '') &&
    extendMotivo.trim() === (activity?.extensionesMotivo?.[selected.student.id] || '')

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
  const isPublished = !!activity?.publishedAt && new Date(withDefaultTime(activity.publishedAt, '00:00:00')).getTime() <= Date.now()

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
  // Para el aviso de zoom en la web (ver "Left: file preview" más abajo):
  // qué se está mostrando ahora mismo, sea la lista completa o un solo
  // archivo (selFiles.length<=1 cae al archivo de selected.sub).
  const previewFiles = selFiles.length > 0
    ? selFiles
    : (selected?.sub?.archivoURL ? [{ nombre: selected.sub.nombreArchivo, url: selected.sub.archivoURL }] : [])
  const previewHasImage = previewFiles.some((f) => isImageFile(f.nombre, f.url))
  const previewHasPdf = previewFiles.some((f) => f.nombre?.toLowerCase().endsWith('.pdf'))
  // Propuesta del lote "Calificar todas con IA" ya lista para esta entrega
  // (gratis de revisar, ya se cobró al generarla).
  const sugerenciaPersistidaIA = selected?.sub ? sugerenciasLoteIA[selected.sub.id] : null
  // "Calificar con IA": visible si hay rúbrica/cotejo guardado, y (a) ya hay
  // una propuesta persistida esperando (no cuesta nada verla), o (b) al
  // menos una evidencia en formato soportado y saldo de créditos.
  const puedeCalificarConIA = hasRubrica && (
    !!sugerenciaPersistidaIA ||
    (creditosIA.saldoPositivo && selFiles.some((f) => isEvidenciaSoportada(f.nombre, f.url)))
  )
  // Tres estados, tres etiquetas — nunca cobra ver algo que ya se generó
  // (pendiente o aplicada), solo generar algo nuevo cobra.
  const labelCalificarConIA = !sugerenciaPersistidaIA
    ? 'Calificar con IA'
    : sugerenciaPersistidaIA._estado === 'aplicada' ? 'Ver evaluación de IA' : 'Ver propuesta de IA'
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
  // acotados entre 0 y el máximo de la actividad. Partiendo de vacío (sin
  // calificar aún) el + salta directo al máximo y el - a la mitad — de ahí
  // en adelante ya suman/restan de 0.5 en 0.5 normalmente.
  function stepCalif(delta) {
    const max = activity?.maxCalif ?? 10
    const current = parseFloat(gradeForm.calificacion)
    if (isNaN(current)) {
      setGradeForm((f) => ({ ...f, calificacion: String(delta > 0 ? max : max / 2) }))
      return
    }
    const next = Math.min(max, Math.max(0, Math.round((current + delta) * 2) / 2))
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
  useBackHandler(() => (returnToCalendar ? navigate('/calendario') : setEditingActivity(false)), editingActivity)
  useBackHandler(closeModal, !!selected)
  useBackHandler(() => setNewDateOpen(false), newDateOpen)
  // Ventanas flotantes de anular/modificar fecha en la vista de evaluar de
  // Android — el botón atrás las cierra primero, antes de cerrar toda la vista.
  useBackHandler(() => setAnnulMode(false), IS_NATIVE_APP && annulMode)
  useBackHandler(() => setExtendMode(false), IS_NATIVE_APP && extendMode)

  // Keep the spinner while a grades-table cell is about to open a student, so the
  // list never flashes before the grading view opens.
  if (loading || pendingOpenId) return (
      <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  )

  // Eliminar actividad — un solo nodo, reutilizado en las dos ramas del
  // ternario de abajo (evaluación y entregable/observación) para que
  // funcione desde cualquiera de los dos tipos.
  const deleteActivityModal = deleteConfirm && activity && (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setDeleteConfirm(false)} aria-label="Cerrar" />
      <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
        <h3 className="text-base font-semibold text-on-surface mb-1">¿Eliminar actividad?</h3>
        <p className="text-sm text-muted mb-4">
          &ldquo;<strong>{activity.nombre}</strong>&rdquo; se eliminará permanentemente, junto con las entregas que tenga.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setDeleteConfirm(false)}
            className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)]">Cancelar</button>
          <button type="button" onClick={handleDeleteActivity} disabled={deletingActivity}
            className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2">
            {deletingActivity ? <Spinner size="sm" /> : <Trash2 size={16} />}
            {deletingActivity ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  )

  return (
      <div {...subjectPaletteProps(subject?.colorPalette)}>
      {/* Evaluaciones render their manager as the page body, but share the
          fullscreen per-student grading overlay below (so a grades-table cell
          opens the SAME panel for every activity type). */}
      {esJuego ? (
        <>
        <JuegoManager
          activity={activity}
          subject={subject}
          activityId={activityId}
          activityLabel={activityLabel}
          students={students}
          submissions={submissions}
          onActivityChange={setActivity}
          onDeleteActivity={() => setDeleteConfirm(true)}
          goBack={goBack}
        />
        {deleteActivityModal}
        </>
      ) : activity?.tipo === 'evaluacion' ? (
        <>
        <EvaluacionManager
          activity={activity}
          subject={subject}
          activityId={activityId}
          activityLabel={activityLabel}
          contextLine={subjectDisplayName(subject)}
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
          onDeleteActivity={() => setDeleteConfirm(true)}
        />
        {deleteActivityModal}
        </>
      ) : (
      <div className={TEACHER_CONTAINER_NARROW}>
        {/* Header */}
        {/* Header on the page background — the Instrucciones card floats like Entregas below.
            overflow-hidden: el botón "Editar actividad" (con su tooltip CSS absolute,
            más ancho que el ícono) queda pegado al borde derecho en la app — sin esto,
            el tooltip hace crecer el scrollWidth de toda la página unos px de más
            aunque nada se vea cortado (mismo "scrollWidth fantasma" ya visto en
            SubjectPage.jsx). */}
        <div className="px-4 py-2 overflow-hidden">
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
              {IS_NATIVE_APP ? (
                <>
                  <p className="text-sm font-medium text-muted truncate">
                    {subjectDisplayName(subject)}
                  </p>
                  <p className="text-[1.75rem] leading-tight font-bold uppercase tracking-wide text-accent">Evaluar</p>
                </>
              ) : (
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="text-[1.75rem] leading-tight font-bold uppercase tracking-wide text-accent flex-shrink-0">Evaluar</p>
                  <p className="text-[1.75rem] leading-tight font-medium text-muted truncate">{subjectDisplayName(subject)}</p>
                </div>
              )}
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
                  className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0"
                >
                  <Pencil size={18} />
                </button>
              </div>
              {/* text-base y no text-sm: es la línea que dice DE QUÉ va esto
                  (parcial y tipo) y quedaba con el mismo tamaño que la letra
                  chica de las fechas, cuando pesa bastante más. */}
              <p className="text-base font-medium text-muted">
                Parcial {activity?.parcial} · {activity?.categoria === 'examen' ? 'Examen' : activity?.categoria === 'cuestionario' ? 'Cuestionario' : activity?.categoria === 'observacion' ? 'Observación' : 'Entregable'}
              </p>
            </div>
          </div>
          {/* Fechas — con aire: gap-3 y text-sm en vez de gap-2/text-xs. Iban
              tan juntas y tan chicas que la fecha de cierre, que es el dato que
              el docente busca de un vistazo, se leía como una nota al pie. */}
          {(activity?.publishedAt || activity?.publishAt || activity?.fechaLimite) && (
            <div className="flex items-center gap-3 mt-2.5 flex-wrap">
              {activity?.publishedAt && (
                <span data-tooltip="Publicado" className="text-sm text-emerald-600 flex items-center gap-1">
                  <Clock size={15} /> {formatPublishAt(activity.publishedAt)}
                </span>
              )}
              {activity?.publishAt && (
                <span data-tooltip="Publicación programada" className="text-sm text-accent flex items-center gap-1">
                  <Clock size={15} /> {formatPublishAt(activity.publishAt)}
                </span>
              )}
              {activity?.fechaLimite && (
                <span data-tooltip="Cierre" className="text-sm text-amber-600 flex items-center gap-1">
                  <Clock size={15} /> {formatDeadline(activity.fechaLimite)}
                </span>
              )}
              {activity?.recibirTarde && !activity?.cerradaManual && (
                <span data-tooltip="Se aceptan entregas tarde" className="text-sm text-slate-500 flex items-center gap-1">
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
              data-tooltip="Descarga todas las evidencias entregadas en un archivo ZIP."
              className="w-full flex items-center justify-center gap-2 py-1.5 rounded border border-accent text-accent text-sm font-medium hover:bg-[var(--accent-medium)] transition-colors disabled:opacity-60"
            >
              {zipDownloading ? <Spinner size="sm" /> : <FolderDown size={18} />}
              {zipDownloading
                ? `Comprimiendo ${zipProgress.done}/${zipProgress.total}…`
                : 'Descargar entregas como ZIP'}
            </button>
          </div>
        )}

        {/* Las 3 acciones de IA sobre el lote de entregas, agrupadas en una
            sola tarjeta compacta (23-ago-2026, pedido de Kike: la barra se
            sentía saturada con 3 botones largos sueltos) — mismas funciones
            de siempre (contarEntregasIA/contarRecalificarIA/
            contarAplicarTodasIA), solo reorganización visual. "Aplicar
            propuestas" solo aparece si hay algo pendiente que aplicar. */}
        {hasRubrica && (() => {
          const pendientesIA = Object.values(sugerenciasLoteIA).filter((s) => s._estado === 'pendiente').length
          return (
            <div className="mx-4 mt-3 rounded-card border border-outline-variant">
              <p className="px-3 pt-2 text-[11px] text-muted">La IA propone; tú decides.</p>
              <div className="p-2 pt-1.5 space-y-1.5">
                <button
                  type="button"
                  onClick={contarEntregasIA}
                  data-tooltip="Genera propuestas de calificación con IA para las entregas pendientes."
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-accent text-accent text-sm font-medium hover:bg-[var(--accent-medium)] transition-colors disabled:opacity-60"
                >
                  <Sparkles size={16} />
                  Calificar con IA
                </button>
                <button
                  type="button"
                  onClick={contarRecalificarIA}
                  data-tooltip="Vuelve a evaluar las entregas con la rúbrica o lista de cotejo actual. Genera una nueva propuesta y consume créditos."
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-surface-container transition-colors disabled:opacity-60"
                >
                  <Sparkles size={16} />
                  Recalificar con IA
                </button>
                {pendientesIA > 0 && (
                  <button
                    type="button"
                    onClick={contarAplicarTodasIA}
                    data-tooltip="Aplica las propuestas de IA pendientes como calificación definitiva. No consume créditos."
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-emerald-300 text-emerald-700 text-sm font-medium hover:bg-emerald-50 transition-colors disabled:opacity-60"
                  >
                    <CheckCheck size={16} />
                    Aplicar propuestas ({pendientesIA})
                  </button>
                )}
              </div>
            </div>
          )
        })()}

          {/* Filter tabs — they belong to the Entregas list, so they live inside
              its container; clicking one scrolls the list into full view */}
          <div className={IS_NATIVE_APP ? 'grid grid-cols-2 gap-1 mx-4 mt-3 bg-surface-container p-1 rounded' : 'flex gap-1 mx-4 mt-3 bg-surface-container p-1 rounded'}>
            {['todos', 'pendiente', 'calificado', 'entregado'].map((f) => (
              <button
                type="button"
                key={f}
                onClick={() => {
                  setFilter(f)
                  setTimeout(() => document.getElementById('entregas-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
                }}
                className={`${IS_NATIVE_APP ? '' : 'flex-1'} py-1.5 text-xs font-medium rounded transition-colors ${
                  filter === f ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'
                }`}
              >
                {FILTER_LABELS[f]} ({f === 'todos' ? students.length : counts[f]})
              </button>
            ))}
          </div>

        {/* Search — misma barra en web y en Android */}
        <div className="px-4 pt-4 pb-2">
          <SearchInput
            value={searchStudents}
            onChange={setSearchStudents}
            placeholder="Buscar por nombre o por número de lista…"
            autoFocus={!IS_NATIVE_APP}
          />
          <p className="text-xs text-red-600 text-center mt-1.5">Presiona un nombre para evaluar</p>
        </div>

        {/* Student list — nombre a la izquierda, estatus a la derecha. Altura
            acotada con scroll propio (rueda del mouse) para que la búsqueda
            y los filtros de arriba no se muevan de lugar al recorrer la lista. */}
        <div className="px-4 pb-4">
          {filtered.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-8">Sin estudiantes en esta categoría</p>
          ) : (
            <div className="bg-surface-card rounded-card overflow-y-auto max-h-[60vh] shadow-card">
              {filtered.map((s, i) => {
                const status = getStatus(s.id)
                const sub = submissions[s.id]
                const hasExtension = !!activity?.extensiones?.[s.id]
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => openGradeFromList(s)}
                    className={`w-full flex items-center ${IS_NATIVE_APP ? 'gap-1 pl-1 pr-2' : 'gap-2 px-2'} py-1 text-left hover:bg-[var(--accent-tint)] transition-colors cursor-pointer ${
                      i > 0 ? 'border-t border-outline-variant' : ''
                    }`}
                  >
                    <span className={`${IS_NATIVE_APP ? 'text-[0.7rem]' : 'text-sm'} text-accent flex-shrink-0 whitespace-nowrap`}>{s.orden}.&nbsp;</span>
                    {/* Sin tooltip en el nombre: el aviso "Presiona un nombre para
                        evaluar", justo arriba de la lista, ya lo dice una vez para
                        toda la lista — repetirlo en cada renglón solo estorbaba. */}
                    <div className="flex-1 min-w-0">
                      <p className={`${IS_NATIVE_APP ? 'text-[0.7rem]' : 'text-sm'} font-medium text-on-surface truncate`}>
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
                      {!IS_NATIVE_APP && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[status]}`}>
                          {STATUS_LABELS[status]}
                        </span>
                      )}
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
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="text-[1.75rem] leading-tight font-bold uppercase tracking-wide text-accent flex-shrink-0">Evaluar</p>
                    <p className="text-[1.75rem] leading-tight font-medium text-muted truncate">{subjectDisplayName(subject)}</p>
                  </div>
                  <h3 className="text-xl font-bold text-on-surface truncate">
                    {activityLabel && <span className="text-accent">{activityLabel} </span>}
                    {activity?.nombre}
                  </h3>
                  {/* text-base, igual que en la página de la actividad: las
                      cuatro variantes de este encabezado (EVALUAR y EVALUACIÓN,
                      página y pantalla completa) llevan la misma escala. */}
                  <p className="text-base font-medium text-muted truncate">
                    Parcial {activity?.parcial} · {activity?.categoria === 'examen' ? 'Examen' : activity?.categoria === 'cuestionario' ? 'Cuestionario' : activity?.categoria === 'observacion' ? 'Observación' : 'Entregable'}
                  </p>
                  {/* Fechas, iguales que en la página. Van DENTRO de la columna
                      del título (no sueltas abajo) para que arranquen a la misma
                      altura que el nombre, en vez de meterse bajo el botón
                      Regresar. Aquí sirven de recordatorio mientras se califica:
                      si una entrega llegó tarde, la fecha de cierre es el dato
                      que lo explica y estaba a dos pantallas de distancia. */}
                  {(activity?.publishedAt || activity?.publishAt || activity?.fechaLimite) && (
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {activity?.publishedAt && (
                        <span data-tooltip="Publicado" className="text-sm text-emerald-600 flex items-center gap-1">
                          <Clock size={15} /> {formatPublishAt(activity.publishedAt)}
                        </span>
                      )}
                      {activity?.publishAt && (
                        <span data-tooltip="Publicación programada" className="text-sm text-accent flex items-center gap-1">
                          <Clock size={15} /> {formatPublishAt(activity.publishAt)}
                        </span>
                      )}
                      {activity?.fechaLimite && (
                        <span data-tooltip="Cierre" className="text-sm text-amber-600 flex items-center gap-1">
                          <Clock size={15} /> {formatDeadline(activity.fechaLimite)}
                        </span>
                      )}
                      {activity?.recibirTarde && !activity?.cerradaManual && (
                        <span data-tooltip="Se aceptan entregas tarde" className="text-sm text-slate-500 flex items-center gap-1">
                          Recibe entregas tarde
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col md:flex-row">

            {/* Left: file preview, top to bottom */}
            <div className="h-[45vh] md:h-auto md:flex-1 min-w-0 bg-surface-container flex flex-col">
              {/* Aviso de cómo hacer zoom en la web — con mouse no hay pellizcar,
                  así que el gesto no es obvio: clic para las imágenes (abre un
                  visor ampliado), Ctrl + rueda o doble clic para el PDF (in-line,
                  para no robarle la rueda al scroll normal entre páginas). */}
              {(previewHasImage || previewHasPdf) && (
                <p className="text-xs text-muted text-center px-3 py-1.5 flex-shrink-0 border-b border-outline-variant">
                  {previewHasImage && previewHasPdf
                    ? 'Clic en la imagen para ampliar y hacer zoom · Ctrl + rueda del mouse (o doble clic) sobre el PDF para acercar'
                    : previewHasImage
                      ? 'Clic en la imagen para ampliar y hacer zoom'
                      : 'Ctrl + rueda del mouse (o doble clic) sobre el PDF para acercar'}
                </p>
              )}
              {selFiles.length > 1 && previewIdx === -1 ? (
                /* "Todas las imágenes": every file stacked, scrollable */
                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                  {selFiles.map((f, i) => (
                    isImageFile(f.nombre, f.url) ? (
                      <ZoomableImage key={`${f.url}-${i}`} src={f.url} alt={f.nombre} className="block" imgClassName="max-w-full rounded mx-auto" />
                    ) : IS_NATIVE_APP ? (
                      <AbrirConNativoButton key={`${f.url}-${i}`} url={f.url} nombre={f.nombre}
                        className="flex items-center gap-2 px-4 py-2 bg-surface-card rounded border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors w-full" />
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
                    <ZoomableImage
                      src={f.url}
                      alt={f.nombre}
                      className="flex-1 min-h-0 flex items-center justify-center p-3"
                      imgClassName="max-w-full max-h-full object-contain rounded"
                    />
                  ) : canPreviewFile(f.nombre) ? (
                    <div className="flex-1 min-h-0">
                      <FilePreview url={f.url} nombre={f.nombre} fill />
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 text-sm p-6 text-center">
                      <p>Sin vista previa disponible para este archivo.</p>
                      {IS_NATIVE_APP ? (
                        <AbrirConNativoButton url={f.url} nombre={f.nombre}
                          className="flex items-center gap-2 px-4 py-2 bg-surface-card rounded border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors" />
                      ) : (
                        <a
                          href={downloadUrl(f.url, f.nombre)}
                          download={f.nombre}
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-4 py-2 bg-surface-card rounded border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors"
                        >
                          <Download size={18} className="text-accent" />
                          Descargar archivo
                        </a>
                      )}
                    </div>
                  )
                })()
              ) : selected.sub && !selected.sub.completadoSinArchivo && selected.sub.archivoURL ? (
                isImageFile(selected.sub.nombreArchivo, selected.sub.archivoURL) ? (
                  <ZoomableImage
                    src={selected.sub.archivoURL}
                    alt="Entrega del estudiante"
                    className="flex-1 min-h-0 flex items-center justify-center p-3"
                    imgClassName="max-w-full max-h-full object-contain rounded"
                  />
                ) : canPreviewFile(selected.sub.nombreArchivo) ? (
                  <div className="flex-1 min-h-0">
                    <FilePreview url={selected.sub.archivoURL} nombre={selected.sub.nombreArchivo} fill />
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 text-sm p-6 text-center">
                    <p>Sin vista previa disponible para este tipo de archivo.</p>
                    {IS_NATIVE_APP ? (
                      <AbrirConNativoButton url={selected.sub.archivoURL} nombre={selected.sub.nombreArchivo}
                        className="flex items-center gap-2 px-4 py-2 bg-surface-card rounded border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors" />
                    ) : (
                      <a
                        href={downloadUrl(selected.sub.archivoURL, selected.sub.nombreArchivo)}
                        download={selected.sub.nombreArchivo}
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-surface-card rounded border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors"
                      >
                        <Download size={18} className="text-accent" />
                        Descargar entrega
                      </a>
                    )}
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
                          {rubricaViewOpen ? `Ocultar ${instrumentoLabel}` : `Ver ${instrumentoLabel}`}
                          <span className="font-bold">
                            {totalR != null ? `— ${totalR} / ${RUBRICA_TOTAL}` : `— faltan ${faltan} criterio${faltan !== 1 ? 's' : ''}`}
                          </span>
                        </button>
                      )
                    })()}
                    {puedeCalificarConIA && (
                      <button
                        type="button"
                        onClick={() => abrirCalificarIA()}
                        className="w-full py-2.5 text-sm font-semibold rounded border border-accent text-accent hover:bg-[var(--accent-medium)] transition-colors flex items-center justify-center gap-2"
                      >
                        <Sparkles size={17} />
                        {labelCalificarConIA}
                      </button>
                    )}

                    {/* Download on the left, grade (with its own header) on the
                        right — narrow input keeps the spinner arrows by the number */}
                    {/* Grade on its own row; the file list (if several) goes below.
                        Con rúbrica, el hueco del botón Descargar se conserva
                        (invisible) cuando no hay archivo, para que la calificación
                        oficial NUNCA cambie de lugar al navegar entre alumnos. */}
                    <div ref={califRowRef} className="flex gap-2 items-end">
                      {/* En la app no hay botón de descarga; cae al hueco
                          invisible de abajo cuando hay rúbrica, para que la
                          calificación no cambie de lugar. */}
                      {selFiles.length === 1 && !IS_NATIVE_APP ? (
                        <a
                          href={downloadUrl(selFiles[0].url, selFiles[0].nombre)}
                          download={selFiles[0].nombre}
                          rel="noopener noreferrer"
                          /* bg-surface-card (blanco) como los otros botones de
                             descarga de esta pantalla: con el lienzo azul,
                             `bg-surface` se pintaba de azul y este se perdía. */
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-card rounded border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors min-w-0"
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
                          {/* Sin descargas en la app: solo se ven, no se bajan. */}
                          {!IS_NATIVE_APP && (
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
                          )}
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
                            {!IS_NATIVE_APP && (
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
                            )}
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
                              ? (d => `${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}, ${formatHora12FromDate(d)}`)(new Date(v.fechaEntrega.seconds * 1000))
                              : '—'}
                          </span>
                          {v.completadoSinArchivo
                            ? <span className="text-slate-400 italic">sin archivo</span>
                            : v.archivoURL
                              ? IS_NATIVE_APP
                                ? <span className="text-muted truncate flex items-center gap-1">{v.nombreArchivo}</span>
                                : <a href={downloadUrl(v.archivoURL, v.nombreArchivo)} download={v.nombreArchivo} rel="noopener noreferrer" className="text-accent hover:underline truncate flex items-center gap-1">
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
                          disabled={!extendDate || savingExtension || extensionUnchanged}
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
          experimentado calificando muchas entregas seguidas). Orden:
          encabezado mínimo (flecha + nombre de actividad) → entrega, tan
          alta como el resto de la pantalla lo permita (mismo tamaño haya o
          no archivos; varias imágenes se navegan hacia abajo, en la misma
          zona) → tabs Todos/Por calificar → número+nombre del alumno (sin
          descripción de archivo) → checkbox + Anterior/Siguiente → rúbrica
          (abre hacia arriba) → calificación grande (arranca en el máximo)
          con pasos de 0.5; anular/modificar fecha son íconos separados que
          abren ventanas flotantes, no empujan el contenido → Guardar
          calificación → historial. Sin comentarios ni "Evaluar sin
          entrega". */}
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

          {/* Columna flex: la entrega es flex-1 (toma todo el espacio que
              sobra), el resto de secciones reserva su alto natural — así la
              entrega queda lo más alta posible sin dejar nada fuera de
              pantalla. overflow-y-auto es solo un respaldo por si algo no
              cupiera en una pantalla muy pequeña. */}
          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto p-3 gap-2">

            {/* Aviso solo cuando hay al menos una imagen entre los archivos
                entregados — el PDF ya pellizca directo, sin tocar primero
                (ver PinchZoomImage), así que este aviso no le aplica. */}
            {selFiles.some((f) => isImageFile(f.nombre, f.url)) && (
              <p className="text-xs text-muted text-center flex-shrink-0">
                Presiona la imagen para luego hacer zoom
              </p>
            )}

            {/* Entrega: alto = todo lo que sobra, mismo tamaño haya o no
                archivos. Varias imágenes/archivos se apilan y se navegan
                hacia abajo DENTRO de esta misma zona (scroll interno). */}
            <div className="flex-1 min-h-0 rounded-card overflow-hidden bg-surface-container">
              {selFiles.length > 0 ? (
                <div className="h-full overflow-y-auto p-2 space-y-2">
                  {selFiles.map((f, i) => (
                    <div key={`${f.url}-${i}`}>
                      {isImageFile(f.nombre, f.url) ? (
                        <ZoomableImage src={f.url} alt={f.nombre} />
                      ) : canPreviewFile(f.nombre) ? (
                        <div className="rounded overflow-hidden bg-surface-card" style={{ height: '55vh' }}>
                          <FilePreview url={f.url} nombre={f.nombre} fill />
                        </div>
                      ) : IS_NATIVE_APP ? (
                        <AbrirConNativoButton url={f.url} nombre={f.nombre}
                          className="flex items-center gap-2 px-4 py-3 bg-surface-card rounded border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors w-full" />
                      ) : (
                        <a
                          href={downloadUrl(f.url, f.nombre)}
                          download={f.nombre}
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-4 py-3 bg-surface-card rounded border border-outline-variant text-sm text-muted hover:bg-[var(--accent-medium)] transition-colors"
                        >
                          <Download size={18} className="text-accent flex-shrink-0" />
                          <span className="truncate">{f.nombre}</span>
                        </a>
                      )}
                    </div>
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

            {/* Número y nombre del estudiante, mismo renglón — sin la
                descripción del archivo entregado debajo ni la etiqueta de
                estatus (Entregado/Pendiente/etc.) */}
            <div className="flex-shrink-0">
              <h4 className="text-[0.9rem] font-semibold text-on-surface truncate">
                {selected.student.orden != null && <span className="text-on-surface">{selected.student.orden}. </span>}
                {studentFullName(selected.student)}
              </h4>
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

            {/* Guardar al avanzar/retroceder + Anterior/Siguiente. SIEMPRE
                montado (nada de "navList.length > 1 &&" envolviendo todo) —
                Anterior/Siguiente solo se deshabilitan (mismo lugar, mismo
                tamaño) cuando no hay a dónde navegar. Sin botón en medio —
                Todos/Por calificar ahora viven junto a la calificación
                (ver más abajo). */}
            <div className="space-y-1.5 flex-shrink-0">
              <label className={`flex items-center gap-2 text-sm text-muted select-none ${(selected.sub || isObservacion || hasRubrica || !isEvaluacion) && !parcialCerrado ? 'cursor-pointer' : 'invisible'}`}>
                <input
                  type="checkbox"
                  checked={autoSaveOnNav}
                  onChange={toggleAutoSave}
                  className="w-4 h-4 accent-[var(--accent)] flex-shrink-0"
                />
                Guardar al avanzar o retroceder
              </label>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => goToOffset(-1)}
                  disabled={navList.length < 2}
                  className="flex-1 flex items-center justify-center gap-1 py-2 rounded border border-accent text-accent text-sm font-semibold hover:bg-[var(--accent-medium)] transition-colors disabled:opacity-40"
                >
                  <ChevronLeft size={18} /> Anterior
                </button>
                <button
                  type="button"
                  onClick={() => goToOffset(1)}
                  disabled={navList.length < 2}
                  className="flex-1 flex items-center justify-center gap-1 py-2 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition-colors disabled:opacity-40"
                >
                  Siguiente <ChevronRight size={18} />
                </button>
              </div>
            </div>

            {/* En Android la calificación siempre está disponible para
                cualquier entregable, tenga o no entrega y tenga o no
                rúbrica — es el estándar de esta vista (antes solo se
                mostraba con entrega, observación o rúbrica, como en la
                web). */}
            {(selected.sub || isObservacion || hasRubrica || !isEvaluacion) ? (
              <form onSubmit={saveGrade} className="space-y-2 flex-shrink-0">
                {parcialCerrado && (
                  <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 leading-relaxed">
                    <strong>El Parcial {activity?.parcial} está cerrado.</strong> No se pueden cambiar calificaciones.
                    Para modificarlas, primero <strong>revierte el cierre del parcial</strong> desde Calificaciones.
                    Al revertir, las calificaciones asignadas automáticamente volverán a como estaban antes de cerrar.
                  </div>
                )}

                {/* Rúbrica — se abre hacia ARRIBA del botón (ver ventana flotante más abajo).
                    Sin rúbrica, pedido explícito: ya NO se reserva este
                    espacio (antes quedaba invisible para que la calificación
                    no cambiara de posición) — se omite del todo para que la
                    entrega (arriba, flex-1) gane ese alto. */}
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
                      {rubricaViewOpen ? `Ocultar ${instrumentoLabel}` : `Ver ${instrumentoLabel}`}
                      <span className="font-bold">
                        {totalR != null ? `— ${totalR} / ${RUBRICA_TOTAL}` : `— faltan ${faltan} criterio${faltan !== 1 ? 's' : ''}`}
                      </span>
                    </button>
                  )
                })()}
                {puedeCalificarConIA && (
                  <button
                    type="button"
                    onClick={() => abrirCalificarIA()}
                    className="w-full py-2.5 text-sm font-semibold rounded border border-accent text-accent hover:bg-[var(--accent-medium)] transition-colors flex items-center justify-center gap-2"
                  >
                    <Sparkles size={17} />
                    Calificar con IA
                  </button>
                )}

                {/* Calificación grande — sin la etiqueta de arriba (le cede
                    ese espacio a la entrega). Vacía ("—") mientras no hay
                    calificación; +/- desde vacío saltan a máximo/mitad (ver
                    stepCalif), luego suben/bajan de 0.5 en 0.5. Anular/
                    Modificar fecha son íconos bien separados (divisor +
                    espacio) que abren ventanas flotantes — nunca empujan
                    este contenido. Todos/Por calificar van a la izquierda
                    de todo esto (ya no en medio de Anterior/Siguiente),
                    aprovechando el espacio que sobraba ahí. */}
                <div>
                  {/* Fila de 3 zonas (izquierda fija / centro flexible /
                      derecha fija) en vez de un solo flex centrado — así
                      las columnas de los extremos pueden "sangrar" hasta el
                      borde real de la pantalla (-ml-3/-mr-3 cancelan el
                      padding del contenedor) sin que el cálculo de centrado
                      del medio los jale de vuelta hacia adentro. */}
                  <div className="flex items-center gap-2">
                    {/* Todos/Por calificar "abrazan" el borde izquierdo de
                        la pantalla como etiquetas — sin curva del lado
                        izquierdo, texto alineado a la izquierda. Mismo alto
                        (h-9) y mismo gap-2 que la columna de Nueva fecha/
                        Anular para que Todos quede a la misma altura que
                        Nueva fecha, y Por calificar a la misma altura que
                        Anular entrega. */}
                    <div className="flex flex-col gap-2 flex-shrink-0 -ml-3">
                      <button
                        type="button"
                        onClick={() => changeFilterInView('todos')}
                        className={`h-9 min-w-[104px] pl-3 pr-2 rounded-r border text-left text-[11px] font-semibold whitespace-nowrap transition-colors flex items-center ${
                          filter === 'todos' ? 'border-accent bg-accent-light text-accent' : 'border-outline-variant text-muted hover:bg-[var(--accent-medium)]'
                        }`}
                      >
                        Todos ({students.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => changeFilterInView('entregado')}
                        className={`h-9 min-w-[104px] pl-3 pr-2 rounded-r border text-left text-[11px] font-semibold whitespace-nowrap transition-colors flex items-center ${
                          filter === 'entregado' ? 'border-accent bg-accent-light text-accent' : 'border-outline-variant text-muted hover:bg-[var(--accent-medium)]'
                        }`}
                      >
                        Por calificar ({counts.entregado})
                      </button>
                    </div>

                    <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
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
                        className="w-24 py-1 text-center text-[2.7rem] font-bold bg-transparent border-b-2 border-accent focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
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
                    </div>

                    {!isObservacion && !isEvaluacion && (
                      <>
                        <div className="w-px h-9 bg-outline-variant flex-shrink-0" />
                        {/* Nueva fecha/Anular hacen lo mismo pero del lado
                            derecho — sin curva a la derecha, hasta el borde
                            real de la pantalla. */}
                        <div className="flex flex-col gap-2 flex-shrink-0 -mr-3">
                          <button
                            type="button"
                            onClick={() => setExtendMode(true)}
                            disabled={parcialCerrado}
                            aria-label="Modificar fecha de entrega"
                            data-tooltip="Modificar fecha de entrega"
                            className="h-9 pl-2 pr-3 rounded-l border border-outline-variant text-muted hover:text-accent hover:border-accent flex items-center justify-center transition-colors disabled:opacity-40"
                          >
                            <CalendarDays size={17} />
                          </button>
                          {selected.sub && (
                            <button
                              type="button"
                              onClick={() => setAnnulMode(true)}
                              disabled={parcialCerrado}
                              aria-label="Anular la entrega"
                              data-tooltip="Anular la entrega"
                              className="h-9 pl-2 pr-3 rounded-l border border-outline-variant text-muted hover:text-red-600 hover:border-red-300 flex items-center justify-center transition-colors disabled:opacity-40"
                            >
                              <Trash2 size={17} />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {!canCreate && (
                  <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 leading-relaxed">
                    Activa tu suscripción mensual para registrar calificaciones nuevas — toda la información de este estudiante sigue disponible.
                  </p>
                )}

                {/* Mismo alto en los dos casos (h-10) — si no, cambiar el
                    checkbox de autoguardado hace que la entrega (flex-1)
                    crezca o encoja de golpe, y se siente como que "brinca"
                    la pantalla. */}
                {parcialCerrado ? null : autoSaveOnNav && navList.length > 1 ? (
                  <p className="h-10 flex items-center justify-center text-xs text-slate-400 text-center">
                    La calificación se guarda al avanzar o al retroceder.
                  </p>
                ) : (
                  <button
                    type="submit"
                    disabled={saving || !canCreate || !isDirty()}
                    className="h-10 w-full bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {saving ? <Spinner size="sm" /> : <Star size={18} />}
                    {saving ? 'Guardando…' : 'Guardar calificación'}
                  </button>
                )}
              </form>
            ) : (
              <p className="text-sm text-slate-400 text-center py-2 flex-shrink-0">
                El estudiante aún no ha entregado esta tarea.
              </p>
            )}

            {selected.sub?.historial?.length > 0 && (
              <div className="flex-shrink-0">
                <p className="text-xs font-medium text-slate-400 mb-2">Versiones anteriores</p>
                <div className="space-y-1.5">
                  {[...selected.sub.historial].reverse().map((v, i) => (
                    <div key={`${v.fechaEntrega?.seconds ?? 'v'}-${i}`} className="flex items-center gap-2 px-3 py-2 bg-surface rounded border border-outline-variant text-xs">
                      <span className="text-slate-400 flex-shrink-0">
                        {v.fechaEntrega?.seconds
                          ? (d => `${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}, ${formatHora12FromDate(d)}`)(new Date(v.fechaEntrega.seconds * 1000))
                          : '—'}
                      </span>
                      {v.completadoSinArchivo
                        ? <span className="text-slate-400 italic">sin archivo</span>
                        : v.archivoURL
                          ? IS_NATIVE_APP
                            ? <span className="text-muted truncate flex items-center gap-1">{v.nombreArchivo}</span>
                            : <a href={downloadUrl(v.archivoURL, v.nombreArchivo)} download={v.nombreArchivo} rel="noopener noreferrer" className="text-accent hover:underline truncate flex items-center gap-1">
                              <Download size={14} /> {v.nombreArchivo}
                            </a>
                          : <span className="text-slate-300 italic">sin archivo</span>
                      }
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="h-1 safe-bottom flex-shrink-0" />
          </div>
        </div>
      )}

      {/* Anular entrega / Modificar fecha — ventanas flotantes centradas
          (Android), no empujan el contenido de la vista de evaluar. */}
      {selected && IS_NATIVE_APP && annulMode && selected.sub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setAnnulMode(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card shadow-2xl w-full max-w-sm p-4 space-y-2">
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
        </div>
      )}

      {selected && IS_NATIVE_APP && extendMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setExtendMode(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card shadow-2xl w-full max-w-sm p-4 space-y-2">
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
                disabled={!extendDate || savingExtension || extensionUnchanged}
                className="flex-1 py-2 bg-accent text-white text-sm font-semibold rounded disabled:opacity-60 transition-colors"
              >
                {savingExtension ? 'Guardando…' : 'Guardar'}
              </button>
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
            // Una lista de cotejo es angosta (Num + Criterio + ¿Cumple? +
            // PUNTOS): estirada de la mitad al borde dejaba una franja blanca
            // enorme a la derecha y tapaba de más el área de trabajos. Se ciñe
            // al ancho de la tabla y se pega al borde DERECHO, dejando libre
            // toda la izquierda, que es donde está la lista por revisar.
            // La rúbrica completa NO: tiene una columna por nivel y sí
            // aprovecha el ancho, así que conserva el anclaje a la mitad.
            //
            // El `md:left-*` va en una sola rama y no repetido en la base: dos
            // utilidades del mismo grupo (left-1/2 y left-auto) tienen la misma
            // especificidad y ganaría la que Tailwind emita después, no la que
            // se escriba al final de la cadena.
            className={`fixed left-2 right-2 z-50 bg-surface-card border border-outline-variant rounded-card shadow-2xl flex flex-col overflow-hidden ${
              esCotejo(activity.rubrica)
                ? 'md:left-auto md:w-[610px] md:max-w-[calc(100vw_-_1rem)]'
                : 'md:left-1/2'
            }`}
            // En Android se ancla por `bottom` y crece hacia arriba (pedido
            // explícitamente); en web sigue anclada por `top`, hacia abajo.
            style={IS_NATIVE_APP
              ? { bottom: rubricaWinBottom, maxHeight: `calc(100vh - ${rubricaWinBottom + 60}px)` }
              : { top: rubricaWinTop, maxHeight: `calc(100vh - ${rubricaWinTop + 10}px)` }}
          >
            {/* Mismo par de colores que la etiqueta del banco: azul = rúbrica,
                violeta = lista de cotejo (ver instrumentoColors). */}
            <div className={`flex items-center gap-2 px-3 py-2 border-b border-outline-variant flex-shrink-0 ${instrumentoColors(activity.rubrica).bg}`}>
              {esCotejo(activity.rubrica)
                ? <ListChecks size={17} className={`${instrumentoColors(activity.rubrica).icon} flex-shrink-0`} />
                : <ClipboardList size={17} className={`${instrumentoColors(activity.rubrica).icon} flex-shrink-0`} />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-on-surface truncate">
                  <span className={instrumentoColors(activity.rubrica).text}>{esCotejo(activity.rubrica) ? 'Lista de cotejo' : 'Rúbrica'}</span>: {activity.rubrica.titulo}
                </p>
                <p className="text-[11px] text-muted truncate">
                  {esCotejo(activity.rubrica)
                    ? 'Marca los criterios que cumple — la calificación se calcula sola'
                    : 'Marca una opción por renglón — la calificación se calcula sola'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRubricaViewOpen(false)}
                aria-label="Cerrar rúbrica"
                data-tooltip="Cerrar rúbrica"
                className="p-2 text-slate-400 hover:text-accent rounded flex-shrink-0"
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
                compact={!IS_NATIVE_APP}
              />
            </div>
            {/* Con el autoguardado activo, Siguiente/Anterior ya aplican la
                calificación — el botón sería redundante */}
            {!autoSaveOnNav && (
              <div className="p-2 border-t border-outline-variant flex-shrink-0">
                {/* "Aplicar" ya GUARDA la calificación (persistGrade) — no hace
                    falta un paso extra de "Guardar calificación". */}
                <button
                  type="button"
                  disabled={saving || parcialCerrado}
                  onClick={async () => {
                    if (await persistGrade()) toast('Calificación guardada')
                    setRubricaViewOpen(false)
                  }}
                  className="w-full py-2 bg-accent text-white text-sm font-semibold rounded flex items-center justify-center gap-2 hover:bg-accent-hover disabled:opacity-60 transition-colors"
                >
                  Aplicar y guardar calificación{totalR != null ? ` — ${totalR} / ${RUBRICA_TOTAL}` : ` (faltan ${faltan})`}
                </button>
              </div>
            )}
          </div>
        )
      })()}

      {calificarIAAbierto && selected?.sub && hasRubrica && (
        <CalificarConIAModal
          open={calificarIAAbierto}
          onClose={cerrarCalificarIA}
          onDescartar={descartarPropuestaIA}
          actividadId={activityId}
          submissionId={selected.sub.id}
          rubrica={activity.rubrica}
          onAplicar={aplicarPropuestaIA}
          resultadoPersistido={sugerenciaPersistidaIA}
        />
      )}

      {loteIAConteo && (
        <ConfirmacionCreditosModal
          titulo={loteIAConteo.recalificar ? 'Recalificar todas con IA' : 'Calificar todas con IA'}
          descripcion={loteIAConteo.recalificar
            ? `Se generará una propuesta NUEVA de calificación (con la rúbrica/lista de cotejo actual) para ${loteIAConteo.entregas} entrega${loteIAConteo.entregas !== 1 ? 's' : ''} con evidencia. No se toca ninguna calificación, entrega ni archivo existente — la IA solo propone: tú revisas y confirmas cada una al calificar a ese estudiante.`
            : `Se generará una propuesta de calificación para ${loteIAConteo.entregas} entrega${loteIAConteo.entregas !== 1 ? 's' : ''} pendiente${loteIAConteo.entregas !== 1 ? 's' : ''}. La IA solo propone: tú revisas y confirmas cada una al calificar a ese estudiante.`}
          costoMin={creditosIA.estimar('calificar_entregable_ia_lote', loteIAConteo.entregas) ?? loteIAConteo.entregas * 0.5}
          ejecutando={loteIATrabajando}
          onCancelar={() => { if (!loteIATrabajando) setLoteIAConteo(null) }}
          onContinuar={ejecutarLoteIA}
        />
      )}

      {/* "Aplicar calificaciones de IA a todas" (Modo 1) — confirmación SIN
          costo, deliberadamente distinta de ConfirmacionCreditosModal (que
          siempre habla de créditos): esta acción no genera IA nueva, así que
          no debe insinuar ningún cobro. */}
      {aplicarTodasConteo && (
        <ConfirmModal
          title="Aplicar calificaciones de IA a todas"
          message={`Se aplicará la calificación propuesta por la IA a ${aplicarTodasConteo.entregas} entrega${aplicarTodasConteo.entregas !== 1 ? 's' : ''} que ya tienen una propuesta pendiente. No se hará ninguna evaluación nueva con IA y no se consumirán créditos.`}
          confirmLabel="Aplicar a todas"
          confirmingLabel="Aplicando…"
          busy={aplicarTodasTrabajando}
          onConfirm={ejecutarAplicarTodasIA}
          onCancel={() => { if (!aplicarTodasTrabajando) setAplicarTodasConteo(null) }}
        />
      )}

      {editingActivity && activity && (
        <EntregableEditor
          activityId={activityId}
          parcial={activity.parcial}
          categoria={activity.categoria || 'entregable'}
          subjectId={activity.asignaturaId}
          docenteId={activity.docenteId}
          existingActivities={[]}
          activityLabel={activityLabel}
          onDeleteActivity={() => setDeleteConfirm(true)}
          onClose={() => (returnToCalendar ? navigate('/calendario') : setEditingActivity(false))}
          onActivityUpdated={(updated) => {
            setActivity((prev) => ({ ...prev, ...updated }))
            if (returnToCalendar) { navigate('/calendario'); return }
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
            // 'published', no 'show': 'show' significa "publicar AHORA MISMO" y
            // resolveVisibilidad valida la fecha límite contra ese instante de
            // guardado (no contra publishedAt) — en una actividad ya publicada
            // eso comparaba la fecha límite contra la hora de editar, no contra
            // la hora real de publicación, y rechazaba fechas límite válidas.
            visibilidadMode: activity.publishedAt ? 'published' : (activity.publishAt ? 'schedule' : 'hide'),
            // Checkbox reads the positive framing ("cerrar en fecha"); the real DB field
            // (recibirTarde) is the inverse — see EntregableEditor's save payload.
            cerrarEntregasEnFecha: !activity.recibirTarde,
            rubrica: activity.rubrica || null,
            rubricaId: activity.rubricaId || null,
            notificarDocente: activity.notificarDocente || false,
          }}
          initialExistingFiles={activity.archivosAdjuntos || []}
          contextLine={subjectDisplayName(subject)}
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

      {/* Eliminar actividad — desde su propia edición, entregable/observación
          o evaluación, publicada o borrador. */}
      {deleteActivityModal}

      </div>
  )
}
