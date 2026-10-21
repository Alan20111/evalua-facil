// Respuestas abiertas como tarjetas sueltas (no tabla). Muestra el texto ORIGINAL tal como llegó y,
// aparte, lo que la IA concluyó de esa respuesta (cuando ya la analizó). No muestra quién respondió.
import { ESTADO_IA } from '../../utils/participacionVivo'

const NIVEL = {
  logrado: { texto: 'Logrado', clase: 'bg-emerald-400/20 text-emerald-200' },
  parcial: { texto: 'Parcial', clase: 'bg-amber-400/20 text-amber-200' },
  no_logrado: { texto: 'Por reforzar', clase: 'bg-rose-400/20 text-rose-200' },
}

function EstadoIA({ r }) {
  switch (r.estadoIA) {
    case ESTADO_IA.ANALIZADA: {
      const n = NIVEL[r.evaluacion?.nivel]
      return n ? <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${n.clase}`}>{n.texto}</span> : null
    }
    case ESTADO_IA.RECIBIDA: return <span className="text-xs text-white/80">En cola para analizar</span>
    case ESTADO_IA.ANALIZANDO: return <span className="text-xs text-white/80">Analizando…</span>
    case ESTADO_IA.ERROR: return <span className="text-xs text-rose-200">No se pudo analizar</span>
    case ESTADO_IA.OMITIDA_TOPE: return <span className="text-xs text-white/80">Sin analizar (tope de la sesión)</span>
    default: return null
  }
}

export default function TarjetasRespuestas({ respuestas, grande = false }) {
  if (!respuestas.length) {
    return <p className="text-xl text-white/80 text-center py-10">Las respuestas aparecerán aquí conforme lleguen</p>
  }
  const orden = [...respuestas].sort((a, b) => (b.creadaEn?.toMillis?.() ?? 0) - (a.creadaEn?.toMillis?.() ?? 0))
  return (
    <ul className={`cascada columns-1 ${grande ? 'md:columns-2' : 'md:columns-2 xl:columns-3'} gap-4`}>
      {orden.map((r) => (
        <li key={r.id} className="break-inside-avoid mb-4 rounded-card bg-white/10 border border-white/10 p-4">
          <p className={`${grande ? 'text-2xl' : 'text-lg'} text-white leading-snug`}>{r.texto}</p>
          <div className="mt-2 min-h-5"><EstadoIA r={r} /></div>
          {r.estadoIA === ESTADO_IA.ANALIZADA && r.evaluacion?.evidencia && (
            <p className="text-xs text-white/80 mt-1">IA: «{r.evaluacion.evidencia}»</p>
          )}
        </li>
      ))}
    </ul>
  )
}
