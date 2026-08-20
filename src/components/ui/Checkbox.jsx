// Checkbox canónico — mismo patrón que el ya auditado en FileTypeSelect.jsx:
// <label> que envuelve al <input>, así el texto queda asociado sin necesidad
// de `id`/`htmlFor`. El color usa `accent-[var(--accent)]`, que respeta el
// theming por rol (docs/DESIGN_SYSTEM.md §6.2).
//
// Existe además porque `src/pages/**` tiene prohibido declarar <input> crudo
// (ver eslint.config.js y PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 1, 1.3):
// las páginas deben tomar sus primitivos de components/ui.
//
// Props:
//   label  texto principal (obligatorio — es el nombre accesible del control)
//   hint   texto secundario debajo (text-xs text-slate-400)
//   className         se agrega al <input>
//   wrapperClassName  se agrega al <label> contenedor
// El resto (checked, onChange, disabled…) pasa al <input>.
import { forwardRef } from 'react'
import { cn } from './cn'

const Checkbox = forwardRef(function Checkbox(
  { label, hint, className = '', wrapperClassName = '', ...rest },
  ref
) {
  return (
    <label className={cn('flex items-start gap-2.5 cursor-pointer', wrapperClassName)}>
      <input
        ref={ref}
        type="checkbox"
        className={cn('mt-0.5 accent-[var(--accent)]', className)}
        {...rest}
      />
      <span className="text-sm font-medium text-on-surface">
        {label}
        {hint && <span className="block font-normal text-xs text-slate-400">{hint}</span>}
      </span>
    </label>
  )
})

export default Checkbox
