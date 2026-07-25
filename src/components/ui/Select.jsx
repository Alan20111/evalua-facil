// Select nativo canónico — mismo marco visual que el Input estándar
// (docs/DESIGN_SYSTEM.md §6.2), para los selects de texto genéricos. Los
// selects de propósito único (IconSelect, PaletteSelect, VisibilitySelect,
// FileTypeSelect) son otra cosa (§6.10) y NO se tocan.
//
// Props:
//   label / hint / error  igual que Input.
//   options  [{ value, label }] — atajo; también acepta <option> como children.
// El resto (value, onChange, required, disabled…) pasa al <select>.
import { forwardRef } from 'react'
import { cn } from './cn'

const BASE =
  'w-full px-4 py-2.5 rounded border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface'

const Select = forwardRef(function Select(
  { label, hint, error, id, options, className = '', wrapperClassName = '', children, ...rest },
  ref
) {
  return (
    <div className={wrapperClassName || undefined}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-muted mb-1">
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={id}
        className={cn(BASE, error ? 'border-red-400' : 'border-outline-variant', className)}
        {...rest}
      >
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          : children}
      </select>
      {error ? (
        <p className="text-red-500 text-xs mt-1">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-400 mt-1">{hint}</p>
      ) : null}
    </div>
  )
})

export default Select
