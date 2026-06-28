import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { FILE_TYPE_OPTIONS, getFileType, CUSTOM_FILE_TYPE } from '../config/fileTypes'

// Subtle gray text that expands into a menu, used in the activity form so the
// teacher can pick which file types students may upload. Includes a
// "Personalizado" option where the teacher types their own extensions.
export default function FileTypeSelect({ value, onChange, customExts = '', onCustomChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = getFileType(value, customExts)
  const isCustom = value === CUSTOM_FILE_TYPE

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-muted transition-colors"
      >
        Archivos permitidos:&nbsp;
        <span className="font-medium text-muted">{current.label}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-60 max-w-[calc(100vw-2rem)] max-h-72 overflow-y-auto bg-surface-card border border-outline-variant rounded shadow-lg py-1">
          {FILE_TYPE_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                onChange(o.key)
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-surface transition-colors ${
                o.key === value ? 'text-blue-600 font-medium' : 'text-muted'
              }`}
            >
              {o.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onChange(CUSTOM_FILE_TYPE)}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-surface transition-colors ${
              isCustom ? 'text-blue-600 font-medium' : 'text-muted'
            }`}
          >
            Personalizado (escribe las extensiones)
          </button>
        </div>
      )}
      {isCustom && (
        <input
          type="text"
          value={customExts}
          onChange={(e) => onCustomChange?.(e.target.value)}
          placeholder="Ej: pptx, zip, psd"
          autoComplete="off"
          spellCheck={false}
          className="mt-2 w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
        />
      )}
    </div>
  )
}
