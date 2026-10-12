import {
  FILE_TYPE_BASE_OPTIONS, ALL_FILES_KEY, CUSTOM_FILE_TYPE, LINK_KEY,
  normalizeFileTypeKeys, parseCustomExts,
} from '../config/fileTypes'
import { Checkbox } from './ui'

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
      // "Cualquier extensión" excluye a los demás tipos de ARCHIVO, pero no al
      // enlace: ese se conserva tal como estaba.
      const link = keys.includes(LINK_KEY) ? [LINK_KEY] : []
      next = keys.includes(ALL_FILES_KEY)
        ? (link.length ? link : [FILE_TYPE_BASE_OPTIONS[0].key])
        : [ALL_FILES_KEY, ...link]
    } else if (key === LINK_KEY) {
      next = keys.includes(LINK_KEY) ? keys.filter((k) => k !== LINK_KEY) : [...keys, LINK_KEY]
    } else {
      const withoutAll = keys.filter((k) => k !== ALL_FILES_KEY)
      next = withoutAll.includes(key) ? withoutAll.filter((k) => k !== key) : [...withoutAll, key]
    }
    if (next.length === 0) return // at least one option must stay selected
    onChange(next)
  }

  return (
    <fieldset className="border-0 p-0 m-0">
      <legend className="block text-sm font-medium text-muted mb-1 p-0">Archivos permitidos</legend>
      <p className="text-sm text-accent font-medium mb-2">
        Ejemplo: al elegir imágenes y 1 Word, el estudiante podrá subir hasta 3 imágenes o un archivo de Word.
      </p>
      <div className="border border-outline-variant rounded-card divide-y divide-outline-variant overflow-hidden">
        {FILE_TYPE_BASE_OPTIONS.map((o) => (
          <Checkbox
            key={o.key}
            checked={keys.includes(o.key)}
            onChange={() => toggle(o.key)}
            wrapperClassName="items-center px-3 py-2.5 text-sm hover:bg-[var(--accent-tint)]"
            label={
              <span className={keys.includes(o.key) ? 'text-accent font-medium' : 'text-on-surface font-normal'}>{o.label}</span>
            }
          />
        ))}
        <Checkbox
          checked={keys.includes(ALL_FILES_KEY)}
          onChange={() => toggle(ALL_FILES_KEY)}
          wrapperClassName="items-center px-3 py-2.5 text-sm hover:bg-[var(--accent-tint)]"
          label={
            <span className={keys.includes(ALL_FILES_KEY) ? 'text-accent font-medium' : 'text-on-surface font-normal'}>1 solo archivo de cualquier extensión</span>
          }
        />
        <Checkbox
          checked={isCustom}
          onChange={() => toggle(CUSTOM_FILE_TYPE)}
          wrapperClassName="items-center px-3 py-2.5 text-sm hover:bg-[var(--accent-tint)]"
          label={
            <span className={isCustom ? 'text-accent font-medium' : 'text-on-surface font-normal'}>1 archivo personalizado, escribe la extensión</span>
          }
        />
        {isCustom && (
          <div className="px-3 py-2.5 bg-surface">
            <input
              type="text"
              value={customExts}
              onChange={(e) => onCustomChange?.(e.target.value)}
              aria-label="Ej: pptx, zip, psd"
              required
              autoComplete="off"
              spellCheck={false}
              className={`w-full px-3 py-2 rounded-full border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface-card ${
                customExtsMissing ? 'border-red-300' : 'border-outline-variant'
              }`}
            />
            {customExtsMissing && (
              <p className="mt-1 text-sm text-red-500">Escribe al menos una extensión (ej: pptx, zip, psd)</p>
            )}
          </div>
        )}
        <Checkbox
          checked={keys.includes(LINK_KEY)}
          onChange={() => toggle(LINK_KEY)}
          wrapperClassName="items-center px-3 py-2.5 text-sm hover:bg-[var(--accent-tint)]"
          label={
            <span className={keys.includes(LINK_KEY) ? 'text-accent font-medium' : 'text-on-surface font-normal'}>
              Enlace o URL
              <span className="block text-sm text-muted font-normal">Úsalo, por ejemplo, para recibir la URL donde está alojado un video.</span>
            </span>
          }
        />
      </div>
    </fieldset>
  )
}
