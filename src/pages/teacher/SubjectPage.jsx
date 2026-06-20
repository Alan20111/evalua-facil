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
import { exportSubjectGrades, parseStudentExcel, exportStudentListExcel, downloadStudentTemplate } from '../../utils/excel'
import { exportStudentListPDF } from '../../utils/pdf'
import { buildJobsForParcial, buildJobsForSubject, downloadSubmissionsZip } from '../../utils/downloadSubmissions'
import { deleteSubjectCascade, deleteSubjectStudents } from '../../utils/deleteSubjectCascade'
import { copySubject } from '../../utils/copySubject'
import { activityVisibilityState, formatPublishAt } from '../../utils/activityVisibility'
import { subjectDisplayName } from '../../utils/subjectName'
import FileTypeSelect from '../../components/FileTypeSelect'
import { DEFAULT_FILE_TYPE } from '../../config/fileTypes'
import {
  ArrowLeft, Plus, ChevronDown, ChevronUp, FileText, Clock,
  CheckCircle, Circle, X, Pencil, Trash2, Archive, ArchiveRestore,
  FileSpreadsheet, Search, UserCheck, UserX, LayoutList,
  ArrowUp, ArrowDown, UserPlus, RotateCcw, Upload, Download, QrCode,
  Link, Hash, Check as CheckIcon, KeyRound, Copy, FolderDown,
  Eye, EyeOff,
} from 'lucide-react'
import { QRCodeSVG as QRCode } from 'qrcode.react'
import { generateUsername, generateResetPassword } from '../../utils/generate'

function getCicloInfo() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  if (month >= 8) {
    return { current: `AGO ${year}-ENE ${year + 1}`, next: `FEB ${year + 1}-JUL ${year + 1}` }
  }
  return { current: `FEB ${year}-JUL ${year}`, next: `AGO ${year}-ENE ${year + 1}` }
}

const PARCIAL_BADGE = {
  1: 'bg-blue-100 text-blue-700',
  2: 'bg-violet-100 text-violet-700',
  3: 'bg-orange-100 text-orange-700',
  4: 'bg-emerald-100 text-emerald-700',
  5: 'bg-amber-100 text-amber-700',
  6: 'bg-rose-100 text-rose-700',
}

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

const EMPTY_FORM = { nombre: '', maxCalif: '10', instrucciones: '', fechaLimite: '', tiposArchivo: DEFAULT_FILE_TYPE, oculta: false, publishAt: '' }

