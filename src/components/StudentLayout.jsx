import { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LogOut, ChevronRight, Camera } from 'lucide-react'
import { signOut } from 'firebase/auth'
import { getDoc, doc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { uploadToCloudinary } from '../utils/cloudinary'
import Spinner from './Spinner'
import SubjectIcon from './SubjectIcon'
import { subjectDisplayName } from '../utils/subjectName'
import { getEnrollments, updateAllEnrollments } from '../utils/studentLookup'
import PortalBadge from './PortalBadge'
import EFLogo from './EFLogo'
import { useBackHandler } from '../hooks/useBackHandler'

export default function StudentLayout({ children }) {
  const { currentUser, userProfile, setUserProfile } = useAuth()
  const navigate = useNavigate()
  const [subjects, setSubjects] = useState([])
  const [loadingSidebar, setLoadingSidebar] = useState(true)
  const [schoolName, setSchoolName] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [studentInfo, setStudentInfo] = useState(null)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showFullLogo, setShowFullLogo] = useState(false)
  const fileInputRef = useRef(null)

  useBackHandler(() => setShowLogoutConfirm(false), showLogoutConfirm)

  useEffect(() => {
    if (!currentUser) return
    async function run() {
      try {
        const enrollments = await getEnrollments(currentUser, userProfile)
        // `userProfile` (from AuthContext) can fail to resolve the student doc in some
        // edge cases — `getEnrollments` looks it up by `uid` first and is more reliable,
        // so use whichever enrollment it found as a fallback source for name/photo.
        setStudentInfo(enrollments[0] || null)
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
      .then((snap) => { if (snap.exists()) setSchoolName(snap.data().nombre || '') })
      .catch(() => {})
  }, [subjects, userProfile?.escuelaId, studentInfo?.escuelaId])

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/alumno')
  }

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPhoto(true)
    try {
      const url = await uploadToCloudinary(file, 'evalua-facil/profiles')
      await updateAllEnrollments(currentUser.uid, { photoURL: url })
      setUserProfile((prev) => ({ ...prev, photoURL: url }))
    } catch {
      // best-effort — silent failure
    } finally {
      setUploadingPhoto(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
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
      {/* Hidden file input for photo upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoChange}
      />

      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 bg-surface-card border-b border-outline-variant px-4 py-2.5 flex items-center justify-between shadow-card">
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
          {/* Logo — variante de alto contraste (texto e icono en blanco), directo
              sobre el azul del sidebar; ya no necesita el recuadro blanco de antes. */}
          <div className="px-4 pt-4 pb-2">
            <EFLogo variant="azul" className="w-full h-auto" />
          </div>
          <div className="px-4 pt-2.5 pb-0.5">
            {/* eslint-disable-next-line jsx-a11y/aria-role -- role aquí es la prop propia de PortalBadge, no un atributo ARIA */}
            <PortalBadge role="alumno" />
          </div>

          {/* Student profile — click avatar to change photo */}
          <div className="flex items-center gap-3 px-3 py-2 mx-2 mt-1 rounded">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="relative w-9 h-9 rounded-full flex-shrink-0 group focus:outline-none"
              data-tooltip="Cambiar foto"
              aria-label="Cambiar foto"
            >
              <div className="w-9 h-9 rounded-full bg-white overflow-hidden flex items-center justify-center">
                {uploadingPhoto ? (
                  <Spinner size="sm" />
                ) : photoURL ? (
                  <img src={photoURL} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-sm font-bold text-accent">{initials}</span>
                )}
              </div>
              <span className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <Camera size={15} className="text-white" />
              </span>
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-body-sm font-semibold text-white truncate">{displayName}</p>
              {schoolName && (
                <p className="text-metadata text-white/70 truncate">{schoolName}</p>
              )}
            </div>
          </div>

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

        {/* Main content */}
        <main className="flex-1 min-w-0 min-h-screen">{children}</main>
      </div>

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
          <EFLogo variant="azul" className="relative w-64 sm:w-80 h-auto pointer-events-none" />
        </div>
      )}
    </div>
  )
}
