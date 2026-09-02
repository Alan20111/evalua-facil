// Input canónico — extraído literal de docs/DESIGN_SYSTEM.md §6.2.
// Envuelve label + input + hint/error opcionales. El anillo de foco es
// `focus-visible:` (convención de toda la app desde jul-2026).
//
// Props:
//   label   texto del <label> (opcional). Si se pasa `id`, se asocia con htmlFor.
//   optional  pinta el signo "+" de campo opcional junto a la etiqueta. El
//             asterisco rojo de obligatorio NO se pide: sale solo cuando el
//             campo lleva `required`, para que no puedan discrepar la marca
//             visual y la validación real.
//   hint    texto de ayuda debajo (text-xs text-slate-400).
//   error   mensaje de error — pinta el borde en rojo y muestra el texto.
//   className  se agrega al <input> (no al wrapper).
//   wrapperClassName  se agrega al contenedor.
// El resto (type, value, onChange, placeholder, required, autoComplete…) pasa al <input>.
import { forwardRef } from 'react'
import { cn } from './cn'
import FieldMark from './FieldMark'

const BASE =
  'w-full px-4 py-2.5 rounded border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface'

const Input = forwardRef(function Input(
  { label, hint, error, id, optional = false, className = '', wrapperClassName = '', ...rest },
  ref
) {
  return (
    <div className={wrapperClassName || undefined}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-muted mb-1">
          {label}
          <FieldMark tipo={rest.required ? 'obligatorio' : optional ? 'opcional' : null} />
        </label>
      )}
      <input
        ref={ref}
        id={id}
        className={cn(BASE, error ? 'border-red-400' : 'border-outline-variant', className)}
        {...rest}
      />
      {error ? (
        <p className="text-red-500 text-xs mt-1">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-400 mt-1">{hint}</p>
      ) : null}
    </div>
  )
})

export default Input
