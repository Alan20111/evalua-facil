import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  collection, query, where, getDocs, getDoc,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import { exportSubjectGrades } from '../../utils/excel'
import {
  ArrowLeft, Plus, ChevronDown, ChevronUp, FileText, Clock,
  CheckCircle, Circle, X, Pencil, Trash2, Archive, ArchiveRestore,
  FileSpreadsheet, Search, UserCheck, UserX, LayoutList,
} from 'lucide-react'

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

const EMPTY_FORM = { nombre: '', maxCalif: '10', instrucciones: '', fechaLimite: '' }

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
  const { currentUser } = useAuth()
  const [subject, setSubject] = useState(null)
  const [group, setGroup] = useState(null)
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

  // Tab
  const [activeTab, setActiveTab] = useState('actividades')

  // Shared students (used by calificaciones + asistencia)
  const [groupStudents, setGroupStudents] = useState([])
  const [groupStudentsLoaded, setGroupStudentsLoaded] = useState(false)

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

  // ── Students (shared) ──────────────────────────────────────────────
  async function ensureGroupStudents(subjectData) {
    if (groupStudentsLoaded) return groupStudents
    const snap = await getDocs(
      query(collection(db, 'students'), where('grupoId', '==', (subjectData || subject).grupoId))
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
        grupoId: subject.grupoId,
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
    if (!subject) return; setArchiving(true)
    const next = !subject.archived
    try {
      await updateDoc(doc(db, 'subjects', subjectId), { archived: next })
      setSubject((s) => ({ ...s, archived: next }))
      toast(next ? 'Asignatura archivada' : 'Asignatura restaurada')
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setArchiving(false) }
  }

  async function handleExport() {
    if (!subject || !group) return; setExporting(true)
    try {
      let students = groupStudents
      let subMap = gradeSubMap
      if (!groupStudentsLoaded) {
        const snap = await getDocs(query(collection(db, 'students'), where('grupoId', '==', subject.grupoId)))
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
        subject, group, activities, students,
        submissions: Object.values(subMap),
        attendanceSessions: attendanceLoaded ? attendanceSessions : [],
      })
    } catch (err) { toast('Error al exportar: ' + err.message, 'error') }
    finally { setExporting(false) }
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
                <h1 className="text-xl font-bold text-slate-900 truncate">{subject?.nombre}</h1>
                {subject?.archived && (
                  <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full flex-shrink-0">Archivada</span>
                )}
              </div>
              <p className="text-slate-400 text-xs">{group?.nombre} · {group?.ciclo}</p>
            </div>
            <button type="button" onClick={handleToggleArchive} disabled={archiving}
              title={subject?.archived ? 'Restaurar' : 'Archivar'}
              className="p-2 text-slate-400 hover:text-amber-600 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0">
              {subject?.archived ? <ArchiveRestore size={19} /> : <Archive size={19} />}
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
                        return (
                          <div key={a.id} className="flex items-center gap-1 rounded-xl border border-slate-100 bg-white hover:border-blue-100 transition-colors">
                            <button onClick={() => navigate(`/activity/${a.id}`)}
                              className="flex items-center gap-3 flex-1 min-w-0 px-3 py-3 text-left">
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
        <div className="px-4 py-4">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-700">
                {groupStudents.length} alumno{groupStudents.length !== 1 ? 's' : ''}
              </p>
              {subject?.grupoId && (
                <button
                  onClick={() => navigate(`/group/${subject.grupoId}`)}
                  className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                >
                  Gestionar alumnos
                </button>
              )}
            </div>
            {groupStudentsLoaded && groupStudents.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-10">Sin alumnos registrados</p>
            ) : !groupStudentsLoaded ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : (
              <ul>
                {groupStudents.map((s, i) => (
                  <li key={s.id}
                    className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                    <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {(s.nombre?.[0] || '?').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {s.apellidoPaterno} {s.apellidoMaterno}, {s.nombre}
                      </p>
                      <p className="text-xs text-slate-400">{s.username}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.activado ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {s.activado ? 'Activo' : 'Pendiente'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
    </TeacherLayout>
  )
}
