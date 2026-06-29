import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  FILE_TYPE_BASE_OPTIONS, ALL_FILES_KEY, CUSTOM_FILE_TYPE,
  normalizeFileTypeKeys, fileTypesLabel, parseCustomExts,
} from '../config/fileTypes'

// Subtle gray text that expands into a checklist, used in the activity form so the
// teacher can pick which file types students may upload — several at once (at
// least one stays checked), plus "Cualquier archivo" and a "Personalizado" option
// where the teacher types their own extra extensions.
export default function FileTypeSelect({ value, onChange, customExts = '', onCustomChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const keys = normalizeFileTypeKeys(value)
  const isCustom = keys.includes(CUSTOM_FILE_TYPE)
  const customExtsMissing = isCustom && parseCustomExts(customExts).length === 0

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function toggle(key) {
    let next
    if (key === ALL_FILES_KEY) {
      next = keys.includes(ALL_FILES_KEY) ? [FILE_TYPE_BASE_OPTIONS[0].key] : [ALL_FILES_KEY]
    } else {
      const withoutAll = keys.filter((k) => k !== ALL_FILES_KEY)
      next = withoutAll.includes(key) ? withoutAll.filter((k) => k !== key) : [...withoutAll, key]
    }
    if (next.length === 0) return // at least one option must stay selected
    onChange(next)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-muted transition-colors"
      >
        Archivos permitidos:&nbsp;
        <span className="font-medium text-muted">{fileTypesLabel(keys, customExts)}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-10 mt-1 right-0 w-64 max-w-[calc(100vw-2rem)] max-h-80 overflow-y-auto bg-surface-card border border-outline-variant rounded shadow-lg py-1">
          {FILE_TYPE_BASE_OPTIONS.map((o) => (
            <label key={o.key} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface cursor-pointer">
              <input
                type="checkbox"
                checked={keys.includes(o.key)}
                onChange={() => toggle(o.key)}
                className="accent-[var(--accent)]"
              />
              <span className={keys.includes(o.key) ? 'text-blue-600 font-medium' : 'text-muted'}>{o.label}</span>
            </label>
          ))}
          <label className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface cursor-pointer border-t border-outline-variant">
            <input
              type="checkbox"
              checked={keys.includes(ALL_FILES_KEY)}
              onChange={() => toggle(ALL_FILES_KEY)}
              className="accent-[var(--accent)]"
            />
            <span className={keys.includes(ALL_FILES_KEY) ? 'text-blue-600 font-medium' : 'text-muted'}>Cualquier archivo</span>
          </label>
          <label className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface cursor-pointer">
            <input
              type="checkbox"
              checked={isCustom}
              onChange={() => toggle(CUSTOM_FILE_TYPE)}
              className="accent-[var(--accent)]"
            />
            <span className={isCustom ? 'text-blue-600 font-medium' : 'text-muted'}>Personalizado (escribe las extensiones)</span>
          </label>
        </div>
      )}
      {isCustom && (
        <>
          <input
            type="text"
            value={customExts}
            onChange={(e) => onCustomChange?.(e.target.value)}
            placeholder="Ej: pptx, zip, psd"
            required
            autoComplete="off"
            spellCheck={false}
            className={`mt-2 w-full px-3 py-2 rounded border focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface ${
              customExtsMissing ? 'border-red-300' : 'border-outline-variant'
            }`}
          />
          {customExtsMissing && (
            <p className="mt-1 text-xs text-red-500">Escribe al menos una extensión (ej: pptx, zip, psd)</p>
          )}
        </>
      )}
    </div>
  )
}
