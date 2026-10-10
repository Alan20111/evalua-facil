import { ESTADO_REVISION, formatearMinuto } from './revisionVideo'

const COLOR_MARCA = { pendiente: 'bg-amber-400', aprobada: 'bg-emerald-500', descartada: 'bg-red-300' }

// La ÚNICA línea de tiempo de la ventana de revisión. El marcador azul es el control deslizante nativo (`input range`) y es el
// TIEMPO REAL DEL VIDEO (`posicion`): avanza al reproducir, se queda al pausar y, al arrastrarlo (con el dedo, el mouse o las
// flechas del teclado), el video salta ahí y el tiempo de la pregunta pasa a ese segundo (`onCambiar`, solo el BORRADOR; no
// escribe nada). El momento de la pregunta actual (`valor`) es una marca fija arriba de la pista: la reproducción nunca la
// mueve. Debajo se dibujan las demás preguntas (puntos) y, hueco, el momento que sugirió la IA.
//   duracionSeg  largo del video (sin él no hay línea y la ventana usa solo el campo m:ss)
//   posicion     segundo real del reproductor (si falta, el marcador cae en el momento de la pregunta)
//   valor        segundo elegido para la pregunta actual (la marca fija)
//   items        todas las preguntas, para los puntos de referencia
//   itemId       la pregunta actual (no se dibuja como punto: es el marcador)
//   sugeridoSeg  lo que propuso la IA
export default function LineaTiempoRevision({ duracionSeg, posicion = null, valor, onCambiar, items = [], itemId, sugeridoSeg = null, disabled = false }) {
  const dur = Number.isFinite(duracionSeg) && duracionSeg > 0 ? Math.floor(duracionSeg) : 0
  if (!dur) return null
  const v = Math.min(Math.max(0, Number.isInteger(valor) ? valor : dur), dur)
  const real = Number.isFinite(posicion) ? Math.min(Math.max(0, posicion), dur) : v
  const pct = (s) => `${(Math.min(Math.max(s, 0), dur) / dur) * 100}%`
  return (
    <div data-testid="linea-tiempo-revision">
      <div className="relative h-10 flex items-center" data-tooltip="Arrastra para mover el video y fijar cuándo aparece la pregunta">
        <div className="absolute inset-x-3.5 top-1/2 -translate-y-1/2 h-2 rounded-full bg-surface-container" aria-hidden="true">
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent-light" style={{ width: pct(real) }} />
          {items.filter((o) => o.id !== itemId && Number.isInteger(o.timestampSeg) && o.timestampSeg <= dur).map((o) => (
            <span key={o.id} className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full opacity-80 ${COLOR_MARCA[o.estado] || COLOR_MARCA[ESTADO_REVISION.PENDIENTE]}`}
              style={{ left: pct(o.timestampSeg) }} />
          ))}
          {Number.isInteger(sugeridoSeg) && sugeridoSeg <= dur && sugeridoSeg !== v && (
            <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-accent bg-surface-card" style={{ left: pct(sugeridoSeg) }}
              title={`Sugerido por la IA: ${formatearMinuto(sugeridoSeg)}`} />
          )}
          <span data-testid="marca-pregunta" className="absolute bottom-full mb-[10px] -translate-x-1/2 w-0 h-0 border-x-[6px] border-x-transparent border-t-[6px] border-t-emerald-600"
            style={{ left: pct(v) }} />
        </div>
        <input type="range" min={0} max={dur} step="any" value={real} disabled={disabled}
          onChange={(e) => onCambiar(Math.min(dur, Math.max(0, Math.round(Number(e.target.value)))))}
          aria-label="Momento en que aparece la pregunta: arrastra o usa las flechas"
          aria-valuetext={formatearMinuto(Math.floor(real))}
          className="relative w-full h-10 bg-transparent cursor-pointer appearance-none disabled:opacity-60
            [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-7 [&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-white
            [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent
            [&::-moz-range-thumb]:border-4 [&::-moz-range-thumb]:border-white" />
      </div>
      <div className="flex justify-between text-xs text-muted tabular-nums" aria-hidden="true"><span>0:00</span><span>{formatearMinuto(dur)}</span></div>
    </div>
  )
}
