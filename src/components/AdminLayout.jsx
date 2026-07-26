import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import {
  LayoutDashboard,
  CreditCard,
  Receipt,
  GraduationCap,
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
  { id: 'estudiantes', label: 'Estudiantes', icon: GraduationCap },
]

// Los tonos guinda viven en [data-role='admin'] (src/index.css), no aquí: la
// zona admin entera —tarjetas, tablas, botones— comparte esa misma paleta a
// través de --accent, así que un solo lugar la define.
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
    <div className="min-h-screen bg-[var(--admin-canvas)]">
      <header className="md:hidden sticky top-0 z-30 bg-surface-card border-b border-outline-variant px-4 py-2.5 flex items-center justify-between shadow-card safe-top">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded bg-[var(--admin-plane)] flex items-center justify-center text-white text-sm font-bold">
            AD
          </div>
          <span className="font-semibold text-on-surface text-base">Admin</span>
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
          style={{ '--admin-sidebar-w': `${width}px` }}
          className={`${
            mobileOpen ? 'flex' : 'hidden'
          } md:flex flex-col w-64 md:w-[var(--admin-sidebar-w)] h-screen fixed md:sticky top-0 flex-shrink-0 overflow-hidden z-40 md:z-20 bg-[var(--admin-plane)]`}
        >
          <div className="px-5 py-3.5 border-b border-white/10 flex items-center gap-3 bg-[var(--admin-plane-dark)]">
            <div className="w-10 h-10 rounded bg-white flex items-center justify-center text-sm font-bold flex-shrink-0 text-[var(--admin-plane)]">
              AD
            </div>
            <div className="min-w-0">
              <span className="font-bold text-white block truncate text-lg">Evalúa Fácil</span>
              <span className="text-sm font-medium text-white/70">Panel Admin</span>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-white/10">
            <p className="text-sm text-white/65 truncate">{displayName}</p>
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
                className={`flex items-center gap-3 w-full px-3 py-3 rounded text-base transition-colors ${
                  activeTab === id
                    ? 'bg-[var(--admin-plane-active)] text-white font-semibold shadow-card'
                    : 'text-white/85 hover:bg-white/20 hover:text-white'
                }`}
              >
                <Icon size={20} className="flex-shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </nav>

          <div className="px-2 py-2.5 border-t border-white/10">
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded text-base text-white/80 hover:bg-white/20 hover:text-white transition-colors"
            >
              <LogOut size={18} className="flex-shrink-0" />
              <span className="truncate">Cerrar sesión</span>
            </button>
          </div>

          {/* Separador arrastrable — zona de agarre ancha (w-2.5) con una línea
              fina visible dentro, para que sea fácil de tomar sin que se vea
              una franja gruesa. Doble clic o Inicio = ancho original.
              Es el patrón ARIA "window splitter": un separador ENFOCABLE con
              aria-valuenow, que es justo lo que la especificación define para
              un divisor redimensionable. jsx-a11y no contempla esa excepción
              (para la regla, `separator` es siempre no interactivo), así que
              se desactiva a propósito en vez de romper la semántica correcta. */}
          {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
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
              className={`w-[3px] h-full transition-colors ${
                resizing ? 'bg-white' : 'bg-white/15 group-hover:bg-white/50 group-focus:bg-white/70'
              }`}
            />
          </div>
          {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        </aside>

        {mobileOpen && (
          <button
            type="button"
            className="fixed inset-0 bg-black/30 z-30 md:hidden border-none cursor-default"
            onClick={() => setMobileOpen(false)}
            aria-label="Cerrar menú"
          />
        )}

        {/* Sin tope de ancho: el panel admin es un tablero de datos (tablas
            largas y anchas), no texto de lectura. Con `max-w-7xl` el contenido
            se cortaba en 1280 px y en un monitor ancho quedaba media pantalla
            desaprovechada a la derecha. */}
        <main className="flex-1 min-w-0 min-h-screen p-4 md:p-5 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
