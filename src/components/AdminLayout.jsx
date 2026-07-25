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
import { useScrollLock } from '../hooks/useScrollLock'
import { useResizableSidebar, SIDEBAR_MIN, SIDEBAR_MAX } from '../hooks/useResizableSidebar'

const TABS = [
  { id: 'resumen', label: 'Resumen', icon: LayoutDashboard },
  { id: 'suscripciones', label: 'Suscripciones', icon: CreditCard },
  { id: 'pagos', label: 'Pagos', icon: Receipt },
  { id: 'cobros', label: 'Cobros', icon: Wallet },
  { id: 'usuarios', label: 'Usuarios', icon: Users },
]

// Guinda institucional — colores literales a propósito: el panel admin no usa
// el acento por rol (--accent, azul del docente) porque es una zona distinta de
// la plataforma y debe leerse como tal de un vistazo. Mismo criterio que
// Landing.jsx, que también fija colores a mano.
const GUINDA = '#611232'        // fondo de la barra
const GUINDA_LIGHT = '#9F2241'  // pestaña activa y separador
const GUINDA_DARK = '#4A0E26'   // cabecera de la barra

export default function AdminLayout({ activeTab, onTabChange, children }) {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { width, resizing, asideRef, startResize, resetWidth, onKeyDown } = useResizableSidebar()

  useScrollLock(mobileOpen)

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/')
  }

  const displayName = userProfile?.email || 'Administrador'

  return (
    <div className="min-h-screen bg-surface">
      <header className="md:hidden sticky top-0 z-30 bg-surface-card border-b border-outline-variant px-4 py-2.5 flex items-center justify-between shadow-card safe-top">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded flex items-center justify-center text-white text-xs font-bold" style={{ background: GUINDA }}>
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
        {/* El ancho ajustable solo aplica en escritorio (md:w-[…]): en móvil la
            barra es un cajón superpuesto y se queda en w-64. `overflow-hidden`
            + scroll interno en <nav> mantienen el separador quieto cuando el
            menú es más alto que la pantalla. */}
        <aside
          ref={asideRef}
          style={{ '--admin-sidebar-w': `${width}px`, background: GUINDA }}
          className={`${
            mobileOpen ? 'flex' : 'hidden'
          } md:flex flex-col w-64 md:w-[var(--admin-sidebar-w)] h-screen fixed md:sticky top-0 flex-shrink-0 overflow-hidden z-40 md:z-20`}
        >
          <div
            className="px-5 py-3 border-b border-white/10 flex items-center gap-2.5"
            style={{ background: GUINDA_DARK }}
          >
            <div className="w-8 h-8 rounded bg-white flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ color: GUINDA }}>
              AD
            </div>
            <div className="min-w-0">
              <span className="font-bold text-white block truncate">Evalúa Fácil</span>
              <span className="text-xs font-medium text-white/70">Panel Admin</span>
            </div>
          </div>

          <div className="px-4 py-2.5 border-b border-white/10">
            <p className="text-xs text-white/60 truncate">{displayName}</p>
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
                style={activeTab === id ? { background: GUINDA_LIGHT } : undefined}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded text-sm transition-colors ${
                  activeTab === id
                    ? 'text-white font-semibold shadow-card'
                    : 'text-white/75 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon size={18} className="flex-shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </nav>

          <div className="px-2 py-2.5 border-t border-white/10">
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-3 py-2 rounded text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            >
              <LogOut size={16} className="flex-shrink-0" />
              <span className="truncate">Cerrar sesión</span>
            </button>
          </div>

          {/* Separador arrastrable — zona de agarre ancha (w-2.5) con una línea
              fina visible dentro, para que sea fácil de tomar sin que se vea
              una franja gruesa. Doble clic o Inicio = ancho original. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Ajustar ancho del menú"
            aria-valuenow={width}
            aria-valuemin={SIDEBAR_MIN}
            aria-valuemax={SIDEBAR_MAX}
            tabIndex={0}
            onPointerDown={startResize}
            onDoubleClick={resetWidth}
            onKeyDown={onKeyDown}
            title="Arrastra para ajustar el ancho (doble clic para restablecer)"
            className="hidden md:flex absolute top-0 right-0 h-full w-2.5 cursor-col-resize items-stretch justify-end group focus:outline-none"
          >
            <div
              className={`w-[3px] h-full transition-colors ${resizing ? '' : 'bg-white/10 group-hover:bg-white/40 group-focus:bg-white/60'}`}
              style={resizing ? { background: '#FFFFFF' } : undefined}
            />
          </div>
        </aside>

        {mobileOpen && (
          <button
            type="button"
            className="fixed inset-0 bg-black/30 z-30 md:hidden border-none cursor-default"
            onClick={() => setMobileOpen(false)}
            aria-label="Cerrar menú"
          />
        )}

        <main className="flex-1 min-w-0 min-h-screen p-4 md:p-5 lg:p-8 max-w-7xl">{children}</main>
      </div>
    </div>
  )
}
