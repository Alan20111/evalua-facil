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
import { activityVisibilityState, formatPublishAt } from '../../utils/activityVisibility'
import { subjectDisplayName } from '../../utils/subjectName'
import PaletteSelect from '../../components/PaletteSelect'
import IconSelect from '../../components/IconSelect'
import SubjectIcon from '../../components/SubjectIcon'
import FileTypeSelect from '../../components/FileTypeSelect'
import RichTextEditor from '../../components/RichTextEditor'
import { htmlToPlainText, sanitizeHtml, toRichHtml } from '../../utils/sanitizeHtml'
import { DEFAULT_FILE_TYPE, CUSTOM_FILE_TYPE, normalizeFileTypeKeys, parseCustomExts } from '../../config/fileTypes'
import { TEACHER_CONTAINER } from '../../config/layout'
import {
  ArrowLeft, Plus, ChevronDown, ChevronUp, FileText, Clock,
  CheckCircle, Circle, X, Pencil, Trash2, Archive, ArchiveRestore,
  FileSpreadsheet, Search,
  ArrowUpDown, UserPlus, RotateCcw, Upload, Download, QrCode,
  Link, Hash, Check as CheckIcon, KeyRound, Copy,
  Eye, EyeOff,
} from 'lucide-react'
import { QRCodeSVG as QRCode } from 'qrcode.react'
import { generateUsername } from '../../utils/generate'
import { findStudentIdentity } from '../../utils/studentIdentity'
import { useSubscription } from '../../hooks/useSubscription'
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

