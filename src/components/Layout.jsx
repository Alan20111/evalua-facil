import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  LogOut,
  User,
  Plus,
  Archive,
  ChevronRight,
  Timer,
  GraduationCap,
} from 'lucide-react'
import { signOut } from 'firebase/auth'
import {
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import Spinner from './Spinner'
import { useSubscription } from '../hooks/useSubscription'
import { getTrialBannerMessage } from '../utils/subscriptionHelpers'
import { subjectDisplayName } from '../utils/subjectName'
import SubjectIcon from './SubjectIcon'
import PlanCompareModal from './PlanCompareModal'

export default function TeacherLayout({ children }) {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()

  const [subjects, setSubjects] = useState([])
  const [loadingSidebar, setLoadingSidebar] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [showPlanCompare, setShowPlanCompare] = useState(false)

  // Real-time subjects: any create/edit/archive/duplicate/delete reflects instantly
  // in the sidebar (no manual refresh).
  useEffect(() => {
    if (!currentUser) return
    const q = query(collection(db, 'subjects'), where('docenteId', '==', currentUser.uid))
    const unsub = onSnapshot(
      q,
      (snap) => {
        setSubjects(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setLoadingSidebar(false)
      },
      () => setLoadingSidebar(false)
    )
    return () => unsub()
  }, [currentUser])

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/')
  }

  const activeSubjects = subjects.filter((s) => !s.archived)
  const archivedSubjects = subjects.filter((s) => s.archived)

  const { subscription, plans } = useSubscription()
  const trialBanner = getTrialBannerMessage(subscription)

  const displayName =
    userProfile?.nombreMostrar || userProfile?.nombre || 'Docente'
  const initials = displayName.charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-surface">
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 bg-surface-card border-b border-outline-variant px-4 py-3 flex items-center justify-between shadow-card">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white">
            <GraduationCap size={18} />
          </div>
          <span className="font-semibold text-on-surface text-body-sm">Evalúa Fácil</span>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="p-2 text-muted hover:text-error rounded transition-colors"
        >
          <LogOut size={18} />
        </button>
      </header>

      {/* Desktop: sidebar + content */}
      <div className="flex">
        {/* Sidebar — desktop only (solid accent plane) */}
        <aside className="hidden md:flex flex-col w-[280px] h-screen sticky top-0 bg-accent text-white flex-shrink-0 z-20">
          {/* Logo */}
          <div className="px-5 py-4 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded bg-white flex items-center justify-center flex-shrink-0">
              <GraduationCap size={20} className="text-accent" />
            </div>
            <span className="font-bold text-white">Evalúa Fácil</span>
          </div>

          {/* Profile button */}
          <NavLink
            to="/profile"
            className="flex items-center gap-3 px-3 py-3 mx-2 mt-1 rounded hover:bg-white/10 transition-colors group"
          >
            <div className="w-9 h-9 rounded-full bg-white overflow-hidden flex items-center justify-center flex-shrink-0">
              {userProfile?.photoURL ? (
                <img src={userProfile.photoURL} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-sm font-bold text-accent">{initials}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-body-sm font-semibold text-white truncate">{displayName}</p>
              <p className="text-metadata text-white/70 truncate">
                {userProfile?.schoolName || 'Mi perfil'}
              </p>
            </div>
            <ChevronRight size={14} className="text-white/50 group-hover:text-white/80 flex-shrink-0" />
          </NavLink>

          {/* Trial banner — silent until TRIAL_WARNING_DAYS are left, then a subtle
              row (urgent/expired get a warmer tone). Never a popup. Opens plan compare. */}
          {trialBanner && (
            <button
              type="button"
              onClick={() => setShowPlanCompare(true)}
              className={`mx-2 mt-1 px-3 py-1.5 flex items-center gap-2 rounded transition-colors text-left w-[calc(100%-1rem)] ${
                trialBanner.urgent ? 'bg-amber-400/20 hover:bg-amber-400/30' : 'hover:bg-white/10'
              }`}
            >
              <Timer size={13} className="text-white/80 flex-shrink-0 mt-0.5" />
              <p className="text-metadata text-white/90 leading-tight">{trialBanner.text}</p>
            </button>
          )}

          {/* Subjects header → goes to the full subjects list */}
          <NavLink to="/dashboard" className="mx-2 px-2 pt-5 pb-1 flex items-center justify-between rounded group">
            <span className="text-label-caps text-white/70 group-hover:text-white uppercase transition-colors">
              Asignaturas
            </span>
            <ChevronRight size={13} className="text-white/50 group-hover:text-white transition-colors" />
          </NavLink>

          {/* Subject list */}
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {loadingSidebar ? (
              <div className="flex justify-center py-4">
                <Spinner size="sm" />
              </div>
            ) : activeSubjects.length === 0 ? (
              <p className="text-body-sm text-white/70 px-3 py-2">Sin asignaturas aún</p>
            ) : (
              activeSubjects.map((s) => (
                <NavLink
                  key={s.id}
                  to={`/subject/${s.id}`}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded text-body-sm transition-colors ${
                      isActive ? 'bg-white text-accent font-semibold' : 'text-white/90 hover:bg-white/10'
                    }`
                  }
                >
                  <SubjectIcon iconKey={s.icon} size={15} className="flex-shrink-0" />
                  <span className="truncate">{subjectDisplayName(s)}</span>
                </NavLink>
              ))
            )}

            {/* Nueva asignatura */}
            <button
              type="button"
              onClick={() => navigate('/dashboard', { state: { openCreate: true } })}
              className="flex items-center gap-2 w-full px-3 py-2 rounded text-body-sm font-medium text-white hover:bg-white/10 transition-colors mt-1"
            >
              <Plus size={15} />
              Nueva asignatura…
            </button>
          </div>

          {/* Archivadas — fixed at the bottom, above logout */}
          {archivedSubjects.length > 0 && (
            <div className="px-2 pt-2 border-t border-white/15 max-h-48 overflow-y-auto">
              <button
                type="button"
                onClick={() => setShowArchived((a) => !a)}
                className="flex items-center gap-2 w-full px-3 py-2 rounded text-body-sm text-white/60 hover:bg-white/10 transition-colors"
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
                      `flex items-center gap-2 px-3 py-2 rounded text-body-sm transition-colors ${
                        isActive ? 'bg-white text-accent' : 'text-white/70 hover:bg-white/10'
                      }`
                    }
                  >
                    <SubjectIcon iconKey={s.icon} size={13} className="flex-shrink-0" />
                    <span className="truncate">{subjectDisplayName(s)}</span>
                  </NavLink>
                ))}
            </div>
          )}

          {/* Logout */}
          <div className="px-2 py-3 border-t border-white/15">
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-3 py-2 rounded text-body-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            >
              <LogOut size={15} />
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
            to="/dashboard"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 gap-0.5 text-metadata transition-colors ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }
          >
            <LayoutDashboard size={22} />
            <span>Asignaturas</span>
          </NavLink>
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 gap-0.5 text-metadata transition-colors ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }
          >
            <User size={22} />
            <span>Perfil</span>
          </NavLink>
        </div>
      </nav>

      {showPlanCompare && (
        <PlanCompareModal
          plans={plans}
          trialDays={trialDays ?? 0}
          onClose={() => setShowPlanCompare(false)}
        />
      )}
    </div>
  )
}
