import { Lightbulb } from 'lucide-react'
import { RECOMENDACIONES_VIDEO, REGLA_VIDEO } from './recomendacionesTexto'
import { ICONO } from '../../config/iconos'

// Lo que el docente debe saber ANTES de publicar un video interactivo: el sistema genera, comprueba y ubica cada pregunta; el
// docente solo la mueve o edita y decide cuáles aprobar. Completas en la creación; en forma corta en la revisión y la vista previa.
export default function RecomendacionesVideo({ compacto = false }) {
  if (compacto) {
    return (
      <p className="text-xs text-amber-900" data-testid="recomendaciones-video">
        <span className="font-semibold">Antes de publicar:</span>{' '}
        {RECOMENDACIONES_VIDEO.map((r, i) => <span key={r.corto}>{i + 1}. {r.corto}{i < RECOMENDACIONES_VIDEO.length - 1 ? ' · ' : '.'}</span>)}
      </p>
    )
  }
  return (
    <section className="rounded-card border border-amber-200 bg-amber-50 p-3 space-y-2" aria-label="Recomendaciones antes de publicar" data-testid="recomendaciones-video">
      <div className="flex items-start gap-2">
        <Lightbulb size={ICONO.md} className="text-amber-700 flex-shrink-0 mt-0.5" />
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
