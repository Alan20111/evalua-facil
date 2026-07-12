import {
  FILE_TYPE_BASE_OPTIONS, ALL_FILES_KEY, CUSTOM_FILE_TYPE,
  normalizeFileTypeKeys, parseCustomExts,
} from '../config/fileTypes'

// Inline checklist (part of the activity form's normal layout, not a floating
// menu) so the teacher can pick several file types at once — at least one
// stays checked — plus "Cualquier archivo" and a "Personalizado" option where
// the teacher types their own extra extensions.
export default function FileTypeSelect({ value, onChange, customExts = '', onCustomChange }) {
  const keys = normalizeFileTypeKeys(value)
  const isCustom = keys.includes(CUSTOM_FILE_TYPE)
  const customExtsMissing = isCustom && parseCustomExts(customExts).length === 0

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
    <fieldset className="border-0 m-0 p-0">
      <legend className="block text-sm font-medium text-muted mb-1 p-0">Archivos permitidos</legend>
      <p className="text-xs text-accent font-medium mb-2">
        Ejemplo: al elegir imágenes y 1 Word, el estudiante podrá subir hasta 5 imágenes o un archivo de Word.
      </p>
      <div className="border border-outline-variant rounded divide-y divide-outline-variant overflow-hidden">
        {FILE_TYPE_BASE_OPTIONS.map((o) => (
          <label key={o.key} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-[var(--accent-tint)] cursor-pointer">
            <input
              type="checkbox"
              checked={keys.includes(o.key)}
              onChange={() => toggle(o.key)}
              className="accent-[var(--accent)]"
            />
            <span className={keys.includes(o.key) ? 'text-accent font-medium' : 'text-on-surface'}>{o.label}</span>
          </label>
        ))}
        <label className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-[var(--accent-tint)] cursor-pointer">
          <input
            type="checkbox"
            checked={keys.includes(ALL_FILES_KEY)}
            onChange={() => toggle(ALL_FILES_KEY)}
            className="accent-[var(--accent)]"
          />
          <span className={keys.includes(ALL_FILES_KEY) ? 'text-accent font-medium' : 'text-on-surface'}>1 solo archivo de cualquier extensión</span>
        </label>
        <label className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-[var(--accent-tint)] cursor-pointer">
          <input
            type="checkbox"
            checked={isCustom}
            onChange={() => toggle(CUSTOM_FILE_TYPE)}
            className="accent-[var(--accent)]"
          />
          <span className={isCustom ? 'text-accent font-medium' : 'text-on-surface'}>1 archivo personalizado, escribe la extensión</span>
        </label>
        {isCustom && (
          <div className="px-3 py-2.5 bg-surface">
            <input
              type="text"
              value={customExts}
              onChange={(e) => onCustomChange?.(e.target.value)}
              placeholder="Ej: pptx, zip, psd"
              required
              autoComplete="off"
              spellCheck={false}
              className={`w-full px-3 py-2 rounded border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface-card ${
                customExtsMissing ? 'border-red-300' : 'border-outline-variant'
              }`}
            />
            {customExtsMissing && (
              <p className="mt-1 text-xs text-red-500">Escribe al menos una extensión (ej: pptx, zip, psd)</p>
            )}
          </div>
        )}
      </div>
    </fieldset>
  )
}
