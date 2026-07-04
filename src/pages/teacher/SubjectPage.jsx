import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  collection, query, where, getDocs, getDoc,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import { exportSubjectGrades, parseStudentExcel, downloadStudentTemplate } from '../../utils/excel'
import { exportSubjectGradesPDF, exportCredentialsPDF, exportQRPDF } from '../../utils/pdf'
import { buildJobsForSubject, downloadSubmissionsZip } from '../../utils/downloadSubmissions'
import { deleteSubjectCascade, deleteSubjectStudents, deleteSubjectSubmissions, deleteSubmissionsByStudent, deleteSubmissionsByActivity } from '../../utils/deleteSubjectCascade'
import { copySubject } from '../../utils/copySubject'
import { activityVisibilityState, formatDeadline, formatPublishAt } from '../../utils/activityVisibility'
import { pesoDe, pesoTotal, promedioParcial } from '../../utils/ponderacion'
import { subjectDisplayName } from '../../utils/subjectName'
import PaletteSelect from '../../components/PaletteSelect'
import IconSelect from '../../components/IconSelect'
import SubjectIcon from '../../components/SubjectIcon'
import FileTypeSelect from '../../components/FileTypeSelect'
import RichTextEditor from '../../components/RichTextEditor'
import VisibilitySelect from '../../components/VisibilitySelect'
import EFDateTimePicker from '../../components/EFDateTimePicker'
import FileDropzone from '../../components/FileDropzone'
import { htmlToPlainText, sanitizeHtml, toRichHtml, richTextContentClass } from '../../utils/sanitizeHtml'
import { DEFAULT_FILE_TYPE, CUSTOM_FILE_TYPE, normalizeFileTypeKeys, parseCustomExts } from '../../config/fileTypes'
import { TEACHER_CONTAINER, TEACHER_CONTAINER_NARROW } from '../../config/layout'
import { uploadToCloudinary, downloadUrl } from '../../utils/cloudinary'
import { RESOURCE_ACCEPT, getResourceIcon, isResourceFileAllowed } from '../../utils/resourceTypes'
import { formatFileSize } from '../../utils/formatBytes'
import AttachmentList, { FilePreview, canPreviewFile } from '../../components/AttachmentList'
import {
  ArrowLeft, Plus, ChevronDown, ChevronUp, FileText, Clock,
  CheckCircle, X, Pencil, Trash2, Archive, ArchiveRestore,
  FileSpreadsheet, Search,
  ArrowUpDown, UserPlus, RotateCcw, Upload, Download, QrCode, ChevronRight,
  Link, Check as CheckIcon, KeyRound, Copy,
  Eye, EyeOff, BookOpen, Paperclip, FileCheck2, Timer,
  ListChecks, GraduationCap,
} from 'lucide-react'
import { QRCodeSVG as QRCode } from 'qrcode.react'
import { generateUsername } from '../../utils/generate'
import { findStudentIdentity } from '../../utils/studentIdentity'
import { matchesStudentSearch } from '../../utils/studentSearch'
import { useSubscription } from '../../hooks/useSubscription'
import EvaluacionEditor from '../../components/EvaluacionEditor'
import EntregableEditor from '../../components/EntregableEditor'
import { canCreateContent } from '../../utils/subscriptionHelpers'

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

const EMPTY_FORM = { nombre: '', categoria: 'entregable', instrucciones: '', fechaLimite: '', tiposArchivo: [DEFAULT_FILE_TYPE], extensionesCustom: '', oculta: false, publishAt: '', publishedAt: '', visibilidadMode: 'show', esEvaluacion: false }

// Defaults for a new evaluación's config — Cuestionario favors repeated
// practice (unlimited attempts, keep best); Examen favors a single formal
// attempt (1 try, keep last). The teacher can change all of this afterward.
const EVALUACION_DEFAULTS = {
  cuestionario: {
    numPreguntas: 0, ordenPreguntas: 'creacion', navegacion: 'libre',
    tiempoLimiteMin: null, intentosPermitidos: null, conservar: 'mejor',
    publicarResultados: 'inmediato', publicarResultadosFecha: null, resultadosPublicados: false,
    mostrarRetroalimentacion: true, mostrarRespuestasCorrectas: false, mostrarPorcentaje: true, barajarRespuestas: false,
  },
  examen: {
    numPreguntas: 0, ordenPreguntas: 'creacion', navegacion: 'secuencial',
    tiempoLimiteMin: 30, intentosPermitidos: 1, conservar: 'ultimo',
    publicarResultados: 'inmediato', publicarResultadosFecha: null, resultadosPublicados: false,
    mostrarRetroalimentacion: true, mostrarRespuestasCorrectas: false, mostrarPorcentaje: true, barajarRespuestas: false,
  },
}

const CATEGORIAS_ACTIVIDAD = [
  { value: 'entregable', label: 'Entregable' },
  { value: 'cuestionario', label: 'Cuestionario' },
  { value: 'examen', label: 'Examen' },
]

