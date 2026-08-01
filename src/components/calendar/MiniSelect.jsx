import { useState, useEffect, useRef } from 'react'
import { ChevronDown } from 'lucide-react'

// Selector compacto reutilizado por los selectores de horas/días de la
// Agenda (docente y alumno) — mismo look que el resto de la app, sin usar
// el <select> nativo del sistema operativo.
export default function MiniSelect({ value, options, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const selected = options.find(o => o.value === value)

  return (
    <div className="relative flex-1 min-w-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-1 px-2 py-1.5 rounded border border-outline-variant bg-surface text-sm text-on-surface transition-colors"
      >
        <span className="truncate">{selected?.label}</span>
        <ChevronDown size={14} className={`text-muted flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 bg-surface-card border border-outline-variant rounded-card shadow-lg py-1 w-full min-w-[8rem] max-h-56 overflow-y-auto">
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${o.value === value ? 'bg-accent text-white font-semibold' : 'text-on-surface hover:bg-accent-tint'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
