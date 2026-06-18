import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import {
  LayoutDashboard,
  CreditCard,
  Receipt,
  Users,
  Package,
  Wallet,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { auth } from '../firebase'
import { useAuth } from '../context/AuthContext'

const TABS = [
  { id: 'resumen', label: 'Resumen', icon: LayoutDashboard },
  { id: 'suscripciones', label: 'Suscripciones', icon: CreditCard },
  { id: 'pagos', label: 'Pagos', icon: Receipt },
  { id: 'cobros', label: 'Cobros', icon: Wallet },
  { id: 'usuarios', label: 'Usuarios', icon: Users },
  { id: 'planes', label: 'Planes', icon: Package },
]

export default function AdminLayout({ activeTab, onTabChange, children }) {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/')
  }

  const displayName = userProfile?.email || 'Administrador'

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="md:hidden sticky top-0 z-30 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
            AD
          </div>
          <span className="font-semibold text-slate-800 text-sm">Admin</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          className="p-2 text-slate-500 rounded-lg"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      <div className="flex">
        <aside
          className={`${
            mobileOpen ? 'flex' : 'hidden'
          } md:flex flex-col w-64 h-screen fixed md:sticky top-0 bg-white border-r border-slate-200 flex-shrink-0 z-20`}
        >
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
              AD
            </div>
            <div>
              <span className="font-bold text-slate-800 block">Evalúa Fácil</span>
              <span className="text-xs text-blue-600 font-medium">Panel Admin</span>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs text-slate-400 truncate">{displayName}</p>
          </div>

          <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  onTabChange(id)
                  setMobileOpen(false)
                }}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm transition-colors ${
                  activeTab === id
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>

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

        {mobileOpen && (
          <div
            className="fixed inset-0 bg-black/30 z-10 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <main className="flex-1 min-h-screen p-4 md:p-6 lg:p-8 max-w-7xl">{children}</main>
      </div>
    </div>
  )
}
