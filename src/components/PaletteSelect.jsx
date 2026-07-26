import { useRef } from 'react'
import { Check, Pipette } from 'lucide-react'
import { isCustomPalette, customPaletteHex, ensureVisibleOnWhite, PALETTES } from '../utils/subjectPalette'

// El catálogo vive en utils/subjectPalette (lo comparten estos cuadros y las
// bolitas del banco de íconos); se re-exporta para no romper importaciones.
export { PALETTES }

// A row of color swatches; `value` is a palette key or "custom:#rrggbb",
// `onChange(key)`. The last swatch opens a free color picker — the pick is
// auto-darkened if needed so it always reads well on white.
export default function PaletteSelect({ value = 'default', onChange }) {
  const colorInputRef = useRef(null)
  const custom = isCustomPalette(value)
  const customColor = custom ? customPaletteHex(value) : null

  return (
    // MISMA rejilla que el banco de íconos de abajo (IconSelect), no un flex
    // con anchos fijos: así los 8 cuadros caen exactamente sobre las mismas
    // columnas que los íconos y las dos zonas se leen como una sola, en vez de
    // dos filas que empiezan y terminan en sitios distintos. Son 8 justos
    // —7 colores + el libre—, así que en escritorio cierran la fila sin hueco.
    //
    // El elegido se marca SOLO con el aro, sin `scale-105`: agrandarlo un 5%
    // lo sacaba de su columna (medido: 1.2 px por lado) y era justo el cuadro
    // que se veía desalineado con el ícono de abajo. El hover sí escala,
    // porque es pasajero y no deja nada torcido.
    <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
      {PALETTES.map((p) => {
        const selected = !custom && (value || 'default') === p.key
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.key)}
            data-tooltip={p.label}
            aria-label={p.label}
            className={`aspect-square w-full rounded-lg flex items-center justify-center transition-transform ${selected ? 'ring-2 ring-offset-2 ring-slate-400' : 'hover:scale-105'}`}
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
        className={`aspect-square w-full rounded-lg flex items-center justify-center transition-transform ${custom ? 'ring-2 ring-offset-2 ring-slate-400' : 'hover:scale-105'}`}
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
