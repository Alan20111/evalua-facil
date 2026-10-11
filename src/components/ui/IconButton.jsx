// Botón de solo ícono (cerrar, editar, más opciones…). Círculo del tamaño de
// un control, nombre accesible OBLIGATORIO (`label`) y el mismo texto como
// tooltip con ratón. PLAN_NORMALIZACION_UI §3.
//
//   size     md (size-control, default) · sm (size-control-sm)
//   variant  soft (default) · accent · danger · onColor (sobre fondos de color)
import { forwardRef } from 'react'
import { cn } from './cn'
import Spinner from '../Spinner'
import { ICONO } from '../../config/iconos'

const VARIANTS = {
  soft: 'text-muted hover:text-accent hover:bg-[var(--accent-tint)]',
  accent: 'bg-accent text-white hover:bg-accent-hover',
  danger: 'text-muted hover:text-red-600 hover:bg-red-50',
  onColor: 'text-white/80 hover:text-white hover:bg-white/10',
}
const SIZES = { sm: 'size-control-sm', md: 'size-control' }

const IconButton = forwardRef(function IconButton(
  { icon: Icono, label, size = 'md', variant = 'soft', tooltip = true, busy = false, className = '', children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      data-tooltip={tooltip ? label : undefined}
      disabled={rest.disabled || busy}
      className={cn(
        'inline-flex items-center justify-center flex-shrink-0 rounded-full transition active:scale-[0.94] disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        SIZES[size] || SIZES.md,
        VARIANTS[variant] || VARIANTS.soft,
        className
      )}
      {...rest}
    >
      {busy ? <Spinner size="sm" current /> : children || <Icono size={size === 'sm' ? ICONO.sm : ICONO.md} aria-hidden="true" />}
    </button>
  )
})

export default IconButton
