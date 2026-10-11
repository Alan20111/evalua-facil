// Campo de una línea: píldora de altura de control (h-control), texto a la
// izquierda, sin placeholder (regla de la app). PLAN_NORMALIZACION_UI §2.1–2.2.
//
//   label, hint, error, required/optional   → ver Field
//   icon       ícono a la izquierda (lupa, arroba…)
//   suffix     nodo a la derecha (botón de ver contraseña, unidad «pts»…)
//   size       md (default) · sm (tablas, filtros)
import { forwardRef, useId } from 'react'
import { cn } from './cn'
import Field from './Field'
import { idAyuda } from './ids'
import { ICONO } from '../../config/iconos'

export const CAMPO_BASE =
  'w-full rounded-full border bg-surface text-sm text-on-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 disabled:cursor-not-allowed'
const ALTO = { sm: 'h-control-sm px-3', md: 'h-control px-4' }

const Input = forwardRef(function Input(
  { label, hint, error, id, optional = false, icon: Icono, suffix, size = 'md', className = '', wrapperClassName = '', ...rest },
  ref
) {
  const auto = useId()
  const campoId = id || (label ? auto : undefined)
  const conAyuda = error || hint
  return (
    <Field id={campoId} label={label} hint={hint} error={error} required={rest.required} optional={optional} className={wrapperClassName}>
      <div className={cn((Icono || suffix) && 'relative')}>
        {Icono && <Icono size={ICONO.sm} aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-hint pointer-events-none" />}
        <input
          ref={ref}
          id={campoId}
          aria-invalid={error ? true : undefined}
          aria-describedby={conAyuda ? idAyuda(campoId) : undefined}
          className={cn(
            CAMPO_BASE,
            ALTO[size] || ALTO.md,
            Icono && 'pl-10',
            suffix && 'pr-12',
            error ? 'border-red-400' : 'border-outline-variant',
            className
          )}
          {...rest}
        />
        {suffix && <span className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">{suffix}</span>}
      </div>
    </Field>
  )
})

export default Input