function formatResourceDate(ts) {
  if (!ts?.toDate) return ''
  return ts.toDate().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Resources are course material (PDFs, decks, spreadsheets), typically
// heavier than a single submission file — a higher cap than the 5 MB used
// for student deliveries (src/pages/student/ActivityPage.jsx).
const MAX_RESOURCE_SIZE = 15 * 1024 * 1024
// Shared by "Material de apoyo" files AND activity-instruction attachments:
// both allow any file type (no extension whitelist, unlike the Recursos tab)
// and any number of files — only the per-file size is capped, same ceiling
// already proven for the Recursos tab's Cloudinary preset.
const MAX_ATTACHMENT_FILE_SIZE = 15 * 1024 * 1024
const EMPTY_MATERIAL_FORM = { nombre: '', descripcion: '', oculta: false, publishAt: '', visibilidadMode: 'show' }

function gradeColor(norm) {
  if (norm === null) return 'text-slate-300'
  if (norm >= 8) return 'text-emerald-700'
  if (norm >= 6) return 'text-amber-600'
  return 'text-red-500'
}

export default function SubjectPage() {
  const { subjectId } = useParams()
  const { currentUser, userProfile } = useAuth()
  const { subscription } = useSubscription()
  const canCreate = canCreateContent(subscription)
  const [subject, setSubject] = useState(null)
  const [activities, setActivities] = useState([])
  const [submissionCounts, setSubmissionCounts] = useState({})
  const [totalStudents, setTotalStudents] = useState(0)
  const [openParcial, setOpenParcial] = useState(1)

  // Activity modal
  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [modalParcial, setModalParcial] = useState(1)
  const [editActivityId, setEditActivityId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  // null = showing the tipo picker, 'entregable'|'cuestionario'|'examen' = form visible
  const [tipoActividad, setTipoActividad] = useState(null)
  // Full-screen evaluación editor (cuestionario / examen)
  const [evalEditor, setEvalEditor] = useState(null) // null | { activityId, categoria, parcial }
  // Full-screen entregable editor
  const [entregableEditor, setEntregableEditor] = useState(null) // null | { activityId, parcial, categoria, activityLabel, initialForm, initialExistingFiles }
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [publishDraftConfirm, setPublishDraftConfirm] = useState(null) // draft activity | null
  const [duplicateConfirm, setDuplicateConfirm] = useState(null) // activity | null
  const [duplicating, setDuplicating] = useState(false)
  // PONDERACIÓN: in-progress weight edits per activity id (committed on blur)
  const [pesoEdits, setPesoEdits] = useState({})
  const [deleting, setDeleting] = useState(false)
  const [archiving, setArchiving] = useState(false)
  // Files attached to the activity's instructions (RichTextEditor's "Adjuntar
  // archivo" button) — support material for the alumno, NOT evidence: kept
  // entirely separate from `submissions`, never required, never graded.
  const [activityExistingFiles, setActivityExistingFiles] = useState([]) // [{url,nombre,tamano}]
  const [activityNewFiles, setActivityNewFiles] = useState([]) // File[] pending upload

  // Materials ("Material de apoyo") — independent of Activity: scoped per
  // parcial like activities, but never creates a submission/grade. Loaded
  // together with activities in loadAll() (not lazily, since it lives
  // inline in the Actividades tab, not behind its own tab).
  const [materials, setMaterials] = useState([])
  const [showMaterialModal, setShowMaterialModal] = useState(false)
  const [materialModalMode, setMaterialModalMode] = useState('create')
  const [materialParcial, setMaterialParcial] = useState(1)
  const [editMaterialId, setEditMaterialId] = useState(null)
  const [materialForm, setMaterialForm] = useState(EMPTY_MATERIAL_FORM)
  const [materialNewFiles, setMaterialNewFiles] = useState([]) // File[] pending upload
  const [materialExistingFiles, setMaterialExistingFiles] = useState([]) // [{url,nombre,tamano}] kept on edit
  const [savingMaterial, setSavingMaterial] = useState(false)
  const [deleteMaterialConfirm, setDeleteMaterialConfirm] = useState(null)
  const [deletingMaterial, setDeletingMaterial] = useState(false)
  const [expandedMaterialId, setExpandedMaterialId] = useState(null)

  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportingGradesPdf, setExportingGradesPdf] = useState(false)
  const [generatingCredentials, setGeneratingCredentials] = useState(false)
  const [showCredentialsModal, setShowCredentialsModal] = useState(false)
  const [zipDownloading, setZipDownloading] = useState(false)
  const [zipProgress, setZipProgress] = useState({ done: 0, total: 0 })

  // Activity visibility

  // Subject CRUD
  const [showEditSubjectModal, setShowEditSubjectModal] = useState(false)
  const [editSubjectForm, setEditSubjectForm] = useState({ nombre: '', grupo: '', fechaInicio: '', fechaFin: '', parciales: '3', colorPalette: 'default', icon: 'book' })
  const [editingSubject, setEditingSubject] = useState(false)
  const [showDeleteSubjectConfirm, setShowDeleteSubjectConfirm] = useState(false)
  const [deleteSubjectConfirmText, setDeleteSubjectConfirmText] = useState('')
  const [deletingSubject, setDeletingSubject] = useState(false)
  const [showCopyModal, setShowCopyModal] = useState(false)
  const [copyForm, setCopyForm] = useState({ nombre: '', grupo: '', keepStudents: false, colorPalette: 'default', icon: 'book' })
  const [copyFechas, setCopyFechas] = useState({ fechaInicio: '', fechaFin: '' })
  const [copyingSubject, setCopyingSubject] = useState(false)

  // Unarchive modal
  const [showUnarchiveModal, setShowUnarchiveModal] = useState(false)
  const [unarchiveStudents, setUnarchiveStudents] = useState('keep') // 'keep' | 'reset'
  const [unarchiveActivities, setUnarchiveActivities] = useState('keep') // 'keep' | 'show' | 'hide'
  const [unarchiveEdits, setUnarchiveEdits] = useState({ nombre: '', grupo: '', fechaInicio: '', fechaFin: '', parciales: '3', colorPalette: 'default', icon: 'book' })
  const [unarchivedSaving, setUnarchivedSaving] = useState(false)
  // Archive flow
  const [showArchiveModal, setShowArchiveModal] = useState(false)
  const [archiveExportChoice, setArchiveExportChoice] = useState('save') // 'save' | 'skip'

  // Tab
  const [activeTab, setActiveTab] = useState('actividades')

  // Shared students (used by calificaciones + alumnos tab)
  const [groupStudents, setGroupStudents] = useState([])
  const [groupStudentsLoaded, setGroupStudentsLoaded] = useState(false)

  // Copy feedback
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)

  // Student management (Alumnos tab)
  const [showAddStudent, setShowAddStudent] = useState(false)
  const [showQR, setShowQR] = useState(false)
  const [studentToDelete, setStudentToDelete] = useState(null)
  const [studentToEdit, setStudentToEdit] = useState(null)
  const [editStudentForm, setEditStudentForm] = useState({ apellidoPaterno: '', apellidoMaterno: '', nombre: '', comentarios: '' })
  const [studentToReset, setStudentToReset] = useState(null)
  const [resetPwdResult, setResetPwdResult] = useState(null) // { student }
  const [linkCandidate, setLinkCandidate] = useState(null) // { person, identity, schoolDocs }
  const [newStudent, setNewStudent] = useState({ apellidoPaterno: '', apellidoMaterno: '', nombre: '' })
  const [savingStudent, setSavingStudent] = useState(false)
  const [searchAlumnos, setSearchAlumnos] = useState('')

  // Resources (Recursos tab) — independent entity scoped by asignaturaId,
  // not tied to activities (see the `resources` collection in firestore.rules).
  const [resources, setResources] = useState([])
  const [resourcesLoaded, setResourcesLoaded] = useState(false)
  const [previewResourceId, setPreviewResourceId] = useState(null)
  const [loadingResources, setLoadingResources] = useState(false)
  const [showResourceModal, setShowResourceModal] = useState(false)
  const [resourceModalMode, setResourceModalMode] = useState('create') // 'create' | 'edit'
  const [resourceForm, setResourceForm] = useState({ id: null, nombre: '', descripcion: '' })
  const [resourceFile, setResourceFile] = useState(null)
  const [savingResource, setSavingResource] = useState(false)
  const [deleteResourceConfirm, setDeleteResourceConfirm] = useState(null)
  const [deletingResource, setDeletingResource] = useState(false)

  // Calificaciones
  const [gradeSubMap, setGradeSubMap] = useState({})
  const [gradesLoaded, setGradesLoaded] = useState(false)
  const [loadingGrades, setLoadingGrades] = useState(false)
  const [searchGrade, setSearchGrade] = useState('')
  // Column/row hover tracking for the grades table cross-highlight — set via
  // event delegation on the table (see handleGradeTableHover below) instead
  // of one handler per cell.
  const [hoverGradeCell, setHoverGradeCell] = useState({ row: null, col: null })

  const navigate = useNavigate()
  const toast = useToast()

  // Guard on currentUser + depend on it: on a cold load the Firestore reads in loadAll()
  // (activities, students, submissions, materials) must not fire before Firebase Auth
  // restores the session, or the rules reject them and the effect never retries — the same
  // auth race that hid activities from students. Re-runs once currentUser is ready.
  useEffect(() => { if (currentUser) loadAll() }, [subjectId, currentUser])

  async function loadAll() {
    setLoading(true)
    // Navigating from one subject straight to another (e.g. via the sidebar) re-renders
    // this same component with a new subjectId instead of remounting it — without this,
    // the Alumnos/Calificaciones tabs would keep showing the PREVIOUS subject's roster,
    // since `groupStudentsLoaded`/`gradesLoaded` would already be true.
    setGroupStudents([])
    setGroupStudentsLoaded(false)
    setGradeSubMap({})
    setGradesLoaded(false)
    setResources([])
    setResourcesLoaded(false)
    try {
      // `materials` is fetched separately (not inside this Promise.all): if its
      // Firestore rules aren't deployed yet, getDocs() rejects with
      // permission-denied — that must never take down the subject/activities
      // load with it (it did once: the whole page fell back to defaults —
      // generic icon, blue palette, 3 parciales — because setSubject() was
      // never reached).
      const [subSnap, actsSnap] = await Promise.all([
        getDoc(doc(db, 'subjects', subjectId)),
        getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', subjectId))),
      ])
      const matsSnap = await getDocs(query(collection(db, 'materials'), where('asignaturaId', '==', subjectId))).catch(() => ({ docs: [] }))
      let subData = { id: subSnap.id, ...subSnap.data() }
      if (!subData.accessCode) {
        const newCode = Math.random().toString(36).slice(2, 8).toUpperCase()
        await updateDoc(doc(db, 'subjects', subjectId), { accessCode: newCode })
        subData = { ...subData, accessCode: newCode }
      }
      setSubject(subData)
      // Firestore doesn't guarantee document order without orderBy (not allowed
      // per this project's query constraints), so `orden` is the only thing that
      // determines display order. Activities created before this field existed
      // self-heal here: fall back to `createdAt`/id for a stable order, assign
      // `orden` from that position, and persist it — same pattern already used
      // for subjects/students.
      let acts = actsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      if (acts.some((a) => a.orden == null)) {
        const byParcial = {}
        acts.forEach((a) => { (byParcial[a.parcial] ||= []).push(a) })
        const batch = writeBatch(db)
        acts = Object.values(byParcial).flatMap((list) => {
          list.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0) || a.id.localeCompare(b.id))
          return list.map((a, i) => {
            const orden = i + 1
            if (a.orden !== orden) batch.update(doc(db, 'activities', a.id), { orden })
            return { ...a, orden }
          })
        })
        batch.commit().catch(() => {}) // best-effort; in-memory order is already correct
      }
      acts = acts.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      setActivities(acts)

      setMaterials(
        matsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      )

      const [subDocs, studSnap] = await Promise.all([
        fetchSubmissionsForActivities(acts.map((a) => a.id)),
        getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId))),
      ])
      setTotalStudents(studSnap.size)

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

      // Re-fetch whichever tab is currently open for the NEW subject — `force: true`
      // because groupStudentsLoaded was just reset above but this function's own
      // closure still has the stale value from before that reset took effect.
      if (activeTab === 'alumnos') await ensureGroupStudents(true)
      if (activeTab === 'calificaciones') await loadGrades(true, acts)
      if (activeTab === 'recursos') await ensureResources(true)
    } catch (err) {
      toast('Error al cargar: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── Students (shared) ──────────────────────────────────────────────
  // `force` bypasses the groupStudentsLoaded cache check — needed right after loadAll()
  // resets it, since this function's own closure (captured at the start of the same
  // render that triggered loadAll) still holds the PREVIOUS subject's stale `true`.
  async function ensureGroupStudents(force = false) {
    if (groupStudentsLoaded && !force) return groupStudents
    const snap = await getDocs(
      query(collection(db, 'students'), where('asignaturaId', '==', subjectId))
    )
    const students = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    setGroupStudents(students)
    setGroupStudentsLoaded(true)
    return students
  }

  // ── Resources (Recursos tab) ───────────────────────────────────────
  async function ensureResources(force = false) {
    if (resourcesLoaded && !force) return resources
    setLoadingResources(true)
    try {
      const snap = await getDocs(query(collection(db, 'resources'), where('asignaturaId', '==', subjectId)))
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        // Most-recent-first by publish date — sorted in memory since this
        // project's Firestore queries can't use orderBy (see CLAUDE.md).
        .sort((a, b) => (b.fechaPublicacion?.seconds ?? 0) - (a.fechaPublicacion?.seconds ?? 0))
      setResources(list)
      setResourcesLoaded(true)
      return list
    } catch (err) {
      toast('Error al cargar recursos: ' + err.message, 'error')
      return []
    } finally {
      setLoadingResources(false)
    }
  }

  function openAddResource() {
    setResourceModalMode('create')
    setResourceForm({ id: null, nombre: '', descripcion: '' })
    setResourceFile(null)
    setShowResourceModal(true)
  }

  function openEditResource(r) {
    setResourceModalMode('edit')
    setResourceForm({ id: r.id, nombre: r.nombre, descripcion: r.descripcion || '' })
    setResourceFile(null)
    setShowResourceModal(true)
  }

  async function handleSaveResource(e) {
    e.preventDefault()
    if (!resourceForm.nombre.trim()) { toast('Escribe un nombre', 'error'); return }
    if (resourceModalMode === 'create' && !resourceFile) { toast('Selecciona un archivo', 'error'); return }
    if (resourceFile) {
      if (!isResourceFileAllowed(resourceFile)) { toast('Tipo de archivo no permitido', 'error'); return }
      if (resourceFile.size > MAX_RESOURCE_SIZE) { toast('El archivo no puede superar 15 MB', 'error'); return }
    }
    setSavingResource(true)
    try {
      if (resourceModalMode === 'create') {
        const url = await uploadToCloudinary(resourceFile, 'evalua-facil/recursos')
        await addDoc(collection(db, 'resources'), {
          asignaturaId: subjectId,
          docenteId: currentUser.uid,
          nombre: resourceForm.nombre.trim(),
          descripcion: resourceForm.descripcion.trim(),
          url,
          nombreArchivo: resourceFile.name,
          tamano: resourceFile.size,
          fechaPublicacion: serverTimestamp(),
        })
        toast('Recurso agregado')
      } else {
        const patch = {
          nombre: resourceForm.nombre.trim(),
          descripcion: resourceForm.descripcion.trim(),
        }
        if (resourceFile) {
          patch.url = await uploadToCloudinary(resourceFile, 'evalua-facil/recursos')
          patch.nombreArchivo = resourceFile.name
          patch.tamano = resourceFile.size
        }
        await updateDoc(doc(db, 'resources', resourceForm.id), patch)
        toast('Recurso actualizado')
      }
      setShowResourceModal(false)
      await ensureResources(true)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingResource(false)
    }
  }

  async function handleDeleteResource() {
    if (!deleteResourceConfirm) return
    setDeletingResource(true)
    try {
      await deleteDoc(doc(db, 'resources', deleteResourceConfirm.id))
      setDeleteResourceConfirm(null)
      await ensureResources(true)
      toast('Recurso eliminado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setDeletingResource(false)
    }
  }

  // ── Calificaciones ─────────────────────────────────────────────────
  // `actsOverride` lets loadAll() pass the just-fetched activities directly — the
  // component's own `activities` state hasn't re-rendered yet inside that same call,
  // so reading it here would still see the PREVIOUS subject's activities.
  async function loadGrades(force = false, actsOverride = null) {
    setLoadingGrades(true)
    try {
      await ensureGroupStudents(force)
      const subDocs = await fetchSubmissionsForActivities((actsOverride || activities).map((a) => a.id))
      const map = {}
      subDocs.forEach((d) => {
        const data = d.data()
        map[`${data.alumnoId}-${data.actividadId}`] = data
      })
      setGradeSubMap(map)
      setGradesLoaded(true)
    } catch (err) {
      toast('Error al cargar calificaciones: ' + err.message, 'error')
    } finally {
      setLoadingGrades(false)
    }
  }

  function switchTab(tab) {
    setActiveTab(tab)
    if (tab === 'calificaciones' && !gradesLoaded) loadGrades()
    if (tab === 'alumnos' && !groupStudentsLoaded) ensureGroupStudents()
    if (tab === 'recursos' && !resourcesLoaded) ensureResources()
  }

  // ── Student management (Alumnos tab) ──────────────────────────────
  // All `students` docs of the school (every enrollment of every person). Used both to
  // dedupe usernames for brand-new people and to detect existing identities (same person
  // re-enrolled) so we can reuse their username/uid instead of forking a second account.
  async function fetchSchoolStudents() {
    const snap = await getDocs(
      query(collection(db, 'students'), where('escuelaId', '==', userProfile.escuelaId || 'sin-escuela'))
    )
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  }

  function uniqueFrom(person, schoolDocs) {
    const taken = new Set(schoolDocs.map((d) => d.username))
    return uniqueUsername(
      generateUsername(person.apellidoPaterno, person.apellidoMaterno, person.nombre),
      taken
    )
  }

  async function refreshGroupStudents() {
    const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
    setGroupStudents(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)))
  }

  // Creates one enrollment doc. If `identity` is given (re-enrolling an existing person),
  // the new doc inherits that person's username/uid/activado so all their subjects share a
  // single account — and an already-activated student gets the new subject instantly.
  async function createEnrollment(person, identity, schoolDocs) {
    const username = identity ? identity.username : uniqueFrom(person, schoolDocs)
    await addDoc(collection(db, 'students'), {
      apellidoPaterno: person.apellidoPaterno.trim(),
      apellidoMaterno: person.apellidoMaterno.trim(),
      nombre: person.nombre.trim(),
      username,
      resetPassword: null,
      escuelaId: userProfile.escuelaId || 'sin-escuela',
      asignaturaId: subjectId,
      activado: identity ? identity.activado : false,
      uid: identity ? (identity.uid || null) : null,
      orden: groupStudents.length + 1,
      createdAt: serverTimestamp(),
    })
  }

  // Duplicate names get a zero-padded suffix: garcia.juan, garcia.juan01,
  // garcia.juan02… (dedupe is school-wide — usernames are the account id)
  function uniqueUsername(base, taken) {
    if (!taken.has(base)) return base
    let i = 1
    while (taken.has(`${base}${String(i).padStart(2, '0')}`)) i++
    return `${base}${String(i).padStart(2, '0')}`
  }

  async function addStudent(e) {
    e.preventDefault()
    setSavingStudent(true)
    try {
      const schoolDocs = await fetchSchoolStudents()
      const identity = findStudentIdentity(schoolDocs, newStudent)
      // Already enrolled in THIS subject → don't create a duplicate.
      if (identity && identity.matches.some((m) => m.asignaturaId === subjectId)) {
        toast('Ese estudiante ya está en esta asignatura', 'error')
        return
      }
      // Same full name elsewhere in the school → ask the teacher if it's the same person
      // before reusing (linking) their account.
      if (identity) {
        setLinkCandidate({ person: { ...newStudent }, identity, schoolDocs })
        return
      }
      await createEnrollment(newStudent, null, schoolDocs)
      setNewStudent({ apellidoPaterno: '', apellidoMaterno: '', nombre: '' })
      setShowAddStudent(false)
      toast('Estudiante agregado')
      await refreshGroupStudents()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingStudent(false)
    }
  }

  // Resolves the "same name found" confirmation: link to the existing account or create new.
  async function resolveLinkCandidate(isSamePerson) {
    if (!linkCandidate) return
    const { person, identity, schoolDocs } = linkCandidate
    setSavingStudent(true)
    try {
      await createEnrollment(person, isSamePerson ? identity : null, schoolDocs)
      setNewStudent({ apellidoPaterno: '', apellidoMaterno: '', nombre: '' })
      setShowAddStudent(false)
      toast(isSamePerson ? 'Asignatura vinculada a su cuenta' : 'Estudiante agregado (cuenta nueva)')
      await refreshGroupStudents()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingStudent(false)
      setLinkCandidate(null)
    }
  }

  async function handleExcelImport(e) {
    const file = e.target.files[0]
    if (!file) return
    setSavingStudent(true)
    try {
      const rows = await parseStudentExcel(file)
      if (rows.length === 0) { toast('El archivo no tiene estudiantes con los 3 campos requeridos', 'error'); return }
      const schoolDocs = await fetchSchoolStudents()
      const taken = new Set(schoolDocs.map((d) => d.username))
      const batch = writeBatch(db)
      let nextOrden = groupStudents.length + 1
      let linked = 0
      let skipped = 0
      for (const row of rows) {
        const identity = findStudentIdentity(schoolDocs, row)
        // Already in this subject → skip (avoid duplicate enrollment).
        if (identity && identity.matches.some((m) => m.asignaturaId === subjectId)) { skipped++; continue }
        let username, uid = null, activado = false
        if (identity) {
          // Same person elsewhere → bulk import links automatically to their account.
          username = identity.username; uid = identity.uid || null; activado = identity.activado; linked++
        } else {
          username = uniqueUsername(generateUsername(row.apellidoPaterno, row.apellidoMaterno, row.nombre), taken)
          taken.add(username)
        }
        const ref = doc(collection(db, 'students'))
        batch.set(ref, {
          ...row,
          username,
          resetPassword: null,
          uid,
          escuelaId: userProfile.escuelaId || 'sin-escuela',
          asignaturaId: subjectId,
          activado,
          orden: nextOrden++,
          createdAt: serverTimestamp(),
        })
      }
      await batch.commit()
      const parts = [`${rows.length - skipped} estudiantes importados`]
      if (linked) parts.push(`${linked} vinculados a cuentas existentes`)
      if (skipped) parts.push(`${skipped} ya estaban en la asignatura`)
      toast(parts.join(' · '))
      await refreshGroupStudents()
    } catch (err) {
      toast('Error importando Excel: ' + err.message, 'error')
    } finally {
      setSavingStudent(false)
      e.target.value = ''
    }
  }

  // Enables password recovery for a student: sets the `resetPassword` field to `true` (an
  // opaque enable-marker, NOT a password) that the student-side "Recuperar contraseña" flow
  // checks. The student then chooses a new password (the actual reset runs server-side via
  // Admin SDK, which clears the marker). We do NOT dictate any temp password to the teacher.
  async function confirmResetStudentPassword() {
    if (!studentToReset) return
    try {
      await updateDoc(doc(db, 'students', studentToReset.id), {
        resetPassword: true,
      })
      setGroupStudents((prev) =>
        prev.map((s) => s.id === studentToReset.id ? { ...s, resetPassword: true } : s)
      )
      setResetPwdResult({ student: studentToReset })
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setStudentToReset(null)
    }
  }

  async function confirmDeleteStudent() {
    if (!studentToDelete) return
    setSavingStudent(true)
    try {
      // Remove this enrollment's submissions first so none are orphaned.
      await deleteSubmissionsByStudent(studentToDelete.id)
      await deleteDoc(doc(db, 'students', studentToDelete.id))
      const remaining = groupStudents.filter((s) => s.id !== studentToDelete.id)
      const batch = writeBatch(db)
      remaining.forEach((s, i) => batch.update(doc(db, 'students', s.id), { orden: i + 1 }))
      await batch.commit()
      toast(`${studentToDelete.username} eliminado`)
      setStudentToDelete(null)
      setGroupStudents(remaining.map((s, i) => ({ ...s, orden: i + 1 })))
    } catch (err) {
      toast('Error al eliminar: ' + err.message, 'error')
    } finally {
      setSavingStudent(false)
    }
  }

  function openEditStudent(s) {
    setStudentToEdit(s)
    setEditStudentForm({
      apellidoPaterno: s.apellidoPaterno || '',
      apellidoMaterno: s.apellidoMaterno || '',
      nombre: s.nombre || '',
      comentarios: s.comentarios || '',
    })
  }

  async function saveEditStudent(e) {
    e.preventDefault()
    if (!studentToEdit) return
    setSavingStudent(true)
    try {
      const updated = {
        apellidoPaterno: editStudentForm.apellidoPaterno.trim(),
        apellidoMaterno: editStudentForm.apellidoMaterno.trim(),
        nombre: editStudentForm.nombre.trim(),
        comentarios: editStudentForm.comentarios.trim(),
      }
      await updateDoc(doc(db, 'students', studentToEdit.id), updated)
      setGroupStudents((prev) => prev.map((s) => (s.id === studentToEdit.id ? { ...s, ...updated } : s)))
      toast('Estudiante actualizado')
      setStudentToEdit(null)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingStudent(false)
    }
  }

  // Hands off to the existing reset-password / delete-confirmation modals, kept out of
  // the row itself (the teacher kept clicking it by accident, prompting students to ask
  // for a reset they didn't need) so the cascade-delete and orden re-index stay in one place.
  function requestResetFromEdit() {
    setStudentToReset(studentToEdit)
    setStudentToEdit(null)
  }

  function requestDeleteFromEdit() {
    setStudentToDelete(studentToEdit)
    setStudentToEdit(null)
  }

  function fullStudentName(s) {
    return `${s.apellidoPaterno || ''} ${s.apellidoMaterno || ''} ${s.nombre || ''}`.trim()
  }

  async function sortStudentsAlphabetically() {
    const newList = [...groupStudents].sort((a, b) =>
      fullStudentName(a).localeCompare(fullStudentName(b), 'es')
    )
    try {
      const batch = writeBatch(db)
      newList.forEach((s, i) => batch.update(doc(db, 'students', s.id), { orden: i + 1 }))
      await batch.commit()
      setGroupStudents(newList.map((s, i) => ({ ...s, orden: i + 1 })))
      toast('Estudiantes ordenados alfabéticamente')
    } catch (err) {
      toast('No se pudo ordenar: ' + err.message, 'error')
    }
  }

  function copyActivationLink() {
    navigator.clipboard.writeText(activationUrl).then(() => {
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    })
  }

  function copyAccessCode() {
    if (!subject?.accessCode) return
    navigator.clipboard.writeText(subject.accessCode).then(() => {
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    })
  }

  // ── Activity actions ───────────────────────────────────────────────
  function openAdd(parcial) {
    if (!canCreate) {
      toast('Activa tu suscripción mensual para crear nuevas actividades — toda tu información sigue disponible')
      return
    }
    setModalMode('create'); setModalParcial(parcial); setEditActivityId(null)
    setForm(EMPTY_FORM)
    setActivityExistingFiles([]); setActivityNewFiles([])
    setTipoActividad(null)
    setShowModal(true)
  }
  function openEdit(activity, labelOverride) {
    if (activity.tipo === 'evaluacion') {
      setEvalEditor({ activityId: activity.id, categoria: activity.categoria, parcial: activity.parcial, activityLabel: labelOverride || null })
      return
    }
    // Entregable (and legacy actividad/tarea) → full-screen editor
    const cat = ['actividad', 'tarea'].includes(activity.categoria) ? 'entregable' : (activity.categoria || 'entregable')
    setEntregableEditor({
      activityId: activity.id,
      parcial: activity.parcial,
      categoria: cat,
      activityLabel: labelOverride || null,
      initialExistingFiles: activity.archivosAdjuntos || [],
      initialForm: {
        nombre: activity.nombre || '',
        instrucciones: toRichHtml(activity.instrucciones || ''),
        fechaLimite: activity.fechaLimite
          ? (activity.fechaLimite.includes('T') ? activity.fechaLimite : `${activity.fechaLimite}T00:00`)
          : '',
        tiposArchivo: normalizeFileTypeKeys(activity.tiposArchivo),
        extensionesCustom: activity.extensionesCustom || '',
        oculta: activity.oculta || false,
        publishAt: activity.publishAt || '',
        publishedAt: activity.publishedAt || '',
        visibilidadMode: !activity.oculta ? 'published' : activity.publishAt ? 'schedule' : 'hide',
      },
    })
  }

  function addInstructionFiles(files) {
    const tooBig = files.find((f) => f.size > MAX_ATTACHMENT_FILE_SIZE)
    if (tooBig) { toast(`"${tooBig.name}" supera el máximo de 15 MB`, 'error'); return }
    setActivityNewFiles((prev) => [...prev, ...files])
  }

  // `index` is into the combined [existing..., new...] list rendered by
  // RichTextEditor's AttachmentList — split it back into the two arrays.
  function removeInstructionFile(index) {
    if (index < activityExistingFiles.length) {
      setActivityExistingFiles((prev) => prev.filter((_, i) => i !== index))
    } else {
      const newIndex = index - activityExistingFiles.length
      setActivityNewFiles((prev) => prev.filter((_, i) => i !== newIndex))
    }
  }

  async function handleSaveActivity(e, asDraft = false) {
    e.preventDefault()
    if (modalMode === 'create' && !canCreate) {
      toast('Activa tu suscripción mensual para crear nuevas actividades — toda tu información sigue disponible')
      return
    }
    const tiposArchivo = normalizeFileTypeKeys(form.tiposArchivo)
    if (tiposArchivo.includes(CUSTOM_FILE_TYPE) && parseCustomExts(form.extensionesCustom).length === 0) {
      toast('Escribe al menos una extensión para "Personalizado"', 'error')
      return
    }
    if (!htmlToPlainText(form.instrucciones)) {
      toast('Escribe las instrucciones de la actividad', 'error')
      return
    }
    // fechaLimite must be strictly after the effective publish datetime
    const now = new Date()
    const nowIso = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
    if (!asDraft) {
      // A scheduled publication must be in the future
      if (form.visibilidadMode === 'schedule') {
        if (!form.publishAt) { toast('Elige la fecha y hora de publicación', 'error'); return }
        if (form.publishAt <= nowIso) {
          toast('La fecha de publicación programada debe ser posterior a este momento', 'error'); return
        }
      }
      const effectivePublishAt =
        form.visibilidadMode === 'show'     ? nowIso :
        form.visibilidadMode === 'schedule' ? (form.publishAt || null) :
        (form.publishedAt || null)
      if (form.fechaLimite && effectivePublishAt && form.fechaLimite <= effectivePublishAt) {
        toast('La fecha límite debe ser posterior a la fecha de publicación', 'error')
        return
      }
    }
    setSaving(true)
    try {
      const uploaded = await Promise.all(
        activityNewFiles.map(async (file) => ({
          url: await uploadToCloudinary(file, 'evalua-facil/instrucciones-adjuntos'),
          nombre: file.name,
          tamano: file.size,
        }))
      )
      const payload = {
        nombre: form.nombre.trim(),
        categoria: form.categoria,
        maxCalif: 10,
        instrucciones: sanitizeHtml(form.instrucciones),
        archivosAdjuntos: [...activityExistingFiles, ...uploaded],
        fechaLimite: form.fechaLimite || null,
        tiposArchivo,
        extensionesCustom: tiposArchivo.includes(CUSTOM_FILE_TYPE) ? (form.extensionesCustom || '').trim() : '',
        oculta: asDraft ? true : form.visibilidadMode !== 'show',
        publishAt: !asDraft && form.visibilidadMode === 'schedule' ? (form.publishAt || null) : null,
        // publishedAt is permanent once set; only 'Publicar ahora' stamps it
        publishedAt: !asDraft && form.visibilidadMode === 'show' ? nowIso : (form.publishedAt || null),
      }
      if (modalMode === 'create') {
        // `orden` is only a sort key (Firestore gives no ordering guarantee
        // without it). The "Actividad" label (1.1, 1.2…) is presentation —
        // computed fresh from position within the parcial wherever it's shown
        // (see `activityLabelById` below) — never stored, so it can't drift.
        const orden = activities.filter((a) => a.parcial === modalParcial).length + 1
        const esEvaluacion = tipoActividad === 'cuestionario' || tipoActividad === 'examen'
        const tipo = esEvaluacion ? 'evaluacion' : 'archivo'
        const extra = esEvaluacion ? { evaluacion: EVALUACION_DEFAULTS[form.categoria] } : {}
        const ref = await addDoc(collection(db, 'activities'), {
          ...payload, ...extra, tipo, parcial: modalParcial, orden,
          asignaturaId: subjectId, docenteId: currentUser.uid, createdAt: serverTimestamp(),
        })
        setActivities((prev) => [...prev, { id: ref.id, ...payload, ...extra, tipo, parcial: modalParcial, orden, asignaturaId: subjectId, docenteId: currentUser.uid }])
        setSubmissionCounts((prev) => ({ ...prev, [ref.id]: { delivered: 0, graded: 0 } }))
        if (esEvaluacion) {
          toast('Evaluación creada — agrega tus preguntas')
          setShowModal(false); setForm(EMPTY_FORM)
          setActivityExistingFiles([]); setActivityNewFiles([])
          navigate(`/activity/${ref.id}`)
          return
        }
        toast(asDraft ? 'Borrador guardado — oculto para estudiantes' : 'Actividad creada')
      } else {
        await updateDoc(doc(db, 'activities', editActivityId), payload)
        setActivities((prev) => prev.map((a) => a.id === editActivityId ? { ...a, ...payload } : a))
        toast(asDraft ? 'Borrador guardado — oculto para estudiantes' : 'Actividad actualizada')
      }
      setShowModal(false); setForm(EMPTY_FORM)
      setActivityExistingFiles([]); setActivityNewFiles([])
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setSaving(false) }
  }

  async function handleDeleteActivity() {
    if (!deleteConfirm) return; setDeleting(true)
    try {
      // Remove this activity's submissions first so none are orphaned.
      await deleteSubmissionsByActivity(deleteConfirm.id)
      await deleteDoc(doc(db, 'activities', deleteConfirm.id))
      // Re-index `orden` for the remaining activities of the SAME parcial so the
      // sort key stays contiguous (1, 2, 3…) — the displayed "Actividad" label
      // is derived from this position wherever it's shown, never stored.
      const remaining = activities
        .filter((a) => a.id !== deleteConfirm.id && a.parcial === deleteConfirm.parcial)
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      const batch = writeBatch(db)
      const renumbered = remaining.map((a, i) => {
        const orden = i + 1
        batch.update(doc(db, 'activities', a.id), { orden })
        return { ...a, orden }
      })
      await batch.commit()
      setActivities((prev) => {
        const others = prev.filter((a) => a.id !== deleteConfirm.id && a.parcial !== deleteConfirm.parcial)
        return [...others, ...renumbered]
      })
      toast('Actividad eliminada'); setDeleteConfirm(null)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setDeleting(false) }
  }

  // ── Material de apoyo actions ───────────────────────────────────────
  // Independent entity from Activity: no maxCalif, no tiposArchivo, no
  // fechaLimite, no submissions — only a name, an optional rich-text
  // description and one or more downloadable files. Reuses the same
  // visibilidadMode/oculta/publishAt shape (and VisibilitySelect component)
  // as activities so the "show now / hide / schedule" behavior is identical.
  function openAddMaterial(parcial) {
    if (!canCreate) {
      toast('Activa tu suscripción mensual para crear nuevo material de apoyo — toda tu información sigue disponible')
      return
    }
    setMaterialModalMode('create'); setMaterialParcial(parcial); setEditMaterialId(null)
    setMaterialForm(EMPTY_MATERIAL_FORM)
    setMaterialNewFiles([]); setMaterialExistingFiles([])
    setShowMaterialModal(true)
  }

  function openEditMaterial(material) {
    setMaterialModalMode('edit'); setMaterialParcial(material.parcial); setEditMaterialId(material.id)
    setMaterialForm({
      nombre: material.nombre || '',
      descripcion: material.descripcion || '',
      oculta: material.oculta || false,
      publishAt: material.publishAt || '',
      visibilidadMode: !material.oculta ? 'show' : material.publishAt ? 'schedule' : 'hide',
    })
    setMaterialNewFiles([])
    setMaterialExistingFiles(material.archivos || [])
    setShowMaterialModal(true)
  }

  function addMaterialFiles(files) {
    const tooBig = files.find((f) => f.size > MAX_ATTACHMENT_FILE_SIZE)
    if (tooBig) { toast(`"${tooBig.name}" supera el máximo de 15 MB`, 'error'); return }
    setMaterialNewFiles((prev) => [...prev, ...files])
  }

  async function handleSaveMaterial(e) {
    e.preventDefault()
    if (materialModalMode === 'create' && !canCreate) {
      toast('Activa tu suscripción mensual para crear nuevo material de apoyo — toda tu información sigue disponible')
      return
    }
    if (!materialForm.nombre.trim()) { toast('Escribe un nombre para el material', 'error'); return }
    if (materialExistingFiles.length === 0 && materialNewFiles.length === 0) {
      toast('Agrega al menos un archivo', 'error'); return
    }
    setSavingMaterial(true)
    try {
      const uploaded = await Promise.all(
        materialNewFiles.map(async (file) => ({
          url: await uploadToCloudinary(file, 'evalua-facil/materiales'),
          nombre: file.name,
          tamano: file.size,
        }))
      )
      const archivos = [...materialExistingFiles, ...uploaded]
      const payload = {
        nombre: materialForm.nombre.trim(),
        descripcion: sanitizeHtml(materialForm.descripcion),
        archivos,
        oculta: materialForm.oculta || !!materialForm.publishAt,
        publishAt: materialForm.publishAt || null,
      }
      if (materialModalMode === 'create') {
        const orden = materials.filter((m) => m.parcial === materialParcial).length + 1
        const ref = await addDoc(collection(db, 'materials'), {
          ...payload, parcial: materialParcial, orden,
          asignaturaId: subjectId, docenteId: currentUser.uid, createdAt: serverTimestamp(),
        })
        setMaterials((prev) => [...prev, { id: ref.id, ...payload, parcial: materialParcial, orden, asignaturaId: subjectId, docenteId: currentUser.uid }])
        toast('Material agregado')
      } else {
        await updateDoc(doc(db, 'materials', editMaterialId), payload)
        setMaterials((prev) => prev.map((m) => m.id === editMaterialId ? { ...m, ...payload } : m))
        toast('Material actualizado')
      }
      setShowMaterialModal(false); setMaterialForm(EMPTY_MATERIAL_FORM)
      setMaterialNewFiles([]); setMaterialExistingFiles([])
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setSavingMaterial(false) }
  }

  async function handleDeleteMaterial() {
    if (!deleteMaterialConfirm) return; setDeletingMaterial(true)
    try {
      await deleteDoc(doc(db, 'materials', deleteMaterialConfirm.id))
      setMaterials((prev) => prev.filter((m) => m.id !== deleteMaterialConfirm.id))
      toast('Material eliminado'); setDeleteMaterialConfirm(null)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setDeletingMaterial(false) }
  }

  // Same visibility toggle activities already have ("Activar para alumnos" /
  // "Ocultar para alumnos" without opening the full edit form).
  async function hideMaterial(m) {
    const payload = { oculta: true, publishAt: null }
    await updateDoc(doc(db, 'materials', m.id), payload)
    setMaterials((prev) => prev.map((x) => x.id === m.id ? { ...x, ...payload } : x))
  }
  async function showMaterialNow(m) {
    const payload = { oculta: false, publishAt: null }
    await updateDoc(doc(db, 'materials', m.id), payload)
    setMaterials((prev) => prev.map((x) => x.id === m.id ? { ...x, ...payload } : x))
  }

  function handleToggleArchive() {
    if (!subject) return
    if (subject.archived) {
      // Unarchiving → open restore modal (edit data + palette + options)
      setUnarchiveStudents('keep')
      setUnarchiveActivities('keep')
      setUnarchiveEdits({
        nombre: subject.nombre || '',
        grupo: subject.grupo || '',
        fechaInicio: subject.fechaInicio || '',
        fechaFin: subject.fechaFin || '',
        parciales: String(subject.parciales || 3),
        colorPalette: subject.colorPalette || 'default',
        icon: subject.icon || 'book',
      })
      setShowUnarchiveModal(true)
    } else {
      // Archiving → ask whether to export the entregas as a ZIP first
      setArchiveExportChoice('save')
      setShowArchiveModal(true)
    }
  }

  // Archives the subject. Archived subjects keep only the course "skeleton"
  // (subject + activities + students), NOT the entregas, which are optionally
  // exported as a ZIP first.
  async function handleArchiveConfirm() {
    setArchiving(true)
    try {
      if (archiveExportChoice === 'save') {
        setZipDownloading(true)
        setZipProgress({ done: 0, total: 0 })
        try {
          const students = await ensureGroupStudents()
          const rawDocs = await fetchSubmissionsForActivities(activities.map((a) => a.id))
          const submissions = rawDocs.map((d) => ({ id: d.id, ...d.data() }))
          const jobs = buildJobsForSubject({ subject, activities, submissions, students })
          if (jobs.length > 0) {
            await downloadSubmissionsZip({
              zipName: subjectDisplayName(subject),
              jobs,
              onProgress: (done, total) => setZipProgress({ done, total }),
            })
          }
        } finally {
          setZipDownloading(false)
          setZipProgress({ done: 0, total: 0 })
        }
      }
      // Delete the entregas (keep the skeleton), then archive.
      await deleteSubjectSubmissions(subjectId)
      await updateDoc(doc(db, 'subjects', subjectId), { archived: true })
      setSubject((s) => ({ ...s, archived: true }))
      setGradeSubMap({})
      setGradesLoaded(false)
      setShowArchiveModal(false)
      toast(archiveExportChoice === 'save' ? 'Asignatura archivada (entregas descargadas)' : 'Asignatura archivada')
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setArchiving(false) }
  }

  async function handleUnarchiveConfirm() {
    const newParciales = parseInt(unarchiveEdits.parciales) || 3
    if (activities.some((a) => a.parcial > newParciales)) {
      toast(`Hay actividades en parciales superiores a ${newParciales}. Elimínalas primero.`, 'error')
      return
    }
    setUnarchivedSaving(true)
    try {
      if (unarchiveStudents === 'reset') {
        await deleteSubjectStudents(subjectId)
        setGroupStudents([])
        setGroupStudentsLoaded(false)
        setGradesLoaded(false)
        setGradeSubMap({})
      }
      const updates = {
        archived: false,
        nombre: unarchiveEdits.nombre.trim() || subject.nombre,
        grupo: unarchiveEdits.grupo.trim(),
        fechaInicio: unarchiveEdits.fechaInicio || '',
        fechaFin: unarchiveEdits.fechaFin || '',
        parciales: newParciales,
        colorPalette: unarchiveEdits.colorPalette || 'default',
        icon: unarchiveEdits.icon || 'book',
      }
      if (unarchiveActivities !== 'keep') {
        const batch = writeBatch(db)
        activities.forEach((a) => batch.update(doc(db, 'activities', a.id), {
          oculta: unarchiveActivities === 'hide',
          publishAt: null,
        }))
        await batch.commit()
        setActivities((prev) => prev.map((a) => ({ ...a, oculta: unarchiveActivities === 'hide', publishAt: null })))
      }
      await updateDoc(doc(db, 'subjects', subjectId), updates)
      setSubject((s) => ({ ...s, ...updates }))
      toast('Asignatura restaurada')
      setShowUnarchiveModal(false)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setUnarchivedSaving(false) }
  }

  // ── Activity visibility ────────────────────────────────────────────
  async function hideActivity(a) {
    try {
      await updateDoc(doc(db, 'activities', a.id), { oculta: true, publishAt: null })
      setActivities((prev) => prev.map((act) => act.id === a.id ? { ...act, oculta: true, publishAt: null } : act))
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // ── Parcial visibility (hides every activity in it from students at once) ──
  async function toggleParcialVisibility(p) {
    const hidden = subject?.parcialesOcultos || []
    const next = hidden.includes(p) ? hidden.filter((x) => x !== p) : [...hidden, p]
    try {
      await updateDoc(doc(db, 'subjects', subjectId), { parcialesOcultos: next })
      setSubject((s) => ({ ...s, parcialesOcultos: next }))
      toast(next.includes(p) ? `Parcial ${p} oculto para estudiantes` : `Parcial ${p} visible para estudiantes`)
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // Eye toggle: show a hidden (already published) activity immediately —
  // no modal, mirror of hideActivity.
  async function showActivityNow(act) {
    try {
      await updateDoc(doc(db, 'activities', act.id), { oculta: false, publishAt: null })
      setActivities((prev) => prev.map((a) => a.id === act.id ? { ...a, oculta: false, publishAt: null } : a))
      toast('Actividad visible para estudiantes')
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // Duplicate an activity as a DRAFT copy: same instructions, file types,
  // attachments and evaluación config/preguntas — but hidden, unpublished,
  // unnumbered and without deadline, ready to rename and publish later.
  async function handleDuplicateActivity() {
    if (!duplicateConfirm) return
    setDuplicating(true)
    try {
      const src = duplicateConfirm
      const orden = activities.filter((a) => a.parcial === src.parcial).length + 1
      const copy = {
        nombre: `${src.nombre} (copia)`,
        categoria: src.categoria || 'entregable',
        maxCalif: src.maxCalif ?? 10,
        instrucciones: src.instrucciones || '',
        archivosAdjuntos: src.archivosAdjuntos || [],
        fechaLimite: null,
        tiposArchivo: src.tiposArchivo || [],
        extensionesCustom: src.extensionesCustom || '',
        tipo: src.tipo || 'archivo',
        ...(src.evaluacion ? { evaluacion: src.evaluacion } : {}),
        oculta: true, publishAt: null, publishedAt: null,
        parcial: src.parcial, orden,
        asignaturaId: subjectId, docenteId: currentUser.uid, createdAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'activities'), copy)
      // Evaluaciones: also clone the question bank of this activity
      if (src.tipo === 'evaluacion') {
        const snap = await getDocs(collection(db, 'activities', src.id, 'preguntas'))
        await Promise.all(snap.docs.map((d) => addDoc(collection(db, 'activities', ref.id, 'preguntas'), d.data())))
      }
      setActivities((prev) => [...prev, { id: ref.id, ...copy, createdAt: null }])
      setSubmissionCounts((prev) => ({ ...prev, [ref.id]: { delivered: 0, graded: 0 } }))
      toast('Copia creada como borrador — edítala para cambiarle el nombre')
      setDuplicateConfirm(null)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setDuplicating(false) }
  }

  // First publication of a draft (no publishedAt yet): the eye asks for
  // confirmation and stamps the publication datetime.
  async function publishDraftNow() {
    if (!publishDraftConfirm) return
    const d = new Date()
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    try {
      await updateDoc(doc(db, 'activities', publishDraftConfirm.id), { oculta: false, publishAt: null, publishedAt: iso })
      setActivities((prev) => prev.map((a) => a.id === publishDraftConfirm.id ? { ...a, oculta: false, publishAt: null, publishedAt: iso } : a))
      toast('Actividad publicada para estudiantes')
      setPublishDraftConfirm(null)
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // ── Subject CRUD ───────────────────────────────────────────────────
  function openEditSubject() {
    setEditSubjectForm({
      nombre: subject?.nombre || '',
      grupo: subject?.grupo || '',
      fechaInicio: subject?.fechaInicio || '',
      fechaFin: subject?.fechaFin || '',
      parciales: String(subject?.parciales || 3),
      colorPalette: subject?.colorPalette || 'default',
      icon: subject?.icon || 'book',
    })
    setShowEditSubjectModal(true)
  }

  async function handleEditSubject(e) {
    e.preventDefault()
    const newParciales = parseInt(editSubjectForm.parciales) || 3
    const hasActsAbove = activities.some((a) => a.parcial > newParciales)
    if (hasActsAbove) {
      toast(`Hay actividades en parciales superiores a ${newParciales}. Elimínalas primero.`, 'error')
      return
    }
    setEditingSubject(true)
    try {
      const subjUpdates = {
        nombre: editSubjectForm.nombre.trim(),
        grupo: editSubjectForm.grupo.trim(),
        fechaInicio: editSubjectForm.fechaInicio || '',
        fechaFin: editSubjectForm.fechaFin || '',
        parciales: newParciales,
        colorPalette: editSubjectForm.colorPalette || 'default',
        icon: editSubjectForm.icon || 'book',
      }
      await updateDoc(doc(db, 'subjects', subjectId), subjUpdates)
      setSubject((s) => ({ ...s, ...subjUpdates }))
      toast('Asignatura actualizada')
      setShowEditSubjectModal(false)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setEditingSubject(false) }
  }

  async function handleDeleteSubject() {
    if (deleteSubjectConfirmText !== subject?.nombre) {
      toast('El nombre no coincide', 'error'); return
    }
    setDeletingSubject(true)
    try {
      await deleteSubjectCascade(subjectId)
      toast('Asignatura eliminada')
      navigate('/dashboard')
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setDeletingSubject(false) }
  }

  function openCopyModal() {
    if (!canCreate) {
      toast('Activa tu suscripción mensual para crear nuevas asignaturas — toda tu información sigue disponible')
      return
    }
    setCopyForm({ nombre: subject?.nombre || '', grupo: subject?.grupo || '', keepStudents: false, colorPalette: subject?.colorPalette || 'default', icon: subject?.icon || 'book' })
    setCopyFechas({ fechaInicio: subject?.fechaInicio || '', fechaFin: subject?.fechaFin || '' })
    setShowCopyModal(true)
  }

  async function handleCopySubject(e) {
    e.preventDefault()
    setCopyingSubject(true)
    try {
      const newId = await copySubject({
        sourceSubjectId: subjectId,
        nombre: copyForm.nombre.trim(),
        grupo: copyForm.grupo.trim(),
        fechaInicio: copyFechas.fechaInicio || '',
        fechaFin: copyFechas.fechaFin || '',
        parciales: subject?.parciales || 3,
        colorPalette: copyForm.colorPalette || 'default',
        icon: copyForm.icon || 'book',
        keepStudents: copyForm.keepStudents,
        docenteId: currentUser.uid,
        escuelaId: userProfile?.escuelaId || 'sin-escuela',
      })
      toast('Asignatura duplicada')
      setShowCopyModal(false)
      navigate(`/subject/${newId}`)
    } catch (err) { toast('Error al duplicar: ' + err.message, 'error') }
    finally { setCopyingSubject(false) }
  }

  async function handleExport() {
    if (!subject) return; setExporting(true)
    try {
      let students = groupStudents
      let subMap = gradeSubMap
      if (!groupStudentsLoaded) {
        const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
        students = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        setGroupStudents(students); setGroupStudentsLoaded(true)
      }
      if (!gradesLoaded) {
        const subDocs = await fetchSubmissionsForActivities(activities.map((a) => a.id))
        subMap = {}
        subDocs.forEach((d) => { const data = d.data(); subMap[`${data.alumnoId}-${data.actividadId}`] = data })
        setGradeSubMap(subMap); setGradesLoaded(true)
      }
      exportSubjectGrades({
        subject, activities, students,
        submissions: Object.values(subMap),
      })
    } catch (err) { toast('Error al exportar: ' + err.message, 'error') }
    finally { setExporting(false) }
  }

  async function handleExportQRPDF() {
    if (!subject) return
    setExportingPdf(true)
    try {
      await exportQRPDF({ subject, activationUrl })
    } catch (err) {
      toast('Error al exportar PDF: ' + err.message, 'error')
    } finally {
      setExportingPdf(false)
    }
  }

  // R12: grades as PDF (same data as the Excel export).
  async function handleExportGradesPDF() {
    if (!subject) return; setExportingGradesPdf(true)
    try {
      let students = groupStudents
      let subMap = gradeSubMap
      if (!groupStudentsLoaded) {
        const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
        students = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        setGroupStudents(students); setGroupStudentsLoaded(true)
      }
      if (!gradesLoaded) {
        const subDocs = await fetchSubmissionsForActivities(activities.map((a) => a.id))
        subMap = {}
        subDocs.forEach((d) => { const data = d.data(); subMap[`${data.alumnoId}-${data.actividadId}`] = data })
        setGradeSubMap(subMap); setGradesLoaded(true)
      }
      await exportSubjectGradesPDF({ subject, activities, students, submissions: Object.values(subMap) })
    } catch (err) { toast('Error al exportar PDF: ' + err.message, 'error') }
    finally { setExportingGradesPdf(false) }
  }

  // R16: download the access list (#, name, username + the class access code). No temp
  // passwords — each student sets their own password on first sign-in.
  async function handleGenerateCredentials() {
    if (!subject) return
    setGeneratingCredentials(true)
    try {
      let students = groupStudents
      if (!groupStudentsLoaded) {
        const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
        students = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        setGroupStudents(students); setGroupStudentsLoaded(true)
      }
      if (students.length === 0) { toast('No hay estudiantes en esta asignatura', 'error'); return }

      await exportCredentialsPDF({ subject, students, activationUrl })
      toast('Lista de acceso descargada')
      setShowCredentialsModal(false)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setGeneratingCredentials(false) }
  }

  // ── Computed ───────────────────────────────────────────────────────
  const PARCIALES = Array.from({ length: subject?.parciales || 3 }, (_, i) => i + 1)

  // "Actividad" labels (1.1, 1.2…) are presentation, not stored data — always
  // derived from each activity's position within its parcial in the current
  // `activities` list (kept sorted by `orden`). Computing this fresh on every
  // render means the displayed sequence can never drift out of order/gapped,
  // regardless of creation order, deletions, or stale stored values.
  // Drafts (hidden, never published, not scheduled) get NO number until they
  // are published — the sequence belongs to published activities only, so a
  // deleted publication's number passes to the next thing published.
  const isDraftActivity = (a) => a.oculta && !a.publishedAt && !a.publishAt
  const activityLabelById = {}
  PARCIALES.forEach((p) => {
    activities.filter((a) => a.parcial === p && !isDraftActivity(a)).forEach((a, i) => {
      activityLabelById[a.id] = `${p}.${i + 1}`
    })
  })

  // Preview of the auto-assigned "Actividad" label shown (read-only) in the modal.
  const previewActividad = modalMode === 'create'
    ? `${modalParcial}.${activities.filter((a) => a.parcial === modalParcial && !isDraftActivity(a)).length + 1}`
    : (activityLabelById[editActivityId] || '—')

  const filteredGradeStudents = groupStudents.filter((s) => matchesStudentSearch(s, searchGrade))

  // Drafts don't grade anything — keep them out of the Calificaciones table
  const tableParcials = PARCIALES.map((p) => ({
    p, acts: activities.filter((a) => a.parcial === p && !isDraftActivity(a)),
  })).filter((pd) => pd.acts.length > 0)

  // Sequential index per real grade column (activities + parcial averages +
  // final average), shared by header and body cells via data-col so
  // handleGradeTableHover can tell which column is under the cursor.
  let _colIdx = 0
  const colIndexByKey = {}
  tableParcials.forEach(({ p, acts }) => {
    acts.forEach((a) => { colIndexByKey[`act-${a.id}`] = _colIdx++ })
    colIndexByKey[`avg-${p}`] = _colIdx++
  })
  colIndexByKey.final = _colIdx++

  // Event delegation: one listener on the table instead of one per cell.
  // Reads data-row/data-col off the hovered element (or its closest
  // ancestor that has them) and only updates state when they actually
  // change, so moving within the same cell doesn't re-render.
  const handleGradeTableHover = (e) => {
    const cell = e.target.closest('[data-col]')
    const row = e.target.closest('[data-row]')
    const col = cell ? Number(cell.getAttribute('data-col')) : null
    const rowIdx = row ? Number(row.getAttribute('data-row')) : null
    setHoverGradeCell((prev) => (prev.row === rowIdx && prev.col === col ? prev : { row: rowIdx, col }))
  }
  const handleGradeTableLeave = () => setHoverGradeCell({ row: null, col: null })
  const gradeHeaderColBg = (colIdx) => (hoverGradeCell.col === colIdx ? 'bg-[var(--accent-tint)]' : '')
  const gradeBodyCellBg = (colIdx, rowIdx) => {
    if (hoverGradeCell.col !== colIdx) return ''
    return hoverGradeCell.row === rowIdx
      ? 'bg-[var(--accent-tint-strong)] ring-1 ring-inset ring-[var(--accent)]'
      : 'bg-[var(--accent-tint)]'
  }

  // ── PONDERACIÓN (optional per-activity weights) ────────────────────
  const ponderacionOn = !!subject?.ponderacionActivada
  async function togglePonderacion() {
    const next = !ponderacionOn
    // Going BACK to simple average when weights already exist needs an
    // explicit confirmation — the captured weights are ERASED
    const conPeso = activities.filter((a) => pesoDe(a) > 0)
    if (!next && conPeso.length > 0) {
      const ok = confirm('Al menos una actividad ya tiene ponderación. ¿Volver a promedio simple? Los pesos ya capturados se borrarán y todas las actividades valdrán lo mismo.')
      if (!ok) return
    }
    try {
      await updateDoc(doc(db, 'subjects', subjectId), { ponderacionActivada: next })
      if (!next && conPeso.length > 0) {
        const batch = writeBatch(db)
        conPeso.forEach((a) => batch.update(doc(db, 'activities', a.id), { pesoCalificacion: null }))
        await batch.commit()
        setActivities((prev) => prev.map((x) => x.pesoCalificacion != null ? { ...x, pesoCalificacion: null } : x))
        setPesoEdits({})
      }
      setSubject((s) => ({ ...s, ponderacionActivada: next }))
      toast(next
        ? 'Ponderación activada — asigna un peso del 1 al 10 a cada actividad'
        : 'Promedio simple activado — los pesos se borraron')
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }
  // Remaining points to reach 10 in the parcial, excluding one activity —
  // offered as the default when the teacher focuses an empty weight box
  function pesoRestante(acts, exceptId) {
    const sum = acts.reduce((t, x) => {
      if (x.id === exceptId) return t
      const edit = pesoEdits[x.id]
      const v = edit !== undefined ? parseFloat(edit) : parseFloat(x.pesoCalificacion)
      return t + (isNaN(v) || v < 0 ? 0 : v)
    }, 0)
    return Math.max(0, parseFloat((10 - sum).toFixed(2)))
  }

  async function savePeso(a) {
    const raw = pesoEdits[a.id]
    if (raw === undefined) return
    let num = parseFloat(raw)
    if (isNaN(num) || num < 0) num = null
    if (num !== null) {
      // The parcial's weights can NEVER exceed 10 — clamp to what's left
      const actsParcial = activities.filter((x) => x.parcial === a.parcial && !isDraftActivity(x))
      const restante = pesoRestante(actsParcial, a.id)
      if (num > restante) {
        num = restante
        toast(`El peso se ajustó a ${restante} — la suma del parcial no puede pasar de 10`)
      }
    }
    setPesoEdits((f) => { const n = { ...f }; delete n[a.id]; return n })
    if ((a.pesoCalificacion ?? null) === num) return
    try {
      await updateDoc(doc(db, 'activities', a.id), { pesoCalificacion: num })
      setActivities((prev) => prev.map((x) => x.id === a.id ? { ...x, pesoCalificacion: num } : x))
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // Pre-compute grade rows
  const gradeRows = filteredGradeStudents.map((s) => {
    const parcialData = tableParcials.map(({ p, acts }) => {
      const grades = acts.map((a) => {
        const sub = gradeSubMap[`${s.id}-${a.id}`]
        return sub?.calificacion != null
          ? parseFloat(((sub.calificacion / (a.maxCalif || 10)) * 10).toFixed(1))
          : null
      })
      const rawAvg = promedioParcial(acts, grades, ponderacionOn)
      const avg = rawAvg !== null ? parseFloat(rawAvg.toFixed(1)) : null
      return { p, grades, avg }
    })
    const validAvgs = parcialData.map((pd) => pd.avg).filter((a) => a !== null)
    const finalAvg = validAvgs.length
      ? parseFloat((validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length).toFixed(1))
      : null
    return { s, parcialData, finalAvg }
  })

  const activationUrl = `${window.location.origin}/activate/${subject?.accessCode}`
  const filteredAlumnos = groupStudents.filter((s) =>
    matchesStudentSearch(s, searchAlumnos) ||
    (s.username || '').toLowerCase().includes(searchAlumnos.trim().toLowerCase())
  )

  if (loading) return (
    <TeacherLayout><div className="flex justify-center py-20"><Spinner size="lg" /></div></TeacherLayout>
  )

  return (
    <TeacherLayout>
      <div data-subject-palette={subject?.colorPalette || 'default'}>
      <div className={TEACHER_CONTAINER}>

        {/* ── Header ── */}
        <div className="bg-surface-card border-b border-outline-variant px-4 py-2">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate('/dashboard')} className="p-2 -ml-2 text-slate-400 hover:text-muted rounded flex-shrink-0">
              <ArrowLeft size={22} />
            </button>
            <div className="w-9 h-9 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
              <SubjectIcon iconKey={subject?.icon} size={20} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-on-surface truncate">
                  {subjectDisplayName(subject)}
                  {userProfile?.nombreMostrar && <span className="text-slate-500 font-normal"> — {userProfile.nombreMostrar}</span>}
                </h1>
                {subject?.archived && (
                  <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full flex-shrink-0">Archivada</span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons — wrap on mobile so they never overflow */}
          <div className="flex flex-wrap items-center gap-1 mt-2">
            <button type="button" onClick={() => setShowQR(true)}
              data-tooltip="Código QR de registro al curso para estudiantes"
              className="p-2 text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
              <QrCode size={21} />
            </button>
            <button type="button" onClick={copyActivationLink}
              data-tooltip="Copiar link de registro al curso para estudiantes"
              className={`p-2 rounded transition-colors flex-shrink-0 ${copiedLink ? 'text-emerald-600 bg-emerald-50' : 'text-accent hover:bg-[var(--accent-medium)]'}`}>
              {copiedLink ? <CheckIcon size={21} /> : <Link size={21} />}
            </button>
            <button type="button" onClick={copyAccessCode}
              data-tooltip="Copiar código de acceso para estudiantes"
              className={`flex items-center gap-2 px-2 py-1.5 rounded transition-all duration-200 flex-shrink-0 font-mono font-bold text-3xl ${copiedCode ? 'text-emerald-600 bg-emerald-50' : 'text-accent hover:bg-[var(--accent-medium)]'}`}>
              {copiedCode
                ? <><CheckIcon size={24} className="animate-bounce flex-shrink-0" /><span>Copiado</span></>
                : <span>{subject?.accessCode}</span>}
            </button>
            <div className="flex-1" />
            <button type="button" onClick={openEditSubject}
              data-tooltip="Editar los datos de la asignatura (nombre, grupo, color, icono…)"
              className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
              <Pencil size={21} />
            </button>
            <button type="button" onClick={openCopyModal}
              data-tooltip="Duplicar esta asignatura (con o sin la lista de estudiantes)"
              className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
              <Copy size={21} />
            </button>
            <button type="button" onClick={handleToggleArchive} disabled={archiving}
              data-tooltip={subject?.archived ? 'Restaurar asignatura (vuelve a tus asignaturas activas)' : 'Archivar asignatura (guarda el esqueleto; elimina las entregas)'}
              className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors disabled:opacity-50 flex-shrink-0">
              {subject?.archived ? <ArchiveRestore size={21} /> : <Archive size={21} />}
            </button>
            <button type="button" onClick={() => { setDeleteSubjectConfirmText(''); setShowDeleteSubjectConfirm(true) }}
              data-tooltip="Eliminar la asignatura permanentemente (no se puede deshacer)"
              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0">
              <Trash2 size={21} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-2 bg-surface-container p-1 rounded">
            {['actividades', 'calificaciones', 'alumnos', 'recursos'].map((t) => (
              <button type="button" key={t} onClick={() => switchTab(t)}
                className={`flex-1 py-2 text-xs sm:text-sm font-medium rounded transition-colors ${
                  activeTab === t ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'
                }`}>
                {t === 'actividades' ? 'Actividades' : t === 'calificaciones' ? 'Calificaciones' : t === 'alumnos' ? 'Estudiantes' : 'Recursos'}
              </button>
            ))}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════
            TAB: ACTIVIDADES
        ══════════════════════════════════════════════════════════ */}
        {activeTab === 'actividades' && (
          <div className={`px-4 py-2 space-y-2 ${TEACHER_CONTAINER_NARROW}`}>
            {PARCIALES.map((p) => {
              const acts = activities.filter((a) => a.parcial === p)
              const mats = materials.filter((m) => m.parcial === p)
              const isOpen = openParcial === p
              const parcialOculto = (subject?.parcialesOcultos || []).includes(p)
              return (
                // Open parcial gets the same accent container treatment as the
                // Preguntas/Configuración sections — it's obvious you're inside it
                <div key={p} className="bg-surface-card rounded-card overflow-hidden shadow-card"
                  style={isOpen ? { border: '1px solid var(--accent)' } : undefined}>
                  <div className="w-full flex items-center gap-1"
                    style={isOpen ? { background: 'var(--accent-light)', borderBottom: '1px solid var(--accent)' } : undefined}>
                    <button type="button" onClick={() => setOpenParcial(isOpen ? 0 : p)}
                      className="flex-1 min-w-0 px-4 py-2 flex items-center gap-2 hover:bg-[var(--accent-medium)] transition-colors text-left">
                      <div className={`w-10 h-10 rounded flex items-center justify-center flex-shrink-0 ${parcialOculto ? 'bg-surface-container' : 'bg-accent-light'}`}>
                        <span className={`font-bold text-sm ${parcialOculto ? 'text-slate-400' : 'text-accent'}`}>{p}</span>
                      </div>
                      <div className="text-left min-w-0">
                        <p className={`font-semibold text-base leading-tight truncate ${parcialOculto ? 'text-slate-400' : 'text-on-surface'}`}>
                          Parcial {p}{parcialOculto && <span className="text-xs font-normal text-slate-400"> · oculto a estudiantes</span>}
                        </p>
                        <p className="text-sm text-slate-500 leading-tight -mt-0.5">{acts.length} actividad{acts.length !== 1 ? 'es' : ''}</p>
                      </div>
                    </button>
                    <button type="button"
                      onClick={() => toggleParcialVisibility(p)}
                      data-tooltip={parcialOculto ? 'Mostrar este parcial a los estudiantes' : 'Ocultar este parcial a los estudiantes'}
                      data-tooltip-pos="left"
                      className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0"
                    >
                      {parcialOculto ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                    <button type="button" onClick={() => setOpenParcial(isOpen ? 0 : p)} className="p-2 mr-2 flex-shrink-0">
                      {isOpen ? <ChevronUp size={20} className="text-slate-400" /> : <ChevronDown size={20} className="text-slate-400" />}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="border-t border-outline-variant pr-4 py-2">
                      <div className="ml-3 pl-3 border-l-2 border-accent space-y-1.5">
                      {acts.length === 0 && (
                        <p className="text-slate-400 text-sm text-center py-2">Sin actividades</p>
                      )}
                      {acts.map((a) => {
                        const counts = submissionCounts[a.id] || {}
                        const visState = activityVisibilityState(a, parcialOculto)
                        const isHidden = visState !== 'visible'
                        // Distinct icon per activity type so they're recognizable at a glance
                        const ActIcon = a.categoria === 'examen' ? GraduationCap
                          : a.categoria === 'cuestionario' ? ListChecks
                          : FileText
                        return (
                          <div key={a.id} className={`flex items-center gap-1 w-full rounded border bg-surface-card transition-colors duration-200 ${isHidden ? 'border-outline-variant opacity-60' : 'border-outline-variant hover:border-accent hover:bg-[var(--accent-tint)]'}`}>
                            {/* A draft has nothing to grade — its row opens the editor instead */}
                            <button type="button"
                              onClick={() => isDraftActivity(a) ? openEdit(a, activityLabelById[a.id]) : navigate(`/activity/${a.id}`)}
                              data-tooltip-follow={isDraftActivity(a) ? 'Editar borrador' : 'Calificar'}
                              className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 text-left">
                              <ActIcon size={20} className={`flex-shrink-0 ${isHidden ? 'text-slate-300' : a.categoria === 'examen' ? 'text-accent' : a.categoria === 'cuestionario' ? 'text-emerald-600' : 'text-slate-400'}`} />
                              <div className="flex-1 min-w-0">
                                <p className={`text-base font-medium leading-tight truncate ${isHidden ? 'text-slate-400' : 'text-on-surface'}`}>
                                  {activityLabelById[a.id] && <span className="text-accent font-semibold">{activityLabelById[a.id]} · </span>}
                                  {a.nombre}
                                  <span className={`text-xs font-normal ${isHidden ? 'text-slate-300' : 'text-slate-400'}`}>
                                    {' '}({a.categoria === 'examen' ? 'Examen' : a.categoria === 'cuestionario' ? 'Cuestionario' : 'Entregable'})
                                  </span>
                                </p>
                                {(a.publishedAt || a.fechaLimite || a.publishAt || visState === 'hidden') && (
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    {a.publishedAt && (
                                      <span data-tooltip="Publicado" className="text-xs text-emerald-600 flex items-center gap-0.5">
                                        <Clock size={14} /> {formatPublishAt(a.publishedAt)}
                                      </span>
                                    )}
                                    {a.publishAt && (
                                      <span data-tooltip="Publicación programada" className="text-xs text-accent flex items-center gap-0.5">
                                        <Clock size={14} /> {formatPublishAt(a.publishAt)}
                                      </span>
                                    )}
                                    {a.fechaLimite && (
                                      <span data-tooltip="Cierre" className="text-xs text-amber-600 flex items-center gap-0.5">
                                        <Clock size={14} /> {formatDeadline(a.fechaLimite)}
                                      </span>
                                    )}
                                    {visState === 'hidden' && (
                                      <span className="text-xs bg-surface-container text-muted px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                        <EyeOff size={13} /> {(!a.publishedAt && a.oculta && !a.publishAt) ? 'Borrador' : 'Oculta'}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <span
                                  data-tooltip="Entregados"
                                  className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                  <FileCheck2 size={11} /> {counts.delivered}/{totalStudents}
                                </span>
                                <span
                                  data-tooltip="Calificados"
                                  className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                  <CheckCircle size={11} /> {counts.graded}/{counts.delivered}
                                </span>
                                <span
                                  data-tooltip="Por calificar"
                                  className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                  <Timer size={11} /> {counts.delivered - counts.graded}/{counts.delivered}
                                </span>
                              </div>
                            </button>
                            {/* Visibility toggle. Published → direct show/hide.
                                Draft (no publishedAt) → confirm first publication. */}
                            {isHidden ? (
                              <button type="button"
                                onClick={(e) => { e.stopPropagation(); a.publishedAt ? showActivityNow(a) : setPublishDraftConfirm(a) }}
                                data-tooltip={a.publishedAt ? 'Mostrar a estudiantes' : 'Publicar para estudiantes'}
                                className="p-2 text-slate-300 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0"
                              >
                                <EyeOff size={16} />
                              </button>
                            ) : (
                              <button type="button"
                                onClick={(e) => { e.stopPropagation(); hideActivity(a) }}
                                data-tooltip="Ocultar para estudiantes"
                                className="p-2 text-slate-400 hover:text-muted hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0"
                              >
                                <Eye size={16} />
                              </button>
                            )}
                            <button type="button" onClick={() => openEdit(a, activityLabelById[a.id])} data-tooltip="Editar"
                              className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0 mr-0.5">
                              <Pencil size={16} />
                            </button>
                            <button type="button" onClick={() => setDuplicateConfirm(a)} data-tooltip="Duplicar como borrador"
                              className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0 mr-0.5">
                              <Copy size={16} />
                            </button>
                            <button type="button" onClick={() => setDeleteConfirm(a)} data-tooltip="Eliminar"
                              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0 mr-1">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )
                      })}

                      {/* Materiales de apoyo — visually distinct from activities (book
                          icon, no submission/grade badges): independent entity, not an
                          "actividad sin calificación". */}
                      {mats.length > 0 && (
                        <>
                          <p className="text-xs font-semibold text-muted uppercase tracking-wide pt-1">Material de apoyo</p>
                          {mats.map((m) => {
                            const visState = activityVisibilityState(m, parcialOculto)
                            const isHidden = visState !== 'visible'
                            const isExpanded = expandedMaterialId === m.id
                            return (
                              <div key={m.id} className={`w-full rounded border bg-surface-card transition-colors duration-200 ${isHidden ? 'border-outline-variant opacity-60' : 'border-outline-variant hover:border-accent'}`}>
                                <div className="flex items-center gap-1">
                                  <button type="button" onClick={() => setExpandedMaterialId(isExpanded ? null : m.id)}
                                    className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 text-left hover:bg-[var(--accent-tint)] rounded transition-colors">
                                    <BookOpen size={20} className={`flex-shrink-0 ${isHidden ? 'text-slate-300' : 'text-amber-500'}`} />
                                    <div className="flex-1 min-w-0">
                                      <p className={`text-base font-medium leading-tight truncate ${isHidden ? 'text-slate-400' : 'text-on-surface'}`}>{m.nombre}</p>
                                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        <span className="text-xs text-slate-500 flex items-center gap-0.5">
                                          <Paperclip size={12} /> {(m.archivos || []).length} archivo{(m.archivos || []).length !== 1 ? 's' : ''}
                                        </span>
                                        {m.publishAt && (
                                          <span data-tooltip="Fecha de publicación" className="text-xs text-accent flex items-center gap-0.5">
                                            <Clock size={14} /> {formatPublishAt(m.publishAt)}
                                          </span>
                                        )}
                                        {visState === 'hidden' && (
                                          <span className="text-xs bg-surface-container text-muted px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                            <EyeOff size={13} /> Oculto
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    {isExpanded ? <ChevronUp size={18} className="text-slate-400 flex-shrink-0" /> : <ChevronDown size={18} className="text-slate-400 flex-shrink-0" />}
                                  </button>
                                  {isHidden ? (
                                    <button type="button" onClick={(e) => { e.stopPropagation(); showMaterialNow(m) }} data-tooltip="Mostrar a estudiantes"
                                      className="p-2 text-slate-300 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
                                      <EyeOff size={16} />
                                    </button>
                                  ) : (
                                    <button type="button" onClick={(e) => { e.stopPropagation(); hideMaterial(m) }} data-tooltip="Ocultar a estudiantes"
                                      className="p-2 text-slate-400 hover:text-muted hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
                                      <Eye size={16} />
                                    </button>
                                  )}
                                  <button type="button" onClick={() => openEditMaterial(m)} data-tooltip="Editar"
                                    className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0 mr-0.5">
                                    <Pencil size={16} />
                                  </button>
                                  <button type="button" onClick={() => setDeleteMaterialConfirm(m)} data-tooltip="Eliminar"
                                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0 mr-1">
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                                {isExpanded && (
                                  <div className="border-t border-outline-variant px-3 py-2 ml-9">
                                    {m.descripcion && (
                                      <div className={`text-sm text-on-surface mb-2 ${richTextContentClass}`}
                                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(m.descripcion) }} />
                                    )}
                                    <AttachmentList files={m.archivos} title={null} />
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </>
                      )}

                      <button type="button" onClick={() => openAdd(p)}
                        data-tooltip={canCreate ? undefined : 'Activa tu suscripción mensual para crear nuevas actividades'}
                        className={`w-full py-2 border-2 border-dashed rounded text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                          canCreate ? 'border-accent text-accent hover:bg-[var(--accent-medium)]' : 'border-outline-variant text-slate-400 hover:bg-[var(--accent-medium)]'
                        }`}>
                        <Plus size={17} /> Agregar actividad
                      </button>
                      <button type="button" onClick={() => openAddMaterial(p)}
                        data-tooltip={canCreate ? undefined : 'Activa tu suscripción mensual para crear nuevo material de apoyo'}
                        className={`w-full py-2 border-2 border-dashed rounded text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                          canCreate ? 'border-accent text-accent hover:bg-[var(--accent-medium)]' : 'border-outline-variant text-slate-400 hover:bg-[var(--accent-medium)]'
                        }`}>
                        <BookOpen size={17} /> Agregar material de apoyo
                      </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
            TAB: CALIFICACIONES
        ══════════════════════════════════════════════════════════ */}
        {activeTab === 'calificaciones' && (
          <div className="px-4 py-2 space-y-2">
            {/* 1 — Descargar calificaciones (Excel / PDF) */}
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Calificaciones</p>
              <div className="flex gap-2">
                <button type="button"
                  onClick={handleExport}
                  disabled={exporting}
                  data-tooltip="Descarga las calificaciones de todos los estudiantes en una hoja de Excel"
                  className="flex-1 flex items-center justify-center gap-2 py-1.5 border border-outline-variant rounded text-sm text-muted hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-40"
                >
                  {exporting ? <Spinner size="sm" /> : <FileSpreadsheet size={17} />} Excel
                </button>
                <button type="button"
                  onClick={handleExportGradesPDF}
                  disabled={exportingGradesPdf}
                  data-tooltip="Descarga las calificaciones de todos los estudiantes en un PDF imprimible"
                  className="flex-1 flex items-center justify-center gap-2 py-1.5 border border-outline-variant rounded text-sm text-muted hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-40"
                >
                  {exportingGradesPdf ? <Spinner size="sm" /> : <FileText size={17} />} PDF
                </button>
              </div>
            </div>

            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={searchGrade} onChange={(e) => setSearchGrade(e.target.value)}
                placeholder="Buscar por nombre o por número de lista…"
                className="w-full pl-9 pr-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface-card" />
            </div>

            {loadingGrades ? (
              <div className="flex justify-center py-12"><Spinner size="lg" /></div>
            ) : activities.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-12">No hay actividades en esta asignatura</p>
            ) : groupStudents.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-12">No hay estudiantes en este grupo</p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-card shadow-card bg-surface-card -mx-4 sm:mx-0">
                  {/* table-fixed + explicit narrow per-column widths (no forced
                      min-w on the table itself) — the table only takes the
                      width its columns actually need, so the wrapper's
                      overflow-x-auto only scrolls once real content overflows,
                      never just because of an arbitrary minimum. */}
                  <table
                    className="grades-table text-xs border-collapse table-fixed"
                    onMouseOver={handleGradeTableHover}
                    onMouseLeave={handleGradeTableLeave}
                  >
                    {/* table-fixed reads column widths from the first row, but
                        that row has colSpan'd "Parcial" headers — an explicit
                        colgroup is the only reliable way to size each real
                        column regardless of the header's rowspan/colspan. */}
                    <colgroup>
                      <col className="w-8" />
                      <col className="w-[150px]" />
                      {tableParcials.map(({ p, acts }) => [
                        ...acts.map((a) => <col key={a.id} className="w-9" />),
                        <col key={`avgcol-${p}`} className="w-14" />,
                      ])}
                      <col className="w-14" />
                    </colgroup>
                    <thead>
                      <tr className="bg-accent-light border-b border-outline-variant">
                        <th className="sticky left-0 z-10 bg-accent-light w-8 px-1 py-1.5 border-r border-outline-variant" />
                        <th className="sticky left-8 z-10 bg-accent-light w-[150px] px-1 py-1 text-left border-r border-outline-variant">
                          <button type="button" onClick={togglePonderacion}
                            data-tooltip-follow="Cada actividad vale un peso"
                            className={`w-full px-1 py-1 rounded text-[10px] font-bold uppercase tracking-wide transition-colors ${ponderacionOn
                              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                              : 'bg-accent text-white hover:bg-accent-hover'}`}>
                            {ponderacionOn ? 'Volver a promedio simple' : 'Activar ponderación'}
                          </button>
                        </th>
                        {tableParcials.map(({ p, acts }) => (
                          <th key={p} colSpan={acts.length + 1}
                            className="px-1.5 py-1.5 font-semibold text-accent text-center border-l border-outline-variant whitespace-nowrap">
                            Parcial {p}
                          </th>
                        ))}
                        <th className="w-14 px-1.5 py-1.5 font-semibold text-muted text-center border-l border-outline-variant whitespace-nowrap">
                          Final
                        </th>
                      </tr>
                      {/* PONDERACIÓN row — weights per activity, distinct amber tone */}
                      {ponderacionOn && (
                        <tr className="bg-amber-50 border-b border-amber-200">
                          <th className="sticky left-0 z-10 bg-amber-50 w-8 px-1 py-1 border-r border-outline-variant" />
                          <th className="sticky left-8 z-10 bg-amber-50 w-[150px] px-2 py-1 text-right text-[10px] font-bold text-amber-700 uppercase tracking-wide border-r border-outline-variant">
                            Ponderación
                          </th>
                          {tableParcials.map(({ p, acts }) => [
                            ...acts.map((a) => (
                              <th key={a.id} className="w-9 px-0.5 py-1 border-l border-outline-variant bg-amber-50">
                                <input type="number" min="0" max="10" step="0.5"
                                  value={pesoEdits[a.id] ?? (a.pesoCalificacion ?? '')}
                                  placeholder={String(pesoRestante(acts, a.id))}
                                  onChange={(e) => setPesoEdits((f) => ({ ...f, [a.id]: e.target.value }))}
                                  onFocus={(e) => {
                                    // Empty box: prefill with the remaining points to reach 10,
                                    // pre-selected — type to replace it, or just leave to accept
                                    const current = pesoEdits[a.id] ?? (a.pesoCalificacion ?? '')
                                    if (current === '') {
                                      setPesoEdits((f) => ({ ...f, [a.id]: String(pesoRestante(acts, a.id)) }))
                                    }
                                    const el = e.target
                                    requestAnimationFrame(() => el.select())
                                  }}
                                  onBlur={() => savePeso(a)}
                                  data-tooltip={`Peso de la actividad ${activityLabelById[a.id] || ''}`}
                                  className="no-spinner w-full px-0 py-0.5 text-center text-[11px] font-semibold rounded border border-amber-300 bg-white text-amber-800 focus:outline-none focus:ring-1 focus:ring-amber-400" />
                              </th>
                            )),
                            <th key={`pw-${p}`} className={`w-14 px-1 py-1 text-center text-[11px] font-bold border-l border-outline-variant bg-amber-50 ${pesoTotal(acts) === 10 ? 'text-emerald-600' : 'text-amber-700'}`}
                              data-tooltip={pesoTotal(acts) === 10 ? 'Los pesos suman 10' : 'Los pesos deben sumar 10'}>
                              {pesoTotal(acts)}
                            </th>,
                          ])}
                          <th className="w-14 bg-amber-50 border-l border-outline-variant" />
                        </tr>
                      )}
                      <tr className="bg-accent-light border-b border-outline-variant">
                        <th className="sticky left-0 z-10 bg-accent-light w-8 px-1 py-1.5 text-center font-medium text-muted border-r border-outline-variant whitespace-nowrap">
                          No.
                        </th>
                        <th className="sticky left-8 z-10 bg-accent-light w-[150px] px-2 py-1.5 text-left font-medium text-muted border-r border-outline-variant whitespace-nowrap">
                          Estudiante / Actividad
                        </th>
                        {tableParcials.map(({ p, acts }) => [
                          ...acts.map((a) => (
                            <th key={a.id} data-col={colIndexByKey[`act-${a.id}`]} className={`w-9 px-0.5 py-1.5 font-normal text-slate-400 text-center border-l border-outline-variant transition-colors duration-200 ${gradeHeaderColBg(colIndexByKey[`act-${a.id}`])}`}>
                              <span className="block truncate" data-tooltip={a.nombre}>{activityLabelById[a.id] || a.nombre}</span>
                            </th>
                          )),
                          <th key={`avg-${p}`} data-col={colIndexByKey[`avg-${p}`]} className={`w-14 px-1.5 py-1.5 font-semibold text-muted text-center border-l border-outline-variant whitespace-nowrap transition-colors duration-200 ${gradeHeaderColBg(colIndexByKey[`avg-${p}`])}`}>
                            Prom.
                          </th>,
                        ])}
                        <th data-col={colIndexByKey.final} className={`w-14 px-1.5 py-1.5 font-semibold text-muted text-center border-l border-outline-variant whitespace-nowrap transition-colors duration-200 ${gradeHeaderColBg(colIndexByKey.final)}`}>
                          Prom.
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {gradeRows.map(({ s, parcialData, finalAvg }, i) => (
                        <tr key={s.id} data-row={i} className={`group border-t border-outline-variant transition-colors duration-200 hover:bg-[var(--accent-tint)] ${i % 2 === 0 ? '' : 'bg-slate-50/50'}`}>
                          <td className={`sticky left-0 z-10 w-8 px-1 py-1 text-center text-slate-400 border-r border-outline-variant transition-colors duration-200 group-hover:bg-[var(--accent-tint)] ${i % 2 === 0 ? 'bg-surface-card' : 'bg-slate-50/50'}`}>
                            {s.orden}
                          </td>
                          <td className={`sticky left-8 z-10 w-[150px] px-2 py-1 text-sm font-medium text-on-surface truncate border-r border-outline-variant transition-colors duration-200 group-hover:bg-[var(--accent-tint)] ${i % 2 === 0 ? 'bg-surface-card' : 'bg-slate-50/50'}`}>
                            {s.apellidoPaterno} {s.nombre}
                          </td>
                          {parcialData.map(({ p, grades, avg }, pi) => [
                            ...tableParcials[pi].acts.map((a, ai) => (
                              <td key={a.id} data-col={colIndexByKey[`act-${a.id}`]} className={`w-9 px-0.5 py-1 text-center font-semibold border-l border-outline-variant transition-colors duration-200 ${gradeColor(grades[ai])} ${gradeBodyCellBg(colIndexByKey[`act-${a.id}`], i)}`}>
                                {grades[ai] !== null ? grades[ai] : '—'}
                              </td>
                            )),
                            <td key={`avg-${p}`} data-col={colIndexByKey[`avg-${p}`]} className={`w-14 px-1.5 py-1 text-center font-bold border-l border-outline-variant transition-colors duration-200 ${gradeColor(avg)} ${gradeBodyCellBg(colIndexByKey[`avg-${p}`], i)}`}>
                              {avg !== null ? avg : '—'}
                            </td>,
                          ])}
                          <td data-col={colIndexByKey.final} className={`w-14 px-1.5 py-1 text-center font-bold border-l border-outline-variant transition-colors duration-200 ${gradeColor(finalAvg)} ${gradeBodyCellBg(colIndexByKey.final, i)}`}>
                            {finalAvg !== null ? finalAvg : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {filteredGradeStudents.length === 0 && searchGrade && (
                  <p className="text-center text-sm text-slate-400">Sin resultados para "{searchGrade}"</p>
                )}
              </>
            )}
          </div>
        )}

      {/* ══════════════════════════════════════════════════════════
          TAB: ALUMNOS
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'alumnos' && (
        <div className={`px-4 py-2 space-y-2 ${TEACHER_CONTAINER_NARROW}`}>
          {/* Agregar alumnos — compact 3-step strip: template → upload → activation codes.
              Each step shows just a number + icon + short label; the full instructions
              live in the title tooltip instead of wrapping across two lines like before. */}
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Agregar estudiantes</p>
            {/* Prominent 3-step cards — everything starts here. No overflow-hidden
                wrapper so the tooltips render above without clipping. */}
            <div className="flex flex-col sm:flex-row sm:items-stretch gap-2">
              <button
                type="button"
                onClick={downloadStudentTemplate}
                data-tooltip="Descargar plantilla en Excel para pegar datos de estudiantes"
                data-tooltip-nowrap=""
                className="flex-1 min-w-0 flex items-center gap-3 py-3 px-4 rounded-card border border-accent bg-surface-card shadow-card hover:bg-[var(--accent-light)] transition-colors text-left"
              >
                <span className="w-8 h-8 rounded-full bg-accent text-white text-sm font-bold flex items-center justify-center flex-shrink-0">1</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-accent flex items-center gap-1.5"><Download size={16} className="flex-shrink-0" /> Plantilla Excel</p>
                  <p className="text-xs text-muted truncate">Descárgala y pega los datos</p>
                </div>
              </button>
              <ChevronRight size={18} className="hidden sm:block text-slate-300 flex-shrink-0 self-center" />
              <label
                data-tooltip="Sube exactamente el archivo de nuestra plantilla de Excel del paso 1"
                data-tooltip-nowrap=""
                className="flex-1 min-w-0 flex items-center gap-3 py-3 px-4 rounded-card border border-accent bg-surface-card shadow-card hover:bg-[var(--accent-light)] transition-colors cursor-pointer"
              >
                <span className="w-8 h-8 rounded-full bg-accent text-white text-sm font-bold flex items-center justify-center flex-shrink-0">2</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-accent flex items-center gap-1.5">{savingStudent ? <Spinner size="sm" /> : <Upload size={16} className="flex-shrink-0" />} Subir plantilla</p>
                  <p className="text-xs text-muted truncate">El archivo del paso 1, ya llenado</p>
                </div>
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelImport} disabled={savingStudent} />
              </label>
              <ChevronRight size={18} className="hidden sm:block text-slate-300 flex-shrink-0 self-center" />
              <button
                type="button"
                onClick={() => setShowCredentialsModal(true)}
                data-tooltip="Genera tu lista actualizada de códigos de acceso cada vez que agregues estudiantes"
                data-tooltip-nowrap=""
                className="flex-1 min-w-0 flex items-center gap-3 py-3 px-4 rounded-card border border-accent bg-surface-card shadow-card hover:bg-[var(--accent-light)] transition-colors text-left"
              >
                <span className="w-8 h-8 rounded-full bg-accent text-white text-sm font-bold flex items-center justify-center flex-shrink-0">3</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-accent flex items-center gap-1.5"><KeyRound size={16} className="flex-shrink-0" /> Generar códigos</p>
                  <p className="text-xs text-muted truncate">Accesos para tus estudiantes</p>
                </div>
              </button>
            </div>
          </div>

          {/* Ordenar alfabéticamente */}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={sortStudentsAlphabetically}
              disabled={groupStudents.length < 2}
              data-tooltip="Ordena la lista por apellido y nombre"
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-accent transition-colors px-2 py-1 rounded hover:bg-[var(--accent-medium)] disabled:opacity-40"
            >
              <ArrowUpDown size={15} />
              Ordenar alfabéticamente
            </button>
          </div>

          {/* 3 — Buscar alumno + agregar manualmente */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchAlumnos}
                onChange={(e) => setSearchAlumnos(e.target.value)}
                placeholder="Buscar por nombre o por número de lista…"
                className="w-full pl-9 pr-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface-card"
              />
            </div>
            <button type="button"
              onClick={() => setShowAddStudent(true)}
              data-tooltip="Agregar nuevo estudiante"
              className="p-2.5 bg-accent text-white rounded hover:bg-accent-hover transition-colors"
            >
              <UserPlus size={20} />
            </button>
          </div>

          {/* Student list */}
          {!groupStudentsLoaded ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : filteredAlumnos.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">
              {searchAlumnos ? 'Sin resultados' : 'No hay estudiantes en esta asignatura'}
            </div>
          ) : (
            <div className="bg-surface-card rounded-card overflow-hidden shadow-card">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container">
                <span className="w-5 flex-shrink-0" />
                <p className="flex-1 min-w-0 text-xs font-semibold text-muted uppercase tracking-wide">Nombre del estudiante</p>
                <p className="w-44 flex-shrink-0 text-xs font-semibold text-muted uppercase tracking-wide">Código</p>
                <p className="w-24 flex-shrink-0 text-xs font-semibold text-muted uppercase tracking-wide">Estado</p>
                <span className="w-9 flex-shrink-0" />
              </div>
              {filteredAlumnos.map((s, i) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-2 px-3 py-0.5 leading-tight transition-colors duration-200 hover:bg-[var(--accent-tint-strong)] ${i > 0 ? 'border-t border-outline-variant' : ''}`}
                >
                  <span className="w-5 text-xs text-slate-500 text-right flex-shrink-0">{s.orden}</span>
                  <p className="flex-1 min-w-0 text-sm font-medium text-on-surface truncate">
                    {fullStudentName(s)}
                  </p>
                  <span className="w-44 flex-shrink-0 text-xs font-mono text-accent font-semibold truncate">{s.username}</span>
                  <span className="w-24 flex-shrink-0 flex items-center">
                    {s.activado ? (
                      <span className="text-[11px] leading-none bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">activo</span>
                    ) : (
                      <span className="text-[11px] leading-none bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">sin activar</span>
                    )}
                  </span>
                  <button type="button"
                    onClick={() => openEditStudent(s)}
                    className="w-9 flex-shrink-0 p-1 flex items-center justify-center text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors duration-200"
                    data-tooltip="Editar estudiante"
                  >
                    <Pencil size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: RECURSOS
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'recursos' && (
        <div className={`px-4 py-2 space-y-2 ${TEACHER_CONTAINER_NARROW}`}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-muted leading-relaxed">
              Materiales permanentes del curso (programa, reglamento, guías, presentaciones…), disponibles para tus estudiantes durante todo el semestre. No generan entrega ni calificación.
            </p>
            <button type="button" onClick={openAddResource}
              data-tooltip="Agregar recurso"
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors">
              <Plus size={16} /> Agregar recurso
            </button>
          </div>

          {!resourcesLoaded || loadingResources ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : resources.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">
              Aún no hay recursos en esta asignatura
            </div>
          ) : (
            <div className="space-y-1.5">
              {resources.map((r) => {
                const { icon: Icon, color } = getResourceIcon(r.nombreArchivo)
                const isPreviewOpen = previewResourceId === r.id
                return (
                  <div key={r.id} className="bg-surface-card border border-outline-variant rounded-card shadow-card overflow-hidden">
                    <div className="flex items-center gap-3 px-3 py-2">
                      <Icon size={28} className={`flex-shrink-0 ${color}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-on-surface truncate">{r.nombre}</p>
                        {r.descripcion && (
                          <p className="text-xs text-slate-500 truncate">{r.descripcion}</p>
                        )}
                        <p className="text-xs text-slate-400 mt-0.5">
                          {formatFileSize(r.tamano)}{r.tamano ? ' · ' : ''}{formatResourceDate(r.fechaPublicacion)}
                        </p>
                      </div>
                      {canPreviewFile(r.nombreArchivo || r.nombre) && (
                        <button type="button" onClick={() => setPreviewResourceId(isPreviewOpen ? null : r.id)}
                          data-tooltip="Vista previa"
                          className={`p-2 rounded transition-colors flex-shrink-0 ${isPreviewOpen ? 'text-accent bg-[var(--accent-medium)]' : 'text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)]'}`}>
                          <Eye size={18} />
                        </button>
                      )}
                      <a href={downloadUrl(r.url, r.nombreArchivo || r.nombre)} download={r.nombreArchivo || r.nombre} rel="noreferrer" data-tooltip="Descargar"
                        className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
                        <Download size={18} />
                      </a>
                      <button type="button" onClick={() => openEditResource(r)} data-tooltip="Editar"
                        className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
                        <Pencil size={18} />
                      </button>
                      <button type="button" onClick={() => setDeleteResourceConfirm(r)} data-tooltip="Eliminar"
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0">
                        <Trash2 size={18} />
                      </button>
                    </div>
                    {isPreviewOpen && (
                      <div className="border-t border-outline-variant bg-surface">
                        <FilePreview url={r.url} nombre={r.nombreArchivo || r.nombre} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      </div>

      {/* ── Activity create/edit modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-surface-card w-full max-w-3xl rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">
                {modalMode === 'create' && !tipoActividad
                  ? `Nueva actividad — Parcial ${modalParcial}`
                  : modalMode === 'create'
                    ? `${tipoActividad === 'entregable' ? 'Entregable' : tipoActividad === 'cuestionario' ? 'Cuestionario' : 'Examen'} — Parcial ${modalParcial}`
                    : 'Editar actividad'}
              </h3>
              <button type="button" onClick={() => setShowModal(false)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>

            {/* ── Tipo picker (only on create, before choosing type) ── */}
            {modalMode === 'create' && !tipoActividad ? (
              <div className="space-y-2 py-2">
                <p className="text-sm text-muted mb-3">¿Qué tipo de actividad quieres crear?</p>
                {[
                  { key: 'entregable', label: 'Entregable', desc: 'El alumno sube un archivo o la marca como completada.' },
                  { key: 'cuestionario', label: 'Cuestionario', desc: 'Preguntas con calificación automática. Ideal para práctica o aprendizaje.' },
                  { key: 'examen', label: 'Examen', desc: 'Preguntas con calificación automática. Para evaluación formal.' },
                ].map((opt) => (
                  <button key={opt.key} type="button"
                    onClick={() => {
                      setShowModal(false)
                      if (opt.key === 'entregable') {
                        setEntregableEditor({ activityId: null, parcial: modalParcial, categoria: 'entregable', activityLabel: null, initialForm: null, initialExistingFiles: null })
                      } else {
                        setEvalEditor({ activityId: null, categoria: opt.key, parcial: modalParcial, activityLabel: `${modalParcial}.${activities.filter((a) => a.parcial === modalParcial).length + 1}` })
                      }
                    }}
                    className="w-full flex items-start gap-3 p-4 rounded-card border border-outline-variant hover:border-accent hover:bg-[var(--accent-tint)] transition-colors text-left">
                    <div>
                      <p className="font-semibold text-on-surface">{opt.label}</p>
                      <p className="text-xs text-muted mt-0.5">{opt.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <>
                {modalMode === 'create' && (
                  <div className="flex items-center gap-2 -mt-2 mb-3">
                    <button type="button" onClick={() => setTipoActividad(null)}
                      className="text-xs text-accent hover:underline">← Cambiar tipo</button>
                  </div>
                )}
                <p className="text-base text-on-surface mb-2">
                  Actividad <strong className="text-accent">{previewActividad}</strong>
                </p>
            <form onSubmit={handleSaveActivity} className="space-y-2">
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Nombre de la actividad</label>
                <input type="text" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                  required autoFocus
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder="Ej: Tarea 1, Examen parcial" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Instrucciones</label>
                <RichTextEditor
                  value={form.instrucciones}
                  onChange={(html) => setForm((f) => ({ ...f, instrucciones: html }))}
                  placeholder="Describe la tarea para tus estudiantes…"
                  attachments={[
                    ...activityExistingFiles,
                    ...activityNewFiles.map((f) => ({ nombre: f.name, tamano: f.size })),
                  ]}
                  onAttachFiles={addInstructionFiles}
                  onRemoveAttachment={removeInstructionFile}
                />
              </div>
              <p className="text-sm text-muted">Calificación máxima: <span className="font-semibold text-on-surface">10</span></p>
              {form.categoria !== 'cuestionario' && form.categoria !== 'examen' && (
                <div className="pt-1">
                  <FileTypeSelect
                    value={form.tiposArchivo}
                    onChange={(v) => setForm((f) => ({ ...f, tiposArchivo: v }))}
                    customExts={form.extensionesCustom}
                    onCustomChange={(v) => setForm((f) => ({ ...f, extensionesCustom: v }))}
                  />
                </div>
              )}

              {/* Visibilidad */}
              <div>
                <label className="block text-sm font-medium text-muted mb-2">Visibilidad</label>
                <VisibilitySelect
                  mode={form.visibilidadMode}
                  publishAt={form.publishAt}
                  onModeChange={(mode) => setForm((f) => ({
                    ...f, visibilidadMode: mode,
                    oculta: mode !== 'show',
                    publishAt: mode === 'schedule' ? f.publishAt : '',
                    fechaLimite: mode === 'hide' ? '' : f.fechaLimite,
                  }))}
                  onPublishAtChange={(v) => setForm((f) => ({ ...f, publishAt: v }))}
                />
              </div>

              {/* Fecha límite — solo visible si no está oculta */}
              {form.visibilidadMode !== 'hide' && (
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">
                    {form.fechaLimite ? 'Modificar fecha límite' : <>Fecha límite <span className="text-slate-400 font-normal">(opcional)</span></>}
                  </label>
                  {form.visibilidadMode === 'schedule' && !form.publishAt ? (
                    <p className="text-xs text-slate-400 px-1">Primero elige la fecha de publicación arriba.</p>
                  ) : (
                    <>
                      <EFDateTimePicker
                        mode="datetime"
                        headerLabel="Fecha y hora límite"
                        value={form.fechaLimite}
                        onChange={v => setForm(f => ({ ...f, fechaLimite: v }))}
                        placeholder="Sin fecha límite…"
                        clearable
                        minDateTime={
                          form.visibilidadMode === 'schedule' ? (form.publishAt || undefined) :
                          (form.publishedAt || undefined)
                        }
                      />
                      <p className="text-xs text-slate-400 mt-1">
                        Luego de esta fecha y hora ya no se reciben entregas.
                      </p>
                    </>
                  )}
                </div>
              )}

              <button type="submit" disabled={saving}
                className="w-full py-2 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                {saving ? <Spinner size="sm" /> : modalMode === 'create' ? <Plus size={18} /> : <Pencil size={18} />}
                {saving ? 'Guardando…' : modalMode === 'create'
                  ? (tipoActividad === 'cuestionario' || tipoActividad === 'examen') ? 'Crear y agregar preguntas' : 'Crear actividad'
                  : 'Guardar cambios'}
              </button>
              {!form.publishedAt && (
                <button type="button" disabled={saving} onClick={(e) => handleSaveActivity(e, true)}
                  className="w-full py-2 mt-2 border border-accent text-accent font-medium rounded transition-colors hover:bg-[var(--accent-tint)] disabled:opacity-60">
                  Guardar como borrador
                </button>
              )}
            </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Duplicate activity confirmation ── */}
      {duplicateConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDuplicateConfirm(null)} />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-on-surface mb-1">Duplicar actividad</h3>
            <p className="text-sm text-muted mb-4">
              Se creará una copia de "<strong>{duplicateConfirm.nombre}</strong>" como <strong>borrador</strong>, con el nombre "{duplicateConfirm.nombre} (copia)".
              Quedará oculta para estudiantes y sin número hasta que la publiques. Edítala para cambiarle el nombre.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDuplicateConfirm(null)}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)]">Cancelar</button>
              <button type="button" onClick={handleDuplicateActivity} disabled={duplicating}
                className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60 flex items-center justify-center gap-2">
                {duplicating ? <Spinner size="sm" /> : <Copy size={16} />}
                {duplicating ? 'Duplicando…' : 'Duplicar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Publish draft confirmation ── */}
      {publishDraftConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPublishDraftConfirm(null)} />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Publicar actividad?</h3>
            <p className="text-sm text-muted mb-2">
              "<strong>{publishDraftConfirm.nombre}</strong>" es un borrador. Al publicarla, los estudiantes podrán verla y se registrará la fecha y hora de publicación.
            </p>
            {/(\(copia\))\s*$/i.test(publishDraftConfirm.nombre || '') && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5 mb-3">
                Aún tiene el nombre de copia — conviene editarla antes de publicar.
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setPublishDraftConfirm(null)}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)]">Cancelar</button>
              {/* Editar is the primary path — a draft usually still needs changes
                  (esp. duplicates); Publicar stays available as secondary */}
              <button type="button" onClick={publishDraftNow}
                className="flex-1 py-1.5 rounded border border-accent text-accent text-sm font-medium hover:bg-[var(--accent-tint)] flex items-center justify-center gap-1.5">
                <Eye size={14} /> Publicar
              </button>
              <button type="button"
                onClick={() => { const a = publishDraftConfirm; setPublishDraftConfirm(null); openEdit(a, activityLabelById[a.id]) }}
                className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover flex items-center justify-center gap-2">
                <Pencil size={16} /> Editar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete activity confirmation ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteConfirm(null)} />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Eliminar actividad?</h3>
            <p className="text-sm text-muted mb-4">
              "<strong>{deleteConfirm.nombre}</strong>" se eliminará permanentemente.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)]">Cancelar</button>
              <button type="button" onClick={handleDeleteActivity} disabled={deleting}
                className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {deleting ? <Spinner size="sm" /> : <Trash2 size={16} />}
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Material de apoyo create/edit modal ── */}
      {showMaterialModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowMaterialModal(false)} />
          <div className="relative bg-surface-card w-full max-w-3xl rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">
                {materialModalMode === 'create' ? `Nuevo material de apoyo — Parcial ${materialParcial}` : 'Editar material de apoyo'}
              </h3>
              <button type="button" onClick={() => setShowMaterialModal(false)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={handleSaveMaterial} className="space-y-2">
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Nombre del material</label>
                <input type="text" value={materialForm.nombre} onChange={(e) => setMaterialForm((f) => ({ ...f, nombre: e.target.value }))}
                  required autoFocus
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder="Ej: Libro de texto, Video introductorio, Guía de laboratorio" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Descripción <span className="text-slate-400 font-normal">(opcional)</span></label>
                <RichTextEditor
                  value={materialForm.descripcion}
                  onChange={(html) => setMaterialForm((f) => ({ ...f, descripcion: html }))}
                  placeholder="Explica brevemente este material para tus estudiantes…"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted mb-1">Recursos</label>
                <FileDropzone
                  onFilesSelected={addMaterialFiles}
                  hint="Cualquier tipo de archivo (PDF, Word, Excel, PowerPoint, imágenes, audio, video, ZIP, RAR…) · máximo 15 MB por archivo"
                />
                {(materialExistingFiles.length > 0 || materialNewFiles.length > 0) && (
                  <div className="space-y-1 mt-2">
                    {materialExistingFiles.map((f, i) => (
                      <div key={f.url || `existing-${f.nombre}-${i}`} className="flex items-center gap-2 px-2 py-1.5 rounded border border-outline-variant">
                        <Paperclip size={16} className="text-slate-400 flex-shrink-0" />
                        <span className="text-sm text-on-surface truncate flex-1">{f.nombre}</span>
                        <span className="text-xs text-slate-400 flex-shrink-0">{formatFileSize(f.tamano)}</span>
                        <button type="button" onClick={() => setMaterialExistingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          className="p-1 text-slate-400 hover:text-red-500 rounded flex-shrink-0">
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                    {materialNewFiles.map((f, i) => (
                      <div key={`new-${f.name}-${f.size}-${i}`} className="flex items-center gap-2 px-2 py-1.5 rounded border border-accent bg-[var(--accent-tint)]">
                        <Paperclip size={16} className="text-accent flex-shrink-0" />
                        <span className="text-sm text-on-surface truncate flex-1">{f.name}</span>
                        <span className="text-xs text-slate-400 flex-shrink-0">{formatFileSize(f.size)}</span>
                        <button type="button" onClick={() => setMaterialNewFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          className="p-1 text-slate-400 hover:text-red-500 rounded flex-shrink-0">
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Visibilidad */}
              <div>
                <label className="block text-sm font-medium text-muted mb-2">Visibilidad</label>
                <VisibilitySelect
                  mode={materialForm.visibilidadMode}
                  publishAt={materialForm.publishAt}
                  onModeChange={(mode) => setMaterialForm((f) => ({
                    ...f, visibilidadMode: mode,
                    oculta: mode !== 'show',
                    publishAt: mode === 'schedule' ? f.publishAt : '',
                  }))}
                  onPublishAtChange={(v) => setMaterialForm((f) => ({ ...f, publishAt: v }))}
                />
              </div>

              <button type="submit" disabled={savingMaterial}
                className="w-full py-2 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                {savingMaterial ? <Spinner size="sm" /> : materialModalMode === 'create' ? <Plus size={18} /> : <Pencil size={18} />}
                {savingMaterial ? 'Guardando…' : materialModalMode === 'create' ? 'Crear material' : 'Guardar cambios'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete material confirmation ── */}
      {deleteMaterialConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteMaterialConfirm(null)} />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Eliminar material de apoyo?</h3>
            <p className="text-sm text-muted mb-4">
              "<strong>{deleteMaterialConfirm.nombre}</strong>" se eliminará permanentemente.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDeleteMaterialConfirm(null)}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)]">Cancelar</button>
              <button type="button" onClick={handleDeleteMaterial} disabled={deletingMaterial}
                className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {deletingMaterial ? <Spinner size="sm" /> : <Trash2 size={16} />}
                {deletingMaterial ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add student modal ── */}
      {showAddStudent && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowAddStudent(false)} />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Agregar estudiante</h3>
              <button type="button" onClick={() => setShowAddStudent(false)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={addStudent} className="space-y-2">
              {['apellidoPaterno', 'apellidoMaterno', 'nombre'].map((field) => (
                <input
                  key={field}
                  type="text"
                  value={newStudent[field]}
                  onChange={(e) => setNewStudent((f) => ({ ...f, [field]: e.target.value }))}
                  required
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder={
                    field === 'apellidoPaterno' ? 'Apellido paterno'
                      : field === 'apellidoMaterno' ? 'Apellido materno'
                      : 'Nombre(s)'
                  }
                />
              ))}
              <button
                type="submit"
                disabled={savingStudent}
                className="w-full py-2 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {savingStudent ? <Spinner size="sm" /> : <Plus size={18} />}
                Agregar estudiante
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit student modal ── */}
      {studentToEdit && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setStudentToEdit(null)} />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Editar estudiante</h3>
              <button type="button" onClick={() => setStudentToEdit(null)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={saveEditStudent} className="space-y-2">
              {['apellidoPaterno', 'apellidoMaterno', 'nombre'].map((field) => (
                <input
                  key={field}
                  type="text"
                  value={editStudentForm[field]}
                  onChange={(e) => setEditStudentForm((f) => ({ ...f, [field]: e.target.value }))}
                  required={field !== 'apellidoMaterno'}
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder={
                    field === 'apellidoPaterno' ? 'Apellido paterno'
                      : field === 'apellidoMaterno' ? 'Apellido materno'
                      : 'Nombre(s)'
                  }
                />
              ))}
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Comentarios (solo para ti, el estudiante no los ve)</label>
                <textarea
                  value={editStudentForm.comentarios}
                  onChange={(e) => setEditStudentForm((f) => ({ ...f, comentarios: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface resize-none"
                  placeholder="Ej: necesita apoyo extra, cambió de grupo, etc."
                />
              </div>
              <button
                type="submit"
                disabled={savingStudent}
                className="w-full py-2 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {savingStudent ? <Spinner size="sm" /> : <Pencil size={18} />}
                Guardar cambios
              </button>
              <button
                type="button"
                onClick={requestResetFromEdit}
                disabled={savingStudent}
                className="w-full py-1.5 rounded border border-amber-200 text-amber-600 text-sm font-semibold hover:bg-amber-50 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <RotateCcw size={17} />
                Habilitar recuperación de contraseña
              </button>
              <button
                type="button"
                onClick={requestDeleteFromEdit}
                disabled={savingStudent}
                className="w-full py-1.5 rounded border border-red-200 text-red-500 text-sm font-semibold hover:bg-red-50 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <Trash2 size={17} />
                Eliminar estudiante
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── QR modal ── */}
      {showQR && subject && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-3">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowQR(false)} />
          <div className="relative bg-surface-card w-[calc(100%-2rem)] max-w-md rounded-card p-6 shadow-2xl text-center max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="text-left">
                <h3 className="text-xl font-semibold leading-tight">{subject.nombre}</h3>
                {subject.grupo && <p className="text-base text-muted">Grupo: {subject.grupo}</p>}
              </div>
              <button type="button" onClick={() => setShowQR(false)} className="p-2 text-slate-400 rounded flex-shrink-0"><X size={22} /></button>
            </div>
            <div className="flex justify-center p-4 bg-surface-card rounded border border-outline-variant mb-4">
              <QRCode value={activationUrl} size={280} className="max-w-full h-auto" />
            </div>
            {subject.accessCode && (
              <p className="text-5xl font-bold tracking-wide text-accent mb-4">{subject.accessCode}</p>
            )}
            <button type="button"
              onClick={handleExportQRPDF}
              disabled={exportingPdf}
              className="w-full flex items-center justify-center gap-2 py-1.5 rounded border border-accent text-accent text-sm font-semibold hover:bg-[var(--accent-medium)] transition-colors disabled:opacity-50"
            >
              {exportingPdf ? <Spinner size="sm" /> : <Download size={17} />}
              {exportingPdf ? 'Generando PDF…' : 'Descargar QR en PDF'}
            </button>
          </div>
        </div>
      )}

      {/* ── Reset password confirmation ── */}
      {studentToReset && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setStudentToReset(null)} />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-2">
              <KeyRound size={24} className="text-amber-500" />
            </div>
            <h3 className="text-lg font-semibold text-center text-on-surface">¿Habilitar recuperación de contraseña?</h3>
            <p className="text-sm text-muted text-center mt-2">
              <strong>{studentToReset.apellidoPaterno} {studentToReset.nombre}</strong>{' '}
              ({studentToReset.username}) podrá elegir una <strong>nueva contraseña</strong> desde
              «Recuperar contraseña» en su pantalla de acceso. No necesitas darle ninguna clave.
            </p>
            <div className="flex gap-2 mt-4">
              <button type="button"
                onClick={() => setStudentToReset(null)}
                className="flex-1 py-2 bg-surface-container hover:bg-[var(--accent-tint)] text-muted font-semibold rounded transition-colors"
              >
                Cancelar
              </button>
              <button type="button"
                onClick={confirmResetStudentPassword}
                className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded transition-colors flex items-center justify-center gap-2"
              >
                <KeyRound size={18} />
                Habilitar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Generate credentials modal (R16) ── */}
      {showCredentialsModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !generatingCredentials && setShowCredentialsModal(false)} />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-full bg-accent-light flex items-center justify-center mx-auto mb-2">
              <KeyRound size={24} className="text-accent" />
            </div>
            <h3 className="text-lg font-semibold text-center text-on-surface">Descargar lista de acceso</h3>
            <p className="text-sm text-muted text-center mt-2">
              Se descargará un PDF con el <strong>usuario</strong> de cada estudiante y el
              <strong> código de la clase</strong> para que puedan entrar por primera vez.
            </p>
            <p className="text-xs text-muted text-center mt-2">
              Cada estudiante elige su propia contraseña la primera vez que entra. No se generan claves temporales.
            </p>
            <div className="flex gap-2 mt-4">
              <button type="button"
                onClick={() => setShowCredentialsModal(false)}
                disabled={generatingCredentials}
                className="flex-1 py-2 bg-surface-container hover:bg-[var(--accent-tint)] text-muted font-semibold rounded transition-colors disabled:opacity-60"
              >
                Cancelar
              </button>
              <button type="button"
                onClick={handleGenerateCredentials}
                disabled={generatingCredentials}
                className="flex-1 py-2 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {generatingCredentials ? <Spinner size="sm" /> : <Download size={18} />}
                {generatingCredentials ? 'Descargando…' : 'Descargar lista'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Same-name found: link to existing account or create new ── */}
      {linkCandidate && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !savingStudent && setLinkCandidate(null)} />
          <div className="relative bg-surface-card w-[calc(100%-2rem)] max-w-sm rounded-card p-4 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-accent-light flex items-center justify-center mx-auto mb-2">
              <UserPlus size={24} className="text-accent" />
            </div>
            <h3 className="text-lg font-semibold text-center text-on-surface">¿Es el mismo estudiante?</h3>
            <p className="text-sm text-muted text-center mt-2">
              Ya hay un estudiante llamado{' '}
              <strong>{linkCandidate.person.apellidoPaterno} {linkCandidate.person.apellidoMaterno} {linkCandidate.person.nombre}</strong>{' '}
              en esta escuela
              {(() => {
                const n = new Set(linkCandidate.identity.matches.map((m) => m.asignaturaId)).size
                return n ? ` (inscrito en ${n} asignatura${n !== 1 ? 's' : ''})` : ''
              })()}.
            </p>
            <p className="text-xs text-muted text-center mt-2">
              Si es la <strong>misma persona</strong>, se agrega esta asignatura a su cuenta (mismo usuario
              <span className="font-mono"> {linkCandidate.identity.username}</span>). Si es <strong>otra persona</strong> con el mismo nombre, se crea una cuenta nueva.
            </p>
            <div className="flex flex-col gap-2 mt-4">
              <button type="button"
                onClick={() => resolveLinkCandidate(true)}
                disabled={savingStudent}
                className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {savingStudent ? <Spinner size="sm" /> : <CheckIcon size={18} />}
                Sí, es el mismo estudiante
              </button>
              <button type="button"
                onClick={() => resolveLinkCandidate(false)}
                disabled={savingStudent}
                className="w-full py-2 bg-surface-container hover:bg-[var(--accent-tint)] text-muted font-semibold rounded transition-colors disabled:opacity-60"
              >
                No, es otro estudiante (cuenta nueva)
              </button>
              <button type="button"
                onClick={() => setLinkCandidate(null)}
                disabled={savingStudent}
                className="w-full py-2 text-sm text-muted hover:text-on-surface transition-colors disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Recovery enabled confirmation ── */}
      {resetPwdResult && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setResetPwdResult(null)} />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-2">
              <KeyRound size={24} className="text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-center text-on-surface">Recuperación habilitada</h3>
            <p className="text-sm text-muted text-center mt-2 mb-4">
              <strong>{resetPwdResult.student.nombre}</strong> ya puede entrar a la pantalla de acceso
              de estudiantes, tocar <strong>«Recuperar contraseña»</strong>, escribir su usuario y elegir una
              nueva contraseña.
            </p>
            <button type="button"
              onClick={() => setResetPwdResult(null)}
              className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* ── Delete student confirmation ── */}
      {studentToDelete && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setStudentToDelete(null)} />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-2">
              <Trash2 size={24} className="text-red-500" />
            </div>
            <h3 className="text-lg font-semibold text-center text-on-surface">¿Eliminar estudiante?</h3>
            <p className="text-sm text-muted text-center mt-2">
              Se eliminará a{' '}
              <strong>{studentToDelete.apellidoPaterno} {studentToDelete.nombre}</strong>{' '}
              ({studentToDelete.username}). Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2 mt-4">
              <button type="button"
                onClick={() => setStudentToDelete(null)}
                className="flex-1 py-2 bg-surface-container hover:bg-[var(--accent-tint)] text-muted font-semibold rounded transition-colors"
              >
                Cancelar
              </button>
              <button type="button"
                onClick={confirmDeleteStudent}
                disabled={savingStudent}
                className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {savingStudent ? <Spinner size="sm" /> : <Trash2 size={18} />}
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Edit subject modal ── */}
      {showEditSubjectModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowEditSubjectModal(false)} />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Editar asignatura</h3>
              <button type="button" onClick={() => setShowEditSubjectModal(false)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={handleEditSubject} className="space-y-2">
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Asignatura</label>
                <input type="text" value={editSubjectForm.nombre} onChange={(e) => setEditSubjectForm((f) => ({ ...f, nombre: e.target.value }))}
                  required autoFocus
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder="Ej: Matemáticas I" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Grupo</label>
                <input type="text" value={editSubjectForm.grupo} onChange={(e) => setEditSubjectForm((f) => ({ ...f, grupo: e.target.value }))}
                  required
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder="Ej: 1A, 2B, 3C" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">
                  Fechas <span className="text-slate-400 font-normal text-xs">(opcional)</span>
                </label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <span className="block text-sm text-slate-500 mb-1">Inicio</span>
                    <EFDateTimePicker mode="date" value={editSubjectForm.fechaInicio} onChange={v => setEditSubjectForm(f => ({ ...f, fechaInicio: v }))} />
                  </div>
                  <div className="flex-1">
                    <span className="block text-sm text-slate-500 mb-1">Fin</span>
                    <EFDateTimePicker mode="date" value={editSubjectForm.fechaFin} onChange={v => setEditSubjectForm(f => ({ ...f, fechaFin: v }))} />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Número de parciales</label>
                <select value={editSubjectForm.parciales} onChange={(e) => setEditSubjectForm((f) => ({ ...f, parciales: e.target.value }))}
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface">
                  {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} parciales</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-2">Color de la asignatura</label>
                <PaletteSelect value={editSubjectForm.colorPalette} onChange={(p) => setEditSubjectForm((f) => ({ ...f, colorPalette: p }))} />
              </div>
              <div data-subject-palette={editSubjectForm.colorPalette || 'default'}>
                <label className="block text-sm font-medium text-muted mb-2">Icono de la asignatura</label>
                <IconSelect value={editSubjectForm.icon} onChange={(ic) => setEditSubjectForm((f) => ({ ...f, icon: ic }))} />
              </div>
              <button type="submit" disabled={editingSubject}
                className="w-full py-2 bg-accent text-white font-semibold rounded disabled:opacity-60 flex items-center justify-center gap-2">
                {editingSubject ? <Spinner size="sm" /> : <Pencil size={18} />}
                {editingSubject ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Copy subject modal ── */}
      {showCopyModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowCopyModal(false)} />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Duplicar asignatura</h3>
              <button type="button" onClick={() => setShowCopyModal(false)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={handleCopySubject} className="space-y-2">
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Asignatura</label>
                <input type="text" value={copyForm.nombre} onChange={(e) => setCopyForm((f) => ({ ...f, nombre: e.target.value }))}
                  required autoFocus
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder="Ej: Matemáticas II" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Grupo</label>
                <input type="text" value={copyForm.grupo} onChange={(e) => setCopyForm((f) => ({ ...f, grupo: e.target.value }))}
                  required
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder="Ej: 1A, 2B, 3C" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">
                  Fechas <span className="text-slate-400 font-normal text-xs">(opcional)</span>
                </label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <span className="block text-sm text-slate-500 mb-1">Inicio</span>
                    <EFDateTimePicker mode="date" value={copyFechas.fechaInicio} onChange={v => setCopyFechas(f => ({ ...f, fechaInicio: v }))} />
                  </div>
                  <div className="flex-1">
                    <span className="block text-sm text-slate-500 mb-1">Fin</span>
                    <EFDateTimePicker mode="date" value={copyFechas.fechaFin} onChange={v => setCopyFechas(f => ({ ...f, fechaFin: v }))} />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-2">Color de la asignatura</label>
                <PaletteSelect value={copyForm.colorPalette} onChange={(p) => setCopyForm((f) => ({ ...f, colorPalette: p }))} />
              </div>
              <div data-subject-palette={copyForm.colorPalette || 'default'}>
                <label className="block text-sm font-medium text-muted mb-2">Icono de la asignatura</label>
                <IconSelect value={copyForm.icon} onChange={(ic) => setCopyForm((f) => ({ ...f, icon: ic }))} />
              </div>
              <label className="flex items-center gap-2 p-3 rounded border border-outline-variant cursor-pointer hover:bg-[var(--accent-tint)] transition-colors">
                <input type="checkbox" checked={copyForm.keepStudents} onChange={(e) => setCopyForm((f) => ({ ...f, keepStudents: e.target.checked }))}
                  className="accent-[var(--accent)] w-4 h-4" />
                <div>
                  <p className="text-sm font-medium text-on-surface">Copiar lista de estudiantes</p>
                  <p className="text-sm text-slate-500">Conservan su mismo usuario y cuenta; quienes ya activaron verán esta asignatura al instante</p>
                </div>
              </label>
              <p className="text-sm text-slate-500">Se duplicarán todas las actividades. Las calificaciones y entregas no se copian.</p>
              <button type="submit" disabled={copyingSubject}
                className="w-full py-2 bg-accent text-white font-semibold rounded disabled:opacity-60 flex items-center justify-center gap-2">
                {copyingSubject ? <Spinner size="sm" /> : <Copy size={18} />}
                {copyingSubject ? 'Duplicando…' : 'Duplicar asignatura'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete subject confirm modal ── */}
      {showDeleteSubjectConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setShowDeleteSubjectConfirm(false); setDeleteSubjectConfirmText('') }} />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-2">
              <Trash2 size={24} className="text-red-500" />
            </div>
            <h3 className="text-base font-semibold text-on-surface text-center mb-1">¿Eliminar asignatura?</h3>
            <p className="text-sm text-muted text-center mb-2">
              Se borrarán permanentemente todas las actividades, entregas y estudiantes de{' '}
              <strong>{subject?.nombre}</strong>. Esta acción <strong>no se puede deshacer</strong>.
            </p>
            <p className="text-xs text-muted mb-2">Escribe <strong>{subject?.nombre}</strong> para confirmar:</p>
            <input
              type="text"
              value={deleteSubjectConfirmText}
              onChange={(e) => setDeleteSubjectConfirmText(e.target.value)}
              className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-red-400 text-sm bg-surface mb-2"
              placeholder={subject?.nombre}
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => { setShowDeleteSubjectConfirm(false); setDeleteSubjectConfirmText('') }}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)]">Cancelar</button>
              <button type="button" onClick={handleDeleteSubject}
                disabled={deletingSubject || deleteSubjectConfirmText !== subject?.nombre}
                className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40 flex items-center justify-center gap-2">
                {deletingSubject ? <Spinner size="sm" /> : <Trash2 size={16} />}
                {deletingSubject ? 'Eliminando…' : 'Eliminar todo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Unarchive modal ── */}
      {/* ── Archive modal ── */}
      {showArchiveModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !archiving && setShowArchiveModal(false)} />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold">Archivar asignatura</h3>
              <button type="button" onClick={() => !archiving && setShowArchiveModal(false)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <p className="text-sm text-muted mb-2">
              Al archivar se conservan las actividades y la lista de estudiantes, pero <strong>se eliminan las entregas</strong>. ¿Qué hacemos con ellas?
            </p>
            <div className="space-y-2 mb-4">
              {[
                { val: 'save', label: 'Guardar entregas como ZIP', desc: 'Se descargan antes de eliminarlas' },
                { val: 'skip', label: 'Archivar sin guardar', desc: 'Las entregas se eliminan sin descargar' },
              ].map(({ val, label, desc }) => (
                <label key={val} className={`flex items-center gap-2 p-3 rounded border cursor-pointer transition-colors ${archiveExportChoice === val ? 'border-accent bg-accent-light' : 'border-outline-variant hover:bg-[var(--accent-tint)]'}`}>
                  <input type="radio" name="archiveExport" value={val} checked={archiveExportChoice === val} onChange={() => setArchiveExportChoice(val)} className="accent-[var(--accent)]" />
                  <div>
                    <p className="text-sm font-medium text-on-surface">{label}</p>
                    <p className="text-sm text-slate-500">{desc}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowArchiveModal(false)} disabled={archiving}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)] disabled:opacity-60">Cancelar</button>
              <button type="button" onClick={handleArchiveConfirm} disabled={archiving}
                className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60 flex items-center justify-center gap-2">
                {archiving ? <Spinner size="sm" /> : <Archive size={16} />}
                {archiving
                  ? (zipDownloading
                      ? `Descargando ${zipProgress.done}/${zipProgress.total}…`
                      : 'Archivando…')
                  : 'Archivar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Unarchive (restore) modal ── */}
      {showUnarchiveModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowUnarchiveModal(false)} />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Desarchivar asignatura</h3>
              <button type="button" onClick={() => setShowUnarchiveModal(false)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <p className="text-sm text-muted mb-2">Puedes editar los datos y elegir cómo restaurar:</p>

            <div className="space-y-2 mb-4">
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Datos</p>
                <div className="space-y-2">
                  <input type="text" value={unarchiveEdits.nombre} onChange={(e) => setUnarchiveEdits((f) => ({ ...f, nombre: e.target.value }))}
                    className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" placeholder="Asignatura" />
                  <input type="text" value={unarchiveEdits.grupo} onChange={(e) => setUnarchiveEdits((f) => ({ ...f, grupo: e.target.value }))}
                    className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" placeholder="Grupo (ej: 1A)" />
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <span className="block text-sm text-slate-500 mb-1">Inicio</span>
                      <EFDateTimePicker mode="date" value={unarchiveEdits.fechaInicio} onChange={v => setUnarchiveEdits(f => ({ ...f, fechaInicio: v }))} />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm text-slate-500 mb-1">Fin</span>
                      <EFDateTimePicker mode="date" value={unarchiveEdits.fechaFin} onChange={v => setUnarchiveEdits(f => ({ ...f, fechaFin: v }))} />
                    </div>
                  </div>
                  <select value={unarchiveEdits.parciales} onChange={(e) => setUnarchiveEdits((f) => ({ ...f, parciales: e.target.value }))}
                    className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface">
                    {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} parciales</option>)}
                  </select>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Color de la asignatura</p>
                <PaletteSelect value={unarchiveEdits.colorPalette} onChange={(p) => setUnarchiveEdits((f) => ({ ...f, colorPalette: p }))} />
              </div>

              <div data-subject-palette={unarchiveEdits.colorPalette || 'default'}>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Icono de la asignatura</p>
                <IconSelect value={unarchiveEdits.icon} onChange={(ic) => setUnarchiveEdits((f) => ({ ...f, icon: ic }))} />
              </div>

              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Lista de estudiantes</p>
                <div className="space-y-1.5">
                  {[
                    { val: 'keep', label: 'Conservar lista', desc: 'Estudiantes y calificaciones se mantienen' },
                    { val: 'reset', label: 'Borrar y empezar de cero', desc: 'Se eliminan estudiantes y sus entregas' },
                  ].map(({ val, label, desc }) => (
                    <label key={val} className={`flex items-center gap-2 p-3 rounded border cursor-pointer transition-colors ${unarchiveStudents === val ? 'border-accent bg-accent-light' : 'border-outline-variant hover:bg-[var(--accent-tint)]'}`}>
                      <input type="radio" name="unarchiveStudents" value={val} checked={unarchiveStudents === val} onChange={() => setUnarchiveStudents(val)} className="accent-[var(--accent)]" />
                      <div>
                        <p className="text-sm font-medium text-on-surface">{label}</p>
                        <p className="text-sm text-slate-500">{desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Actividades</p>
                <div className="space-y-1.5">
                  {[
                    { val: 'keep', label: 'Conservar visibilidad actual' },
                    { val: 'show', label: 'Mostrar todas' },
                    { val: 'hide', label: 'Ocultar todas' },
                  ].map(({ val, label }) => (
                    <label key={val} className={`flex items-center gap-2 p-3 rounded border cursor-pointer transition-colors ${unarchiveActivities === val ? 'border-accent bg-accent-light' : 'border-outline-variant hover:bg-[var(--accent-tint)]'}`}>
                      <input type="radio" name="unarchiveActivities" value={val} checked={unarchiveActivities === val} onChange={() => setUnarchiveActivities(val)} className="accent-[var(--accent)]" />
                      <p className="text-sm font-medium text-on-surface">{label}</p>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={() => setShowUnarchiveModal(false)}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)]">Cancelar</button>
              <button type="button" onClick={handleUnarchiveConfirm} disabled={unarchivedSaving}
                className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60 flex items-center justify-center gap-2">
                {unarchivedSaving ? <Spinner size="sm" /> : null}
                {unarchivedSaving ? 'Guardando…' : 'Desarchivar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add/Edit resource modal ── */}
      {showResourceModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowResourceModal(false)} />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{resourceModalMode === 'create' ? 'Agregar recurso' : 'Editar recurso'}</h3>
              <button type="button" onClick={() => setShowResourceModal(false)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={handleSaveResource} className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Nombre del recurso</label>
                <input
                  type="text"
                  value={resourceForm.nombre}
                  onChange={(e) => setResourceForm((f) => ({ ...f, nombre: e.target.value }))}
                  required
                  autoFocus
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder="Ej: Programa de la asignatura"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Descripción (opcional)</label>
                <textarea
                  value={resourceForm.descripcion}
                  onChange={(e) => setResourceForm((f) => ({ ...f, descripcion: e.target.value }))}
                  rows={2}
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface resize-none"
                  placeholder="Ej: Consulta este documento antes del primer parcial"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Archivo {resourceModalMode === 'edit' && '(déjalo vacío para conservar el actual)'}
                </label>
                <input
                  type="file"
                  accept={RESOURCE_ACCEPT}
                  onChange={(e) => setResourceFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-accent-light file:text-accent file:text-sm file:font-medium"
                />
                <p className="text-xs text-slate-400 mt-1">PDF, Word, Excel, Power Point, JPG o PNG · máximo 15 MB</p>
              </div>
              <button
                type="submit"
                disabled={savingResource}
                className="w-full py-2 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {savingResource ? <Spinner size="sm" /> : <Upload size={18} />}
                {savingResource ? 'Guardando…' : 'Guardar recurso'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete resource confirm ── */}
      {deleteResourceConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteResourceConfirm(null)} />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Eliminar recurso?</h3>
            <p className="text-sm text-muted mb-4">
              "<strong>{deleteResourceConfirm.nombre}</strong>" se eliminará permanentemente.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDeleteResourceConfirm(null)}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)]">Cancelar</button>
              <button type="button" onClick={handleDeleteResource} disabled={deletingResource}
                className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {deletingResource ? <Spinner size="sm" /> : <Trash2 size={16} />}
                {deletingResource ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* ── Full-screen entregable editor ── */}
      {entregableEditor && (
        <EntregableEditor
          activityId={entregableEditor.activityId}
          parcial={entregableEditor.parcial}
          categoria={entregableEditor.categoria}
          subjectId={subjectId}
          docenteId={currentUser?.uid}
          existingActivities={activities}
          activityLabel={entregableEditor.activityLabel}
          contextLine={[subjectDisplayName(subject), userProfile?.nombreMostrar || userProfile?.nombre].filter(Boolean).join(' — ')}
          initialForm={entregableEditor.initialForm}
          initialExistingFiles={entregableEditor.initialExistingFiles}
          onClose={() => setEntregableEditor(null)}
          onActivityCreated={(act) => {
            setActivities((prev) => [...prev, act])
            setSubmissionCounts((prev) => ({ ...prev, [act.id]: { delivered: 0, graded: 0 } }))
          }}
          onActivityUpdated={(act) => {
            setActivities((prev) => prev.map((a) => a.id === act.id ? { ...a, ...act } : a))
          }}
        />
      )}

      {/* ── Full-screen evaluación editor (Cuestionario / Examen) ── */}
      {evalEditor && (
        <EvaluacionEditor
          activityId={evalEditor.activityId}
          parcial={evalEditor.parcial}
          categoria={evalEditor.categoria}
          activityLabel={evalEditor.activityLabel}
          contextLine={[subjectDisplayName(subject), userProfile?.nombreMostrar || userProfile?.nombre].filter(Boolean).join(' — ')}
          subjectId={subjectId}
          docenteId={currentUser?.uid}
          subject={subject}
          existingActivities={activities}
          onClose={() => setEvalEditor(null)}
          onActivityCreated={(act) => {
            setActivities((prev) => [...prev, act])
            setSubmissionCounts((prev) => ({ ...prev, [act.id]: { delivered: 0, graded: 0 } }))
          }}
          onActivityUpdated={(act) => {
            setActivities((prev) => prev.map((a) => a.id === act.id ? { ...a, ...act } : a))
          }}
        />
      )}
    </TeacherLayout>
  )
}
