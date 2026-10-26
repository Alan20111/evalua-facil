import { AlertTriangle, FileSearch } from 'lucide-react'
import { advertenciasDeTiempo, formatearMinuto, leerEvidencia } from './revisionVideo'
import { ICONO } from '../../config/iconos'

// De qué parte del video salió una pregunta: el fragmento y la cita con la que se comprobó. Es información, no una tarea: al docente
// no se le pide comprobar nada. NUNCA inventa evidencia y NO dibuja nada cuando no la hay (propuestas de la versión anterior).
export default function EvidenciaVideo({ item }) {
  const ev = leerEvidencia(item?.respaldo)
  if (!ev) return null
  const avisos = advertenciasDeTiempo(item)
  return (
    <div className="rounded-card border border-outline-variant bg-surface px-3 py-2 space-y-1.5" data-testid="evidencia-video">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-on-surface">
        <FileSearch size={ICONO.xs} className="text-muted" /> Tramo del video y evidencia
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
      </div>
      {avisos.map((a) => (
        <p key={a} className="flex items-start gap-1.5 text-xs text-amber-900 bg-amber-50 rounded px-2 py-1.5">
          <AlertTriangle size={ICONO.xs} className="flex-shrink-0 mt-0.5 text-amber-700" /> {a}
        </p>
      ))}
    </div>
  )
}
