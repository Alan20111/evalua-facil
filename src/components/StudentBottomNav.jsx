import { NavLink } from 'react-router-dom'
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
    <nav
      style={IS_NATIVE_APP ? { width: 'var(--layout-w)' } : undefined}
      className={`${IS_NATIVE_APP ? '' : 'md:hidden'} fixed bottom-0 left-0 z-30 bg-surface-card border-t border-outline-variant safe-bottom`}
    >
      <div className="flex">
        {NAV_TABS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 gap-0.5 text-metadata transition-colors ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }
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
