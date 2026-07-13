import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getDoc,
  doc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import {
  BookOpen, ChevronRight, ChevronDown, Plus, X, Hash, Bell, Archive, Camera,
} from 'lucide-react'
import SubjectIcon from '../../components/SubjectIcon'
import { isActivityPublished } from '../../utils/activityVisibility'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import { getEnrollments, updateAllEnrollments } from '../../utils/studentLookup'
import { uploadToCloudinary } from '../../utils/cloudinary'
import StudentLayout from '../../components/StudentLayout'
import { promedioParcial, ponderacionActivaEnParcial } from '../../utils/ponderacion'
import { STUDENT_CONTAINER } from '../../config/layout'

// All activities for a set of subjects in as few round trips as possible.
// Firestore `in` takes up to 30 values, so chunk and run chunks in parallel.
async function fetchActivitiesForSubjects(subjectIds) {
  if (subjectIds.length === 0) return []
  const chunks = []
  for (let i = 0; i < subjectIds.length; i += 30) chunks.push(subjectIds.slice(i, i + 30))
  const snaps = await Promise.all(
    chunks.map((ids) =>
      getDocs(query(collection(db, 'activities'), where('asignaturaId', 'in', ids)))
    )
  )
  return snaps.flatMap((s) => s.docs)
}

// All submissions belonging to a set of student enrollment docs (chunked `in`).
async function fetchSubmissionsForStudents(studentDocIds) {
  if (studentDocIds.length === 0) return []
  const chunks = []
  for (let i = 0; i < studentDocIds.length; i += 30) chunks.push(studentDocIds.slice(i, i + 30))
  const snaps = await Promise.all(
    chunks.map((ids) =>
      getDocs(query(collection(db, 'submissions'), where('alumnoId', 'in', ids)))
    )
  )
  return snaps.flatMap((s) => s.docs)
}

// Interruptor simple (mismo patrón visual que el resto de la app: pista
// h-6 w-11 rounded-full, pulgar h-4 w-4 — ver PaymentConfig.jsx).
function Toggle({ checked, onChange, label, description }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 py-2.5 text-left"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-on-surface">{label}</p>
        {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
      </div>
      <span
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
          checked ? 'bg-accent' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-surface-card transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  )
}

const NOTIF_DEFAULTS = { actividadesNuevas: true, calificaciones: true, recordatorios: true }