function gradeColor(norm) {
  if (norm === null) return 'text-slate-300'
  if (norm >= 8) return 'text-emerald-700'
  if (norm >= 6) return 'text-amber-600'
  return 'text-red-500'
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtAttDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('es-MX', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

function attendanceColor(present, total) {
  if (!total) return 'text-slate-400'
  const p = present / total
  if (p >= 0.8) return 'text-emerald-700'
  if (p >= 0.6) return 'text-amber-600'
  return 'text-red-500'
}

export default function SubjectPage() {
  const { subjectId } = useParams()
  const { currentUser, userProfile } = useAuth()
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
  const [zipDownloading, setZipDownloading] = useState(false)
  const [zipProgress, setZipProgress] = useState({ done: 0, total: 0 })

  // Activity visibility
  const [activateModal, setActivateModal] = useState(null) // activity | null
  const [activateMode, setActivateMode] = useState('now') // 'now' | 'schedule'
  const [activateDate, setActivateDate] = useState('')

  // Subject CRUD
  const [showEditSubjectModal, setShowEditSubjectModal] = useState(false)
  const [editSubjectForm, setEditSubjectForm] = useState({ nombre: '', grupo: '', ciclo: '', parciales: '3' })
  const [editingSubject, setEditingSubject] = useState(false)
  const [showDeleteSubjectConfirm, setShowDeleteSubjectConfirm] = useState(false)
  const [deleteSubjectConfirmText, setDeleteSubjectConfirmText] = useState('')
  const [deletingSubject, setDeletingSubject] = useState(false)
  const [showCopyModal, setShowCopyModal] = useState(false)
  const [copyForm, setCopyForm] = useState({ nombre: '', keepStudents: false })
  const [copyCicloMode, setCopyCicloMode] = useState('current')
  const [copyingSubject, setCopyingSubject] = useState(false)

  // Unarchive modal
  const [showUnarchiveModal, setShowUnarchiveModal] = useState(false)
  const [unarchiveStudents, setUnarchiveStudents] = useState('keep') // 'keep' | 'reset'
  const [unarchiveActivities, setUnarchiveActivities] = useState('keep') // 'keep' | 'show' | 'hide'
  const [unarchivedSaving, setUnarchivedSaving] = useState(false)

  // Tab
  const [activeTab, setActiveTab] = useState('actividades')

  // Shared students (used by calificaciones + asistencia + alumnos tab)
  const [groupStudents, setGroupStudents] = useState([])
  const [groupStudentsLoaded, setGroupStudentsLoaded] = useState(false)

  // Copy feedback
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)

  // Student management (Alumnos tab)
  const [showAddStudent, setShowAddStudent] = useState(false)
  const [showQR, setShowQR] = useState(false)
  const [studentToDelete, setStudentToDelete] = useState(null)
  const [studentToReset, setStudentToReset] = useState(null)
  const [resetPwdResult, setResetPwdResult] = useState(null) // { student, tempPwd }
  const [copiedTempPwd, setCopiedTempPwd] = useState(false)
  const [newStudent, setNewStudent] = useState({ apellidoPaterno: '', apellidoMaterno: '', nombre: '' })
  const [savingStudent, setSavingStudent] = useState(false)
  const [searchAlumnos, setSearchAlumnos] = useState('')

  // Calificaciones
  const [gradeSubMap, setGradeSubMap] = useState({})
  const [gradesLoaded, setGradesLoaded] = useState(false)
  const [loadingGrades, setLoadingGrades] = useState(false)
  const [searchGrade, setSearchGrade] = useState('')

  // Asistencia
  const [attendanceSessions, setAttendanceSessions] = useState([])
  const [attendanceLoaded, setAttendanceLoaded] = useState(false)
  const [loadingAttendance, setLoadingAttendance] = useState(false)
  const [attendanceView, setAttendanceView] = useState('list') // 'list' | 'record'
  const [showSummary, setShowSummary] = useState(false)
  const [recordDate, setRecordDate] = useState(todayStr())
  const [recordParcial, setRecordParcial] = useState(1)
  const [recordPresence, setRecordPresence] = useState({})
  const [editingSessionId, setEditingSessionId] = useState(null)
  const [savingSession, setSavingSession] = useState(false)
  const [deleteSessionConfirm, setDeleteSessionConfirm] = useState(null)
  const [deletingSession, setDeletingSession] = useState(false)
  const [searchRecord, setSearchRecord] = useState('')

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
      let subData = { id: subSnap.id, ...subSnap.data() }
      if (!subData.accessCode) {
        const newCode = Math.random().toString(36).slice(2, 8).toUpperCase()
        await updateDoc(doc(db, 'subjects', subjectId), { accessCode: newCode })
        subData = { ...subData, accessCode: newCode }
      }
      setSubject(subData)
      const acts = actsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
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
    } catch (err) {
      toast('Error al cargar: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── Students (shared) ──────────────────────────────────────────────
  async function ensureGroupStudents() {
    if (groupStudentsLoaded) return groupStudents
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
  async function loadGrades() {
    setLoadingGrades(true)
    try {
      const students = await ensureGroupStudents()
      const subDocs = await fetchSubmissionsForActivities(activities.map((a) => a.id))
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

  // ── Asistencia ─────────────────────────────────────────────────────
  async function loadAttendance() {
    setLoadingAttendance(true)
    try {
      const [students, sessionsSnap] = await Promise.all([
        ensureGroupStudents(),
        getDocs(query(collection(db, 'attendance'), where('asignaturaId', '==', subjectId))),
      ])
      const sessions = sessionsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
      setAttendanceSessions(sessions)
      setAttendanceLoaded(true)
    } catch (err) {
      toast('Error al cargar asistencia: ' + err.message, 'error')
    } finally {
      setLoadingAttendance(false)
    }
  }

  function switchTab(tab) {
    setActiveTab(tab)
    if (tab === 'calificaciones' && !gradesLoaded) loadGrades()
    if (tab === 'asistencia' && !attendanceLoaded) loadAttendance()
    if (tab === 'alumnos' && !groupStudentsLoaded) ensureGroupStudents()
  }

  // ── Attendance actions ─────────────────────────────────────────────
  function startNewSession() {
    const presence = {}
    groupStudents.forEach((s) => { presence[s.id] = true })
    setRecordPresence(presence)
    setRecordDate(todayStr())
    setRecordParcial(1)
    setEditingSessionId(null)
    setSearchRecord('')
    setAttendanceView('record')
  }

  function startEditSession(session) {
    // Fill in all students; those not in session.asistencias default to false
    const presence = {}
    groupStudents.forEach((s) => { presence[s.id] = false })
    Object.entries(session.asistencias || {}).forEach(([id, val]) => { presence[id] = val })
    setRecordPresence(presence)
    setRecordDate(session.fecha)
    setRecordParcial(session.parcial)
    setEditingSessionId(session.id)
    setSearchRecord('')
    setAttendanceView('record')
  }

  function togglePresence(studentId) {
    setRecordPresence((prev) => ({ ...prev, [studentId]: !prev[studentId] }))
  }

  function setAllPresent(val) {
    const presence = {}
    groupStudents.forEach((s) => { presence[s.id] = val })
    setRecordPresence(presence)
  }

  async function saveSession() {
    setSavingSession(true)
    try {
      const payload = {
        asignaturaId: subjectId,
        docenteId: currentUser.uid,
        fecha: recordDate,
        parcial: recordParcial,
        asistencias: recordPresence,
      }
      if (editingSessionId) {
        await updateDoc(doc(db, 'attendance', editingSessionId), payload)
        setAttendanceSessions((prev) =>
          prev.map((s) => s.id === editingSessionId ? { ...s, ...payload } : s)
            .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
        )
        toast('Lista actualizada')
      } else {
        const ref = await addDoc(collection(db, 'attendance'), { ...payload, createdAt: serverTimestamp() })
        setAttendanceSessions((prev) =>
          [{ id: ref.id, ...payload }, ...prev]
            .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
        )
        toast('Asistencia registrada')
      }
      setAttendanceView('list')
      setEditingSessionId(null)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingSession(false)
    }
  }

  async function confirmDeleteSession() {
    if (!deleteSessionConfirm) return
    setDeletingSession(true)
    try {
      await deleteDoc(doc(db, 'attendance', deleteSessionConfirm.id))
      setAttendanceSessions((prev) => prev.filter((s) => s.id !== deleteSessionConfirm.id))
      toast('Sesión eliminada')
      setDeleteSessionConfirm(null)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setDeletingSession(false)
    }
  }

  // ── Student management (Alumnos tab) ──────────────────────────────
  async function fetchSchoolUsernames() {
    const snap = await getDocs(
      query(collection(db, 'students'), where('escuelaId', '==', userProfile.escuelaId))
    )
    return new Set(snap.docs.map((d) => d.data().username))
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
      const taken = await fetchSchoolUsernames()
      const username = uniqueUsername(
        generateUsername(newStudent.apellidoPaterno, newStudent.apellidoMaterno, newStudent.nombre),
        taken
      )
      await addDoc(collection(db, 'students'), {
        apellidoPaterno: newStudent.apellidoPaterno.trim(),
        apellidoMaterno: newStudent.apellidoMaterno.trim(),
        nombre: newStudent.nombre.trim(),
        username,
        resetPassword: generateResetPassword(),
        escuelaId: userProfile.escuelaId,
        asignaturaId: subjectId,
        activado: false,
        orden: groupStudents.length + 1,
        createdAt: serverTimestamp(),
      })
      setNewStudent({ apellidoPaterno: '', apellidoMaterno: '', nombre: '' })
      setShowAddStudent(false)
      toast('Alumno agregado')
      const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
      setGroupStudents(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)))
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingStudent(false)
    }
  }

  async function handleExcelImport(e) {
    const file = e.target.files[0]
    if (!file) return
    setSavingStudent(true)
    try {
      const rows = await parseStudentExcel(file)
      if (rows.length === 0) { toast('El archivo no tiene alumnos con los 3 campos requeridos', 'error'); return }
      const taken = await fetchSchoolUsernames()
      const batch = writeBatch(db)
      let nextOrden = groupStudents.length + 1
      for (const row of rows) {
        const username = uniqueUsername(
          generateUsername(row.apellidoPaterno, row.apellidoMaterno, row.nombre),
          taken
        )
        taken.add(username)
        const ref = doc(collection(db, 'students'))
        batch.set(ref, {
          ...row,
          username,
          resetPassword: generateResetPassword(),
          escuelaId: userProfile.escuelaId,
          asignaturaId: subjectId,
          activado: false,
          orden: nextOrden++,
          createdAt: serverTimestamp(),
        })
      }
      await batch.commit()
      toast(`${rows.length} alumnos importados`)
      const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
      setGroupStudents(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)))
    } catch (err) {
      toast('Error importando Excel: ' + err.message, 'error')
    } finally {
      setSavingStudent(false)
      e.target.value = ''
    }
  }

  function generateResetPassword() {
    return Math.random().toString(36).slice(2, 6).toUpperCase()
  }

  async function confirmResetStudentPassword() {
    if (!studentToReset) return
    const tempPwd = generateResetPassword()
    try {
      await updateDoc(doc(db, 'students', studentToReset.id), {
        activado: false,
        resetPassword: tempPwd,
      })
      setGroupStudents((prev) =>
        prev.map((s) => s.id === studentToReset.id ? { ...s, activado: false, resetPassword: tempPwd } : s)
      )
      setResetPwdResult({ student: studentToReset, tempPwd })
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

  async function moveStudent(index, direction) {
    const newList = [...groupStudents]
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= newList.length) return
    ;[newList[index], newList[targetIndex]] = [newList[targetIndex], newList[index]]
    const batch = writeBatch(db)
    newList.forEach((s, i) => batch.update(doc(db, 'students', s.id), { orden: i + 1 }))
    await batch.commit()
    setGroupStudents(newList.map((s, i) => ({ ...s, orden: i + 1 })))
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
    setModalMode('create'); setModalParcial(parcial); setEditActivityId(null)
    setForm(EMPTY_FORM); setShowModal(true)
  }
  function openEdit(activity) {
    setModalMode('edit'); setModalParcial(activity.parcial); setEditActivityId(activity.id)
    setForm({
      nombre: activity.nombre || '',
      maxCalif: String(activity.maxCalif ?? '10'),
      instrucciones: activity.instrucciones || '',
      fechaLimite: activity.fechaLimite || '',
      tiposArchivo: activity.tiposArchivo || DEFAULT_FILE_TYPE,
      oculta: activity.oculta || false,
      publishAt: activity.publishAt || '',
    })
    setShowModal(true)
  }

  async function handleSaveActivity(e) {
    e.preventDefault(); setSaving(true)
    const payload = {
      nombre: form.nombre.trim(),
      maxCalif: parseFloat(form.maxCalif) || 10,
      instrucciones: form.instrucciones.trim(),
      fechaLimite: form.fechaLimite || null,
      tiposArchivo: form.tiposArchivo || DEFAULT_FILE_TYPE,
      oculta: form.oculta || !!form.publishAt,
      publishAt: form.publishAt || null,
    }
    try {
      if (modalMode === 'create') {
        const ref = await addDoc(collection(db, 'activities'), {
          ...payload, tipo: 'archivo', parcial: modalParcial,
          asignaturaId: subjectId, docenteId: currentUser.uid, createdAt: serverTimestamp(),
        })
        setActivities((prev) => [...prev, { id: ref.id, ...payload, tipo: 'archivo', parcial: modalParcial, asignaturaId: subjectId, docenteId: currentUser.uid }])
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
      await deleteDoc(doc(db, 'activities', deleteConfirm.id))
      setActivities((prev) => prev.filter((a) => a.id !== deleteConfirm.id))
      toast('Actividad eliminada'); setDeleteConfirm(null)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setDeleting(false) }
  }

  async function handleToggleArchive() {
    if (!subject) return
    if (subject.archived) {
      // Unarchiving → open modal to ask options
      setUnarchiveStudents('keep')
      setUnarchiveActivities('keep')
      setShowUnarchiveModal(true)
      return
    }
    setArchiving(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), { archived: true })
      setSubject((s) => ({ ...s, archived: true }))
      toast('Asignatura archivada')
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setArchiving(false) }
  }

  async function handleUnarchiveConfirm() {
    setUnarchivedSaving(true)
    try {
      if (unarchiveStudents === 'reset') {
        await deleteSubjectStudents(subjectId)
        setGroupStudents([])
        setGroupStudentsLoaded(false)
        setGradesLoaded(false)
        setGradeSubMap({})
      }
      const updates = { archived: false }
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
      setSubject((s) => ({ ...s, archived: false }))
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
      ciclo: subject?.ciclo || '',
      parciales: String(subject?.parciales || 3),
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
      await updateDoc(doc(db, 'subjects', subjectId), {
        nombre: editSubjectForm.nombre.trim(),
        grupo: editSubjectForm.grupo.trim(),
        ciclo: editSubjectForm.ciclo.trim(),
        parciales: newParciales,
      })
      setSubject((s) => ({ ...s, nombre: editSubjectForm.nombre.trim(), grupo: editSubjectForm.grupo.trim(), ciclo: editSubjectForm.ciclo.trim(), parciales: newParciales }))
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
    setCopyForm({ nombre: subject?.nombre || '', grupo: subject?.grupo || '', keepStudents: false })
    setCopyCicloMode('current')
    setShowCopyModal(true)
  }

  async function handleCopySubject(e) {
    e.preventDefault()
    const cicloInfo = getCicloInfo()
    const ciclo = copyCicloMode === 'current' ? cicloInfo.current : cicloInfo.next
    setCopyingSubject(true)
    try {
      const newId = await copySubject({
        sourceSubjectId: subjectId,
        nombre: copyForm.nombre.trim(),
        grupo: copyForm.grupo.trim(),
        ciclo,
        parciales: subject?.parciales || 3,
        keepStudents: copyForm.keepStudents,
        docenteId: currentUser.uid,
        escuelaId: userProfile?.escuelaId,
      })
      toast('Asignatura copiada')
      setShowCopyModal(false)
      navigate(`/subject/${newId}`)
    } catch (err) { toast('Error al copiar: ' + err.message, 'error') }
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
        attendanceSessions: attendanceLoaded ? attendanceSessions : [],
      })
    } catch (err) { toast('Error al exportar: ' + err.message, 'error') }
    finally { setExporting(false) }
  }

  async function handleZip(level, parcial) {
    setZipDownloading(true)
    setZipProgress({ done: 0, total: 0 })
    try {
      const students = await ensureGroupStudents()
      const targetActs = level === 'parcial'
        ? activities.filter((a) => a.parcial === parcial)
        : activities
      if (targetActs.length === 0) { toast('No hay actividades en este parcial'); return }
      const rawDocs = await fetchSubmissionsForActivities(targetActs.map((a) => a.id))
      const submissions = rawDocs.map((d) => ({ id: d.id, ...d.data() }))
      const jobs = level === 'parcial'
        ? buildJobsForParcial({ subject, parcial, activities: targetActs, submissions, students })
        : buildJobsForSubject({ subject, activities: targetActs, submissions, students })
      if (jobs.length === 0) { toast('No hay archivos entregados para descargar'); return }
      const zipName = level === 'parcial'
        ? `${subjectDisplayName(subject)} - Parcial ${parcial}`
        : subjectDisplayName(subject)
      const { escritos, errores } = await downloadSubmissionsZip({
        zipName,
        jobs,
        onProgress: (done, total) => setZipProgress({ done, total }),
      })
      toast(errores > 0
        ? `Descargadas ${escritos} de ${escritos + errores} entregas (${errores} con error)`
        : `${escritos} entrega${escritos !== 1 ? 's' : ''} descargada${escritos !== 1 ? 's' : ''} en ZIP`)
    } catch (err) {
      toast('Error al generar ZIP: ' + err.message, 'error')
    } finally {
      setZipDownloading(false)
      setZipProgress({ done: 0, total: 0 })
    }
  }

  async function handleExportListPDF() {
    if (!subject) return
    setExportingPdf(true)
    try {
      let students = groupStudents
      if (!groupStudentsLoaded) {
        const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
        students = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        setGroupStudents(students); setGroupStudentsLoaded(true)
      }
      await exportStudentListPDF({ subject, students, activationUrl })
    } catch (err) {
      toast('Error al exportar PDF: ' + err.message, 'error')
    } finally {
      setExportingPdf(false)
    }
  }

  // ── Computed ───────────────────────────────────────────────────────
  const PARCIALES = Array.from({ length: subject?.parciales || 3 }, (_, i) => i + 1)

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

  // Attendance summary
  const sessionCounts = {}
  PARCIALES.forEach((p) => { sessionCounts[p] = 0 })
  attendanceSessions.forEach((s) => { if (s.parcial && sessionCounts[s.parcial] !== undefined) sessionCounts[s.parcial]++ })

  const attendanceSummary = {}
  groupStudents.forEach((s) => {
    attendanceSummary[s.id] = {}
    PARCIALES.forEach((p) => { attendanceSummary[s.id][p] = 0 })
  })
  attendanceSessions.forEach((session) => {
    Object.entries(session.asistencias || {}).forEach(([sId, present]) => {
      if (present && attendanceSummary[sId] && attendanceSummary[sId][session.parcial] !== undefined) {
        attendanceSummary[sId][session.parcial]++
      }
    })
  })

  const presentCount = Object.values(recordPresence).filter(Boolean).length
  const filteredRecordStudents = groupStudents.filter((s) => {
    if (!searchRecord.trim()) return true
    return `${s.apellidoPaterno} ${s.apellidoMaterno} ${s.nombre}`.toLowerCase()
      .includes(searchRecord.trim().toLowerCase())
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
      <div className="max-w-2xl mx-auto">

        {/* ── Header ── */}
        <div className="bg-white border-b border-slate-100 px-4 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/dashboard')} className="p-2 -ml-2 text-slate-400 hover:text-slate-600 rounded-lg">
              <ArrowLeft size={20} />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900 truncate">{subjectDisplayName(subject)}</h1>
                {subject?.archived && (
                  <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full flex-shrink-0">Archivada</span>
                )}
              </div>
              <p className="text-slate-400 text-xs">{subject?.ciclo}</p>
            </div>
            <button type="button" onClick={() => setShowQR(true)}
              title="Código QR de acceso"
              className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex-shrink-0">
              <QrCode size={19} />
            </button>
            <button type="button" onClick={copyActivationLink}
              title="Copiar link de activación"
              className={`p-2 rounded-lg transition-colors flex-shrink-0 ${copiedLink ? 'text-emerald-600 bg-emerald-50' : 'text-blue-600 hover:bg-blue-50'}`}>
              {copiedLink ? <CheckIcon size={19} /> : <Link size={19} />}
            </button>
            <button type="button" onClick={copyAccessCode}
              title="Copiar código de acceso"
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg transition-all duration-200 flex-shrink-0 font-mono font-bold text-sm ${copiedCode ? 'text-emerald-600 bg-emerald-50' : 'text-blue-600 hover:bg-blue-50'}`}>
              {copiedCode
                ? <><CheckIcon size={19} className="animate-bounce flex-shrink-0" /><span>Copiado</span></>
                : <><Hash size={19} className="flex-shrink-0" /><span>{subject?.accessCode}</span></>}
            </button>
            <button type="button" onClick={openEditSubject}
              title="Editar asignatura"
              className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex-shrink-0">
              <Pencil size={19} />
            </button>
            <button type="button" onClick={openCopyModal}
              title="Copiar asignatura"
              className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex-shrink-0">
              <Copy size={19} />
            </button>
            <button type="button" onClick={handleToggleArchive} disabled={archiving}
              title={subject?.archived ? 'Restaurar' : 'Archivar'}
              className="p-2 text-slate-400 hover:text-amber-600 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0">
              {subject?.archived ? <ArchiveRestore size={19} /> : <Archive size={19} />}
            </button>
            <button type="button" onClick={() => { setDeleteSubjectConfirmText(''); setShowDeleteSubjectConfirm(true) }}
              title="Eliminar asignatura"
              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
              <Trash2 size={19} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4 bg-slate-100 p-1 rounded-xl">
            {['actividades', 'calificaciones', 'asistencia', 'alumnos'].map((t) => (
              <button key={t} onClick={() => switchTab(t)}
                className={`flex-1 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors ${
                  activeTab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}>
                {t === 'actividades' ? 'Actividades' : t === 'calificaciones' ? 'Calif.' : t === 'asistencia' ? 'Asistencia' : 'Alumnos'}
              </button>
            ))}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════
            TAB: ACTIVIDADES
        ══════════════════════════════════════════════════════════ */}
        {activeTab === 'actividades' && (
          <div className="px-4 py-4 space-y-3">
            {PARCIALES.map((p) => {
              const acts = activities.filter((a) => a.parcial === p)
              const isOpen = openParcial === p
              return (
                <div key={p} className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                  <button onClick={() => setOpenParcial(isOpen ? 0 : p)}
                    className="w-full px-4 py-4 flex items-center gap-3 hover:bg-slate-50 transition-colors">
                    <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-700 font-bold text-sm">{p}</span>
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-semibold text-slate-900">Parcial {p}</p>
                      <p className="text-xs text-slate-400">{acts.length} actividad{acts.length !== 1 ? 'es' : ''}</p>
                    </div>
                    {isOpen ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100 pr-4 py-3">
                      <div className="ml-3 pl-3 border-l-2 border-blue-100 space-y-2">
                      {acts.length === 0 && (
                        <p className="text-slate-400 text-sm text-center py-3">Sin actividades</p>
                      )}
                      {acts.map((a) => {
                        const counts = submissionCounts[a.id] || {}
                        const visState = activityVisibilityState(a)
                        const isHidden = visState !== 'visible'
                        return (
                          <div key={a.id} className={`flex items-center gap-1 rounded-xl border bg-white transition-colors ${isHidden ? 'border-slate-100 opacity-60' : 'border-slate-100 hover:border-blue-100'}`}>
                            <button onClick={() => navigate(`/activity/${a.id}`)}
                              className="flex items-center gap-3 flex-1 min-w-0 px-3 py-3 text-left">
                              <FileText size={18} className={`flex-shrink-0 ${isHidden ? 'text-slate-300' : 'text-slate-400'}`} />
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium truncate ${isHidden ? 'text-slate-400' : 'text-slate-900'}`}>{a.nombre}</p>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  <span className="text-xs text-slate-400">Máx: {a.maxCalif}</span>
                                  {a.fechaLimite && (
                                    <span className="text-xs text-amber-600 flex items-center gap-0.5">
                                      <Clock size={10} /> {new Date(a.fechaLimite).toLocaleDateString('es-MX')}
                                    </span>
                                  )}
                                  {visState === 'hidden' && (
                                    <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                      <EyeOff size={9} /> Oculta
                                    </span>
                                  )}
                                  {visState === 'scheduled' && (
                                    <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                      <Clock size={9} /> {formatPublishAt(a.publishAt)}
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
                            {/* Visibility toggle */}
                            {isHidden ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); setActivateMode('now'); setActivateDate(''); setActivateModal(a) }}
                                title="Activar para alumnos"
                                className="p-2 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex-shrink-0"
                              >
                                <EyeOff size={14} />
                              </button>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); hideActivity(a) }}
                                title="Ocultar para alumnos"
                                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors flex-shrink-0"
                              >
                                <Eye size={14} />
                              </button>
                            )}
                            <button onClick={() => openEdit(a)} title="Editar"
                              className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex-shrink-0 mr-0.5">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => setDeleteConfirm(a)} title="Eliminar"
                              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0 mr-1">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )
                      })}
                      <button onClick={() => openAdd(p)}
                        className="w-full py-2.5 border-2 border-dashed border-blue-200 rounded-xl text-blue-600 text-sm font-medium hover:bg-blue-50 transition-colors flex items-center justify-center gap-2">
                        <Plus size={15} /> Agregar actividad
                      </button>
                      {acts.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleZip('parcial', p) }}
                          disabled={zipDownloading}
                          className="w-full py-2 border border-blue-100 rounded-xl text-blue-500 text-xs font-medium hover:bg-blue-50 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
                        >
                          {zipDownloading ? <Spinner size="sm" /> : <FolderDown size={13} />}
                          {zipDownloading
                            ? `Comprimiendo ${zipProgress.done}/${zipProgress.total}…`
                            : `Descargar Parcial ${p} como ZIP`}
                        </button>
                      )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Subject-level ZIP */}
            {activities.length > 0 && (
              <button
                onClick={() => handleZip('subject')}
                disabled={zipDownloading}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-blue-200 text-blue-700 text-sm font-medium hover:bg-blue-50 transition-colors disabled:opacity-40"
              >
                {zipDownloading ? <Spinner size="sm" /> : <FolderDown size={17} />}
                {zipDownloading
                  ? `Comprimiendo ${zipProgress.done}/${zipProgress.total}…`
                  : 'Descargar toda la asignatura como ZIP'}
              </button>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
            TAB: CALIFICACIONES
        ══════════════════════════════════════════════════════════ */}
        {activeTab === 'calificaciones' && (
          <div className="px-4 py-4 space-y-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={searchGrade} onChange={(e) => setSearchGrade(e.target.value)}
                placeholder="Buscar alumno…"
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white" />
            </div>

            {loadingGrades ? (
              <div className="flex justify-center py-12"><Spinner size="lg" /></div>
            ) : activities.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-12">No hay actividades en esta asignatura</p>
            ) : groupStudents.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-12">No hay alumnos en este grupo</p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm bg-white">
                  <table className="text-sm border-collapse min-w-full">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5 text-left text-xs font-medium text-slate-500 whitespace-nowrap min-w-[150px] border-r border-slate-100">
                          Alumno
                        </th>
                        {tableParcials.map(({ p, acts }) => (
                          <th key={p} colSpan={acts.length + 1}
                            className="px-2 py-2.5 text-xs font-semibold text-blue-700 text-center border-l border-slate-200 whitespace-nowrap">
                            Parcial {p}
                          </th>
                        ))}
                        <th className="px-2 py-2.5 text-xs font-semibold text-slate-600 text-center border-l border-slate-200 whitespace-nowrap">
                          Final
                        </th>
                      </tr>
                      <tr className="bg-white border-b border-slate-100">
                        <th className="sticky left-0 z-10 bg-white px-3 py-1.5 border-r border-slate-100" />
                        {tableParcials.map(({ p, acts }) => [
                          ...acts.map((a) => (
                            <th key={a.id} className="px-2 py-1.5 text-xs font-normal text-slate-400 text-center border-l border-slate-100 max-w-[80px]">
                              <span className="block truncate max-w-[76px]" title={a.nombre}>{a.nombre}</span>
                            </th>
                          )),
                          <th key={`avg-${p}`} className="px-2 py-1.5 text-xs font-semibold text-slate-500 text-center border-l border-slate-200 whitespace-nowrap">
                            Prom.
                          </th>,
                        ])}
                        <th className="px-2 py-1.5 text-xs font-semibold text-slate-500 text-center border-l border-slate-200 whitespace-nowrap">
                          Prom.
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {gradeRows.map(({ s, parcialData, finalAvg }, i) => (
                        <tr key={s.id} className={`border-t border-slate-100 ${i % 2 === 0 ? '' : 'bg-slate-50/50'}`}>
                          <td className={`sticky left-0 z-10 px-3 py-2.5 text-xs font-medium text-slate-900 whitespace-nowrap border-r border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                            {s.apellidoPaterno} {s.nombre}
                          </td>
                          {parcialData.map(({ p, grades, avg }, pi) => [
                            ...tableParcials[pi].acts.map((a, ai) => (
                              <td key={a.id} className={`px-2 py-2.5 text-center text-xs font-semibold border-l border-slate-100 ${gradeColor(grades[ai])}`}>
                                {grades[ai] !== null ? grades[ai] : '—'}
                              </td>
                            )),
                            <td key={`avg-${p}`} className={`px-2 py-2.5 text-center text-xs font-bold border-l border-slate-200 ${gradeColor(avg)}`}>
                              {avg !== null ? avg : '—'}
                            </td>,
                          ])}
                          <td className={`px-2 py-2.5 text-center text-xs font-bold border-l border-slate-200 ${gradeColor(finalAvg)}`}>
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

                <button onClick={handleExport} disabled={exporting}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-emerald-200 text-emerald-700 text-sm font-medium hover:bg-emerald-50 transition-colors disabled:opacity-40">
                  {exporting ? <Spinner size="sm" /> : <FileSpreadsheet size={17} />}
                  {exporting ? 'Generando Excel…' : 'Exportar calificaciones a Excel'}
                </button>
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
            TAB: ASISTENCIA — RECORD VIEW
        ══════════════════════════════════════════════════════════ */}
        {activeTab === 'asistencia' && attendanceView === 'record' && (
          <div className="px-4 py-4 space-y-3">
            {/* Record header */}
            <div className="flex items-center justify-between">
              <button onClick={() => { setAttendanceView('list'); setEditingSessionId(null) }}
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
                <X size={16} /> Cancelar
              </button>
              <span className="text-sm font-semibold text-slate-700">
                {presentCount} / {groupStudents.length} presentes
              </span>
              <button onClick={saveSession} disabled={savingSession}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center gap-2">
                {savingSession ? <Spinner size="sm" /> : null}
                Guardar
              </button>
            </div>

            {/* Date + parcial */}
            <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm flex flex-wrap gap-3 items-center">
              <div className="flex-1 min-w-[140px]">
                <label className="block text-xs text-slate-500 mb-1">Fecha</label>
                <input type="date" value={recordDate}
                  onChange={(e) => setRecordDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Parcial</label>
                <div className="flex gap-1.5">
                  {PARCIALES.map((p) => (
                    <button key={p} type="button" onClick={() => setRecordParcial(p)}
                      className={`w-10 h-10 rounded-xl text-sm font-bold transition-colors ${
                        recordParcial === p ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick actions + search */}
            <div className="flex gap-2">
              <button onClick={() => setAllPresent(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium rounded-xl hover:bg-emerald-100 transition-colors">
                <UserCheck size={14} /> Todos presentes
              </button>
              <button onClick={() => setAllPresent(false)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-red-50 border border-red-200 text-red-600 text-xs font-medium rounded-xl hover:bg-red-100 transition-colors">
                <UserX size={14} /> Marcar ausentes
              </button>
            </div>

            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={searchRecord} onChange={(e) => setSearchRecord(e.target.value)}
                placeholder="Buscar alumno…"
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white" />
            </div>

            {/* Student toggle list */}
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
              {filteredRecordStudents.map((s, i) => {
                const isPresent = !!recordPresence[s.id]
                return (
                  <button key={s.id} type="button" onClick={() => togglePresence(s.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                      i > 0 ? 'border-t border-slate-100' : ''
                    } ${isPresent ? 'hover:bg-emerald-50/60' : 'bg-red-50/40 hover:bg-red-50'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isPresent ? 'bg-emerald-100' : 'bg-red-100'
                    }`}>
                      {isPresent
                        ? <UserCheck size={16} className="text-emerald-600" />
                        : <UserX size={16} className="text-red-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${isPresent ? 'text-slate-900' : 'text-red-700'}`}>
                        {s.apellidoPaterno} {s.apellidoMaterno} {s.nombre}
                      </p>
                      <p className="text-xs text-slate-400 font-mono">{s.username}</p>
                    </div>
                    <span className={`text-xs font-semibold flex-shrink-0 ${isPresent ? 'text-emerald-600' : 'text-red-500'}`}>
                      {isPresent ? 'Presente' : 'Ausente'}
                    </span>
                  </button>
                )
              })}
              {filteredRecordStudents.length === 0 && (
                <p className="text-center py-8 text-slate-400 text-sm">Sin resultados</p>
              )}
            </div>

            {/* Bottom save */}
            <button onClick={saveSession} disabled={savingSession}
              className="w-full py-3.5 bg-blue-600 text-white text-sm font-semibold rounded-2xl hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {savingSession ? <Spinner size="sm" /> : <CheckCircle size={16} />}
              {savingSession ? 'Guardando…' : `Guardar — ${presentCount}/${groupStudents.length} presentes`}
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
            TAB: ASISTENCIA — LIST VIEW
        ══════════════════════════════════════════════════════════ */}
        {activeTab === 'asistencia' && attendanceView === 'list' && (
          <div className="px-4 py-4 space-y-3">
            {loadingAttendance ? (
              <div className="flex justify-center py-12"><Spinner size="lg" /></div>
            ) : (
              <>
                {/* Actions */}
                <div className="flex gap-2">
                  <button onClick={startNewSession}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors">
                    <Plus size={16} /> Nueva lista de asistencia
                  </button>
                  <button onClick={() => setShowSummary(!showSummary)}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                      showSummary
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}>
                    <LayoutList size={16} />
                    Resumen
                  </button>
                </div>

                {/* Stats chips */}
                <div className="flex gap-2 flex-wrap">
                  {PARCIALES.map((p) => (
                    <span key={p} className={`text-xs px-2.5 py-1 rounded-full font-medium ${PARCIAL_BADGE[p]}`}>
                      P{p}: {sessionCounts[p]} clase{sessionCounts[p] !== 1 ? 's' : ''}
                    </span>
                  ))}
                  <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium">
                    {attendanceSessions.length} total
                  </span>
                </div>

                {/* ── Summary table ── */}
                {showSummary && (
                  <div className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm bg-white">
                    <table className="text-sm border-collapse min-w-full">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <th className="sticky left-0 bg-slate-50 px-3 py-2.5 text-left text-xs font-medium text-slate-500 whitespace-nowrap min-w-[150px] border-r border-slate-100">Alumno</th>
                          {PARCIALES.map((p) => (
                            <th key={p} className={`px-4 py-2.5 text-xs font-semibold text-center border-l border-slate-100 whitespace-nowrap ${
                              sessionCounts[p] === 0 ? 'text-slate-300' : 'text-slate-700'
                            }`}>
                              P{p} /{sessionCounts[p]}
                            </th>
                          ))}
                          <th className="px-4 py-2.5 text-xs font-semibold text-slate-700 text-center border-l border-slate-200 whitespace-nowrap">
                            Total /{attendanceSessions.length}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupStudents.map((s, i) => {
                          const aSum = attendanceSummary[s.id] || {}
                          const totalPresent = PARCIALES.reduce((sum, p) => sum + (aSum[p] || 0), 0)
                          const totalSessions = attendanceSessions.length
                          return (
                            <tr key={s.id} className={`border-t border-slate-100 ${i % 2 === 0 ? '' : 'bg-slate-50/50'}`}>
                              <td className={`sticky left-0 px-3 py-2.5 text-xs font-medium text-slate-900 whitespace-nowrap border-r border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                {s.apellidoPaterno} {s.nombre}
                              </td>
                              {PARCIALES.map((p) => (
                                <td key={p} className={`px-4 py-2.5 text-center text-xs font-semibold border-l border-slate-100 ${
                                  sessionCounts[p] === 0 ? 'text-slate-300' : attendanceColor(aSum[p], sessionCounts[p])
                                }`}>
                                  {sessionCounts[p] === 0 ? '—' : aSum[p]}
                                </td>
                              ))}
                              <td className={`px-4 py-2.5 text-center text-xs font-bold border-l border-slate-200 ${attendanceColor(totalPresent, totalSessions)}`}>
                                {totalSessions === 0 ? '—' : totalPresent}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* ── Sessions list ── */}
                {attendanceSessions.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
                    <p className="text-slate-600 font-medium mb-1">Sin listas de asistencia</p>
                    <p className="text-slate-400 text-sm">Registra la primera lista con el botón de arriba</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                    {attendanceSessions.map((session, i) => {
                      const asistencias = session.asistencias || {}
                      const present = Object.values(asistencias).filter(Boolean).length
                      const total = groupStudents.length
                      const absent = total - present
                      return (
                        <div key={session.id}
                          className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-slate-900">{fmtAttDate(session.fecha)}</p>
                              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${PARCIAL_BADGE[session.parcial]}`}>
                                P{session.parcial}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 mt-0.5">
                              <span className="text-xs text-emerald-600 flex items-center gap-0.5">
                                <UserCheck size={11} /> {present} presentes
                              </span>
                              {absent > 0 && (
                                <span className="text-xs text-red-500 flex items-center gap-0.5">
                                  <UserX size={11} /> {absent} ausentes
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <span className={`text-sm font-bold ${attendanceColor(present, total)}`}>
                              {present}/{total}
                            </span>
                            <button onClick={() => startEditSession(session)}
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors ml-1">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => setDeleteSessionConfirm(session)}
                              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Export with attendance */}
                {attendanceSessions.length > 0 && (
                  <button onClick={handleExport} disabled={exporting}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-emerald-200 text-emerald-700 text-sm font-medium hover:bg-emerald-50 transition-colors disabled:opacity-40">
                    {exporting ? <Spinner size="sm" /> : <FileSpreadsheet size={17} />}
                    {exporting ? 'Generando Excel…' : 'Exportar calificaciones + asistencias a Excel'}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      {/* ══════════════════════════════════════════════════════════
          TAB: ALUMNOS
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'alumnos' && (
        <div className="px-4 py-4 space-y-3">
          {/* Search + add */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchAlumnos}
                onChange={(e) => setSearchAlumnos(e.target.value)}
                placeholder="Buscar alumno…"
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
              />
            </div>
            <button
              onClick={() => setShowAddStudent(true)}
              className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
            >
              <UserPlus size={18} />
            </button>
          </div>

          {/* Excel actions */}
          <div className="flex gap-2">
            <label className="flex-1 flex items-center justify-center gap-2 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors">
              <Upload size={15} /> Importar Excel
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelImport} disabled={savingStudent} />
            </label>
            <button
              onClick={() => exportStudentListExcel(groupStudents)}
              disabled={groupStudents.length === 0}
              className="flex-1 flex items-center justify-center gap-2 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40"
            >
              <Download size={15} /> Excel
            </button>
            <button
              onClick={handleExportListPDF}
              disabled={groupStudents.length === 0 || exportingPdf}
              className="flex-1 flex items-center justify-center gap-2 py-2 border border-blue-200 text-blue-700 rounded-xl text-sm hover:bg-blue-50 transition-colors disabled:opacity-40"
            >
              {exportingPdf ? <Spinner size="sm" /> : <Download size={15} />} PDF
            </button>
          </div>
          <button
            type="button"
            onClick={downloadStudentTemplate}
            className="w-full flex items-center justify-center gap-2 py-2 border border-blue-200 rounded-xl text-sm text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <Download size={15} /> Descargar plantilla de importación
          </button>

          {/* Student list */}
          {!groupStudentsLoaded ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : filteredAlumnos.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">
              {searchAlumnos ? 'Sin resultados' : 'No hay alumnos en esta asignatura'}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
              {filteredAlumnos.map((s, i) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-3 px-3 py-2.5 ${i > 0 ? 'border-t border-slate-100' : ''}`}
                >
                  <span className="w-5 text-xs text-slate-400 text-right flex-shrink-0">{s.orden}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {s.apellidoPaterno} {s.apellidoMaterno} {s.nombre}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs font-mono text-blue-600 font-semibold">{s.username}</span>
                      {s.activado ? (
                        <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">activo</span>
                      ) : (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">sin activar</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!searchAlumnos && (
                      <>
                        <button
                          onClick={() => moveStudent(i, -1)}
                          disabled={i === 0}
                          className="p-1.5 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          onClick={() => moveStudent(i, 1)}
                          disabled={i === filteredAlumnos.length - 1}
                          className="p-1.5 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded"
                        >
                          <ArrowDown size={14} />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setStudentToReset(s)}
                      className="p-1.5 text-amber-500 hover:text-amber-700 rounded"
                      title="Resetear contraseña"
                    >
                      <RotateCcw size={14} />
                    </button>
                    <button
                      onClick={() => setStudentToDelete(s)}
                      className="p-1.5 text-slate-300 hover:text-red-500 rounded"
                      title="Eliminar alumno"
                    >
                      <Trash2 size={14} />
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
                <input type="text" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                  required autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50"
                  placeholder="Ej: Tarea 1, Examen parcial" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Calificación máxima</label>
                <input type="number" value={form.maxCalif} onChange={(e) => setForm((f) => ({ ...f, maxCalif: e.target.value }))}
                  required min="1" max="100"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Instrucciones <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                <textarea value={form.instrucciones} onChange={(e) => setForm((f) => ({ ...f, instrucciones: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50 resize-none"
                  placeholder="Describe la tarea para tus alumnos…" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Fecha límite <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                <input type="date" value={form.fechaLimite} onChange={(e) => setForm((f) => ({ ...f, fechaLimite: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50" />
              </div>
              <div className="pt-1">
                <FileTypeSelect value={form.tiposArchivo} onChange={(v) => setForm((f) => ({ ...f, tiposArchivo: v }))} />
              </div>

              {/* Visibilidad */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Visibilidad</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-slate-50"
                    style={{ borderColor: !form.oculta ? '#3b82f6' : '#e2e8f0', background: !form.oculta ? '#eff6ff' : '' }}>
                    <input type="radio" name="visibilidad" checked={!form.oculta}
                      onChange={() => setForm((f) => ({ ...f, oculta: false, publishAt: '' }))}
                      className="accent-blue-600" />
                    <div>
                      <p className="text-sm font-medium text-slate-800">Mostrar ahora</p>
                      <p className="text-xs text-slate-500">Visible para alumnos de inmediato</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-slate-50"
                    style={{ borderColor: form.oculta && !form.publishAt ? '#3b82f6' : '#e2e8f0', background: form.oculta && !form.publishAt ? '#eff6ff' : '' }}>
                    <input type="radio" name="visibilidad" checked={!!(form.oculta && !form.publishAt)}
                      onChange={() => setForm((f) => ({ ...f, oculta: true, publishAt: '' }))}
                      className="accent-blue-600" />
                    <div>
                      <p className="text-sm font-medium text-slate-800">Ocultar</p>
                      <p className="text-xs text-slate-500">Solo tú la ves; alumnos no</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-slate-50"
                    style={{ borderColor: form.oculta && form.publishAt ? '#3b82f6' : '#e2e8f0', background: form.oculta && form.publishAt ? '#eff6ff' : '' }}>
                    <input type="radio" name="visibilidad" checked={!!(form.oculta && form.publishAt)}
                      onChange={() => setForm((f) => ({ ...f, oculta: true, publishAt: f.publishAt || '' }))}
                      className="accent-blue-600" />
                    <div>
                      <p className="text-sm font-medium text-slate-800">Programar</p>
                      <p className="text-xs text-slate-500">Se activa automáticamente en una fecha</p>
                    </div>
                  </label>
                  {form.oculta && (
                    <input
                      type="datetime-local"
                      value={form.publishAt}
                      onChange={(e) => setForm((f) => ({ ...f, publishAt: e.target.value, oculta: true }))}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50"
                    />
                  )}
                </div>
              </div>

              <button type="submit" disabled={saving}
                className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                {saving ? <Spinner size="sm" /> : modalMode === 'create' ? <Plus size={16} /> : <Pencil size={16} />}
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
          <div className="relative bg-white rounded-2xl p-6 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-slate-900 mb-1">¿Eliminar actividad?</h3>
            <p className="text-sm text-slate-500 mb-5">
              "<strong>{deleteConfirm.nombre}</strong>" se eliminará permanentemente.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50">Cancelar</button>
              <button onClick={handleDeleteActivity} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {deleting ? <Spinner size="sm" /> : <Trash2 size={14} />}
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete session confirmation ── */}
      {deleteSessionConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteSessionConfirm(null)} />
          <div className="relative bg-white rounded-2xl p-6 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-slate-900 mb-1">¿Eliminar lista?</h3>
            <p className="text-sm text-slate-500 mb-5">
              La asistencia del <strong>{fmtAttDate(deleteSessionConfirm.fecha)}</strong> (Parcial {deleteSessionConfirm.parcial}) se eliminará permanentemente.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteSessionConfirm(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50">Cancelar</button>
              <button onClick={confirmDeleteSession} disabled={deletingSession}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {deletingSession ? <Spinner size="sm" /> : <Trash2 size={14} />}
                {deletingSession ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add student modal ── */}
      {showAddStudent && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowAddStudent(false)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">Agregar alumno</h3>
              <button onClick={() => setShowAddStudent(false)} className="p-2 text-slate-400 rounded-lg"><X size={18} /></button>
            </div>
            <form onSubmit={addStudent} className="space-y-3">
              {['apellidoPaterno', 'apellidoMaterno', 'nombre'].map((field) => (
                <input
                  key={field}
                  type="text"
                  value={newStudent[field]}
                  onChange={(e) => setNewStudent((f) => ({ ...f, [field]: e.target.value }))}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50"
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
                className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {savingStudent ? <Spinner size="sm" /> : <Plus size={16} />}
                Agregar alumno
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── QR modal ── */}
      {showQR && subject && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowQR(false)} />
          <div className="relative bg-white w-full max-w-xs rounded-2xl p-6 shadow-2xl text-center">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">QR de acceso</h3>
              <button onClick={() => setShowQR(false)} className="p-2 text-slate-400 rounded-lg"><X size={18} /></button>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              Proyecta este QR en clase para que tus alumnos activen su cuenta.
            </p>
            <div className="flex justify-center p-4 bg-white rounded-xl border border-slate-100 mb-3">
              <QRCode value={activationUrl} size={180} />
            </div>
            <div className="mt-3 space-y-2">
              <button
                onClick={copyActivationLink}
                className={`w-full flex items-center justify-center gap-2 py-2 rounded-xl border text-sm font-semibold transition-colors ${copiedLink ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              >
                {copiedLink ? <CheckIcon size={15} /> : <Link size={15} />}
                {copiedLink ? 'Link copiado' : 'Copiar link de activación'}
              </button>
              <button
                onClick={copyAccessCode}
                className={`w-full flex items-center justify-center gap-2 py-2 rounded-xl border text-sm font-semibold transition-colors ${copiedCode ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              >
                {copiedCode ? <CheckIcon size={15} /> : <Hash size={15} />}
                {copiedCode ? 'Código copiado' : `Copiar código: ${subject.accessCode}`}
              </button>
              <button
                onClick={handleExportListPDF}
                disabled={exportingPdf}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-blue-200 text-blue-700 text-sm font-semibold hover:bg-blue-50 transition-colors disabled:opacity-50"
              >
                {exportingPdf ? <Spinner size="sm" /> : <Download size={15} />}
                {exportingPdf ? 'Generando PDF…' : 'Descargar lista en PDF'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reset password confirmation ── */}
      {studentToReset && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setStudentToReset(null)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
              <RotateCcw size={22} className="text-amber-500" />
            </div>
            <h3 className="text-lg font-semibold text-center text-slate-900">¿Restablecer contraseña?</h3>
            <p className="text-sm text-slate-500 text-center mt-2">
              Se generará una contraseña temporal para{' '}
              <strong>{studentToReset.apellidoPaterno} {studentToReset.nombre}</strong>{' '}
              ({studentToReset.username}). El alumno deberá activar su cuenta de nuevo con QR, link o código.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStudentToReset(null)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmResetStudentPassword}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <RotateCcw size={16} />
                Restablecer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reset password result (show temp password to teacher) ── */}
      {resetPwdResult && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setResetPwdResult(null)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
              <KeyRound size={22} className="text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-center text-slate-900">Contraseña restablecida</h3>
            <p className="text-sm text-slate-500 text-center mt-1 mb-4">
              Comparte esta contraseña temporal con{' '}
              <strong>{resetPwdResult.student.nombre}</strong>. El alumno la usará al activar su cuenta para crear una nueva contraseña.
            </p>
            <div
              onClick={() => {
                navigator.clipboard.writeText(resetPwdResult.tempPwd)
                setCopiedTempPwd(true)
                setTimeout(() => setCopiedTempPwd(false), 2000)
              }}
              className="cursor-pointer flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-5 hover:bg-blue-50 hover:border-blue-200 transition-colors"
            >
              <span className="font-mono text-xl font-bold tracking-widest text-slate-800 select-all">
                {resetPwdResult.tempPwd}
              </span>
              {copiedTempPwd
                ? <CheckIcon size={18} className="text-emerald-500 flex-shrink-0 animate-bounce" />
                : <Copy size={18} className="text-slate-400 flex-shrink-0" />}
            </div>
            <button
              onClick={() => setResetPwdResult(null)}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
            >
              Listo
            </button>
          </div>
        </div>
      )}

      {/* ── Delete student confirmation ── */}
      {studentToDelete && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setStudentToDelete(null)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <Trash2 size={22} className="text-red-500" />
            </div>
            <h3 className="text-lg font-semibold text-center text-slate-900">¿Eliminar alumno?</h3>
            <p className="text-sm text-slate-500 text-center mt-2">
              Se eliminará a{' '}
              <strong>{studentToDelete.apellidoPaterno} {studentToDelete.nombre}</strong>{' '}
              ({studentToDelete.username}). Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStudentToDelete(null)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteStudent}
                disabled={savingStudent}
                className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {savingStudent ? <Spinner size="sm" /> : <Trash2 size={16} />}
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
          <div className="relative bg-white rounded-2xl p-6 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-slate-900 mb-1">Activar actividad</h3>
            <p className="text-sm text-slate-500 mb-4">
              "<strong>{activateModal.nombre}</strong>" está oculta. ¿Cómo quieres activarla?
            </p>
            <div className="space-y-2 mb-4">
              <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-slate-50 ${activateMode === 'now' ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}>
                <input type="radio" name="activateMode" value="now" checked={activateMode === 'now'} onChange={() => setActivateMode('now')} className="accent-blue-600" />
                <div>
                  <p className="text-sm font-medium text-slate-800">Mostrar ahora</p>
                  <p className="text-xs text-slate-400">Visible de inmediato para alumnos</p>
                </div>
              </label>
              <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-slate-50 ${activateMode === 'schedule' ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}>
                <input type="radio" name="activateMode" value="schedule" checked={activateMode === 'schedule'} onChange={() => setActivateMode('schedule')} className="accent-blue-600" />
                <div>
                  <p className="text-sm font-medium text-slate-800">Programar</p>
                  <p className="text-xs text-slate-400">Se activa en fecha y hora específicas</p>
                </div>
              </label>
              {activateMode === 'schedule' && (
                <input
                  type="datetime-local"
                  value={activateDate}
                  onChange={(e) => setActivateDate(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50"
                />
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setActivateModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50">Cancelar</button>
              <button onClick={handleActivateConfirm}
                disabled={activateMode === 'schedule' && !activateDate}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
                <Eye size={14} /> Activar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit subject modal ── */}
      {showEditSubjectModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowEditSubjectModal(false)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">Editar materia</h3>
              <button onClick={() => setShowEditSubjectModal(false)} className="p-2 text-slate-400 rounded-lg"><X size={18} /></button>
            </div>
            <form onSubmit={handleEditSubject} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Materia</label>
                <input type="text" value={editSubjectForm.nombre} onChange={(e) => setEditSubjectForm((f) => ({ ...f, nombre: e.target.value }))}
                  required autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50"
                  placeholder="Ej: Matemáticas I" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Grupo</label>
                <input type="text" value={editSubjectForm.grupo} onChange={(e) => setEditSubjectForm((f) => ({ ...f, grupo: e.target.value }))}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50"
                  placeholder="Ej: 1A, 2B, 3C" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Ciclo escolar</label>
                <input type="text" value={editSubjectForm.ciclo} onChange={(e) => setEditSubjectForm((f) => ({ ...f, ciclo: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50"
                  placeholder="Ej: 2024-2025" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Número de parciales</label>
                <select value={editSubjectForm.parciales} onChange={(e) => setEditSubjectForm((f) => ({ ...f, parciales: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50">
                  {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} parciales</option>)}
                </select>
              </div>
              <button type="submit" disabled={editingSubject}
                className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl disabled:opacity-60 flex items-center justify-center gap-2">
                {editingSubject ? <Spinner size="sm" /> : <Pencil size={16} />}
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
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">Copiar materia</h3>
              <button onClick={() => setShowCopyModal(false)} className="p-2 text-slate-400 rounded-lg"><X size={18} /></button>
            </div>
            <form onSubmit={handleCopySubject} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Materia</label>
                <input type="text" value={copyForm.nombre} onChange={(e) => setCopyForm((f) => ({ ...f, nombre: e.target.value }))}
                  required autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50"
                  placeholder="Ej: Matemáticas II" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Grupo</label>
                <input type="text" value={copyForm.grupo} onChange={(e) => setCopyForm((f) => ({ ...f, grupo: e.target.value }))}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50"
                  placeholder="Ej: 1A, 2B, 3C" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Período escolar</label>
                <div className="flex rounded-xl overflow-hidden border border-slate-200">
                  {[
                    { label: 'Período actual', mode: 'current', value: getCicloInfo().current },
                    { label: 'Siguiente', mode: 'next', value: getCicloInfo().next },
                  ].map(({ label, mode, value }, i) => (
                    <button key={mode} type="button" onClick={() => setCopyCicloMode(mode)}
                      className={`flex-1 py-2.5 px-2 text-center transition-colors ${i > 0 ? 'border-l border-slate-200' : ''} ${copyCicloMode === mode ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                      <span className={`block text-xs mb-0.5 ${copyCicloMode === mode ? 'text-blue-200' : 'text-slate-400'}`}>{label}</span>
                      <span className="block text-sm font-semibold">{value}</span>
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors">
                <input type="checkbox" checked={copyForm.keepStudents} onChange={(e) => setCopyForm((f) => ({ ...f, keepStudents: e.target.checked }))}
                  className="accent-blue-600 w-4 h-4" />
                <div>
                  <p className="text-sm font-medium text-slate-800">Copiar lista de alumnos</p>
                  <p className="text-xs text-slate-400">Se generan nuevas credenciales; alumnos deberán reactivar su cuenta</p>
                </div>
              </label>
              <p className="text-xs text-slate-400">Se copiarán todas las actividades. Las calificaciones y entregas no se copian.</p>
              <button type="submit" disabled={copyingSubject}
                className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl disabled:opacity-60 flex items-center justify-center gap-2">
                {copyingSubject ? <Spinner size="sm" /> : <Copy size={16} />}
                {copyingSubject ? 'Copiando…' : 'Crear copia'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete subject confirm modal ── */}
      {showDeleteSubjectConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setShowDeleteSubjectConfirm(false); setDeleteSubjectConfirmText('') }} />
          <div className="relative bg-white rounded-2xl p-6 shadow-2xl w-full max-w-sm">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <Trash2 size={22} className="text-red-500" />
            </div>
            <h3 className="text-base font-semibold text-slate-900 text-center mb-1">¿Eliminar materia?</h3>
            <p className="text-sm text-slate-500 text-center mb-4">
              Se borrarán permanentemente todas las actividades, entregas, alumnos y asistencias de{' '}
              <strong>{subject?.nombre}</strong>. Esta acción <strong>no se puede deshacer</strong>.
            </p>
            <p className="text-xs text-slate-500 mb-2">Escribe <strong>{subject?.nombre}</strong> para confirmar:</p>
            <input
              type="text"
              value={deleteSubjectConfirmText}
              onChange={(e) => setDeleteSubjectConfirmText(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-400 text-sm bg-slate-50 mb-4"
              placeholder={subject?.nombre}
            />
            <div className="flex gap-3">
              <button onClick={() => { setShowDeleteSubjectConfirm(false); setDeleteSubjectConfirmText('') }}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50">Cancelar</button>
              <button onClick={handleDeleteSubject}
                disabled={deletingSubject || deleteSubjectConfirmText !== subject?.nombre}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40 flex items-center justify-center gap-2">
                {deletingSubject ? <Spinner size="sm" /> : <Trash2 size={14} />}
                {deletingSubject ? 'Eliminando…' : 'Eliminar todo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Unarchive modal ── */}
      {showUnarchiveModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowUnarchiveModal(false)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">Desarchivar materia</h3>
              <button onClick={() => setShowUnarchiveModal(false)} className="p-2 text-slate-400 rounded-lg"><X size={18} /></button>
            </div>
            <p className="text-sm text-slate-500 mb-4">Elige cómo quieres restaurar la materia:</p>

            <div className="space-y-3 mb-5">
              <div>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Lista de alumnos</p>
                <div className="space-y-1.5">
                  {[
                    { val: 'keep', label: 'Conservar lista', desc: 'Alumnos y calificaciones se mantienen' },
                    { val: 'reset', label: 'Borrar y empezar de cero', desc: 'Se eliminan alumnos y sus entregas' },
                  ].map(({ val, label, desc }) => (
                    <label key={val} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-slate-50 ${unarchiveStudents === val ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}>
                      <input type="radio" name="unarchiveStudents" value={val} checked={unarchiveStudents === val} onChange={() => setUnarchiveStudents(val)} className="accent-blue-600" />
                      <div>
                        <p className="text-sm font-medium text-slate-800">{label}</p>
                        <p className="text-xs text-slate-400">{desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Actividades</p>
                <div className="space-y-1.5">
                  {[
                    { val: 'keep', label: 'Conservar visibilidad actual' },
                    { val: 'show', label: 'Mostrar todas' },
                    { val: 'hide', label: 'Ocultar todas' },
                  ].map(({ val, label }) => (
                    <label key={val} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-slate-50 ${unarchiveActivities === val ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}>
                      <input type="radio" name="unarchiveActivities" value={val} checked={unarchiveActivities === val} onChange={() => setUnarchiveActivities(val)} className="accent-blue-600" />
                      <p className="text-sm font-medium text-slate-800">{label}</p>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowUnarchiveModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50">Cancelar</button>
              <button onClick={handleUnarchiveConfirm} disabled={unarchivedSaving}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {unarchivedSaving ? <Spinner size="sm" /> : null}
                {unarchivedSaving ? 'Guardando…' : 'Desarchivar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </TeacherLayout>
  )
}
