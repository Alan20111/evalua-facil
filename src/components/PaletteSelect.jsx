import { useRef } from 'react'
import { Check, Pipette } from 'lucide-react'
import { isCustomPalette, customPaletteHex, ensureVisibleOnWhite } from '../utils/subjectPalette'

// Preset accent palettes for a subject. Keys must match the
// [data-subject-palette="..."] rules in src/index.css.
export const PALETTES = [
  { key: 'default', label: 'Azul', color: '#2563eb' },
  { key: 'orange', label: 'Naranja', color: '#f97316' },
  { key: 'purple', label: 'Morado', color: '#9333ea' },
  { key: 'green', label: 'Verde', color: '#16a34a' },
  { key: 'rose', label: 'Rosa', color: '#e11d48' },
  { key: 'teal', label: 'Teal', color: '#14b8a6' },
  { key: 'slate', label: 'Grafito', color: '#475569' },
]

// A row of color swatches; `value` is a palette key or "custom:#rrggbb",
// `onChange(key)`. The last swatch opens a free color picker — the pick is
// auto-darkened if needed so it always reads well on white.
export default function PaletteSelect({ value = 'default', onChange }) {
  const colorInputRef = useRef(null)
  const custom = isCustomPalette(value)
  const customColor = custom ? customPaletteHex(value) : null

  return (
    // Sized so the 7 presets + free pick always fit on ONE row, even on a
    // mobile-width modal (8×32px + 7×8px gap = 312px).
    <div className="flex flex-nowrap gap-2">
      {PALETTES.map((p) => {
        const selected = !custom && (value || 'default') === p.key
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.key)}
            data-tooltip={p.label}
            aria-label={p.label}
            className={`w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center transition-transform ${selected ? 'ring-2 ring-offset-2 ring-slate-400 scale-105' : 'hover:scale-105'}`}
            style={{ backgroundColor: p.color }}
          >
            {selected && <Check size={16} className="text-white" />}
          </button>
        )
      })}
      {/* Free pick — always last. Shows a color wheel until the user picks.
          Tooltip goes to the LEFT: this swatch sits at the row's right edge
          inside an overflow-hidden modal, so the default centered tooltip
          would be clipped (and widen the scroll area). */}
      <button
        type="button"
        onClick={() => colorInputRef.current?.click()}
        data-tooltip="Elige tu propio color (se ajusta solo para notarse sobre blanco)"
        data-tooltip-pos="left"
        aria-label="Color personalizado"
        className={`w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center transition-transform ${custom ? 'ring-2 ring-offset-2 ring-slate-400 scale-105' : 'hover:scale-105'}`}
        style={custom
          ? { backgroundColor: customColor }
          : { background: 'conic-gradient(#ef4444, #f97316, #eab308, #16a34a, #06b6d4, #2563eb, #9333ea, #ef4444)' }}
      >
        {custom ? <Check size={16} className="text-white" /> : <Pipette size={14} className="text-white drop-shadow" />}
      </button>
      <input
        ref={colorInputRef}
        type="color"
        value={customColor || '#334155'}
        onChange={(e) => onChange('custom:' + ensureVisibleOnWhite(e.target.value))}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  )
}
