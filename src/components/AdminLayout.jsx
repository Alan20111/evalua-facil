import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import {
  LayoutDashboard,
  CreditCard,
  Receipt,
  Users,
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
    <div className="min-h-screen bg-surface">
      <header className="md:hidden sticky top-0 z-30 bg-surface-card border-b border-outline-variant px-4 py-2.5 flex items-center justify-between shadow-card">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-accent flex items-center justify-center text-white text-xs font-bold">
            AD
          </div>
          <span className="font-semibold text-on-surface text-sm">Admin</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          className="p-2 text-muted rounded"
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      <div className="flex">
        <aside
          className={`${
            mobileOpen ? 'flex' : 'hidden'
          } md:flex flex-col w-64 h-screen fixed md:sticky top-0 bg-surface-card border-r border-outline-variant flex-shrink-0 overflow-y-auto z-40 md:z-20`}
        >
          <div className="px-5 py-3 border-b border-outline-variant flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-accent flex items-center justify-center text-white text-xs font-bold">
              AD
            </div>
            <div>
              <span className="font-bold text-on-surface block">Evalúa Fácil</span>
              <span className="text-xs text-accent font-medium">Panel Admin</span>
            </div>
          </div>

          <div className="px-4 py-2.5 border-b border-outline-variant">
            <p className="text-xs text-slate-400 truncate">{displayName}</p>
          </div>

          <nav className="flex-1 px-2 py-2.5 space-y-0.5 overflow-y-auto">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  onTabChange(id)
                  setMobileOpen(false)
                }}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded text-sm transition-colors ${
                  activeTab === id
                    ? 'bg-accent-light text-accent font-semibold'
                    : 'text-muted hover:bg-surface'
                }`}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
          </nav>

          <div className="px-2 py-2.5 border-t border-outline-variant">
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-3 py-2 rounded text-sm text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
            >
              <LogOut size={16} />
              Cerrar sesión
            </button>
          </div>
        </aside>

        {mobileOpen && (
          <div
            className="fixed inset-0 bg-black/30 z-30 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <main className="flex-1 min-w-0 min-h-screen p-4 md:p-5 lg:p-8 max-w-7xl">{children}</main>
      </div>
    </div>
  )
}
