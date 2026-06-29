import { Check } from 'lucide-react'

// Preset accent palettes for a subject. Keys must match the
// [data-subject-palette="..."] rules in src/index.css.
export const PALETTES = [
  { key: 'default', label: 'Azul', color: '#2563eb' },
  { key: 'orange', label: 'Naranja', color: '#f97316' },
  { key: 'purple', label: 'Morado', color: '#9333ea' },
  { key: 'green', label: 'Verde', color: '#16a34a' },
  { key: 'rose', label: 'Rosa', color: '#e11d48' },
  { key: 'teal', label: 'Teal', color: '#14b8a6' },
]

// A row of color swatches; `value` is a palette key, `onChange(key)`.
export default function PaletteSelect({ value = 'default', onChange }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {PALETTES.map((p) => {
        const selected = (value || 'default') === p.key
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.key)}
            title={p.label}
            aria-label={p.label}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-transform ${selected ? 'ring-2 ring-offset-2 ring-slate-400 scale-105' : 'hover:scale-105'}`}
            style={{ backgroundColor: p.color }}
          >
            {selected && <Check size={18} className="text-white" />}
          </button>
        )
      })}
    </div>
  )
}
