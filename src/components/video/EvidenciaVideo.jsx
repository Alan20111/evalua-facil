import { AlertTriangle, FileSearch } from 'lucide-react'
import { advertenciasDeTiempo, formatearMinuto, leerEvidencia } from './revisionVideo'

// De dónde salió una pregunta y si su momento tiene respaldo. NUNCA inventa evidencia y NO dibuja nada cuando no la hay: hoy
// las propuestas no guardan el tramo del que salieron, así que un recuadro vacío repetido en cada pregunta no le dice nada al
// docente (la ventana de revisión avisa UNA vez, en una línea, que no hay evidencia). Aunque la haya, el resumen de un tramo lo
// escribió una IA y puede omitir o deformar lo que dice el video: es una ayuda para revisar, no una garantía.
export default function EvidenciaVideo({ item }) {
  const ev = leerEvidencia(item?.respaldo)
  if (!ev) return null
  const avisos = advertenciasDeTiempo(item)
  return (
    <div className="rounded-card border border-outline-variant bg-surface px-3 py-2 space-y-1.5" data-testid="evidencia-video">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-on-surface">
        <FileSearch size={14} className="text-muted" /> Tramo del video y evidencia
      </p>
      <div className="text-xs text-on-surface space-y-1">
        {(ev.inicioSeg !== null || ev.finSeg !== null) && (
          <p>
            Tramo: <span className="font-semibold tabular-nums">
              {ev.inicioSeg !== null ? formatearMinuto(Math.floor(ev.inicioSeg)) : '—'}–{ev.finSeg !== null ? formatearMinuto(Math.floor(ev.finSeg)) : '—'}
            </span>
          </p>
        )}
        {ev.resumen && <p><span className="font-semibold">Resumen del tramo:</span> {ev.resumen}</p>}
        {ev.cita && <p><span className="font-semibold">Cita de apoyo:</span> “{ev.cita}”</p>}
        <p className="text-hint">El resumen lo escribió una IA y puede omitir o deformar lo que dice el video. Compáralo con el video.</p>
      </div>
      {avisos.map((a) => (
        <p key={a} className="flex items-start gap-1.5 text-xs text-amber-900 bg-amber-50 rounded px-2 py-1.5">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5 text-amber-700" /> {a}
        </p>
      ))}
    </div>
  )
}
