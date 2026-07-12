import { Star, TrendingUp, TrendingDown, CheckCircle2, Users, FileCheck2, Clock } from 'lucide-react'

// Specialized results-analysis panel for an evaluación — distinct from the grade
// table. Shows the core group metrics in a consistent card grid. Kept as its own
// component so future stats (distribución, por-pregunta, aciertos) can be added
// here without touching EvaluacionManager. No overengineering: just the metrics
// the spec asks for, rendered from already-computed values.
//
// props:
//   stats       — { promedio, maxima, minima, porcentajeAprobados } (calcularEstadisticasGrupo)
//   totalEstudiantes, totalEntregas, totalPendientes — counts
//   maxCalif    — scale for the average/max/min captions
export default function EvaluacionStatsPanel({ stats, totalEstudiantes, totalEntregas, totalPendientes, maxCalif = 10 }) {
  const metrics = [
    { icon: Star, label: 'Promedio', value: stats.promedio, sub: `/ ${maxCalif}` },
    { icon: TrendingUp, label: 'Calificación máxima', value: stats.maxima, sub: `/ ${maxCalif}` },
    { icon: TrendingDown, label: 'Calificación mínima', value: stats.minima, sub: `/ ${maxCalif}` },
    { icon: CheckCircle2, label: '% de aprobación', value: `${stats.porcentajeAprobados}%` },
    { icon: Users, label: 'Total de estudiantes', value: totalEstudiantes },
    { icon: FileCheck2, label: 'Total de entregas', value: totalEntregas },
    { icon: Clock, label: 'Total pendientes', value: totalPendientes },
  ]
  return (
    <div className="rounded-card overflow-hidden bg-surface-card shadow-card mb-3 border border-accent">
      <div className="px-4 py-3 bg-accent-light border-b border-accent">
        <h2 className="font-semibold text-accent">Análisis de resultados</h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 p-3">
        {metrics.map(({ icon: Icon, label, value, sub }) => (
          <div key={label} className="bg-accent-light rounded p-3 text-center">
            <Icon size={18} className="text-accent mx-auto mb-1" />
            <p className="text-xl font-bold text-on-surface leading-tight">
              {value}{sub && <span className="text-xs font-normal text-muted"> {sub}</span>}
            </p>
            <p className="text-xs text-muted mt-0.5">{label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
