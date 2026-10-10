import { Lightbulb } from 'lucide-react'
import { RECOMENDACIONES_VIDEO, REGLA_VIDEO } from './recomendacionesTexto'

// Las tres recomendaciones que el docente debe tener presentes ANTES de publicar un video interactivo.
// Se muestran siempre completas en la creación y en la revisión (no se pliegan ni se ocultan), y en forma corta
// en la vista previa. La regla de fondo: la IA propone; el docente revisa, corrige, prueba, aprueba o descarta.
// Aprobar NO es una verificación automática de que el contenido sea exacto: es la decisión del docente.
export default function RecomendacionesVideo({ compacto = false }) {
  if (compacto) {
    return (
      <p className="text-xs text-amber-900" data-testid="recomendaciones-video">
        <span className="font-semibold">Antes de publicar, asegúrate:</span>{' '}
        {RECOMENDACIONES_VIDEO.map((r, i) => <span key={r.corto}>{i + 1}. {r.corto}{i < 2 ? ' · ' : '.'}</span>)}
      </p>
    )
  }
  return (
    <section className="rounded-card border border-amber-200 bg-amber-50 p-3 space-y-2" aria-label="Recomendaciones antes de publicar" data-testid="recomendaciones-video">
      <div className="flex items-start gap-2">
        <Lightbulb size={18} className="text-amber-700 flex-shrink-0 mt-0.5" />
        <h3 className="text-sm font-semibold text-amber-900">Antes de publicar, ten presente:</h3>
      </div>
      <ol className="space-y-1.5 text-sm text-amber-900 list-decimal pl-6">
        {RECOMENDACIONES_VIDEO.map((r) => (
          <li key={r.titulo}><span className="font-semibold">{r.titulo}</span> {r.texto}</li>
        ))}
      </ol>
      <p className="text-xs font-semibold text-amber-900">{REGLA_VIDEO}</p>
    </section>
  )
}