const EMPTY_FORM = { nombre: '', instrucciones: '', fechaLimite: '', tiposArchivo: [DEFAULT_FILE_TYPE], extensionesCustom: '', oculta: false, publishAt: '' }

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
  const [openParcial, setOpenParcial] = useState(1)

  // Activity modal
  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [modalParcial, setModalParcial] = useState(1)
  const [editActivityId, setEditActivityId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [archiving, setArchiving] = useState(false)

  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportingGradesPdf, setExportingGradesPdf] = useState(false)
  const [generatingCredentials, setGeneratingCredentials] = useState(false)
  const [showCredentialsModal, setShowCredentialsModal] = useState(false)
  const [zipDownloading, setZipDownloading] = useState(false)
  const [zipProgress, setZipProgress] = useState({ done: 0, total: 0 })

  // Activity visibility
  const [activateModal, setActivateModal] = useState(null) // activity | null
  const [activateMode, setActivateMode] = useState('now') // 'now' | 'schedule'
  const [activateDate, setActivateDate] = useState('')

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

  // Calificaciones
  const [gradeSubMap, setGradeSubMap] = useState({})
  const [gradesLoaded, setGradesLoaded] = useState(false)
  const [loadingGrades, setLoadingGrades] = useState(false)
  const [searchGrade, setSearchGrade] = useState('')

  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => { loadAll() }, [subjectId])

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
    try {
      const [subSnap, actsSnap] = await Promise.all([
        getDoc(doc(db, 'subjects', subjectId)),
        getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', subjectId))),
      ])
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

      const subDocs = await fetchSubmissionsForActivities(acts.map((a) => a.id))

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

  function uniqueUsername(base, taken) {
    if (!taken.has(base)) return base
    let i = 2
    while (taken.has(`${base}${i}`)) i++
    return `${base}${i}`
  }

  async function addStudent(e) {
    e.preventDefault()
    setSavingStudent(true)
    try {
      const schoolDocs = await fetchSchoolStudents()
      const identity = findStudentIdentity(schoolDocs, newStudent)
      // Already enrolled in THIS subject → don't create a duplicate.
      if (identity && identity.matches.some((m) => m.asignaturaId === subjectId)) {
        toast('Ese alumno ya está en esta asignatura', 'error')
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
      toast('Alumno agregado')
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
      toast(isSamePerson ? 'Asignatura vinculada a su cuenta' : 'Alumno agregado (cuenta nueva)')
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
      if (rows.length === 0) { toast('El archivo no tiene alumnos con los 3 campos requeridos', 'error'); return }
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
      const parts = [`${rows.length - skipped} alumnos importados`]
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
      toast('Alumno actualizado')
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
      toast('Alumnos ordenados alfabéticamente')
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
    setForm(EMPTY_FORM); setShowModal(true)
  }
  function openEdit(activity) {
    setModalMode('edit'); setModalParcial(activity.parcial); setEditActivityId(activity.id)
    setForm({
      nombre: activity.nombre || '',
      instrucciones: toRichHtml(activity.instrucciones || ''),
      fechaLimite: activity.fechaLimite || '',
      tiposArchivo: normalizeFileTypeKeys(activity.tiposArchivo),
      extensionesCustom: activity.extensionesCustom || '',
      oculta: activity.oculta || false,
      publishAt: activity.publishAt || '',
    })
    setShowModal(true)
  }

  async function handleSaveActivity(e) {
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
    setSaving(true)
    const payload = {
      nombre: form.nombre.trim(),
      maxCalif: 10,
      instrucciones: sanitizeHtml(form.instrucciones),
      fechaLimite: form.fechaLimite || null,
      tiposArchivo,
      extensionesCustom: tiposArchivo.includes(CUSTOM_FILE_TYPE) ? (form.extensionesCustom || '').trim() : '',
      oculta: form.oculta || !!form.publishAt,
      publishAt: form.publishAt || null,
    }
    try {
      if (modalMode === 'create') {
        // `orden` is only a sort key (Firestore gives no ordering guarantee
        // without it). The "Actividad" label (1.1, 1.2…) is presentation —
        // computed fresh from position within the parcial wherever it's shown
        // (see `activityLabelById` below) — never stored, so it can't drift.
        const orden = activities.filter((a) => a.parcial === modalParcial).length + 1
        const ref = await addDoc(collection(db, 'activities'), {
          ...payload, tipo: 'archivo', parcial: modalParcial, orden,
          asignaturaId: subjectId, docenteId: currentUser.uid, createdAt: serverTimestamp(),
        })
        setActivities((prev) => [...prev, { id: ref.id, ...payload, tipo: 'archivo', parcial: modalParcial, orden, asignaturaId: subjectId, docenteId: currentUser.uid }])
        setSubmissionCounts((prev) => ({ ...prev, [ref.id]: { delivered: 0, graded: 0 } }))
        toast('Actividad creada')
      } else {
        await updateDoc(doc(db, 'activities', editActivityId), payload)
        setActivities((prev) => prev.map((a) => a.id === editActivityId ? { ...a, ...payload } : a))
        toast('Actividad actualizada')
      }
      setShowModal(false); setForm(EMPTY_FORM)
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
      toast(next.includes(p) ? `Parcial ${p} oculto para alumnos` : `Parcial ${p} visible para alumnos`)
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  async function handleActivateConfirm() {
    if (!activateModal) return
    try {
      if (activateMode === 'now') {
        await updateDoc(doc(db, 'activities', activateModal.id), { oculta: false, publishAt: null })
        setActivities((prev) => prev.map((a) => a.id === activateModal.id ? { ...a, oculta: false, publishAt: null } : a))
        toast('Actividad visible para alumnos')
      } else {
        if (!activateDate) { toast('Elige una fecha', 'error'); return }
        await updateDoc(doc(db, 'activities', activateModal.id), { oculta: true, publishAt: activateDate })
        setActivities((prev) => prev.map((a) => a.id === activateModal.id ? { ...a, oculta: true, publishAt: activateDate } : a))
        toast('Activación programada')
      }
      setActivateModal(null)
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
      if (students.length === 0) { toast('No hay alumnos en esta asignatura', 'error'); return }

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
  const activityLabelById = {}
  PARCIALES.forEach((p) => {
    activities.filter((a) => a.parcial === p).forEach((a, i) => {
      activityLabelById[a.id] = `${p}.${i + 1}`
    })
  })

  // Preview of the auto-assigned "Actividad" label shown (read-only) in the modal.
  const previewActividad = modalMode === 'create'
    ? `${modalParcial}.${activities.filter((a) => a.parcial === modalParcial).length + 1}`
    : (activityLabelById[editActivityId] || '—')

  const filteredGradeStudents = groupStudents.filter((s) => {
    if (!searchGrade.trim()) return true
    return `${s.apellidoPaterno} ${s.apellidoMaterno} ${s.nombre}`.toLowerCase()
      .includes(searchGrade.trim().toLowerCase())
  })

  const tableParcials = PARCIALES.map((p) => ({
    p, acts: activities.filter((a) => a.parcial === p),
  })).filter((pd) => pd.acts.length > 0)

  // Pre-compute grade rows
  const gradeRows = filteredGradeStudents.map((s) => {
    const parcialData = tableParcials.map(({ p, acts }) => {
      const grades = acts.map((a) => {
        const sub = gradeSubMap[`${s.id}-${a.id}`]
        return sub?.calificacion != null
          ? parseFloat(((sub.calificacion / (a.maxCalif || 10)) * 10).toFixed(1))
          : null
      })
      const valid = grades.filter((g) => g !== null)
      const avg = valid.length ? parseFloat((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1)) : null
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
    `${s.apellidoPaterno} ${s.apellidoMaterno} ${s.nombre} ${s.username}`
      .toLowerCase()
      .includes(searchAlumnos.toLowerCase())
  )

  if (loading) return (
    <TeacherLayout><div className="flex justify-center py-20"><Spinner size="lg" /></div></TeacherLayout>
  )

  return (
    <TeacherLayout>
      <div data-subject-palette={subject?.colorPalette || 'default'}>
      <div className={TEACHER_CONTAINER}>

        {/* ── Header ── */}
        <div className="bg-surface-card border-b border-outline-variant px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/dashboard')} className="p-2 -ml-2 text-slate-400 hover:text-muted rounded flex-shrink-0">
              <ArrowLeft size={22} />
            </button>
            <div className="w-9 h-9 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
              <SubjectIcon iconKey={subject?.icon} size={20} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-on-surface truncate">{subjectDisplayName(subject)}</h1>
                {subject?.archived && (
                  <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full flex-shrink-0">Archivada</span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons — wrap on mobile so they never overflow */}
          <div className="flex flex-wrap items-center gap-1 mt-3">
            <button type="button" onClick={() => setShowQR(true)}
              title="Código QR de acceso para alumnos"
              className="p-2 text-accent hover:bg-accent-light rounded transition-colors flex-shrink-0">
              <QrCode size={21} />
            </button>
            <button type="button" onClick={copyActivationLink}
              title="Copiar link de activación para alumnos"
              className={`p-2 rounded transition-colors flex-shrink-0 ${copiedLink ? 'text-emerald-600 bg-emerald-50' : 'text-accent hover:bg-accent-light'}`}>
              {copiedLink ? <CheckIcon size={21} /> : <Link size={21} />}
            </button>
            <button type="button" onClick={copyAccessCode}
              title="Copiar código de acceso para alumnos"
              className={`flex items-center gap-1 px-2 py-1.5 rounded transition-all duration-200 flex-shrink-0 font-mono font-bold text-sm ${copiedCode ? 'text-emerald-600 bg-emerald-50' : 'text-accent hover:bg-accent-light'}`}>
              {copiedCode
                ? <><CheckIcon size={21} className="animate-bounce flex-shrink-0" /><span>Copiado</span></>
                : <><Hash size={21} className="flex-shrink-0" /><span>{subject?.accessCode}</span></>}
            </button>
            <button type="button" onClick={openEditSubject}
              title="Editar los datos de la asignatura (nombre, grupo, color, icono…)"
              className="p-2 text-slate-400 hover:text-accent hover:bg-accent-light rounded transition-colors flex-shrink-0">
              <Pencil size={21} />
            </button>
            <button type="button" onClick={openCopyModal}
              title="Duplicar esta asignatura (con o sin la lista de alumnos)"
              className="p-2 text-slate-400 hover:text-accent hover:bg-accent-light rounded transition-colors flex-shrink-0">
              <Copy size={21} />
            </button>
            <button type="button" onClick={handleToggleArchive} disabled={archiving}
              title={subject?.archived ? 'Restaurar asignatura (vuelve a tus asignaturas activas)' : 'Archivar asignatura (guarda el esqueleto; elimina las entregas)'}
              className="p-2 text-slate-400 hover:text-amber-600 rounded transition-colors disabled:opacity-50 flex-shrink-0">
              {subject?.archived ? <ArchiveRestore size={21} /> : <Archive size={21} />}
            </button>
            <button type="button" onClick={() => { setDeleteSubjectConfirmText(''); setShowDeleteSubjectConfirm(true) }}
              title="Eliminar la asignatura permanentemente (no se puede deshacer)"
              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0">
              <Trash2 size={21} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-3 bg-surface-container p-1 rounded">
            {['actividades', 'calificaciones', 'alumnos'].map((t) => (
              <button key={t} onClick={() => switchTab(t)}
                className={`flex-1 py-2.5 text-xs sm:text-sm font-medium rounded transition-colors ${
                  activeTab === t ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:text-on-surface'
                }`}>
                {t === 'actividades' ? 'Actividades' : t === 'calificaciones' ? 'Calificaciones' : 'Alumnos'}
              </button>
            ))}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════
            TAB: ACTIVIDADES
        ══════════════════════════════════════════════════════════ */}
        {activeTab === 'actividades' && (
          <div className="px-4 py-3 space-y-3">
            {PARCIALES.map((p) => {
              const acts = activities.filter((a) => a.parcial === p)
              const isOpen = openParcial === p
              const parcialOculto = (subject?.parcialesOcultos || []).includes(p)
              return (
                <div key={p} className="bg-surface-card rounded-card overflow-hidden shadow-card">
                  <div className="w-full flex items-center gap-1">
                    <button onClick={() => setOpenParcial(isOpen ? 0 : p)}
                      className="min-w-0 max-w-2xl px-4 py-2.5 flex items-center gap-3 hover:bg-surface transition-colors text-left">
                      <div className={`w-10 h-10 rounded flex items-center justify-center flex-shrink-0 ${parcialOculto ? 'bg-surface-container' : 'bg-accent-light'}`}>
                        <span className={`font-bold text-sm ${parcialOculto ? 'text-slate-400' : 'text-accent'}`}>{p}</span>
                      </div>
                      <div className="text-left min-w-0">
                        <p className={`font-semibold text-base leading-tight truncate ${parcialOculto ? 'text-slate-400' : 'text-on-surface'}`}>
                          Parcial {p}{parcialOculto && <span className="text-xs font-normal text-slate-400"> · oculto a alumnos</span>}
                        </p>
                        <p className="text-sm text-slate-500 leading-tight -mt-0.5">{acts.length} actividad{acts.length !== 1 ? 'es' : ''}</p>
                      </div>
                    </button>
                    <button
                      onClick={() => toggleParcialVisibility(p)}
                      title={parcialOculto ? 'Mostrar este parcial a los alumnos' : 'Ocultar este parcial a los alumnos'}
                      className="p-2 text-slate-400 hover:text-accent hover:bg-accent-light rounded transition-colors flex-shrink-0"
                    >
                      {parcialOculto ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                    <button onClick={() => setOpenParcial(isOpen ? 0 : p)} className="p-2 mr-2 flex-shrink-0">
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
                        return (
                          <div key={a.id} className={`flex items-center gap-1 w-fit max-w-full rounded border bg-surface-card transition-colors ${isHidden ? 'border-outline-variant opacity-60' : 'border-outline-variant hover:border-accent'}`}>
                            <button onClick={() => navigate(`/activity/${a.id}`)}
                              className="flex items-center gap-3 min-w-0 max-w-2xl px-3 py-2 text-left">
                              <FileText size={20} className={`flex-shrink-0 ${isHidden ? 'text-slate-300' : 'text-slate-400'}`} />
                              <div className="flex-1 min-w-0">
                                <p className={`text-base font-medium leading-tight truncate ${isHidden ? 'text-slate-400' : 'text-on-surface'}`}>
                                  {activityLabelById[a.id] && <span className="text-accent font-semibold">{activityLabelById[a.id]} · </span>}
                                  {a.nombre}
                                  {a.instrucciones && (
                                    <span className="text-sm font-normal text-on-surface"> — {htmlToPlainText(a.instrucciones)}</span>
                                  )}
                                </p>
                                {(a.fechaLimite || visState !== 'visible') && (
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    {a.fechaLimite && (
                                      <span className="text-xs text-amber-600 flex items-center gap-0.5">
                                        <Clock size={14} /> {new Date(a.fechaLimite).toLocaleDateString('es-MX')}
                                      </span>
                                    )}
                                    {visState === 'hidden' && (
                                      <span className="text-xs bg-surface-container text-muted px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                        <EyeOff size={13} /> Oculta
                                      </span>
                                    )}
                                    {visState === 'scheduled' && (
                                      <span className="text-xs bg-accent-light text-accent px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                        <Clock size={13} /> {formatPublishAt(a.publishAt)}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {counts.graded > 0 && (
                                  <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                    <CheckCircle size={13} /> {counts.graded}
                                  </span>
                                )}
                                {counts.delivered > 0 && (
                                  <span className="text-xs bg-accent-light text-accent px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                    <Circle size={13} /> {counts.delivered}
                                  </span>
                                )}
                              </div>
                            </button>
                            {/* Visibility toggle */}
                            {isHidden ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); setActivateMode('now'); setActivateDate(''); setActivateModal(a) }}
                                title="Activar para alumnos"
                                className="p-2 text-slate-300 hover:text-accent hover:bg-accent-light rounded transition-colors flex-shrink-0"
                              >
                                <EyeOff size={16} />
                              </button>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); hideActivity(a) }}
                                title="Ocultar para alumnos"
                                className="p-2 text-slate-400 hover:text-muted hover:bg-surface rounded transition-colors flex-shrink-0"
                              >
                                <Eye size={16} />
                              </button>
                            )}
                            <button onClick={() => openEdit(a)} title="Editar"
                              className="p-2 text-slate-400 hover:text-accent hover:bg-accent-light rounded transition-colors flex-shrink-0 mr-0.5">
                              <Pencil size={16} />
                            </button>
                            <button onClick={() => setDeleteConfirm(a)} title="Eliminar"
                              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0 mr-1">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )
                      })}
                      <button onClick={() => openAdd(p)}
                        title={canCreate ? undefined : 'Activa tu suscripción mensual para crear nuevas actividades'}
                        className={`w-full py-2.5 border-2 border-dashed rounded text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                          canCreate ? 'border-accent text-accent hover:bg-accent-light' : 'border-outline-variant text-slate-400 hover:bg-surface'
                        }`}>
                        <Plus size={17} /> Agregar actividad
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
          <div className="px-4 py-3 space-y-3">
            {/* 1 — Descargar calificaciones (Excel / PDF) */}
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Calificaciones</p>
              <div className="flex gap-2">
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  title="Descarga las calificaciones de todos los alumnos en una hoja de Excel"
                  className="flex-1 flex items-center justify-center gap-2 py-2 border border-outline-variant rounded text-sm text-muted hover:bg-surface transition-colors disabled:opacity-40"
                >
                  {exporting ? <Spinner size="sm" /> : <FileSpreadsheet size={17} />} Excel
                </button>
                <button
                  onClick={handleExportGradesPDF}
                  disabled={exportingGradesPdf}
                  title="Descarga las calificaciones de todos los alumnos en un PDF imprimible"
                  className="flex-1 flex items-center justify-center gap-2 py-2 border border-outline-variant rounded text-sm text-muted hover:bg-surface transition-colors disabled:opacity-40"
                >
                  {exportingGradesPdf ? <Spinner size="sm" /> : <FileText size={17} />} PDF
                </button>
              </div>
            </div>

            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={searchGrade} onChange={(e) => setSearchGrade(e.target.value)}
                placeholder="Buscar alumno…"
                className="w-full pl-9 pr-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface-card" />
            </div>

            {loadingGrades ? (
              <div className="flex justify-center py-12"><Spinner size="lg" /></div>
            ) : activities.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-12">No hay actividades en esta asignatura</p>
            ) : groupStudents.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-12">No hay alumnos en este grupo</p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-card shadow-card bg-surface-card -mx-4 sm:mx-0">
                  <table className="text-sm border-collapse min-w-[640px]">
                    <thead>
                      <tr className="bg-surface border-b border-outline-variant">
                        <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-xs font-medium text-muted whitespace-nowrap min-w-[170px] border-r border-outline-variant">
                          Alumno
                        </th>
                        {tableParcials.map(({ p, acts }) => (
                          <th key={p} colSpan={acts.length + 1}
                            className="px-2.5 py-2 text-xs font-semibold text-accent text-center border-l border-outline-variant whitespace-nowrap">
                            Parcial {p}
                          </th>
                        ))}
                        <th className="px-2.5 py-2 text-xs font-semibold text-muted text-center border-l border-outline-variant whitespace-nowrap">
                          Final
                        </th>
                      </tr>
                      <tr className="bg-surface-card border-b border-outline-variant">
                        <th className="sticky left-0 z-10 bg-surface-card px-3 py-2 text-left text-xs font-medium text-muted border-r border-outline-variant whitespace-nowrap">
                          Actividad
                        </th>
                        {tableParcials.map(({ p, acts }) => [
                          ...acts.map((a) => (
                            <th key={a.id} className="px-2.5 py-2 text-xs font-normal text-slate-400 text-center border-l border-outline-variant max-w-[96px]">
                              <span className="block truncate max-w-[88px]" title={a.nombre}>{activityLabelById[a.id] || a.nombre}</span>
                            </th>
                          )),
                          <th key={`avg-${p}`} className="px-2.5 py-2 text-xs font-semibold text-muted text-center border-l border-outline-variant whitespace-nowrap">
                            Prom.
                          </th>,
                        ])}
                        <th className="px-2.5 py-2 text-xs font-semibold text-muted text-center border-l border-outline-variant whitespace-nowrap">
                          Prom.
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {gradeRows.map(({ s, parcialData, finalAvg }, i) => (
                        <tr key={s.id} className={`border-t border-outline-variant ${i % 2 === 0 ? '' : 'bg-slate-50/50'}`}>
                          <td className={`sticky left-0 z-10 px-3 py-2 text-xs font-medium text-on-surface whitespace-nowrap border-r border-outline-variant ${i % 2 === 0 ? 'bg-surface-card' : 'bg-slate-50/50'}`}>
                            {s.apellidoPaterno} {s.nombre}
                          </td>
                          {parcialData.map(({ p, grades, avg }, pi) => [
                            ...tableParcials[pi].acts.map((a, ai) => (
                              <td key={a.id} className={`px-2.5 py-2 text-center text-xs font-semibold border-l border-outline-variant ${gradeColor(grades[ai])}`}>
                                {grades[ai] !== null ? grades[ai] : '—'}
                              </td>
                            )),
                            <td key={`avg-${p}`} className={`px-2.5 py-2 text-center text-xs font-bold border-l border-outline-variant ${gradeColor(avg)}`}>
                              {avg !== null ? avg : '—'}
                            </td>,
                          ])}
                          <td className={`px-2.5 py-2 text-center text-xs font-bold border-l border-outline-variant ${gradeColor(finalAvg)}`}>
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
        <div className="px-4 py-3 space-y-3">
          {/* 1 — Agregar alumnos con la plantilla de Excel (paso 1: descargar, paso 2: subir) */}
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Agregar alumnos con Excel</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={downloadStudentTemplate}
                className="flex-1 flex items-center justify-center text-center gap-2 py-2.5 px-3 border border-accent rounded text-sm text-accent hover:bg-accent-light transition-colors"
              >
                <Download size={17} className="flex-shrink-0" /> <strong>Paso 1</strong> · Descargar plantilla en Excel para pegar datos de alumnos
              </button>
              <label
                title="Sube exactamente el archivo de nuestra plantilla de Excel del paso 1"
                className="flex-1 flex items-center justify-center text-center gap-2 py-2.5 px-3 border border-accent rounded text-sm text-accent hover:bg-accent-light transition-colors cursor-pointer"
              >
                {savingStudent ? <Spinner size="sm" /> : <Upload size={17} className="flex-shrink-0" />} <strong>Paso 2</strong> · Subir la plantilla de Excel con los datos de los alumnos
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelImport} disabled={savingStudent} />
              </label>
            </div>
          </div>

          {/* 2 — Descargar lista de acceso (R16) */}
          <button
            type="button"
            onClick={() => setShowCredentialsModal(true)}
            title="Genera tu lista actualizada cada vez que agregues usuarios"
            className="w-full flex items-center justify-center gap-2 py-2.5 border border-accent rounded text-sm text-accent hover:bg-accent-light transition-colors"
          >
            <KeyRound size={17} /> <strong>Paso 3</strong> · Generar códigos para alumnos y descargar lista de acceso (usuarios + códigos)
          </button>

          {/* Ordenar alfabéticamente */}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={sortStudentsAlphabetically}
              disabled={groupStudents.length < 2}
              title="Ordena la lista por apellido y nombre"
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-accent transition-colors px-2 py-1 rounded hover:bg-accent-light disabled:opacity-40"
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
                placeholder="Buscar alumno…"
                className="w-full pl-9 pr-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface-card"
              />
            </div>
            <button
              onClick={() => setShowAddStudent(true)}
              title="Agregar nuevo alumno"
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
              {searchAlumnos ? 'Sin resultados' : 'No hay alumnos en esta asignatura'}
            </div>
          ) : (
            <div className="bg-surface-card rounded-card overflow-hidden shadow-card">
              {filteredAlumnos.map((s, i) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-3 px-3 py-2 ${i > 0 ? 'border-t border-outline-variant' : ''}`}
                >
                  <span className="w-5 text-sm text-slate-500 text-right flex-shrink-0">{s.orden}</span>
                  <div className="min-w-0 max-w-2xl">
                    <p className="text-sm font-medium text-on-surface truncate">
                      {fullStudentName(s)}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs font-mono text-accent font-semibold">{s.username}</span>
                      {s.activado ? (
                        <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">activo</span>
                      ) : (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">sin activar</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openEditStudent(s)}
                      className="p-1.5 text-slate-400 hover:text-accent rounded"
                      title="Editar alumno"
                    >
                      <Pencil size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </div>

      {/* ── Activity create/edit modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-surface-card w-full max-w-3xl rounded-t-card sm:rounded-card p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">
                {modalMode === 'create' ? `Nueva actividad — Parcial ${modalParcial}` : 'Editar actividad'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <p className="text-base text-on-surface -mt-2 mb-3">
              Actividad <strong className="text-accent">{previewActividad}</strong>
            </p>
            <form onSubmit={handleSaveActivity} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Nombre de la actividad</label>
                <input type="text" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                  required autoFocus
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder="Ej: Tarea 1, Examen parcial" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Instrucciones</label>
                <RichTextEditor
                  value={form.instrucciones}
                  onChange={(html) => setForm((f) => ({ ...f, instrucciones: html }))}
                  placeholder="Describe la tarea para tus alumnos…"
                />
              </div>
              <p className="text-sm text-muted">Calificación máxima: <span className="font-semibold text-on-surface">10</span></p>
              <div className="pt-1">
                <FileTypeSelect
                  value={form.tiposArchivo}
                  onChange={(v) => setForm((f) => ({ ...f, tiposArchivo: v }))}
                  customExts={form.extensionesCustom}
                  onCustomChange={(v) => setForm((f) => ({ ...f, extensionesCustom: v }))}
                />
              </div>

              {/* Visibilidad */}
              <div>
                <label className="block text-sm font-medium text-muted mb-2">Visibilidad</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-3 rounded border cursor-pointer transition-colors hover:bg-surface"
                    style={{ borderColor: !form.oculta ? 'var(--accent)' : '#e2e8f0', background: !form.oculta ? 'var(--accent-light)' : '' }}>
                    <input type="radio" name="visibilidad" checked={!form.oculta}
                      onChange={() => setForm((f) => ({ ...f, oculta: false, publishAt: '' }))}
                      className="accent-[var(--accent)]" />
                    <div>
                      <p className="text-sm font-medium text-on-surface">Mostrar ahora</p>
                      <p className="text-xs text-muted">Visible para alumnos de inmediato</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 rounded border cursor-pointer transition-colors hover:bg-surface"
                    style={{ borderColor: form.oculta && !form.publishAt ? 'var(--accent)' : '#e2e8f0', background: form.oculta && !form.publishAt ? 'var(--accent-light)' : '' }}>
                    <input type="radio" name="visibilidad" checked={!!(form.oculta && !form.publishAt)}
                      onChange={() => setForm((f) => ({ ...f, oculta: true, publishAt: '' }))}
                      className="accent-[var(--accent)]" />
                    <div>
                      <p className="text-sm font-medium text-on-surface">Ocultar</p>
                      <p className="text-xs text-muted">Solo tú lo ves, hasta que lo muestres o programes</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 rounded border cursor-pointer transition-colors hover:bg-surface"
                    style={{ borderColor: form.oculta && form.publishAt ? 'var(--accent)' : '#e2e8f0', background: form.oculta && form.publishAt ? 'var(--accent-light)' : '' }}>
                    <input type="radio" name="visibilidad" checked={!!(form.oculta && form.publishAt)}
                      onChange={() => setForm((f) => ({ ...f, oculta: true, publishAt: f.publishAt || '' }))}
                      className="accent-[var(--accent)]" />
                    <div>
                      <p className="text-sm font-medium text-on-surface">Programar</p>
                      <p className="text-xs text-muted">Se activa automáticamente en una fecha</p>
                    </div>
                  </label>
                  {form.oculta && (
                    <input
                      type="datetime-local"
                      value={form.publishAt}
                      onChange={(e) => setForm((f) => ({ ...f, publishAt: e.target.value, oculta: true }))}
                      className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                    />
                  )}
                </div>
              </div>

              {/* Fecha límite — hasta abajo */}
              <div>
                <label className="block text-sm font-medium text-muted mb-1">
                  Fecha límite <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                <input type="date" value={form.fechaLimite} onChange={(e) => setForm((f) => ({ ...f, fechaLimite: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
              </div>

              <button type="submit" disabled={saving}
                className="w-full py-2.5 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                {saving ? <Spinner size="sm" /> : modalMode === 'create' ? <Plus size={18} /> : <Pencil size={18} />}
                {saving ? 'Guardando…' : modalMode === 'create' ? 'Crear actividad' : 'Guardar cambios'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete activity confirmation ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteConfirm(null)} />
          <div className="relative bg-surface-card rounded-card p-5 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Eliminar actividad?</h3>
            <p className="text-sm text-muted mb-5">
              "<strong>{deleteConfirm.nombre}</strong>" se eliminará permanentemente.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-surface">Cancelar</button>
              <button onClick={handleDeleteActivity} disabled={deleting}
                className="flex-1 py-2.5 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {deleting ? <Spinner size="sm" /> : <Trash2 size={16} />}
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add student modal ── */}
      {showAddStudent && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowAddStudent(false)} />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">Agregar alumno</h3>
              <button onClick={() => setShowAddStudent(false)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={addStudent} className="space-y-3">
              {['apellidoPaterno', 'apellidoMaterno', 'nombre'].map((field) => (
                <input
                  key={field}
                  type="text"
                  value={newStudent[field]}
                  onChange={(e) => setNewStudent((f) => ({ ...f, [field]: e.target.value }))}
                  required
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
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
                className="w-full py-2.5 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {savingStudent ? <Spinner size="sm" /> : <Plus size={18} />}
                Agregar alumno
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit student modal ── */}
      {studentToEdit && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setStudentToEdit(null)} />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">Editar alumno</h3>
              <button onClick={() => setStudentToEdit(null)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={saveEditStudent} className="space-y-3">
              {['apellidoPaterno', 'apellidoMaterno', 'nombre'].map((field) => (
                <input
                  key={field}
                  type="text"
                  value={editStudentForm[field]}
                  onChange={(e) => setEditStudentForm((f) => ({ ...f, [field]: e.target.value }))}
                  required={field !== 'apellidoMaterno'}
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder={
                    field === 'apellidoPaterno' ? 'Apellido paterno'
                      : field === 'apellidoMaterno' ? 'Apellido materno'
                      : 'Nombre(s)'
                  }
                />
              ))}
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Comentarios (solo para ti, el alumno no los ve)</label>
                <textarea
                  value={editStudentForm.comentarios}
                  onChange={(e) => setEditStudentForm((f) => ({ ...f, comentarios: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface resize-none"
                  placeholder="Ej: necesita apoyo extra, cambió de grupo, etc."
                />
              </div>
              <button
                type="submit"
                disabled={savingStudent}
                className="w-full py-2.5 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {savingStudent ? <Spinner size="sm" /> : <Pencil size={18} />}
                Guardar cambios
              </button>
              <button
                type="button"
                onClick={requestResetFromEdit}
                disabled={savingStudent}
                className="w-full py-2.5 rounded border border-amber-200 text-amber-600 text-sm font-semibold hover:bg-amber-50 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <RotateCcw size={17} />
                Habilitar recuperación de contraseña
              </button>
              <button
                type="button"
                onClick={requestDeleteFromEdit}
                disabled={savingStudent}
                className="w-full py-2.5 rounded border border-red-200 text-red-500 text-sm font-semibold hover:bg-red-50 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <Trash2 size={17} />
                Eliminar alumno
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── QR modal ── */}
      {showQR && subject && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowQR(false)} />
          <div className="relative bg-surface-card w-[calc(100%-2rem)] max-w-xs rounded-card p-5 shadow-2xl text-center max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <div className="text-left">
                <h3 className="text-lg font-semibold leading-tight">{subject.nombre}</h3>
                {subject.grupo && <p className="text-sm text-muted">Grupo: {subject.grupo}</p>}
              </div>
              <button onClick={() => setShowQR(false)} className="p-2 text-slate-400 rounded flex-shrink-0"><X size={20} /></button>
            </div>
            <div className="flex justify-center p-4 bg-surface-card rounded border border-outline-variant mb-3">
              <QRCode value={activationUrl} size={200} className="max-w-full h-auto" />
            </div>
            <button
              onClick={handleExportQRPDF}
              disabled={exportingPdf}
              className="w-full flex items-center justify-center gap-2 py-2 rounded border border-accent text-accent text-sm font-semibold hover:bg-accent-light transition-colors disabled:opacity-50"
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
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-3">
              <KeyRound size={24} className="text-amber-500" />
            </div>
            <h3 className="text-lg font-semibold text-center text-on-surface">¿Habilitar recuperación de contraseña?</h3>
            <p className="text-sm text-muted text-center mt-2">
              <strong>{studentToReset.apellidoPaterno} {studentToReset.nombre}</strong>{' '}
              ({studentToReset.username}) podrá elegir una <strong>nueva contraseña</strong> desde
              «Recuperar contraseña» en su pantalla de acceso. No necesitas darle ninguna clave.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStudentToReset(null)}
                className="flex-1 py-2.5 bg-surface-container hover:bg-surface-dim text-muted font-semibold rounded transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmResetStudentPassword}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded transition-colors flex items-center justify-center gap-2"
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
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-full bg-accent-light flex items-center justify-center mx-auto mb-3">
              <KeyRound size={24} className="text-accent" />
            </div>
            <h3 className="text-lg font-semibold text-center text-on-surface">Descargar lista de acceso</h3>
            <p className="text-sm text-muted text-center mt-2">
              Se descargará un PDF con el <strong>usuario</strong> de cada alumno y el
              <strong> código de la clase</strong> para que puedan entrar por primera vez.
            </p>
            <p className="text-xs text-muted text-center mt-2">
              Cada alumno elige su propia contraseña la primera vez que entra. No se generan claves temporales.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCredentialsModal(false)}
                disabled={generatingCredentials}
                className="flex-1 py-2.5 bg-surface-container hover:bg-surface-dim text-muted font-semibold rounded transition-colors disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                onClick={handleGenerateCredentials}
                disabled={generatingCredentials}
                className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
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
          <div className="relative bg-surface-card w-[calc(100%-2rem)] max-w-sm rounded-card p-5 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-accent-light flex items-center justify-center mx-auto mb-3">
              <UserPlus size={24} className="text-accent" />
            </div>
            <h3 className="text-lg font-semibold text-center text-on-surface">¿Es el mismo alumno?</h3>
            <p className="text-sm text-muted text-center mt-2">
              Ya hay un alumno llamado{' '}
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
            <div className="flex flex-col gap-2 mt-6">
              <button
                onClick={() => resolveLinkCandidate(true)}
                disabled={savingStudent}
                className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {savingStudent ? <Spinner size="sm" /> : <CheckIcon size={18} />}
                Sí, es el mismo alumno
              </button>
              <button
                onClick={() => resolveLinkCandidate(false)}
                disabled={savingStudent}
                className="w-full py-2.5 bg-surface-container hover:bg-surface-dim text-muted font-semibold rounded transition-colors disabled:opacity-60"
              >
                No, es otro alumno (cuenta nueva)
              </button>
              <button
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
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-3">
              <KeyRound size={24} className="text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-center text-on-surface">Recuperación habilitada</h3>
            <p className="text-sm text-muted text-center mt-2 mb-5">
              <strong>{resetPwdResult.student.nombre}</strong> ya puede entrar a la pantalla de acceso
              de alumnos, tocar <strong>«Recuperar contraseña»</strong>, escribir su usuario y elegir una
              nueva contraseña.
            </p>
            <button
              onClick={() => setResetPwdResult(null)}
              className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors"
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
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
              <Trash2 size={24} className="text-red-500" />
            </div>
            <h3 className="text-lg font-semibold text-center text-on-surface">¿Eliminar alumno?</h3>
            <p className="text-sm text-muted text-center mt-2">
              Se eliminará a{' '}
              <strong>{studentToDelete.apellidoPaterno} {studentToDelete.nombre}</strong>{' '}
              ({studentToDelete.username}). Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStudentToDelete(null)}
                className="flex-1 py-2.5 bg-surface-container hover:bg-surface-dim text-muted font-semibold rounded transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteStudent}
                disabled={savingStudent}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {savingStudent ? <Spinner size="sm" /> : <Trash2 size={18} />}
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Activate activity modal ── */}
      {activateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setActivateModal(null)} />
          <div className="relative bg-surface-card rounded-card p-5 shadow-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-on-surface mb-1">Activar actividad</h3>
            <p className="text-sm text-muted mb-3">
              "<strong>{activateModal.nombre}</strong>" está oculta. ¿Cómo quieres activarla?
            </p>
            <div className="space-y-2 mb-3">
              <label className={`flex items-center gap-3 p-3 rounded border cursor-pointer transition-colors hover:bg-surface ${activateMode === 'now' ? 'border-accent bg-accent-light' : 'border-outline-variant'}`}>
                <input type="radio" name="activateMode" value="now" checked={activateMode === 'now'} onChange={() => setActivateMode('now')} className="accent-[var(--accent)]" />
                <div>
                  <p className="text-sm font-medium text-on-surface">Mostrar ahora</p>
                  <p className="text-sm text-slate-500">Visible de inmediato para alumnos</p>
                </div>
              </label>
              <label className={`flex items-center gap-3 p-3 rounded border cursor-pointer transition-colors hover:bg-surface ${activateMode === 'schedule' ? 'border-accent bg-accent-light' : 'border-outline-variant'}`}>
                <input type="radio" name="activateMode" value="schedule" checked={activateMode === 'schedule'} onChange={() => setActivateMode('schedule')} className="accent-[var(--accent)]" />
                <div>
                  <p className="text-sm font-medium text-on-surface">Programar</p>
                  <p className="text-sm text-slate-500">Se activa en fecha y hora específicas</p>
                </div>
              </label>
              {activateMode === 'schedule' && (
                <input
                  type="datetime-local"
                  value={activateDate}
                  onChange={(e) => setActivateDate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                />
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setActivateModal(null)}
                className="flex-1 py-2.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-surface">Cancelar</button>
              <button onClick={handleActivateConfirm}
                disabled={activateMode === 'schedule' && !activateDate}
                className="flex-1 py-2.5 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-50 flex items-center justify-center gap-2">
                <Eye size={16} /> Activar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit subject modal ── */}
      {showEditSubjectModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowEditSubjectModal(false)} />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">Editar asignatura</h3>
              <button onClick={() => setShowEditSubjectModal(false)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={handleEditSubject} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Asignatura</label>
                <input type="text" value={editSubjectForm.nombre} onChange={(e) => setEditSubjectForm((f) => ({ ...f, nombre: e.target.value }))}
                  required autoFocus
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder="Ej: Matemáticas I" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Grupo</label>
                <input type="text" value={editSubjectForm.grupo} onChange={(e) => setEditSubjectForm((f) => ({ ...f, grupo: e.target.value }))}
                  required
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder="Ej: 1A, 2B, 3C" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">
                  Fechas <span className="text-slate-400 font-normal text-xs">(opcional)</span>
                </label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <span className="block text-sm text-slate-500 mb-1">Inicio</span>
                    <input type="date" value={editSubjectForm.fechaInicio} onChange={(e) => setEditSubjectForm((f) => ({ ...f, fechaInicio: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
                  </div>
                  <div className="flex-1">
                    <span className="block text-sm text-slate-500 mb-1">Fin</span>
                    <input type="date" value={editSubjectForm.fechaFin} onChange={(e) => setEditSubjectForm((f) => ({ ...f, fechaFin: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Número de parciales</label>
                <select value={editSubjectForm.parciales} onChange={(e) => setEditSubjectForm((f) => ({ ...f, parciales: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface">
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
                className="w-full py-2.5 bg-accent text-white font-semibold rounded disabled:opacity-60 flex items-center justify-center gap-2">
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
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">Duplicar asignatura</h3>
              <button onClick={() => setShowCopyModal(false)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={handleCopySubject} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Asignatura</label>
                <input type="text" value={copyForm.nombre} onChange={(e) => setCopyForm((f) => ({ ...f, nombre: e.target.value }))}
                  required autoFocus
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder="Ej: Matemáticas II" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Grupo</label>
                <input type="text" value={copyForm.grupo} onChange={(e) => setCopyForm((f) => ({ ...f, grupo: e.target.value }))}
                  required
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder="Ej: 1A, 2B, 3C" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">
                  Fechas <span className="text-slate-400 font-normal text-xs">(opcional)</span>
                </label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <span className="block text-sm text-slate-500 mb-1">Inicio</span>
                    <input type="date" value={copyFechas.fechaInicio} onChange={(e) => setCopyFechas((f) => ({ ...f, fechaInicio: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
                  </div>
                  <div className="flex-1">
                    <span className="block text-sm text-slate-500 mb-1">Fin</span>
                    <input type="date" value={copyFechas.fechaFin} onChange={(e) => setCopyFechas((f) => ({ ...f, fechaFin: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
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
              <label className="flex items-center gap-3 p-3 rounded border border-outline-variant cursor-pointer hover:bg-surface transition-colors">
                <input type="checkbox" checked={copyForm.keepStudents} onChange={(e) => setCopyForm((f) => ({ ...f, keepStudents: e.target.checked }))}
                  className="accent-[var(--accent)] w-4 h-4" />
                <div>
                  <p className="text-sm font-medium text-on-surface">Copiar lista de alumnos</p>
                  <p className="text-sm text-slate-500">Conservan su mismo usuario y cuenta; quienes ya activaron verán esta asignatura al instante</p>
                </div>
              </label>
              <p className="text-sm text-slate-500">Se duplicarán todas las actividades. Las calificaciones y entregas no se copian.</p>
              <button type="submit" disabled={copyingSubject}
                className="w-full py-2.5 bg-accent text-white font-semibold rounded disabled:opacity-60 flex items-center justify-center gap-2">
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
          <div className="relative bg-surface-card rounded-card p-5 shadow-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
              <Trash2 size={24} className="text-red-500" />
            </div>
            <h3 className="text-base font-semibold text-on-surface text-center mb-1">¿Eliminar asignatura?</h3>
            <p className="text-sm text-muted text-center mb-3">
              Se borrarán permanentemente todas las actividades, entregas y alumnos de{' '}
              <strong>{subject?.nombre}</strong>. Esta acción <strong>no se puede deshacer</strong>.
            </p>
            <p className="text-xs text-muted mb-2">Escribe <strong>{subject?.nombre}</strong> para confirmar:</p>
            <input
              type="text"
              value={deleteSubjectConfirmText}
              onChange={(e) => setDeleteSubjectConfirmText(e.target.value)}
              className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-red-400 text-sm bg-surface mb-3"
              placeholder={subject?.nombre}
            />
            <div className="flex gap-3">
              <button onClick={() => { setShowDeleteSubjectConfirm(false); setDeleteSubjectConfirmText('') }}
                className="flex-1 py-2.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-surface">Cancelar</button>
              <button onClick={handleDeleteSubject}
                disabled={deletingSubject || deleteSubjectConfirmText !== subject?.nombre}
                className="flex-1 py-2.5 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40 flex items-center justify-center gap-2">
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
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Archivar asignatura</h3>
              <button onClick={() => !archiving && setShowArchiveModal(false)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <p className="text-sm text-muted mb-3">
              Al archivar se conservan las actividades y la lista de alumnos, pero <strong>se eliminan las entregas</strong>. ¿Qué hacemos con ellas?
            </p>
            <div className="space-y-2 mb-5">
              {[
                { val: 'save', label: 'Guardar entregas como ZIP', desc: 'Se descargan antes de eliminarlas' },
                { val: 'skip', label: 'Archivar sin guardar', desc: 'Las entregas se eliminan sin descargar' },
              ].map(({ val, label, desc }) => (
                <label key={val} className={`flex items-center gap-3 p-3 rounded border cursor-pointer transition-colors hover:bg-surface ${archiveExportChoice === val ? 'border-accent bg-accent-light' : 'border-outline-variant'}`}>
                  <input type="radio" name="archiveExport" value={val} checked={archiveExportChoice === val} onChange={() => setArchiveExportChoice(val)} className="accent-[var(--accent)]" />
                  <div>
                    <p className="text-sm font-medium text-on-surface">{label}</p>
                    <p className="text-sm text-slate-500">{desc}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowArchiveModal(false)} disabled={archiving}
                className="flex-1 py-2.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-surface disabled:opacity-60">Cancelar</button>
              <button onClick={handleArchiveConfirm} disabled={archiving}
                className="flex-1 py-2.5 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60 flex items-center justify-center gap-2">
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
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">Desarchivar asignatura</h3>
              <button onClick={() => setShowUnarchiveModal(false)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <p className="text-sm text-muted mb-3">Puedes editar los datos y elegir cómo restaurar:</p>

            <div className="space-y-3 mb-5">
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Datos</p>
                <div className="space-y-2">
                  <input type="text" value={unarchiveEdits.nombre} onChange={(e) => setUnarchiveEdits((f) => ({ ...f, nombre: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" placeholder="Asignatura" />
                  <input type="text" value={unarchiveEdits.grupo} onChange={(e) => setUnarchiveEdits((f) => ({ ...f, grupo: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" placeholder="Grupo (ej: 1A)" />
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <span className="block text-sm text-slate-500 mb-1">Inicio</span>
                      <input type="date" value={unarchiveEdits.fechaInicio} onChange={(e) => setUnarchiveEdits((f) => ({ ...f, fechaInicio: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-sm text-slate-500 mb-1">Fin</span>
                      <input type="date" value={unarchiveEdits.fechaFin} onChange={(e) => setUnarchiveEdits((f) => ({ ...f, fechaFin: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
                    </div>
                  </div>
                  <select value={unarchiveEdits.parciales} onChange={(e) => setUnarchiveEdits((f) => ({ ...f, parciales: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface">
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
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Lista de alumnos</p>
                <div className="space-y-1.5">
                  {[
                    { val: 'keep', label: 'Conservar lista', desc: 'Alumnos y calificaciones se mantienen' },
                    { val: 'reset', label: 'Borrar y empezar de cero', desc: 'Se eliminan alumnos y sus entregas' },
                  ].map(({ val, label, desc }) => (
                    <label key={val} className={`flex items-center gap-3 p-3 rounded border cursor-pointer transition-colors hover:bg-surface ${unarchiveStudents === val ? 'border-accent bg-accent-light' : 'border-outline-variant'}`}>
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
                    <label key={val} className={`flex items-center gap-3 p-3 rounded border cursor-pointer transition-colors hover:bg-surface ${unarchiveActivities === val ? 'border-accent bg-accent-light' : 'border-outline-variant'}`}>
                      <input type="radio" name="unarchiveActivities" value={val} checked={unarchiveActivities === val} onChange={() => setUnarchiveActivities(val)} className="accent-[var(--accent)]" />
                      <p className="text-sm font-medium text-on-surface">{label}</p>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowUnarchiveModal(false)}
                className="flex-1 py-2.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-surface">Cancelar</button>
              <button onClick={handleUnarchiveConfirm} disabled={unarchivedSaving}
                className="flex-1 py-2.5 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60 flex items-center justify-center gap-2">
                {unarchivedSaving ? <Spinner size="sm" /> : null}
                {unarchivedSaving ? 'Guardando…' : 'Desarchivar'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </TeacherLayout>
  )
}
