import { useState } from 'react'
import { Play } from 'lucide-react'
import {
  ESTADO_REVISION, PASOS_TIEMPO, ajustarTiempo, formatearMinuto, interpretarTiempo, validarTiempo,
} from './revisionVideo'

const PASO = 'min-h-[2.75rem] min-w-[3.25rem] px-3 rounded-full border border-outline-variant text-sm font-semibold tabular-nums text-on-surface hover:bg-surface-container disabled:opacity-60 disabled:hover:bg-transparent'
const COLOR_MARCA = { pendiente: 'bg-amber-400', aprobada: 'bg-emerald-500', descartada: 'bg-red-300' }

// Cuándo aparece la pregunta: campo m:ss, botones ±1 y ±5 s, control deslizante y una referencia visual de su posición entre
// las demás preguntas del video. Todo cambia el BORRADOR del docente: se refleja de inmediato aquí y en la vista previa, pero
// no se guarda hasta que el docente lo decide (botón «Guardar» de la pregunta).
//   item         elemento de revisión (con el borrador aplicado)
//   items        todos, para la referencia visual
//   duracionSeg  duración del video si se conoce (límite superior)
//   onCambiar    (segundos) → nuevo tiempo del borrador
//   onProbar     () → abre la vista previa unos segundos antes de este minuto
export default function ControlTiempoVideo({ item, items, duracionSeg, disabled = false, onCambiar, onProbar, puedeProbar = true }) {
  const [errorTexto, setErrorTexto] = useState(null)
  const seg = item.timestampSeg
  const dur = Number.isFinite(duracionSeg) && duracionSeg > 0 ? Math.floor(duracionSeg) : null
  const v = validarTiempo(seg, duracionSeg)
  const cambio = item.guardado && item.guardado.timestampSeg !== seg
  const sugeridoDifiere = Number.isInteger(item.sugeridoSeg) && item.sugeridoSeg !== seg

  function confirmarTexto(texto) {
    const n = interpretarTiempo(texto)
    const val = validarTiempo(n, duracionSeg)
    if (!val.ok) { setErrorTexto(val.error); return }
    setErrorTexto(null)
    if (n !== seg) onCambiar(n)
  }
  const mover = (d) => { setErrorTexto(null); onCambiar(ajustarTiempo(seg, d, duracionSeg)) }

  return (
    <div className="rounded-card border border-outline-variant bg-surface px-3 py-2.5 space-y-2" data-testid="control-tiempo">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="text-xs font-semibold text-on-surface">Momento en que aparece</p>
        {Number.isInteger(item.sugeridoSeg) && (
          <p className="text-xs text-muted">Sugerido por la IA: <span className="font-semibold tabular-nums">{formatearMinuto(item.sugeridoSeg)}</span></p>
        )}
        {sugeridoDifiere && <p className="text-xs text-muted">Elegido por ti: <span className="font-semibold tabular-nums text-on-surface">{formatearMinuto(seg)}</span></p>}
        {cambio && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900">Sin guardar</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PASOS_TIEMPO.filter((d) => d < 0).map((d) => (
          <button key={d} type="button" disabled={disabled} onClick={() => mover(d)} className={PASO} aria-label={`Aparece ${Math.abs(d)} segundos antes`}>
            −{Math.abs(d)} s
          </button>
        ))}
        <input
          key={`t-${seg}`} type="text" inputMode="numeric" defaultValue={formatearMinuto(seg)} disabled={disabled}
          aria-label="Minuto en que aparece la pregunta (m:ss)" aria-invalid={!v.ok || !!errorTexto}
          onBlur={(e) => confirmarTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarTexto(e.currentTarget.value) } }}
          className="w-24 min-h-[2.75rem] px-3 text-center rounded-full border border-outline-variant bg-surface text-sm font-semibold tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {PASOS_TIEMPO.filter((d) => d > 0).map((d) => (
          <button key={d} type="button" disabled={disabled} onClick={() => mover(d)} className={PASO} aria-label={`Aparece ${d} segundos después`}>
            +{d} s
          </button>
        ))}
        <button type="button" onClick={onProbar} disabled={!puedeProbar} data-testid="probar-desde-antes"
          className="ml-auto inline-flex items-center gap-1.5 min-h-[2.75rem] px-4 rounded-full border border-accent text-accent text-sm font-semibold hover:bg-[var(--accent-tint)] disabled:opacity-60">
          <Play size={14} /> Probar desde unos segundos antes
        </button>
      </div>

      {dur && Number.isInteger(seg) && seg <= dur && (
        <input type="range" min={0} max={dur} step={1} value={seg} disabled={disabled}
          onChange={(e) => { setErrorTexto(null); onCambiar(Number(e.target.value)) }}
          aria-label="Mover el momento de aparición sobre la línea de tiempo"
          className="w-full accent-[var(--accent)]" />
      )}
      {dur && (
        <div aria-hidden="true">
          <div className="relative h-2 rounded-full bg-surface-container mx-1.5">
            {(items || []).filter((o) => Number.isInteger(o.timestampSeg) && o.timestampSeg <= dur).map((o) => (
              <span key={o.id}
                className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${o.id === item.id ? 'w-3.5 h-3.5 bg-accent ring-2 ring-white z-10' : `w-2.5 h-2.5 ${COLOR_MARCA[o.estado] || COLOR_MARCA[ESTADO_REVISION.PENDIENTE]} opacity-80`}`}
                style={{ left: `${(o.timestampSeg / dur) * 100}%` }} />
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted tabular-nums mt-0.5"><span>0:00</span><span>{formatearMinuto(dur)}</span></div>
        </div>
      )}
      {!dur && <p className="text-xs text-hint">Aún no se conoce la duración del video: el límite se comprobará cuando se reproduzca.</p>}

      {(errorTexto || !v.ok) && <p role="alert" className="text-xs text-error">{errorTexto || v.error}</p>}
      {v.ok && v.aviso && <p className="text-xs text-amber-800">{v.aviso}</p>}
    </div>
  )
}
