import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, LogOut, User } from 'lucide-react'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth } from '../context/AuthContext'

export default function TeacherLayout({ children }) {
  const { userProfile } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/')
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 pb-20">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">
            EF
          </div>
          <span className="font-semibold text-slate-800 text-sm">Evalúa Fácil</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-500 text-xs hidden sm:block">{userProfile?.nombre}</span>
          <button
            onClick={handleLogout}
            className="p-2 text-slate-400 hover:text-red-500 rounded-lg transition-colors"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1">{children}</main>

      {/* Bottom nav (mobile) */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-100 safe-bottom">
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
    </div>
  )
}
