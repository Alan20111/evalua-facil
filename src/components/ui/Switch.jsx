// Interruptor (encendido/apagado inmediato, sin «Guardar»). role="switch" con
// aria-checked; la perilla se desliza con la curva de entrada. Para elegir
// algo que se envía después con un formulario, usar Checkbox.
// PLAN_NORMALIZACION_UI §3.
import { useId } from 'react'
import { cn } from './cn'

export default function Switch({ checked = false, onChange, label, hint, disabled = false, id, ariaLabel, className = '' }) {
  const auto = useId()
  const switchId = id || auto
  const etiquetaId = `${switchId}-etiqueta`
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      {(label || hint) && (
        <label id={etiquetaId} htmlFor={switchId} className={cn('min-w-0 text-sm font-medium text-on-surface', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
          {label}
          {hint && <span className="block font-normal text-xs text-hint">{hint}</span>}
        </label>
      )}
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={label ? etiquetaId : undefined}
        aria-label={label ? undefined : ariaLabel}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={cn(
          'relative inline-flex flex-shrink-0 h-6 w-11 items-center rounded-full transition-colors duration-estandar focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed',
          checked ? 'bg-accent' : 'bg-outline'
        )}
      >
        <span aria-hidden="true" className={cn(
          'inline-block size-5 rounded-full bg-white shadow-card transition-transform duration-estandar ease-entrada',
          checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
        )} />
      </button>
    </div>
  )
}
