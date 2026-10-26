import { GLOBO_DESDE_IZQ, PASOS_TIEMPO, ajustarTiempo, formatearMinuto, validarTiempo } from './revisionVideo'

const PASO = 'min-h-[2.75rem] min-w-[3rem] px-2.5 rounded-full border border-outline-variant text-sm font-semibold tabular-nums text-on-surface hover:bg-surface-container disabled:opacity-60 disabled:hover:bg-transparent'

// Cuándo aparece la pregunta: el momento (solo lectura) y el ajuste fino −5/−1/+1/+5. El docente NUNCA escribe minutos: el sistema
// ya asignó el momento, y la forma de cambiarlo es arrastrar la bolita de la línea de tiempo (LineaTiempoRevision). Estos botones
// existen solo como alternativa ACCESIBLE al arrastre: la bolita no se puede manejar con teclado ni con lector de pantalla.
// Todo cambia el BORRADOR de la pregunta actual; no se guarda hasta que el docente lo decide (la bolita guarda sola al soltarla).
//   item         elemento de revisión (con el borrador aplicado)
//   duracionSeg  largo del video si se conoce (límite superior)
//   onCambiar    (segundos) → nuevo tiempo del borrador
//   acciones     botones que van al final de la misma fila (Deshacer / Rehacer); también cuando la pregunta aún no tiene momento
export default function ControlTiempoVideo({ item, duracionSeg, disabled = false, onCambiar, acciones = null }) {
  const seg = item.timestampSeg
  // Propuesta de la versión anterior sin momento: queda pendiente de ubicación. No se le inventa un tiempo (tampoco 0 como base de
  // los botones): se ubica arrastrando su punto a la línea de tiempo, o se descarta.
  if (!Number.isInteger(seg)) {
    const aviso = (
      <p className="text-xs text-amber-900" data-testid="pendiente-ubicacion">
        Esta pregunta no tiene momento. Arrastra su punto a la línea de tiempo o descártala.
      </p>
    )
    if (!acciones) return aviso
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1.5" data-testid="acciones-tiempo">{acciones}</div>
        {aviso}
      </div>
    )
  }
  const v = validarTiempo(seg, duracionSeg)
  const mover = (d) => onCambiar(ajustarTiempo(seg, d, duracionSeg))

  return (
    <div className="space-y-1" data-testid="control-tiempo">
      <div className="flex flex-wrap items-center gap-1.5">
        {PASOS_TIEMPO.filter((d) => d < 0).map((d) => (
          <button key={d} type="button" disabled={disabled} onClick={() => mover(d)} className={`${PASO} ${GLOBO_DESDE_IZQ}`} aria-label={`Aparece ${Math.abs(d)} segundos antes`}
            data-tooltip={`Que aparezca ${Math.abs(d)} ${Math.abs(d) === 1 ? 'segundo' : 'segundos'} antes`}>−{Math.abs(d)}</button>
        ))}
        <span data-testid="momento-pregunta" aria-live="polite" aria-label={`La pregunta aparece en ${formatearMinuto(seg)}`}
          className="inline-flex items-center justify-center w-20 min-h-[2.75rem] px-2 rounded-full bg-surface-container text-base font-bold tabular-nums">
          {formatearMinuto(seg)}
        </span>
        {PASOS_TIEMPO.filter((d) => d > 0).map((d) => (
          <button key={d} type="button" disabled={disabled} onClick={() => mover(d)} className={`${PASO} ${GLOBO_DESDE_IZQ}`} aria-label={`Aparece ${d} segundos después`}
            data-tooltip={`Que aparezca ${d} ${d === 1 ? 'segundo' : 'segundos'} después`}>+{d}</button>
        ))}
        {/* Separador + Deshacer / Rehacer como un bloque: si no caben en la línea (teléfono vertical) bajan juntos, nunca separados. */}
        {acciones && (
          <span className="inline-flex items-center gap-1.5" data-testid="acciones-tiempo">
            <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-outline-variant" />
            {acciones}
          </span>
        )}
      </div>
      {(!v.ok || v.aviso) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          {!v.ok && <span role="alert" className="text-error">{v.error}</span>}
          {v.ok && v.aviso && <span className="text-amber-800">{v.aviso}</span>}
        </div>
      )}
    </div>
  )
}