export default function StudentDashboard() {
  const { currentUser, userProfile, setUserProfile } = useAuth()
  const [subjects, setSubjects] = useState([])
  const [studentInfo, setStudentInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showJoin, setShowJoin] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [showNotif, setShowNotif] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [prefs, setPrefs] = useState(NOTIF_DEFAULTS)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const fileInputRef = useRef(null)
  const navigate = useNavigate()
  const toast = useToast()

  function handleJoinSubject(e) {
    e.preventDefault()
    const code = joinCode.trim().toUpperCase()
    if (!code) return
    navigate(`/activate/${code}`)
  }

  useEffect(() => {
    if (currentUser) loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps -- mount-only intencional
  }, [currentUser])

  useEffect(() => {
    if (studentInfo?.notifPrefs) setPrefs({ ...NOTIF_DEFAULTS, ...studentInfo.notifPrefs })
  }, [studentInfo?.notifPrefs])

  async function loadData() {
    setLoading(true)
    try {
      // A student account can be enrolled in several subjects (one `students` doc per
      // subject, all sharing the same auth uid). Load every enrollment.
      const enrollments = await getEnrollments(currentUser, userProfile)
      if (enrollments.length === 0) {
        toast('No se encontró tu perfil de estudiante', 'error')
        setSubjects([])
        return
      }
      setStudentInfo(enrollments[0])
      // Map each subject → the enrollment doc id (used as alumnoId for submissions).
      const docIdBySubject = {}
      enrollments.forEach((s) => { if (s.asignaturaId) docIdBySubject[s.asignaturaId] = s.id })
      const asignaturaIds = Object.keys(docIdBySubject)
      if (asignaturaIds.length === 0) { setSubjects([]); return }

      const subjSnaps = await Promise.all(asignaturaIds.map((id) => getDoc(doc(db, 'subjects', id))))
      const subs = subjSnaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }))
      if (subs.length === 0) { setSubjects([]); return }
      const subjectById = {}
      subs.forEach((s) => { subjectById[s.id] = s })

      // Everything else in ONE parallel batch — a constant number of round trips:
      //  · teacher names  · all activities (chunked `in`)  · all my submissions (chunked `in`)
      const teacherIds = [...new Set(subs.map((s) => s.docenteId).filter(Boolean))]
      const subjectIds = subs.map((s) => s.id)
      const myDocIds = Object.values(docIdBySubject)
      const [teacherSnaps, actDocs, mySubmissions] = await Promise.all([
        Promise.all(teacherIds.map((tid) => getDoc(doc(db, 'users', tid)))),
        fetchActivitiesForSubjects(subjectIds),
        fetchSubmissionsForStudents(myDocIds),
      ])

      const teachers = {}
      teacherSnaps.forEach((t) => {
        if (!t.exists()) return
        const td = t.data()
        teachers[t.id] = td.nombreMostrar || td.username || td.nombre || '—'
      })

      // Group activities by subject and index this student's grade per activity
      // (activities are subject-unique, so keying by activity id never collides).
      const actsBySubject = {}
      actDocs.forEach((d) => {
        const a = { id: d.id, ...d.data() }
        const parcialesOcultos = subjectById[a.asignaturaId]?.parcialesOcultos || []
        if (!isActivityPublished(a, parcialesOcultos.includes(a.parcial))) return
        if (!actsBySubject[a.asignaturaId]) actsBySubject[a.asignaturaId] = []
        actsBySubject[a.asignaturaId].push(a)
      })
      const gradeByActivity = {}
      mySubmissions.forEach((d) => {
        const data = d.data()
        if (data.calificacion != null) gradeByActivity[data.actividadId] = data.calificacion
      })

      // Compute each subject's average in memory.
      const enriched = subs.map((s) => {
        const acts = actsBySubject[s.id] || []
        // Same math as the teacher: per-parcial (weighted when applicable),
        // then the mean of parcial averages
        const PARC = Array.from({ length: s.parciales || 3 }, (_, i) => i + 1)
        const parcAvgs = PARC.map((p) => {
          const pacts = acts.filter((a) => a.parcial === p)
          const grades = pacts.map((a) =>
            gradeByActivity[a.id] != null ? (gradeByActivity[a.id] / (a.maxCalif || 10)) * 10 : null
          )
          return promedioParcial(pacts, grades, ponderacionActivaEnParcial(s, p))
        }).filter((v) => v !== null)
        const avg = parcAvgs.length
          ? (parcAvgs.reduce((x, y) => x + y, 0) / parcAvgs.length).toFixed(1)
          : null
        return { ...s, teacherName: teachers[s.docenteId] || '—', avg }
      })
      setSubjects(enriched)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file || !currentUser) return
    setUploadingPhoto(true)
    try {
      const url = await uploadToCloudinary(file, 'evalua-facil/profiles')
      await updateAllEnrollments(currentUser.uid, { photoURL: url })
      setUserProfile((prev) => ({ ...prev, photoURL: url }))
      setStudentInfo((prev) => (prev ? { ...prev, photoURL: url } : prev))
    } catch {
      // best-effort — silent failure
    } finally {
      setUploadingPhoto(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Preferencias de notificaciones — se guardan en TODAS las inscripciones de
  // este uid, ya que el alumno no tiene un doc propio en `users`. Aún no hay
  // push conectado; esto solo deja la preferencia lista para cuando se active.
  async function togglePref(key, value) {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    if (!currentUser) return
    setSavingPrefs(true)
    try {
      await updateAllEnrollments(currentUser.uid, { notifPrefs: next })
      setStudentInfo((prev) => (prev ? { ...prev, notifPrefs: next } : prev))
    } catch {
      // best-effort — silent failure
    } finally {
      setSavingPrefs(false)
    }
  }

  if (loading) return (
    <StudentLayout>
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    </StudentLayout>
  )

  const displayName =
    [userProfile?.nombre, userProfile?.apellidoPaterno, userProfile?.apellidoMaterno].filter(Boolean).join(' ')
    || [studentInfo?.nombre, studentInfo?.apellidoPaterno, studentInfo?.apellidoMaterno].filter(Boolean).join(' ')
    || userProfile?.username
    || studentInfo?.username
    || 'Estudiante'
  const initials = displayName.charAt(0).toUpperCase()
  const photoURL = userProfile?.photoURL || studentInfo?.photoURL
  // Solo el/los nombre(s) de pila, sin apellidos.
  const firstName = userProfile?.nombre || studentInfo?.nombre || displayName

  const activeSubjects = subjects.filter((s) => !s.archived)
  const archivedSubjects = subjects.filter((s) => s.archived)

  return (
    <StudentLayout>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoChange}
      />

      <div className={`px-4 py-6 ${STUDENT_CONTAINER}`}>
        {/* Foto/nombre + Notificaciones — solo móvil (el logo tocable ya vive en la barra superior) */}
        <div className="md:hidden bg-surface-card rounded-card shadow-card overflow-hidden mb-4">
          <div className="flex items-center gap-3 px-4 py-4 border-b-2 border-outline-variant">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="relative w-11 h-11 rounded-full flex-shrink-0 group focus:outline-none"
              data-tooltip="Cambiar foto"
              aria-label="Cambiar foto"
            >
              <div className="w-11 h-11 rounded-full bg-accent-tint overflow-hidden flex items-center justify-center">
                {uploadingPhoto ? (
                  <Spinner size="sm" />
                ) : photoURL ? (
                  <img src={photoURL} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-base font-bold text-accent">{initials}</span>
                )}
              </div>
              <span className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <Camera size={16} className="text-white" />
              </span>
            </button>
            <p className="flex-1 min-w-0 font-semibold text-on-surface truncate">{firstName}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowNotif(true)}
            className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-accent-tint transition-colors"
          >
            <Bell size={20} className="text-accent flex-shrink-0" />
            <span className="font-medium text-on-surface flex-1 text-left">Notificaciones</span>
            <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />
          </button>
        </div>

        <h1 className="text-xl font-bold text-on-surface mb-1">Mis asignaturas</h1>
        <p className="text-slate-400 text-sm mb-5">{activeSubjects.length} asignatura{activeSubjects.length !== 1 ? 's' : ''} activas</p>

        {activeSubjects.length === 0 ? (
          <div className="bg-surface-card rounded-card border border-outline-variant p-10 text-center">
            <BookOpen size={32} className="text-slate-300 mx-auto mb-3" />
            <p className="text-muted mb-1">Aún no tienes asignaturas</p>
            <p className="text-slate-400 text-sm">Usa el botón de abajo para unirte a una.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeSubjects.map((s) => (
              <button
                type="button"
                key={s.id}
                {...subjectPaletteProps(s.colorPalette)}
                onClick={() => navigate(`/alumno/materia/${s.id}`)}
                className="w-full bg-surface-card rounded-card p-3 text-left shadow-card hover:shadow-md transition-shadow flex items-center gap-3"
              >
                <div className="w-12 h-12 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
                  <SubjectIcon iconKey={s.icon} size={22} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-on-surface truncate">{subjectDisplayName(s)}</p>
                  <p className="text-slate-400 text-xs mt-0.5 truncate">{s.teacherName}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {s.avg != null && (
                    <div className="text-right">
                      <p className="text-lg font-bold text-accent">{s.avg}</p>
                      <p className="text-sm text-slate-500">promedio</p>
                    </div>
                  )}
                  <ChevronRight size={18} className="text-slate-300" />
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Join another subject */}
        <button
          type="button"
          onClick={() => { setJoinCode(''); setShowJoin(true) }}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-card border border-dashed border-accent text-accent text-sm font-semibold hover:bg-accent-light transition-colors"
        >
          <Plus size={18} /> Unirme a otra asignatura
        </button>

        {/* Asignaturas archivadas — solo móvil */}
        <div className="md:hidden mt-4 bg-surface-card rounded-card shadow-card overflow-hidden">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-muted hover:bg-accent-tint transition-colors"
          >
            <Archive size={16} className="flex-shrink-0" />
            <span className="flex-1 text-left">Asignaturas archivadas{archivedSubjects.length > 0 ? ` (${archivedSubjects.length})` : ''}</span>
            <ChevronDown size={15} className={`flex-shrink-0 transition-transform ${showArchived ? 'rotate-180' : ''}`} />
          </button>
          {showArchived && (
            archivedSubjects.length === 0 ? (
              <p className="text-xs text-muted px-4 pb-3">No tienes asignaturas archivadas.</p>
            ) : (
              <div className="px-2 pb-2 space-y-1">
                {archivedSubjects.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => navigate(`/alumno/materia/${s.id}`)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded text-sm text-muted hover:bg-accent-tint transition-colors text-left"
                  >
                    <SubjectIcon iconKey={s.icon} size={17} className="flex-shrink-0" />
                    <span className="truncate">{subjectDisplayName(s)}</span>
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {/* ── Join-subject modal ── */}
      {showJoin && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/40 border-none cursor-default"
            onClick={() => setShowJoin(false)}
            aria-label="Cerrar"
          />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-lg font-semibold text-on-surface truncate">Unirme a otra asignatura</h3>
              <button type="button" aria-label="Cerrar" onClick={() => setShowJoin(false)} className="p-2 text-slate-400 rounded flex-shrink-0"><X size={20} /></button>
            </div>
            <p className="text-sm text-muted mb-3">
              Ingresa el <strong>código de acceso</strong> de tu nueva asignatura (o escanea su QR). Como ya tienes cuenta, solo confirmarás tu contraseña.
            </p>
            <form onSubmit={handleJoinSubject} className="flex gap-2">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={8}
                placeholder="Ej: A3B7K2"
                className="flex-1 px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface font-mono tracking-widest text-center"
              />
              <button
                type="submit"
                disabled={!joinCode.trim()}
                className="px-4 py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center gap-1.5 flex-shrink-0"
              >
                <Hash size={18} /> Ir
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Notificaciones modal ── */}
      {showNotif && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/40 border-none cursor-default"
            onClick={() => setShowNotif(false)}
            aria-label="Cerrar"
          />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h3 className="text-lg font-semibold text-on-surface truncate">Notificaciones</h3>
              <div className="flex items-center gap-2 flex-shrink-0">
                {savingPrefs && <Spinner size="sm" />}
                <button type="button" aria-label="Cerrar" onClick={() => setShowNotif(false)} className="p-2 text-slate-400 rounded"><X size={20} /></button>
              </div>
            </div>
            <div className="divide-y divide-outline-variant">
              <Toggle
                checked={prefs.actividadesNuevas}
                onChange={(v) => togglePref('actividadesNuevas', v)}
                label="Actividades nuevas"
                description="Cuando tu maestro publique una actividad"
              />
              <Toggle
                checked={prefs.calificaciones}
                onChange={(v) => togglePref('calificaciones', v)}
                label="Calificaciones"
                description="Cuando te califiquen una entrega"
              />
              <Toggle
                checked={prefs.recordatorios}
                onChange={(v) => togglePref('recordatorios', v)}
                label="Recordatorios de entrega"
                description="Antes de que cierre una fecha límite"
              />
            </div>
          </div>
        </div>
      )}
    </StudentLayout>
  )
}
