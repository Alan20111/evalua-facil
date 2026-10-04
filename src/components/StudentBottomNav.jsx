import { NavLink } from 'react-router-dom'
import { NAV_ITEM } from '../config/sidebar'
import { LayoutDashboard, CalendarDays, Bell, User } from 'lucide-react'
import { IS_NATIVE_APP } from '../utils/platform'

function navIconPillCls(isActive) {
  if (!IS_NATIVE_APP) return ''
  return `px-5 py-1 rounded-full transition-colors ${isActive ? 'bg-[var(--accent-light)]' : ''}`
}

const NAV_TABS = [
  { to: '/alumno/dashboard', label: 'Asignaturas', Icon: LayoutDashboard },
  { to: '/alumno/agenda', label: 'Agenda', Icon: CalendarDays },
  { to: '/alumno/notificaciones', label: 'Notificaciones', Icon: Bell },
  { to: '/alumno/perfil', label: 'Perfil', Icon: User },
]

export default function StudentBottomNav() {
  return (
    // style width usa --layout-w (layout viewport real, 360px) en lugar de 100% (que en
    // Samsung S23 Capacitor resuelve al visual viewport de ~410px, causando el hueco).
    // En la web ese ancho no se aplica, así que el ancho lo da `right-0`: sin él
    // la barra `fixed` se encoge a su contenido (~204 de 375px) y queda cortada.
    // `w-full` + left/right-0 la hace llenar el 100% de cualquier pantalla.
    <nav
      data-esq="nav-inferior"
      aria-label="Navegación principal"
      style={IS_NATIVE_APP ? { width: 'calc(var(--layout-w) - 1rem)' } : undefined}
      className={`${IS_NATIVE_APP ? '' : 'right-2 md:hidden'} fixed barra-flotante-inf left-2 z-30 bg-surface-card rounded-full shadow-barra`}
    >
      <div data-esq="nav-inferior-fila" className="flex px-2 h-[var(--barra-alto)]">
        {NAV_TABS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={NAV_ITEM}
          >
            {({ isActive }) => (<>
              <span className={navIconPillCls(isActive)}><Icon size={24} /></span>
              <span>{label}</span>
            </>)}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
