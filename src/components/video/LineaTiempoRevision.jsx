import { ESTADO_REVISION, formatearMinuto } from './revisionVideo'

const COLOR_MARCA = { pendiente: 'bg-amber-400', aprobada: 'bg-emerald-500', descartada: 'bg-red-300' }

// La ÚNICA línea de tiempo de la ventana de revisión. Tiene DOS ejes que no se mezclan:
//   · EL VIDEO: el TRIÁNGULO verde (`marca-video`) es el tiempo actual del video (`posicion`): avanza al reproducir. Arrastrarlo,
//     tocar la línea (el `input range` nativo, con su «bolita» TRANSPARENTE: no hay punto azul) o usar las flechas solo SALTA el
//     video (`onSaltar`): nunca cambia el tiempo guardado de la pregunta. El relleno azul claro muestra el avance.
//   · LA PREGUNTA: la BOLITA BLANCA (`bolita-pregunta`) es el momento en que aparece la pregunta actual (`valor`, lo que propuso la
//     IA o lo que el docente ya corrigió). Se arrastra (mouse o dedo): cada segundo nuevo cambia el borrador y lleva el video ahí
//     (`onCambiar`), y al soltarla avisa (`onSoltar(seg)`) para que el panel guarde ese tiempo solo, sin pulsar «Guardar».
// Los puntos de las demás preguntas van ENCIMA del control de la línea (nada los tapa) y TOCAR UNO lleva a esa pregunta (`onIr`).
//   duracionSeg  largo del video (sin él no hay línea y la ventana usa solo el campo m:ss)
//   posicion     segundo real del reproductor (si falta, el triángulo cae en el momento de la pregunta)
//   valor        segundo elegido para la pregunta actual (la bolita blanca)
//   items        todas las preguntas (un punto por cada una; la actual es la bolita blanca)
//   itemId       la pregunta actual (no se repite como punto de navegación)
//   onCambiar    (seg) → nuevo momento de la pregunta (borrador + el video salta)
//   onSoltar     (seg) → la bolita se soltó en `seg` (guardar el tiempo)
//   onSaltar     (seg) → solo mover el video
//   onIr         (id) → ir a esa pregunta
export default function LineaTiempoRevision({ duracionSeg, posicion = null, valor, onCambiar, onSoltar, onSaltar, onIr, items = [], itemId, disabled = false }) {
  const dur = Number.isFinite(duracionSeg) && duracionSeg > 0 ? Math.floor(duracionSeg) : 0
  if (!dur) return null
  const v = Math.min(Math.max(0, Number.isInteger(valor) ? valor : dur), dur)
  const real = Number.isFinite(posicion) ? Math.min(Math.max(0, posicion), dur) : v
  const pct = (s) => `${(Math.min(Math.max(s, 0), dur) / dur) * 100}%`
  // x ↔ segundo, sobre la franja por la que corre el centro del control de la línea (`pista`: el contenedor de los puntos)
  const segEn = (clientX, pista) => {
    const r = pista?.getBoundingClientRect()
    if (!r || r.width <= 0) return v
    return Math.min(dur, Math.max(0, Math.round(((clientX - r.left) / r.width) * dur)))
  }
  // El estado del arrastre vive en el propio elemento (data-*): distancia puntero–centro al agarrar (no «salta» al tomarlo de la orilla)
  // y último segundo elegido con la bolita (para guardarlo al soltar).
  const elegir = (s, el) => { if (!disabled && s !== v) { el.dataset.ultimo = String(s); onCambiar(s) } }
  const saltar = (s) => { if (s !== Math.round(real)) onSaltar?.(s) }
  // Arrastre con captura de puntero (mouse o dedo). `habilitado` y `alSoltar` distinguen la bolita del triángulo.
  const agarrar = (accion, habilitado, alSoltar) => ({
    onPointerDown: (e) => {
      if (!habilitado) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const r = e.currentTarget.getBoundingClientRect()
      e.currentTarget.dataset.agarre = String(e.clientX - (r.left + r.width / 2))
    },
    onPointerMove: (e) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) accion(segEn(e.clientX - (Number(e.currentTarget.dataset.agarre) || 0), e.currentTarget.parentElement), e.currentTarget)
    },
    onPointerUp: (e) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
      e.currentTarget.releasePointerCapture(e.pointerId)
      alSoltar?.(e.currentTarget)
    },
  })
  const soltarBolita = (el) => {
    const s = el.dataset.ultimo
    delete el.dataset.ultimo
    if (s !== undefined) onSoltar?.(Number(s))
  }
  return (
    <div data-testid="linea-tiempo-revision">
      <div className="relative h-14 flex items-center" data-tooltip="Arrastra para mover el video y fijar cuándo aparece la pregunta" data-tooltip-pos="bottom">
        <div className="absolute inset-x-3.5 top-1/2 -translate-y-1/2 h-2 rounded-full bg-surface-container" aria-hidden="true">
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent-light" style={{ width: pct(real) }} />
        </div>
        {/* El control de la línea: tocar o arrastrar salta el video. Solo para el puntero (el triángulo es el control con teclado). */}
        <input type="range" min={0} max={dur} step="any" value={real} aria-hidden="true" tabIndex={-1}
          onChange={(e) => saltar(Math.min(dur, Math.max(0, Math.round(Number(e.target.value)))))}
          className="relative w-full h-14 bg-transparent cursor-pointer appearance-none
            [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-7 [&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-transparent
            [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-transparent
            [&::-moz-range-thumb]:border-4 [&::-moz-range-thumb]:border-transparent" />
        {/* Encima del control de la línea (después en el DOM): puntos de navegación, bolita blanca y triángulo. */}
        <div className="absolute inset-x-3.5 top-1/2 h-0 pointer-events-none">
          {items.filter((o) => o.id !== itemId && Number.isInteger(o.timestampSeg) && o.timestampSeg <= dur).map((o) => (
            <button key={o.id} type="button" onClick={() => onIr?.(o.id)} data-testid="punto-pregunta"
              aria-label={`Ir a la pregunta del minuto ${formatearMinuto(o.timestampSeg)}${o.sinGuardar ? ', con cambios sin guardar' : ''}`}
              className="absolute top-0 -translate-x-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full pointer-events-auto cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              style={{ left: pct(o.timestampSeg) }}>
              <span className={`relative block w-2.5 h-2.5 rounded-full ring-2 ring-white ${COLOR_MARCA[o.estado] || COLOR_MARCA[ESTADO_REVISION.PENDIENTE]}`}>
                {o.sinGuardar && <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-accent ring-1 ring-white" />}
              </span>
            </button>
          ))}
          {/* La BOLITA BLANCA: el momento de la pregunta actual. Se arrastra y, al soltarla, el tiempo se guarda solo. Es solo un agarre del
              puntero: el control accesible de la línea (teclado, lector de pantalla) es el triángulo. */}
          <div data-testid="bolita-pregunta" aria-hidden="true" {...agarrar(elegir, !disabled, soltarBolita)}
            className={`absolute top-0 -translate-x-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center touch-none pointer-events-auto ${disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
            style={{ left: pct(v) }}>
            <span className="block w-3.5 h-3.5 rounded-full border-2 border-accent bg-surface-card" />
          </div>
          {/* El TRIÁNGULO verde: el tiempo actual del video. Se arrastra o se mueve con las flechas para recorrer el video. */}
          {/* eslint-disable-next-line jsx-a11y/prefer-tag-over-role --
              el `input range` de esta línea es solo el agarre del puntero (transparente y fuera del teclado); este es el control
              deslizante accesible del video, y un segundo input range encimado tomaría los clics. Lleva role="slider" completo. */}
          <div role="slider" tabIndex={0} data-testid="marca-video" aria-label="Posición del video: arrastra o usa las flechas"
            aria-valuemin={0} aria-valuemax={dur} aria-valuenow={Math.floor(real)} aria-valuetext={formatearMinuto(Math.floor(real))}
            {...agarrar(saltar, true)}
            onKeyDown={(e) => {
              const paso = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 }[e.key]
              if (!paso) return
              e.preventDefault()
              saltar(Math.min(dur, Math.max(0, Math.round(real) + paso)))
            }}
            className="absolute bottom-[10px] -translate-x-1/2 w-8 h-5 flex items-end justify-center touch-none pointer-events-auto cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded"
            style={{ left: pct(real) }}>
            <span className="block w-0 h-0 border-x-[8px] border-x-transparent border-t-[11px] border-t-emerald-600" aria-hidden="true" />
          </div>
        </div>
      </div>
      <div className="flex justify-between text-xs text-muted tabular-nums" aria-hidden="true"><span>0:00</span><span>{formatearMinuto(dur)}</span></div>
    </div>
  )
}
