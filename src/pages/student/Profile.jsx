import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDoc, doc, collection, query, where, getDocs } from 'firebase/firestore'
import { signOut, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { auth, db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import PasswordInput from '../../components/PasswordInput'
import SubjectIcon from '../../components/SubjectIcon'
import StudentLayout from '../../components/StudentLayout'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import { getEnrollments, updateAllEnrollments } from '../../utils/studentLookup'
import { uploadToCloudinary } from '../../utils/cloudinary'
import { isActivityPublished } from '../../utils/activityVisibility'
import { promedioParcial, ponderacionActivaEnParcial, normalizeGrade } from '../../utils/ponderacion'
import { teacherDisplayName } from '../../utils/studentSearch'
import { STUDENT_CONTAINER_NARROW } from '../../config/layout'
import { useBackHandler } from '../../hooks/useBackHandler'
import {
  Camera, Copy, Check, KeyRound, Bell, CalendarDays, LogOut, ChevronRight, GraduationCap,
} from 'lucide-react'

// Todas las actividades de un conjunto de asignaturas (chunked `in` — permitido
// para activities; las submissions van con una query `==` por inscripción, ver
// las reglas de submissions).
async function fetchActivitiesForSubjects(subjectIds) {
  if (subjectIds.length === 0) return []
  const chunks = []
  for (let i = 0; i < subjectIds.length; i += 30) chunks.push(subjectIds.slice(i, i + 30))
  const snaps = await Promise.all(
    chunks.map((ids) => getDocs(query(collection(db, 'activities'), where('asignaturaId', 'in', ids))))
  )
  return snaps.flatMap((s) => s.docs)
}

async function fetchSubmissionsForStudents(studentDocIds) {
  const snaps = await Promise.all(
    studentDocIds.map((id) => getDocs(query(collection(db, 'submissions'), where('alumnoId', '==', id))))
  )
  return snaps.flatMap((s) => s.docs)
}

export default function StudentProfile() {
  const { currentUser, userProfile, setUserProfile } = useAuth()
  const [studentInfo, setStudentInfo] = useState(null)
  const [schoolName, setSchoolName] = useState('')
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [copied, setCopied] = useState(false)
  // Cambio de contraseña
  const [passActual, setPassActual] = useState('')
  const [passNueva, setPassNueva] = useState('')
  const [passConfirm, setPassConfirm] = useState('')
  const [savingPass, setSavingPass] = useState(false)
  const fileInputRef = useRef(null)
  const navigate = useNavigate()
  const toast = useToast()
  useBackHandler(() => navigate('/alumno/dashboard'))

  useEffect(() => {
    if (currentUser) loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps -- mount-only intencional
  }, [currentUser])

  async function loadAll() {
    setLoading(true)
    try {
      const enrollments = await getEnrollments(currentUser, userProfile)
      if (enrollments.length === 0) { setSubjects([]); return }
      setStudentInfo(enrollments[0])

      const docIdBySubject = {}
      enrollments.forEach((s) => { if (s.asignaturaId) docIdBySubject[s.asignaturaId] = s.id })
      const asignaturaIds = Object.keys(docIdBySubject)
      const subjSnaps = await Promise.all(asignaturaIds.map((id) => getDoc(doc(db, 'subjects', id))))
      const subs = subjSnaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }))
      const subjectById = {}
      subs.forEach((s) => { subjectById[s.id] = s })

      // Nombre de la escuela: igual que StudentLayout, a través del docente de la
      // primera asignatura (refleja SU escuela actual); si no hay, el doc schools.
      const docenteId = subs[0]?.docenteId
      if (docenteId) {
        getDoc(doc(db, 'users', docenteId))
          .then((snap) => { if (snap.exists()) setSchoolName(snap.data().schoolName || '') })
          .catch(() => {})
      } else if (enrollments[0]?.escuelaId) {
        getDoc(doc(db, 'schools', enrollments[0].escuelaId))
          .then((snap) => { if (snap.exists()) setSchoolName(snap.data().shortName || snap.data().nombre || '') })
          .catch(() => {})
      }

      const teacherIds = [...new Set(subs.map((s) => s.docenteId).filter(Boolean))]
      const [teacherSnaps, actDocs, mySubmissions] = await Promise.all([
        Promise.all(teacherIds.map((tid) => getDoc(doc(db, 'users', tid)))),
        fetchActivitiesForSubjects(subs.map((s) => s.id)),
        fetchSubmissionsForStudents(Object.values(docIdBySubject)),
      ])
      const teachers = {}
      teacherSnaps.forEach((t) => { if (t.exists()) teachers[t.id] = teacherDisplayName(t.data()) || '—' })

      // Mismo cálculo de promedios que el Dashboard del alumno.
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
      const enriched = subs.filter((s) => !s.archived).map((s) => {
        const acts = actsBySubject[s.id] || []
        const PARC = Array.from({ length: s.parciales || 3 }, (_, i) => i + 1)
        const parcAvgs = PARC.map((p) => {
          const pacts = acts.filter((a) => a.parcial === p)
          const grades = pacts.map((a) => normalizeGrade(gradeByActivity[a.id], a.maxCalif))
          return promedioParcial(pacts, grades, ponderacionActivaEnParcial(s, p))
        }).filter((v) => v !== null)
        const avg = parcAvgs.length
          ? Math.round((parcAvgs.reduce((x, y) => x + y, 0) / parcAvgs.length) * 10) / 10
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
      toast('Foto actualizada')
    } catch {
      toast('No se pudo subir la foto', 'error')
    } finally {
      setUploadingPhoto(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleCopyUsername() {
    const username = studentInfo?.username || userProfile?.username
    if (!username) return
    try {
      await navigator.clipboard.writeText(username)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast('No se pudo copiar', 'error')
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    if (passNueva.length < 6) { toast('La contraseña nueva debe tener al menos 6 caracteres', 'error'); return }
    if (passNueva !== passConfirm) { toast('Las contraseñas nuevas no coinciden', 'error'); return }
    setSavingPass(true)
    try {
      // Reautenticación con la contraseña actual — updatePassword la exige si
      // la sesión no es reciente, y de paso confirma que quien cambia la clave
      // es el dueño de la cuenta (no alguien que agarró un teléfono abierto).
      const cred = EmailAuthProvider.credential(currentUser.email, passActual)
      await reauthenticateWithCredential(currentUser, cred)
      await updatePassword(currentUser, passNueva)
      setPassActual(''); setPassNueva(''); setPassConfirm('')
      toast('Contraseña actualizada. Úsala la próxima vez que entres.')
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        toast('La contraseña actual no es correcta', 'error')
      } else if (err.code === 'auth/weak-password') {
        toast('La contraseña nueva es demasiado débil', 'error')
      } else if (err.code === 'auth/too-many-requests') {
        toast('Demasiados intentos. Espera unos minutos e intenta de nuevo.', 'error')
      } else {
        toast('Error: ' + err.message, 'error')
      }
    } finally {
      setSavingPass(false)
    }
  }

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/alumno')
  }

  const displayName =
    [studentInfo?.nombre, studentInfo?.apellidoPaterno, studentInfo?.apellidoMaterno].filter(Boolean).join(' ')
    || [userProfile?.nombre, userProfile?.apellidoPaterno, userProfile?.apellidoMaterno].filter(Boolean).join(' ')
    || studentInfo?.username || 'Estudiante'
  const initials = displayName.charAt(0).toUpperCase()
  const photoURL = userProfile?.photoURL || studentInfo?.photoURL
  const username = studentInfo?.username || userProfile?.username || ''
  const conPromedio = subjects.filter((s) => s.avg != null)
  const promedioGeneral = conPromedio.length
    ? (conPromedio.reduce((sum, s) => sum + s.avg, 0) / conPromedio.length).toFixed(1)
    : null

  if (loading) return (
    <StudentLayout>
      <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
    </StudentLayout>
  )

  return (
    <StudentLayout>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoChange}
      />

      <div className={`px-4 py-6 ${STUDENT_CONTAINER_NARROW}`}>
        <h1 className="text-xl font-bold text-on-surface mb-4">Mi perfil</h1>

        {/* ── Identidad ── */}
        <div className="bg-surface-card rounded-card shadow-card p-5 mb-4 flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="relative w-16 h-16 rounded-full flex-shrink-0 group focus:outline-none"
            data-tooltip="Cambiar foto"
            aria-label="Cambiar foto"
          >
            <div className="w-16 h-16 rounded-full bg-accent-tint overflow-hidden flex items-center justify-center">
              {uploadingPhoto ? (
                <Spinner size="sm" />
              ) : photoURL ? (
                <img src={photoURL} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xl font-bold text-accent">{initials}</span>
              )}
            </div>
            <span className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <Camera size={18} className="text-white" />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-on-surface leading-snug">{displayName}</p>
            {schoolName && <p className="text-sm text-muted truncate mt-0.5">{schoolName}</p>}
            <p className="text-xs text-slate-400 mt-1">Toca la foto para cambiarla</p>
          </div>
        </div>

        {/* ── Datos de acceso ── */}
        <div className="bg-surface-card rounded-card shadow-card p-5 mb-4">
          <h2 className="text-sm font-semibold text-on-surface mb-3">Datos de acceso</h2>
          <p className="text-xs text-muted mb-1.5">Tu usuario para entrar a Evalúa Fácil:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded bg-surface border border-outline-variant text-sm font-mono text-on-surface truncate">
              {username}
            </code>
            <button
              type="button"
              onClick={handleCopyUsername}
              className="p-2.5 rounded border border-outline-variant text-muted hover:bg-accent-tint hover:text-accent transition-colors flex-shrink-0"
              aria-label="Copiar usuario"
              data-tooltip={copied ? 'Copiado' : 'Copiar'}
            >
              {copied ? <Check size={17} className="text-green-600" /> : <Copy size={17} />}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Tu nombre lo administra tu maestro — si hay un error, pídele que lo corrija.
          </p>
        </div>

        {/* ── Cambiar contraseña ── */}
        <div className="bg-surface-card rounded-card shadow-card p-5 mb-4">
          <h2 className="text-sm font-semibold text-on-surface mb-3 flex items-center gap-2">
            <KeyRound size={16} className="text-accent" /> Cambiar contraseña
          </h2>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <PasswordInput
              value={passActual}
              onChange={(e) => setPassActual(e.target.value)}
              placeholder="Contraseña actual"
              autoComplete="current-password"
              required
              className="w-full px-3 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
            />
            <PasswordInput
              value={passNueva}
              onChange={(e) => setPassNueva(e.target.value)}
              placeholder="Contraseña nueva (mínimo 6 caracteres)"
              autoComplete="new-password"
              required
              className="w-full px-3 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
            />
            <PasswordInput
              value={passConfirm}
              onChange={(e) => setPassConfirm(e.target.value)}
              placeholder="Repite la contraseña nueva"
              autoComplete="new-password"
              required
              className="w-full px-3 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
            />
            <button
              type="submit"
              disabled={savingPass || !passActual || !passNueva || !passConfirm}
              className="w-full py-2.5 rounded bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {savingPass ? <Spinner size="sm" /> : 'Guardar contraseña nueva'}
            </button>
          </form>
        </div>

        {/* ── Mis asignaturas ── */}
        <div className="bg-surface-card rounded-card shadow-card p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-on-surface flex items-center gap-2">
              <GraduationCap size={16} className="text-accent" /> Mis asignaturas
            </h2>
            {promedioGeneral != null && (
              <div className="text-right">
                <p className="text-lg font-bold text-accent leading-none">{promedioGeneral}</p>
                <p className="text-xs text-slate-500">promedio general</p>
              </div>
            )}
          </div>
          {subjects.length === 0 ? (
            <p className="text-sm text-muted">Aún no tienes asignaturas.</p>
          ) : (
            <div className="space-y-1">
              {subjects.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  {...subjectPaletteProps(s.colorPalette)}
                  onClick={() => navigate(`/alumno/materia/${s.id}`)}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded hover:bg-accent-tint transition-colors text-left"
                >
                  <SubjectIcon iconKey={s.icon} size={18} className="text-accent flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-on-surface truncate">{subjectDisplayName(s)}</p>
                    <p className="text-xs text-slate-500 truncate">{s.teacherName}</p>
                  </div>
                  {s.avg != null && (
                    <span className="text-sm font-bold text-accent flex-shrink-0">{s.avg.toFixed(1)}</span>
                  )}
                  <ChevronRight size={15} className="text-slate-300 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Accesos ── */}
        <div className="bg-surface-card rounded-card shadow-card overflow-hidden">
          <button
            type="button"
            onClick={() => navigate('/alumno/notificaciones')}
            className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-accent-tint transition-colors"
          >
            <Bell size={19} className="text-accent flex-shrink-0" />
            <span className="text-sm font-medium text-on-surface flex-1 text-left">Notificaciones</span>
            <ChevronRight size={15} className="text-slate-400 flex-shrink-0" />
          </button>
          <button
            type="button"
            onClick={() => navigate('/alumno/agenda')}
            className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-accent-tint transition-colors border-t border-outline-variant"
          >
            <CalendarDays size={19} className="text-accent flex-shrink-0" />
            <span className="text-sm font-medium text-on-surface flex-1 text-left">Agenda</span>
            <ChevronRight size={15} className="text-slate-400 flex-shrink-0" />
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-50 transition-colors border-t border-outline-variant"
          >
            <LogOut size={19} className="text-red-500 flex-shrink-0" />
            <span className="text-sm font-medium text-red-600 flex-1 text-left">Cerrar sesión</span>
          </button>
        </div>
      </div>
    </StudentLayout>
  )
}
