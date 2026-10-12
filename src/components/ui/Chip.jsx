// Chip (filtro o elección rápida) y Badge (etiqueta de estado, no se toca).
// PLAN_NORMALIZACION_UI §3 y §5.1: el chip elegido = relleno de acento.
import { cn } from './cn'
import { ICONO } from '../../config/iconos'

export function Chip({ selected = false, onClick, icon: Icono, className = '', children, ...rest }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 h-control-sm px-3 rounded-full text-sm font-medium whitespace-nowrap transition active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        selected ? 'bg-accent text-white' : 'bg-surface-container text-muted hover:bg-[var(--accent-tint)] hover:text-on-surface',
        className
      )}
      {...rest}
    >
      {Icono && <Icono size={ICONO.xs} aria-hidden="true" />}
      {children}
    </button>
  )
}

const TONOS = {
  accent: 'bg-accent-light text-accent-hover',
  neutral: 'bg-surface-container text-muted',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-800',
  danger: 'bg-red-50 text-red-700',
}

export function Badge({ tone = 'neutral', icon: Icono, className = '', children }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap', TONOS[tone] || TONOS.neutral, className)}>
      {Icono && <Icono size={ICONO.xs} aria-hidden="true" />}
      {children}
    </span>
  )
}

export default Chip
