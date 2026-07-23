import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LogOut, ChevronRight } from 'lucide-react'
import { signOut } from 'firebase/auth'
import { getDoc, doc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import Spinner from './Spinner'
import SubjectIcon from './SubjectIcon'
import { subjectDisplayName } from '../utils/subjectName'
import { maskEmail } from '../utils/generate'
import { getEnrollments, updateAllEnrollments } from '../utils/studentLookup'
import PortalBadge from './PortalBadge'
import EFLogo from './EFLogo'
import { useBackHandler } from '../hooks/useBackHandler'
import { useScrollLock } from '../hooks/useScrollLock'
import StudentBottomNav from './StudentBottomNav'

export default function StudentLayout({ children }) {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const [subjects, setSubjects] = useState([])
  const [loadingSidebar, setLoadingSidebar] = useState(true)
  const [schoolName, setSchoolName] = useState('')
  const [studentInfo, setStudentInfo] = useState(null)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showFullLogo, setShowFullLogo] = useState(false)

  useBackHandler(() => setShowLogoutConfirm(false), showLogoutConfirm)
  useScrollLock(showLogoutConfirm)
  useScrollLock(showFullLogo)

  useEffect(() => {
    if (!currentUser) return
    async function run() {
      try {
        const enrollments = await getEnrollments(currentUser, userProfile)
        // `userProfile` (from AuthContext) can fail to resolve the student doc in some
        // edge cases — `getEnrollments` looks it up by `uid` first and is more reliable,
        // so use whichever enrollment it found as a fallback source for name/photo.
        setStudentInfo(enrollments[0] || null)
        // El correo de la cuenta ya no es el @evalua.local falso → el estudiante
        // confirmó su correo de recuperación desde el enlace. Sella la máscara y
        // el flag en sus inscripciones (públicas: solo máscara, nunca el correo)
        // para que el login pueda orientarlo a entrar con su correo.
        const emailReal = currentUser.email && !currentUser.email.endsWith('@evalua.local')
        if (emailReal && enrollments.length && enrollments[0].correoVerificado !== true) {
          updateAllEnrollments(currentUser.uid, {
            correoVerificado: true,
            correoMask: maskEmail(currentUser.email),
          }).catch(() => {})
        }
        const subjectIds = [...new Set(enrollments.map((e) => e.asignaturaId).filter(Boolean))]
        if (subjectIds.length === 0) { setSubjects([]); return }
        const snaps = await Promise.all(subjectIds.map((id) => getDoc(doc(db, 'subjects', id))))
        setSubjects(snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() })))
      } catch {
        setSubjects([])
      } finally {
        setLoadingSidebar(false)
      }
    }
    run()
  }, [currentUser, userProfile])

  useEffect(() => {
    // The student's own `escuelaId` is copied onto their `students` doc at creation
    // time and never updated again — if the teacher later changes their school in
    // Profile, old students keep pointing at the stale one, showing a different
    // name than the teacher's own header. Resolve through the subject's teacher
    // instead, which always reflects their CURRENT school.
    const docenteId = subjects[0]?.docenteId
    if (docenteId) {
      getDoc(doc(db, 'users', docenteId))
        .then((snap) => { if (snap.exists()) setSchoolName(snap.data().schoolName || '') })
        .catch(() => {})
      return
    }
    const eid = userProfile?.escuelaId || studentInfo?.escuelaId
    if (!eid) return
    getDoc(doc(db, 'schools', eid))
      .then((snap) => { if (snap.exists()) setSchoolName(snap.data().shortName || snap.data().nombre || '') })
      .catch(() => {})
  }, [subjects, userProfile?.escuelaId, studentInfo?.escuelaId])

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/alumno')
  }

  const displayName =
    [userProfile?.nombre, userProfile?.apellidoPaterno, userProfile?.apellidoMaterno].filter(Boolean).join(' ')
    || [studentInfo?.nombre, studentInfo?.apellidoPaterno, studentInfo?.apellidoMaterno].filter(Boolean).join(' ')
    || userProfile?.username
    || studentInfo?.username
    || 'Estudiante'
  const initials = displayName.charAt(0).toUpperCase()
  const photoURL = userProfile?.photoURL || studentInfo?.photoURL

  return (
    <div className="min-h-screen bg-surface">
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 bg-surface-card border-b border-outline-variant px-4 py-2.5 flex items-center justify-between shadow-card safe-top">
        <button
          type="button"
          onClick={() => setShowFullLogo((v) => !v)}
          aria-label="Ver logo de Evalúa Fácil"
          className="flex items-center gap-2 min-w-0 -ml-1 p-1 rounded hover:bg-accent-tint transition-colors"
        >
          <EFLogo subtitle={false} className="h-8 w-auto flex-shrink-0" />
          {/* eslint-disable-next-line jsx-a11y/aria-role -- role aquí es la prop propia de PortalBadge, no un atributo ARIA */}
          <PortalBadge role="alumno" />
        </button>
        <button
          type="button"
          onClick={() => setShowLogoutConfirm(true)}
          aria-label="Cerrar sesión"
          className="p-2 text-muted hover:text-error rounded transition-colors"
        >
          <LogOut size={20} />
        </button>
      </header>

      {/* Desktop: sidebar + content */}
      <div className="flex">
        {/* Sidebar — desktop only. data-role="docente" forces the institutional
            blue regardless of the parent's data-role="alumno" accent override. */}
        <aside
          data-role="docente"
          className="hidden md:flex flex-col w-[280px] h-screen sticky top-0 bg-accent text-white flex-shrink-0 z-20"
        >
          {/* Logo — siempre sobre blanco: recuadro blanco sobre el azul del sidebar. */}
          <div className="px-3 pt-3 pb-2">
            <div className="bg-white rounded-card px-3 py-2.5 shadow-card">
              <EFLogo className="w-full h-auto" />
            </div>
          </div>
          {/* data-role="alumno" reafirma el naranja del alumno solo para esta
              insignia — el resto del sidebar se queda en el azul institucional
              forzado arriba. */}
          <div className="px-4 pt-2.5 pb-0.5" data-role="alumno">
            {/* eslint-disable-next-line jsx-a11y/aria-role -- role aquí es la prop propia de PortalBadge, no un atributo ARIA */}
            <PortalBadge role="alumno" />
          </div>

          {/* Identidad → clic = Mi perfil (la foto se cambia DENTRO del perfil —
              una sola casa por función, Don't Make Me Think). */}
          <button
            type="button"
            onClick={() => navigate('/alumno/perfil')}
            className="flex items-center gap-3 px-3 py-2 mx-2 mt-1 rounded text-left hover:bg-white/10 transition-colors focus:outline-none"
            data-tooltip="Mi perfil"
          >
            <div className="w-9 h-9 rounded-full bg-white overflow-hidden flex items-center justify-center flex-shrink-0">
              {photoURL ? (
                <img src={photoURL} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-sm font-bold text-accent">{initials}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-body-sm font-semibold text-white truncate">{displayName}</p>
              {schoolName && (
                <p className="text-metadata text-white/70 truncate">{schoolName}</p>
              )}
            </div>
            <ChevronRight size={14} className="text-white/50 flex-shrink-0" />
          </button>

          {/* Subjects heading — links to dashboard */}
          <NavLink
            to="/alumno/dashboard"
            className="mx-2 px-2 pt-4 pb-1 flex items-center justify-between rounded group"
          >
            <span className="text-label-caps text-white/70 group-hover:text-white uppercase transition-colors">
              Asignaturas
            </span>
            <ChevronRight size={15} className="text-white/50 group-hover:text-white transition-colors" />
          </NavLink>

          {/* Subject list */}
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {loadingSidebar ? (
              <div className="flex justify-center py-3">
                <Spinner size="sm" />
              </div>
            ) : subjects.length === 0 ? (
              <p className="text-body-sm text-white/70 px-3 py-2">Sin asignaturas aún</p>
            ) : (
              subjects.map((s) => (
                <NavLink
                  key={s.id}
                  to={`/alumno/materia/${s.id}`}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-1.5 rounded text-body-sm transition-colors ${
                      isActive ? 'bg-white text-accent font-semibold' : 'text-white/90 hover:bg-white/10'
                    }`
                  }
                >
                  <SubjectIcon iconKey={s.icon} size={17} className="flex-shrink-0" />
                  <span className="truncate">{subjectDisplayName(s)}</span>
                </NavLink>
              ))
            )}
          </div>

          {/* Logout */}
          <div className="px-2 py-2 border-t border-white/15">
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-3 py-1.5 rounded text-body-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            >
              <LogOut size={17} />
              Cerrar sesión
            </button>
          </div>
        </aside>

        {/* Main content — pb reserva el alto de la barra inferior (5rem) MÁS el
            inset de seguridad de Android que ya se le suma a esa barra
            (.safe-bottom en <nav> abajo); si no, el último contenido de cada
            página queda tapado detrás de la barra. Mismo estándar que el docente. */}
        <main className="flex-1 min-w-0 min-h-screen pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-0">{children}</main>
      </div>

      {/* Mobile bottom nav — mismo estándar que la App del docente */}
      <StudentBottomNav />

      {/* Confirmación antes de cerrar sesión (header móvil) */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/40 border-none cursor-default"
            onClick={() => setShowLogoutConfirm(false)}
            aria-label="Cancelar"
          />
          <div className="relative bg-surface-card w-[calc(100%-2rem)] max-w-sm rounded-card p-4 shadow-2xl">
            <h3 className="text-base font-semibold text-on-surface">¿Cerrar sesión?</h3>
            <p className="text-sm text-muted mt-2">
              Vas a salir de tu cuenta. Puedes volver a entrar cuando quieras con tu usuario y contraseña.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => { setShowLogoutConfirm(false); handleLogout() }}
                className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
              >
                Sí, cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logo completo — se abre al tocar el ícono de la barra superior, se cierra tocando el fondo */}
      {showFullLogo && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60">
          <button
            type="button"
            className="absolute inset-0 border-none cursor-default"
            onClick={() => setShowFullLogo(false)}
            aria-label="Cerrar logo"
          />
          <div className="relative bg-white rounded-card px-6 py-5 shadow-2xl pointer-events-none">
            <EFLogo className="w-56 sm:w-72 h-auto" />
          </div>
        </div>
      )}
    </div>
  )
}
