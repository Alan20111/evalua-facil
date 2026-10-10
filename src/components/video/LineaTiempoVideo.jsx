import { useRef } from 'react'
import { formatearTiempo } from '../../utils/videoProgreso'

// Línea de tiempo propia del Video interactivo (los controles nativos de
// YouTube están apagados). Muestra tres cosas:
//   · lo ya visto (franja suave) y la posición actual (franja fuerte),
//   · una marca por pregunta: hueca = pendiente, rellena = respondida,
//     con aro = la que está en pantalla, gris = aún no llega,
//   · y solo deja tocar hasta donde el estudiante ya llegó.
//
// Va FUERA del recuadro del video, nunca encima (regla de YouTube). Tocar la
// pista salta a ese punto (acotado a lo visto); tocar una marca va a esa pregunta.
// No hay arrastre: un toque, sin accidentes con el dedo.
export default function LineaTiempoVideo({
  duracion, posicion, maxVisto, preguntas, respondida, activaId, onSaltar, onMarca,
  sinLimite = false, // vista previa del docente: sin franja de «lo visto» y todas las marcas se pueden tocar
}) {
  const pistaRef = useRef(null)
  const d = Math.max(1, duracion || 1)
  const pct = (s) => `${Math.min(100, Math.max(0, (s / d) * 100))}%`

  function alTocarPista(e) {
    const r = pistaRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return
    onSaltar(((e.clientX - r.left) / r.width) * d)
  }

  return (
    <div>
      {/* px-5: las marcas miden 40 px y se centran en su segundo; la de 0:00 y la del final sobresaldrían 20 px de la pista
          y taparían al botón vecino (lo vio la medición de cajas en 1550×860). El relleno las deja dentro de su caja. */}
      <div className="flex items-center h-11 px-5">
        {/* El toque en la pista salta; las marcas son botones aparte. */}
        <div ref={pistaRef} onClick={alTocarPista} aria-hidden="true"
          className="relative w-full h-3 rounded-full bg-surface-container cursor-pointer">
          {!sinLimite && <div className="absolute inset-y-0 left-0 rounded-full bg-accent-light" style={{ width: pct(maxVisto) }} />}
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: pct(posicion) }} />
          {preguntas.map((p) => {
            const lista = respondida(p)
            const alcanzada = sinLimite || p.timestampSeg <= maxVisto + 0.3
            const activa = p.id === activaId
            return (
              <button key={p.id} type="button"
                onClick={(e) => { e.stopPropagation(); onMarca(p) }}
                aria-label={`Pregunta en ${formatearTiempo(p.timestampSeg)}: ${lista ? 'respondida' : alcanzada ? 'pendiente' : 'aún no llegas'}`}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center"
                style={{ left: pct(p.timestampSeg) }}>
                <span className={`block w-3.5 h-3.5 rounded-full border-2 ${
                  lista ? 'bg-accent border-accent'
                    : alcanzada ? 'bg-surface-card border-accent'
                      : 'bg-surface-card border-outline-variant'
                } ${activa ? 'ring-4 ring-[var(--accent-light)]' : ''}`} />
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex justify-between text-xs text-muted tabular-nums">
        <span>{formatearTiempo(posicion)}</span>
        <span>{formatearTiempo(d)}</span>
      </div>
    </div>
  )
}
