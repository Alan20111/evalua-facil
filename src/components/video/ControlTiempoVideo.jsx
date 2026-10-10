import { useState } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import { PASOS_TIEMPO, ajustarTiempo, formatearMinuto, interpretarTiempo, validarTiempo } from './revisionVideo'

const PASO = 'min-h-[2.75rem] min-w-[3rem] px-2.5 rounded-full border border-outline-variant text-sm font-semibold tabular-nums text-on-surface hover:bg-surface-container disabled:opacity-60 disabled:hover:bg-transparent'

// Cuándo aparece la pregunta, en UNA fila: el segundo elegido (campo m:ss), el ajuste fino −5/−1/+1/+5, lo que sugirió la IA
// con una acción para recuperarlo, y «Comprobar» (reproduce desde unos segundos antes y se detiene en el momento elegido).
// El deslizador y las referencias viven en LineaTiempoRevision: aquí no hay otra línea de tiempo. Todo cambia el BORRADOR de
// la pregunta actual; no se guarda hasta que el docente lo decide.
//   item         elemento de revisión (con el borrador aplicado)
//   duracionSeg  largo del video si se conoce (límite superior)
//   onCambiar    (segundos) → nuevo tiempo del borrador
//   onComprobar  () → reproduce desde unos segundos antes del momento elegido
export default function ControlTiempoVideo({ item, duracionSeg, disabled = false, onCambiar, onComprobar, comprobando = false, puedeComprobar = true }) {
  const [errorTexto, setErrorTexto] = useState(null)
  const seg = item.timestampSeg
  const v = validarTiempo(seg, duracionSeg)
  const sugerido = Number.isInteger(item.sugeridoSeg) ? item.sugeridoSeg : null

  function confirmarTexto(texto) {
    const n = interpretarTiempo(texto)
    const val = validarTiempo(n, duracionSeg)
    if (!val.ok) { setErrorTexto(val.error); return }
    setErrorTexto(null)
    if (n !== seg) onCambiar(n)
  }
  const mover = (d) => { setErrorTexto(null); onCambiar(ajustarTiempo(seg, d, duracionSeg)) }

  return (
    <div className="space-y-1" data-testid="control-tiempo">
      <div className="flex flex-wrap items-center gap-1.5">
        {PASOS_TIEMPO.filter((d) => d < 0).map((d) => (
          <button key={d} type="button" disabled={disabled} onClick={() => mover(d)} className={PASO} aria-label={`Aparece ${Math.abs(d)} segundos antes`}>−{Math.abs(d)}</button>
        ))}
        <input
          key={`t-${seg}`} type="text" inputMode="numeric" defaultValue={formatearMinuto(seg)} disabled={disabled}
          aria-label="Minuto en que aparece la pregunta (m:ss)" aria-invalid={!v.ok || !!errorTexto}
          onBlur={(e) => confirmarTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarTexto(e.currentTarget.value) } }}
          className="w-20 min-h-[2.75rem] px-2 text-center rounded-full border border-outline-variant bg-surface text-base font-bold tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {PASOS_TIEMPO.filter((d) => d > 0).map((d) => (
          <button key={d} type="button" disabled={disabled} onClick={() => mover(d)} className={PASO} aria-label={`Aparece ${d} segundos después`}>+{d}</button>
        ))}
        <button type="button" onClick={onComprobar} disabled={!puedeComprobar || !v.ok} data-testid="comprobar-momento"
          className="inline-flex items-center gap-1.5 min-h-[2.75rem] px-3 rounded-full border border-accent text-accent text-sm font-semibold hover:bg-[var(--accent-tint)] disabled:opacity-60">
          <Play size={14} /> {comprobando ? 'Repetir' : 'Comprobar'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
        {sugerido !== null && (
          <span data-testid="sugerido-ia">
            Sugerido por la IA: <span className="font-semibold tabular-nums text-on-surface">{formatearMinuto(sugerido)}</span>
            {sugerido !== seg && (
              <button type="button" disabled={disabled} onClick={() => { setErrorTexto(null); onCambiar(sugerido) }} data-testid="usar-sugerido"
                className="ml-2 inline-flex items-center gap-1 min-h-[2.5rem] px-2 text-accent font-semibold hover:underline disabled:opacity-60">
                <RotateCcw size={12} /> Usar
              </button>
            )}
          </span>
        )}
        {(errorTexto || !v.ok) && <span role="alert" className="text-error">{errorTexto || v.error}</span>}
        {v.ok && v.aviso && <span className="text-amber-800">{v.aviso}</span>}
      </div>
    </div>
  )
}
