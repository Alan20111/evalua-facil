// Select propio, sin usar el <select> nativo — pedido explícito (2026-08-04):
// en el celular (App y web móvil) un <select> nativo abre el picker crudo del
// sistema operativo, que se ve fuera de lugar frente al resto de la app.
// Mismo patrón ya usado en NotificationSettings.jsx (AnticipacionPicker) y
// MiniSelect.jsx: un botón que abre una hoja con las opciones, en vez de
// delegarle la UI al sistema operativo.
//
// API: mismo props que el Input estándar (label/hint/error/id), más
// options=[{value,label}] y onChange(value) — a diferencia de un <select>
// nativo, onChange recibe el VALOR directo, no un evento.
import { useState } from 'react'
import { ChevronDown, Check, X } from 'lucide-react'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { cn } from './cn'

const TRIGGER_BASE =
  'w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface text-left'

export default function Select({
  label, hint, error, id, options = [], value, onChange,
  placeholder = 'Seleccionar…', className = '', wrapperClassName = '', disabled = false,
}) {
  const [open, setOpen] = useState(false)
  useBackHandler(() => setOpen(false), open)
  useScrollLock(open)

  const current = options.find((o) => o.value === value)

  return (
    <div className={wrapperClassName || undefined}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-muted mb-1">
          {label}
        </label>
      )}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          TRIGGER_BASE,
          error ? 'border-red-400' : 'border-outline-variant',
          disabled ? 'opacity-60 cursor-not-allowed' : '',
          className
        )}
      >
        <span className={`truncate ${current ? 'text-on-surface' : 'text-slate-400'}`}>
          {current?.label || placeholder}
        </span>
        <ChevronDown size={16} className="text-muted flex-shrink-0" />
      </button>
      {error ? (
        <p className="text-red-500 text-xs mt-1">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-400 mt-1">{hint}</p>
      ) : null}

      {open && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setOpen(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-t-card sm:rounded-card drop-shadow-2xl w-full sm:max-w-sm max-h-[80vh] overflow-y-auto safe-bottom">
            <div className="sticky top-0 bg-surface-card px-4 py-3 border-b border-outline-variant flex items-center justify-between">
              <p className="font-semibold text-on-surface">{label || 'Elegir'}</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="p-1 -mr-1 text-muted hover:text-on-surface rounded transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-2">
              {options.map((o) => {
                const selected = o.value === value
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false) }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded text-left text-sm transition-colors ${
                      selected ? 'bg-[var(--accent-tint)] text-accent font-medium' : 'text-on-surface hover:bg-[var(--accent-tint)]'
                    }`}
                  >
                    <span>{o.label}</span>
                    {selected && <Check size={16} className="flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
