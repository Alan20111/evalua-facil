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
  X,
} from 'lucide-react'
import { signOut } from 'firebase/auth'
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import Spinner from './Spinner'

export default function TeacherLayout({ children }) {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [subjects, setSubjects] = useState([])
  const [groups, setGroups] = useState([])
  const [loadingSidebar, setLoadingSidebar] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)
  const [newSubjectName, setNewSubjectName] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!currentUser) return
    loadSidebarData()
  }, [currentUser])

  async function loadSidebarData() {
    try {
      const [subSnap, grpSnap] = await Promise.all([
        getDocs(query(collection(db, 'subjects'), where('docenteId', '==', currentUser.uid))),
        getDocs(query(collection(db, 'groups'), where('docenteId', '==', currentUser.uid))),
      ])
      setSubjects(subSnap.docs.map((d) => ({ id: d.id, ...d.data() })))
      const grps = grpSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setGroups(grps)
      if (grps.length > 0) setSelectedGroupId(grps[0].id)
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

  async function handleCreateSubject(e) {
    e.preventDefault()
    if (!newSubjectName.trim() || !selectedGroupId) return
    setCreating(true)
    try {
      const ref = await addDoc(collection(db, 'subjects'), {
        nombre: newSubjectName.trim(),
        docenteId: currentUser.uid,
        grupoId: selectedGroupId,
        escuelaId: userProfile?.escuelaId,
        createdAt: serverTimestamp(),
        archived: false,
      })
      setSubjects((s) => [
        ...s,
        {
          id: ref.id,
          nombre: newSubjectName.trim(),
          docenteId: currentUser.uid,
          grupoId: selectedGroupId,
          archived: false,
        },
      ])
      setNewSubjectName('')
      setShowNewModal(false)
      toast('Asignatura creada')
      navigate(`/subject/${ref.id}`)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setCreating(false)
    }
  }

  const displayName = userProfile?.username || userProfile?.nombre || 'Docente'
  const initials = displayName.charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">
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
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              EF
            </div>
            <span className="font-bold text-slate-800">Evalúa Fácil</span>
          </div>

          {/* Profile button */}
          <NavLink
            to="/profile"
            className="flex items-center gap-3 px-3 py-3 mx-2 mt-2 rounded-xl hover:bg-slate-50 transition-colors group"
          >
            <div className="w-9 h-9 rounded-full bg-indigo-100 overflow-hidden flex items-center justify-center flex-shrink-0">
              {userProfile?.photoURL ? (
                <img
                  src={userProfile.photoURL}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-sm font-bold text-indigo-600">{initials}</span>
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

          {/* Subjects header */}
          <div className="px-4 pt-5 pb-1">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Asignaturas
            </p>
          </div>

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
                        ? 'bg-indigo-50 text-indigo-700 font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`
                  }
                >
                  <BookOpen size={14} className="flex-shrink-0" />
                  <span className="truncate">{s.nombre}</span>
                </NavLink>
              ))
            )}

            {/* Nueva asignatura */}
            <button
              type="button"
              onClick={() => setShowNewModal(true)}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-indigo-600 hover:bg-indigo-50 transition-colors mt-1"
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
                            ? 'bg-indigo-50 text-indigo-700'
                            : 'text-slate-500 hover:bg-slate-50'
                        }`
                      }
                    >
                      <BookOpen size={13} className="flex-shrink-0" />
                      <span className="truncate">{s.nombre}</span>
                    </NavLink>
                  ))}
              </>
            )}
          </div>

          {/* Dashboard link */}
          <div className="px-2 py-1 border-t border-slate-100">
            <NavLink
              to="/dashboard"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-slate-500 hover:bg-slate-50'
                }`
              }
            >
              <LayoutDashboard size={14} />
              Grupos
            </NavLink>
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
                isActive ? 'text-indigo-600' : 'text-slate-400'
              }`
            }
          >
            <LayoutDashboard size={22} />
            <span>Grupos</span>
          </NavLink>
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 gap-0.5 text-xs transition-colors ${
                isActive ? 'text-indigo-600' : 'text-slate-400'
              }`
            }
          >
            <User size={22} />
            <span>Perfil</span>
          </NavLink>
        </div>
      </nav>

      {/* New subject modal */}
      {showNewModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4"
          onClick={() => setShowNewModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-slate-900">Nueva asignatura</h3>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            {groups.length === 0 ? (
              <div className="text-center py-2">
                <p className="text-sm text-slate-500 mb-4">
                  Primero crea un grupo en el panel principal para poder añadir asignaturas.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewModal(false)
                    navigate('/dashboard')
                  }}
                  className="py-2.5 px-5 bg-indigo-600 text-white font-semibold rounded-xl text-sm"
                >
                  Ir al panel
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateSubject} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Nombre de la asignatura
                  </label>
                  <input
                    type="text"
                    value={newSubjectName}
                    onChange={(e) => setNewSubjectName(e.target.value)}
                    required
                    autoFocus
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
                    placeholder="Ej. Matemáticas I"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Grupo
                  </label>
                  <select
                    value={selectedGroupId}
                    onChange={(e) => setSelectedGroupId(e.target.value)}
                    required
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.nombre} — {g.ciclo}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={creating || !newSubjectName.trim()}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {creating ? <Spinner size="sm" /> : null}
                  {creating ? 'Creando…' : 'Crear asignatura'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
