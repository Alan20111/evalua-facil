import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { FILE_TYPE_OPTIONS, getFileType } from '../config/fileTypes'

// Subtle gray text that expands into a menu, used in the activity form so the
// teacher can pick which file types students may upload.
export default function FileTypeSelect({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = getFileType(value)

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
        <div className="absolute z-10 mt-1 w-56 bg-surface-card border border-outline-variant rounded shadow-lg py-1">
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
        </div>
      )}
    </div>
  )
}
