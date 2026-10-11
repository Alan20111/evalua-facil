// Botón de la app (docs/PLAN_NORMALIZACION_UI.md §2.1 y §3). Todos los botones
// de texto miden LO MISMO: la altura es fija (h-control), no sale del padding
// ni del tamaño de letra, y el texto es siempre text-sm font-semibold. El
// padding solo da aire a los lados.
//
// Props:
//   variant  primary (default) · secondary · outline-accent · danger ·
//            danger-outline · ghost · quiet (acción secundaria discreta:
//            «Atrás», «Lo haré después») · link · icon · cta-dashed · fab
//   size     sm (zonas densas) · md (default) · lg (acción principal de
//            pantallas de acceso y botón fijo de formulario)
//   icon / iconRight   componente de lucide (u otro) a la izquierda / derecha
//   iconEffect   microanimación del ícono al pasar (ver Animado: gira90,
//                empujaArriba, balanceo, destello…)
//   busy     muestra el spinner en lugar del ícono y deshabilita
//   fullWidth, as ('button' | Link | 'a'…), className
import { forwardRef } from 'react'
import { cn } from './cn'
import Spinner from '../Spinner'
import { ICONO } from '../../config/iconos'
import Animado from './Animado'

const BASE =
  'group inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold whitespace-nowrap select-none transition active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2'

const VARIANTS = {
  primary: 'bg-accent hover:bg-accent-hover text-white',
  secondary: 'border border-outline-variant bg-surface-card text-on-surface hover:bg-surface',
  'outline-accent': 'border border-accent text-accent hover:bg-[var(--accent-tint)]',
  danger: 'bg-red-600 hover:bg-red-700 text-white',
  'danger-outline': 'border border-red-300 text-red-600 hover:bg-red-50',
  ghost: 'text-accent hover:bg-[var(--accent-tint)]',
  quiet: 'text-muted hover:text-on-surface hover:bg-surface-container',
  // Enlace dentro de un texto: sin altura propia ni relleno.
  link: 'text-accent hover:underline underline-offset-2',
  icon: 'size-control text-muted hover:text-accent hover:bg-[var(--accent-tint)]',
  'cta-dashed': 'w-full border-2 border-dashed border-accent text-accent hover:bg-accent-light',
  fab: 'size-14 bg-accent text-white shadow-lg hover:bg-accent-hover',
}

// Variantes con altura de control y relleno lateral.
const CON_ALTURA = new Set(['primary', 'secondary', 'outline-accent', 'danger', 'danger-outline', 'ghost', 'quiet', 'cta-dashed'])
const SIZES = {
  sm: 'h-control-sm px-3',
  md: 'h-control px-4',
  lg: 'h-control-lg px-5',
}
const ICONO_POR_TAMANO = { sm: ICONO.xs, md: ICONO.sm, lg: ICONO.sm }

const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', fullWidth = false, busy = false, icon: Icono, iconRight: IconoDer, iconEffect, as = 'button', className = '', disabled, children, ...rest },
  ref
) {
  const Tag = as
  const tamIcono = variant === 'icon' || variant === 'fab' ? ICONO.md : ICONO_POR_TAMANO[size]
  const classes = cn(
    variant === 'link' ? 'inline-flex items-center gap-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full' : BASE,
    VARIANTS[variant] || VARIANTS.primary,
    CON_ALTURA.has(variant) && (SIZES[size] || SIZES.md),
    fullWidth && 'w-full',
    className
  )
  return (
    <Tag
      ref={ref}
      className={classes}
      disabled={Tag === 'button' ? disabled || busy : undefined}
      aria-busy={busy || undefined}
      {...(Tag === 'button' && !rest.type ? { type: 'button' } : {})}
      {...rest}
    >
      {busy ? <Spinner size="sm" current /> : Icono && (iconEffect
        ? <Animado efecto={iconEffect}><Icono size={tamIcono} /></Animado>
        : <Icono size={tamIcono} aria-hidden="true" className="flex-shrink-0" />)}
      {children}
      {IconoDer && !busy && <IconoDer size={tamIcono} aria-hidden="true" className="flex-shrink-0" />}
    </Tag>
  )
})

export default Button
