// Casilla de la app: círculo (todo es redondo, DESIGN_SYSTEM §4.1) que se
// rellena de acento y DIBUJA su palomita al marcarse (animación `trazo`).
// El <input> nativo sigue ahí (invisible, encima) para teclado, formularios y
// lectores de pantalla. PLAN_NORMALIZACION_UI §3 y §5.1.
import { forwardRef } from 'react'
import { cn } from './cn'

export function MarcaCasilla({ className = '' }) {
  return (
    <span aria-hidden="true" className={cn(
      'pointer-events-none absolute inset-0 rounded-full border-2 border-outline transition-colors duration-rapida',
      'peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2',
      'peer-disabled:opacity-40 peer-checked:[&_path]:animate-trazo',
      className
    )}>
      <svg viewBox="0 0 20 20" className="size-full text-white">
        <path d="M5.5 10.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="[stroke-dasharray:16]" />
      </svg>
    </span>
  )
}

const Checkbox = forwardRef(function Checkbox(
  { label, hint, className = '', wrapperClassName = '', ...rest },
  ref
) {
  return (
    <label className={cn('flex items-start gap-3 cursor-pointer select-none', rest.disabled && 'cursor-not-allowed', wrapperClassName)}>
      <span className="relative flex-shrink-0 size-5 mt-px">
        <input
          ref={ref}
          type="checkbox"
          className={cn('peer absolute inset-0 m-0 opacity-0 cursor-pointer disabled:cursor-not-allowed', className)}
          {...rest}
        />
        <MarcaCasilla />
      </span>
      {(label || hint) && (
        <span className="text-sm font-medium text-on-surface">
          {label}
          {hint && <span className="block font-normal text-xs text-hint">{hint}</span>}
        </span>
      )}
    </label>
  )
})

export default Checkbox
