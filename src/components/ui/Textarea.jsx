// Área de texto de varias líneas. Es lo único «de una sola pieza» que NO es
// píldora: lleva el radio estándar (rounded), porque un óvalo de varias líneas
// se come las esquinas del texto. PLAN_NORMALIZACION_UI §2.2.
//
//   autoResize   crece con el contenido (sin barra de desplazamiento)
//   showCount    contador «12/500» cuando hay maxLength
import { forwardRef, useCallback, useId, useLayoutEffect, useRef } from 'react'
import { cn } from './cn'
import Field from './Field'
import { idAyuda } from './ids'

const Textarea = forwardRef(function Textarea(
  { label, hint, error, id, optional = false, autoResize = false, showCount = false, rows = 3, className = '', wrapperClassName = '', onChange, value, ...rest },
  ref
) {
  const auto = useId()
  const campoId = id || (label ? auto : undefined)
  const interno = useRef(null)
  const ajustar = useCallback(() => {
    const el = interno.current
    if (!autoResize || !el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [autoResize])
  useLayoutEffect(ajustar, [ajustar, value])
  const setRef = (el) => {
    interno.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }
  const largo = typeof value === 'string' ? value.length : 0
  return (
    <Field id={campoId} label={label} hint={hint} error={error} required={rest.required} optional={optional} className={wrapperClassName}>
      <textarea
        ref={setRef}
        id={campoId}
        rows={rows}
        value={value}
        onChange={(e) => { onChange?.(e); ajustar() }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? idAyuda(campoId) : undefined}
        className={cn(
          'w-full px-4 py-3 rounded border bg-surface text-sm text-on-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60',
          autoResize ? 'resize-none overflow-hidden' : 'resize-y',
          error ? 'border-red-400' : 'border-outline-variant',
          className
        )}
        {...rest}
      />
      {showCount && rest.maxLength && (
        <p className="text-xs text-hint text-right mt-1 tabular-nums" aria-live="polite">{largo}/{rest.maxLength}</p>
      )}
    </Field>
  )
})

export default Textarea
