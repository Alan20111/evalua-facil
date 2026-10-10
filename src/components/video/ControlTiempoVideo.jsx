import { useState } from 'react'
import { GLOBO_DESDE_IZQ, PASOS_TIEMPO, ajustarTiempo, formatearMinuto, interpretarTiempo, validarTiempo } from './revisionVideo'

const PASO = 'min-h-[2.75rem] min-w-[3rem] px-2.5 rounded-full border border-outline-variant text-sm font-semibold tabular-nums text-on-surface hover:bg-surface-container disabled:opacity-60 disabled:hover:bg-transparent'

// Cuándo aparece la pregunta, en UNA fila: el segundo elegido (campo m:ss) y el ajuste fino −5/−1/+1/+5.
// La línea de tiempo vive en LineaTiempoRevision: aquí no hay otra. Todo cambia el BORRADOR de la pregunta actual; no se guarda
// hasta que el docente lo decide (solo la bolita blanca de la línea guarda sola al soltarla).
//   item         elemento de revisión (con el borrador aplicado)
//   duracionSeg  largo del video si se conoce (límite superior)
//   onCambiar    (segundos) → nuevo tiempo del borrador
export default function ControlTiempoVideo({ item, duracionSeg, disabled = false, onCambiar }) {
  const [errorTexto, setErrorTexto] = useState(null)
  const seg = item.timestampSeg
  const v = validarTiempo(seg, duracionSeg)

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
          <button key={d} type="button" disabled={disabled} onClick={() => mover(d)} className={`${PASO} ${GLOBO_DESDE_IZQ}`} aria-label={`Aparece ${Math.abs(d)} segundos antes`}
            data-tooltip={`Que aparezca ${Math.abs(d)} ${Math.abs(d) === 1 ? 'segundo' : 'segundos'} antes`}>−{Math.abs(d)}</button>
        ))}
        <span data-tooltip="Escribe el minuto exacto, por ejemplo 2:34" className={`inline-flex ${GLOBO_DESDE_IZQ}`}>
        <input
          key={`t-${seg}`} type="text" inputMode="numeric" defaultValue={formatearMinuto(seg)} disabled={disabled}
          aria-label="Minuto en que aparece la pregunta (m:ss)" aria-invalid={!v.ok || !!errorTexto}
          onBlur={(e) => confirmarTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarTexto(e.currentTarget.value) } }}
          className="w-20 min-h-[2.75rem] px-2 text-center rounded-full border border-outline-variant bg-surface text-base font-bold tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        </span>
        {PASOS_TIEMPO.filter((d) => d > 0).map((d) => (
          <button key={d} type="button" disabled={disabled} onClick={() => mover(d)} className={`${PASO} ${GLOBO_DESDE_IZQ}`} aria-label={`Aparece ${d} segundos después`}
            data-tooltip={`Que aparezca ${d} ${d === 1 ? 'segundo' : 'segundos'} después`}>+{d}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
        {(errorTexto || !v.ok) && <span role="alert" className="text-error">{errorTexto || v.error}</span>}
        {v.ok && v.aviso && <span className="text-amber-800">{v.aviso}</span>}
      </div>
    </div>
  )
}
