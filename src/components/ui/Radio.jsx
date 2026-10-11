// Opción única: aro que se llena con un punto de acento al elegirse (el punto
// «crece» desde el centro). Radio suelto o RadioGroup con opciones.
// PLAN_NORMALIZACION_UI §3 y §5.1.
import { forwardRef, useId } from 'react'
import { cn } from './cn'

const Radio = forwardRef(function Radio({ label, hint, className = '', wrapperClassName = '', ...rest }, ref) {
  return (
    <label className={cn('flex items-start gap-3 cursor-pointer select-none', rest.disabled && 'cursor-not-allowed', wrapperClassName)}>
      <span className="relative flex-shrink-0 size-5 mt-px">
        <input ref={ref} type="radio" className={cn('peer absolute inset-0 m-0 opacity-0 cursor-pointer disabled:cursor-not-allowed', className)} {...rest} />
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full border-2 border-outline transition-colors duration-rapida peer-checked:border-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-disabled:opacity-40" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-1.5 rounded-full bg-accent scale-0 transition-transform duration-estandar ease-entrada peer-checked:scale-100" />
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

// options: [{ value, label, hint?, disabled? }]
export function RadioGroup({ label, name, options = [], value, onChange, className = '' }) {
  const auto = useId()
  const grupo = name || auto
  return (
    <fieldset className={className || undefined}>
      {label && <legend className="block text-sm font-medium text-muted mb-2">{label}</legend>}
      <div className="space-y-3">
        {options.map((o) => (
          <Radio key={o.value} name={grupo} value={o.value} label={o.label} hint={o.hint} disabled={o.disabled}
            checked={value === o.value} onChange={() => onChange?.(o.value)} />
        ))}
      </div>
    </fieldset>
  )
}

export default Radio
