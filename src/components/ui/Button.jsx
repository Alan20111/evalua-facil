// Botón canónico — extraído literal de docs/DESIGN_SYSTEM.md §6.1 (8 variantes).
// NO inventa estilos: cada `variant` es la cadena de clases ya documentada.
//
// Props:
//   variant  'primary' (default) | 'secondary' | 'outline-accent' | 'danger'
//            | 'ghost' | 'icon' | 'cta-dashed' | 'fab'
//   size     'sm' | 'md' (default) | 'lg'  — solo aplica a las variantes con
//            texto (primary/secondary/outline-accent/danger); icon/ghost/
//            cta-dashed/fab traen su propio tamaño.
//   fullWidth  agrega w-full.
//   busy       muestra Spinner y deshabilita (para acciones async).
//   as         'button' (default) | 'a'  — para links con aspecto de botón.
// El resto de props (onClick, type, disabled, href, aria-*, etc.) pasan tal cual.
import { forwardRef } from 'react'
import { cn } from './cn'
import Spinner from '../Spinner'

const VARIANTS = {
  primary:
    'bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2',
  secondary:
    'border border-outline-variant rounded font-semibold text-on-surface hover:bg-surface transition-colors disabled:opacity-60 flex items-center justify-center gap-2',
  'outline-accent':
    'border border-accent text-accent rounded hover:bg-[var(--accent-tint)] font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2',
  danger:
    'bg-red-600 hover:bg-red-700 text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2',
  ghost:
    'text-accent hover:underline font-semibold transition-colors disabled:opacity-60',
  // Icon-button: disabled:opacity-40 (convención de toolbars de puro icono).
  // Alto/ancho mínimo de 44 px reales, en corchetes (no en la escala rem de
  // Tailwind): con html{font-size:90%} del proyecto, el equivalente en la
  // escala (ej. min-h-11) daría 39.6px reales, no 44 — WCAG 2.5.8 pide el
  // tamaño real del target, no el nominal. docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 2, paso 2.8.
  icon:
    'p-2 min-h-[44px] min-w-[44px] rounded text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] transition-colors disabled:opacity-40 inline-flex items-center justify-center',
  'cta-dashed':
    'w-full py-2.5 rounded border-2 border-dashed border-accent text-accent text-sm font-semibold hover:bg-accent-light transition-colors disabled:opacity-60 flex items-center justify-center gap-2',
  fab:
    'w-14 h-14 rounded-full bg-accent text-white shadow-lg flex items-center justify-center',
}

// El tamaño (padding + texto) solo modula las variantes de botón "de texto".
const SIZED = new Set(['primary', 'secondary', 'outline-accent', 'danger'])
const SIZES = {
  sm: 'px-3 py-2 text-sm',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-5 py-2.5 text-base',
}

const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', fullWidth = false, busy = false, as = 'button', className = '', disabled, children, ...rest },
  ref
) {
  const Tag = as
  const classes = cn(
    VARIANTS[variant] || VARIANTS.primary,
    SIZED.has(variant) && SIZES[size],
    fullWidth && 'w-full',
    className
  )
  return (
    <Tag
      ref={ref}
      className={classes}
      disabled={Tag === 'button' ? disabled || busy : undefined}
      {...(Tag === 'button' && !rest.type ? { type: 'button' } : {})}
      {...rest}
    >
      {busy && <Spinner size="sm" />}
      {children}
    </Tag>
  )
})

export default Button
