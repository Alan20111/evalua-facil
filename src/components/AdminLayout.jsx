import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import {
  LayoutDashboard,
  UserPlus,
  GraduationCap,
  Wallet,
  LogOut,
  Menu,
  X,
  Map,
  Sparkles,
  BrainCircuit,
  Download, TrendingUp, School, Flag, Bug } from 'lucide-react'
import { auth } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useScrollLock } from '../hooks/useScrollLock'
import { useResizableSidebar, SIDEBAR_MIN, SIDEBAR_MAX } from '../hooks/useResizableSidebar'
import SkipLink from './SkipLink'
import { IconButton } from './ui'
import { SB_FILA, SB_ICONO, SB_INACTIVA, SB_GRUPO } from '../config/sidebar'

// Modelo de créditos puros (20-ago-2026): se retira la pestaña "Pagos"
// (suscripción mensual, flujo eliminado) — "Créditos" pasa a ser la compra
// principal de IA, y "Registros" lista a los docentes registrados.
const TABS = [
  { id: 'chat', label: 'Inteligencia de EF', icon: BrainCircuit },
  { id: 'resumen', label: 'Resumen', icon: LayoutDashboard },
  { id: 'creditos', label: 'Compras de créditos', icon: Sparkles },
  { id: 'costosIA', label: 'Costos de IA', icon: TrendingUp },
  { id: 'reportesIA', label: 'Reportes de IA', icon: Flag },
  { id: 'errores', label: 'Errores', icon: Bug },
  { id: 'registros', label: 'Registros', icon: UserPlus },
  { id: 'zonas', label: 'Ventas por zona', icon: Map },
  { id: 'cobros', label: 'Cobros', icon: Wallet },
  { id: 'escuelas', label: 'Escuelas', icon: School },
  { id: 'estudiantes', label: 'Estudiantes', icon: GraduationCap },
  { id: 'descargas', label: 'Descargas', icon: Download },
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
      <SkipLink />
      <header className="md:hidden sticky top-0 z-30 bg-surface-card border-b border-outline-variant px-4 py-2.5 flex items-center justify-between shadow-card safe-top">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-[var(--admin-plane)] flex items-center justify-center text-white text-sm font-bold">
            AD
          </div>
          <span className="font-semibold text-on-surface text-base">Admin</span>
        </div>
        <IconButton
          icon={mobileOpen ? X : Menu}
          label={mobileOpen ? 'Cerrar menú' : 'Abrir menú'}
          tooltip={false}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((o) => !o)}
        />
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
            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-sm font-bold flex-shrink-0 text-[var(--admin-plane)]">
              AD
            </div>
            <div className="min-w-0">
              <span className="font-bold text-white block truncate text-lg">Evalúa Fácil</span>
              <span className="text-sm font-medium text-white/95">Panel Admin</span>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-white/10">
            <p className="text-sm text-white/65 truncate">{displayName}</p>
          </div>

          <nav className={`flex-1 ${SB_GRUPO} overflow-y-auto`}>
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  onTabChange(id)
                  setMobileOpen(false)
                }}
                aria-current={activeTab === id ? 'page' : undefined}
                className={`${SB_FILA} ${
                  activeTab === id
                    ? 'bg-[var(--admin-plane-active)] text-white font-semibold shadow-card'
                    : SB_INACTIVA
                }`}
              >
                <Icon size={SB_ICONO} className="flex-shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </nav>

          <div className={`${SB_GRUPO} border-t border-white/10`}>
            <button
              type="button"
              onClick={handleLogout}
              className={`${SB_FILA} ${SB_INACTIVA}`}
            >
              <LogOut size={SB_ICONO} className="flex-shrink-0" />
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
            className="fixed inset-0 bg-black/30 animate-velo z-30 md:hidden border-none cursor-default"
            onClick={() => setMobileOpen(false)}
            aria-label="Cerrar menú"
          />
        )}

        {/* Sin tope de ancho: el panel admin es un tablero de datos (tablas
            largas y anchas), no texto de lectura. Con `max-w-7xl` el contenido
            se cortaba en 1280 px y en un monitor ancho quedaba media pantalla
            desaprovechada a la derecha. */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 min-w-0 min-h-screen p-4 md:p-5 lg:p-8 focus:outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  )
}
