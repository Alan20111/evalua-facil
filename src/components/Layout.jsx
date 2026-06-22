import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  LogOut,
  User,
  BookOpen,
  Plus,
  Archive,
  ChevronRight,
  Timer,
} from 'lucide-react'
import { signOut } from 'firebase/auth'
import {
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import Spinner from './Spinner'
import { useSubscription } from '../hooks/useSubscription'
import { calcDaysRemaining } from '../utils/subscriptionHelpers'
import { subjectDisplayName } from '../utils/subjectName'

export default function TeacherLayout({ children }) {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()

  const [subjects, setSubjects] = useState([])
  const [loadingSidebar, setLoadingSidebar] = useState(true)
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    if (!currentUser) return
    loadSidebarData()
  }, [currentUser])

  async function loadSidebarData() {
    try {
      const subSnap = await getDocs(
        query(collection(db, 'subjects'), where('docenteId', '==', currentUser.uid))
      )
      setSubjects(subSnap.docs.map((d) => ({ id: d.id, ...d.data() })))
    } finally {
      setLoadingSidebar(false)
    }
  }

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/')
  }

  const activeSubjects = subjects.filter((s) => !s.archived)
  const archivedSubjects = subjects.filter((s) => s.archived)

  const { subscription } = useSubscription()
  const trialDays = subscription?.status === 'trial'
    ? calcDaysRemaining(subscription.fechaVencimiento)
    : null

  const displayName =
    userProfile?.nombreMostrar || userProfile?.username || userProfile?.nombre || 'Docente'
  const initials = displayName.charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
            EF
          </div>
          <span className="font-semibold text-slate-800 text-sm">Evalúa Fácil</span>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="p-2 text-slate-400 hover:text-red-500 rounded-lg transition-colors"
        >
          <LogOut size={18} />
        </button>
      </header>

      {/* Desktop: sidebar + content */}
      <div className="flex">
        {/* Sidebar — desktop only */}
        <aside className="hidden md:flex flex-col w-64 h-screen sticky top-0 bg-white border-r border-slate-200 flex-shrink-0 z-20">
          {/* Logo */}
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              EF
            </div>
            <span className="font-bold text-slate-800">Evalúa Fácil</span>
          </div>

          {/* Profile button */}
          <NavLink
            to="/profile"
            className="flex items-center gap-3 px-3 py-3 mx-2 mt-2 rounded-xl hover:bg-slate-50 transition-colors group"
          >
            <div className="w-9 h-9 rounded-full bg-blue-100 overflow-hidden flex items-center justify-center flex-shrink-0">
              {userProfile?.photoURL ? (
                <img
                  src={userProfile.photoURL}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-sm font-bold text-blue-600">{initials}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 truncate">{displayName}</p>
              <p className="text-xs text-slate-400 truncate">
                {userProfile?.schoolName || 'Mi perfil'}
              </p>
            </div>
            <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 flex-shrink-0" />
          </NavLink>

          {/* Trial banner — subtle, blue, no background */}
          {trialDays !== null && trialDays > 0 && (
            <NavLink to="/profile" className="mx-2 mt-1 px-3 py-1.5 flex items-center gap-2 rounded-xl hover:bg-blue-50 transition-colors">
              <Timer size={13} className="text-blue-600 flex-shrink-0" />
              <p className="text-xs text-blue-600 leading-tight">
                Te quedan <strong>{trialDays} día{trialDays !== 1 ? 's' : ''}</strong> de prueba
              </p>
            </NavLink>
          )}

          {/* Subjects header → goes to the full subjects list */}
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `mx-2 px-2 pt-5 pb-1 flex items-center justify-between rounded-lg group ${isActive ? '' : ''}`
            }
          >
            <span className="text-xs font-semibold text-slate-400 group-hover:text-blue-600 uppercase tracking-wider transition-colors">
              Asignaturas
            </span>
            <ChevronRight size={13} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
          </NavLink>

          {/* Subject list */}
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {loadingSidebar ? (
              <div className="flex justify-center py-4">
                <Spinner size="sm" />
              </div>
            ) : activeSubjects.length === 0 ? (
              <p className="text-xs text-slate-400 px-3 py-2">Sin asignaturas aún</p>
            ) : (
              activeSubjects.map((s) => (
                <NavLink
                  key={s.id}
                  to={`/subject/${s.id}`}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`
                  }
                >
                  <BookOpen size={14} className="flex-shrink-0" />
                  <span className="truncate">{subjectDisplayName(s)}</span>
                </NavLink>
              ))
            )}

            {/* Nueva asignatura */}
            <button
              type="button"
              onClick={() => navigate('/dashboard', { state: { openCreate: true } })}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-blue-600 hover:bg-blue-50 transition-colors mt-1"
            >
              <Plus size={14} />
              Nueva asignatura…
            </button>

            {/* Archivadas */}
            {archivedSubjects.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowArchived((a) => !a)}
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-slate-400 hover:bg-slate-50 transition-colors mt-1"
                >
                  <Archive size={13} />
                  Archivadas ({archivedSubjects.length})
                </button>
                {showArchived &&
                  archivedSubjects.map((s) => (
                    <NavLink
                      key={s.id}
                      to={`/subject/${s.id}`}
                      className={({ isActive }) =>
                        `flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors opacity-60 ${
                          isActive
                            ? 'bg-blue-50 text-blue-700'
                            : 'text-slate-500 hover:bg-slate-50'
                        }`
                      }
                    >
                      <BookOpen size={13} className="flex-shrink-0" />
                      <span className="truncate">{subjectDisplayName(s)}</span>
                    </NavLink>
                  ))}
              </>
            )}
          </div>

          {/* Logout */}
          <div className="px-2 py-3 border-t border-slate-100">
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
            >
              <LogOut size={14} />
              Cerrar sesión
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-h-screen pb-20 md:pb-0">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-100 safe-bottom">
        <div className="flex">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 gap-0.5 text-xs transition-colors ${
                isActive ? 'text-blue-600' : 'text-slate-400'
              }`
            }
          >
            <LayoutDashboard size={22} />
            <span>Asignaturas</span>
          </NavLink>
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 gap-0.5 text-xs transition-colors ${
                isActive ? 'text-blue-600' : 'text-slate-400'
              }`
            }
          >
            <User size={22} />
            <span>Perfil</span>
          </NavLink>
        </div>
      </nav>
    </div>
  )
}
