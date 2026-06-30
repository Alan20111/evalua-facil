import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LogOut, ChevronRight, LayoutDashboard, GraduationCap } from 'lucide-react'
import { signOut } from 'firebase/auth'
import { getDoc, doc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import Spinner from './Spinner'
import SubjectIcon from './SubjectIcon'
import { subjectDisplayName } from '../utils/subjectName'
import { getEnrollments } from '../utils/studentLookup'

export default function StudentLayout({ children }) {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const [subjects, setSubjects] = useState([])
  const [loadingSidebar, setLoadingSidebar] = useState(true)
  const [schoolName, setSchoolName] = useState('')

  useEffect(() => {
    if (!currentUser) return
    async function run() {
      try {
        const enrollments = await getEnrollments(currentUser, userProfile)
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
    const eid = userProfile?.escuelaId
    if (!eid) return
    getDoc(doc(db, 'schools', eid))
      .then((snap) => { if (snap.exists()) setSchoolName(snap.data().nombre || '') })
      .catch(() => {})
  }, [userProfile?.escuelaId])

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/alumno')
  }

  const displayName = userProfile
    ? [userProfile.nombre, userProfile.apellidoPaterno].filter(Boolean).join(' ')
    : 'Alumno'
  const initials = displayName.charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-surface">
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 bg-surface-card border-b border-outline-variant px-4 py-2.5 flex items-center justify-between shadow-card">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[#2563eb] flex items-center justify-center text-white">
            <GraduationCap size={20} />
          </div>
          <span className="font-semibold text-on-surface text-body-sm">Evalúa Fácil</span>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="p-2 text-muted hover:text-error rounded transition-colors"
        >
          <LogOut size={20} />
        </button>
      </header>

      {/* Desktop: sidebar + content */}
      <div className="flex">
        {/* Sidebar — desktop only. data-role="docente" forces the institutional blue
            regardless of the parent's data-role="alumno" accent override. */}
        <aside
          data-role="docente"
          className="hidden md:flex flex-col w-[280px] h-screen sticky top-0 bg-accent text-white flex-shrink-0 z-20"
        >
          {/* Logo */}
          <div className="px-4 py-2.5 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded bg-white flex items-center justify-center flex-shrink-0">
              <GraduationCap size={22} className="text-accent" />
            </div>
            <span className="font-bold text-white">Evalúa Fácil</span>
          </div>

          {/* Student profile */}
          <div className="flex items-center gap-3 px-3 py-2 mx-2 mt-1 rounded">
            <div className="w-9 h-9 rounded-full bg-white overflow-hidden flex items-center justify-center flex-shrink-0">
              {userProfile?.photoURL ? (
                <img src={userProfile.photoURL} alt="" className="w-full h-full object-cover" />
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
        <main className="flex-1 min-w-0 min-h-screen pb-20 md:pb-0">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-surface-card border-t border-outline-variant safe-bottom">
        <div className="flex">
          <NavLink
            to="/alumno/dashboard"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 gap-0.5 text-metadata transition-colors ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }
          >
            <LayoutDashboard size={24} />
            <span>Asignaturas</span>
          </NavLink>
        </div>
      </nav>
    </div>
  )
}
