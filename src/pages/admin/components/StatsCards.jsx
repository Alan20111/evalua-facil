import { formatCurrency } from '../../../utils/subscriptionHelpers'
import { DIAS_POR_VENCER, INSIGNIAS } from '../../../utils/situacionSuscripcion'
import StatusBadge from './StatusBadge'

// Mes en curso, escrito ("julio de 2026"), para que el renglón de ingresos diga
// de qué mes habla en vez de un "del mes" que hay que adivinar.
function mesEnCurso() {
  const texto = new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

// Un renglón por indicador, en el orden en que se leen: cuánta gente hay, cómo
// están sus suscripciones, cuántos estudiantes y cuánto se cobró.
//
// `insignia` es la clave de la MISMA etiqueta de color que la tabla de
// Suscripciones le pone a esos renglones, para poder saltar de un conteo a las
// filas que lo forman sin traducir nada mentalmente. Los indicadores que no
// hablan de una situación de suscripción no llevan ninguna.
const KPI_CONFIG = [
  { key: 'teacherCount', label: 'Docentes registrados', format: (v) => v },
  {
    key: 'activeSubCount',
    label: 'Suscripciones activas',
    ayuda: 'Suma de Depósito automático (domiciliada) y Mes pagado.',
    format: (v) => v,
  },
  {
    key: 'activeExpiringSoonCount',
    label: 'Suscripciones por vencer',
    ayuda: `Suscripciones de paga que vencen dentro de los próximos ${DIAS_POR_VENCER} días.`,
    format: (v) => v,
  },
  { key: 'trialCount', label: 'En periodo de prueba', insignia: 'prueba', format: (v) => v },
  {
    key: 'trialExpiringSoonCount',
    label: 'En periodo de prueba por vencer',
    insignia: 'prueba',
    ayuda: `Pruebas que terminan dentro de los próximos ${DIAS_POR_VENCER} días.`,
    format: (v) => v,
  },
  { key: 'activeStudentCount', label: 'Estudiantes activos', format: (v) => v },
  {
    key: 'inactiveStudentCount',
    label: 'Estudiantes no activados',
    ayuda: 'Estudiantes dados de alta que todavía no entran: nunca activaron su cuenta o su docente les puso contraseña temporal.',
    format: (v) => v,
  },
  { key: 'monthRevenue', label: `Ingresos de ${mesEnCurso()}`, format: formatCurrency },
  { key: 'totalRevenue', label: 'Ingresos totales', format: formatCurrency },
]

export default function StatsCards({ kpis }) {
  if (!kpis) return null

  return (
    /* w-fit: la tabla mide lo que miden sus datos y se queda a la izquierda,
       en vez de estirarse de lado a lado con las cifras perdidas al fondo. */
    <div className="bg-surface-card rounded-card shadow-card overflow-hidden w-fit max-w-full">
      <table className="w-auto text-sm">
        <thead>
          <tr className="text-left text-[11.5px] tracking-wide uppercase text-accent bg-surface">
            {/* Columna de las insignias: sin título, porque solo la mitad de
                los renglones tiene una y ponerle nombre prometía de más. */}
            <th className="px-4 py-2 font-normal" />
            <th className="pr-4 py-2 font-normal">Indicador</th>
            <th className="px-4 py-2 font-normal text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {KPI_CONFIG.map(({ key, label, ayuda, insignia, format }) => (
            <tr key={key} className="border-t border-outline-variant">
              {/* Celda propia (aunque vaya vacía) para que las insignias
                  arranquen todas en la misma vertical y los nombres de los
                  indicadores también. */}
              <td className="px-4 py-2.5 whitespace-nowrap">
                {insignia && <StatusBadge situacion={INSIGNIAS[insignia]} />}
              </td>
              <td className="pr-4 py-2.5 text-on-surface">
                <span
                  title={ayuda}
                  className={ayuda ? 'cursor-help underline decoration-dotted underline-offset-2' : ''}
                >
                  {label}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-on-surface whitespace-nowrap">
                {format(kpis[key] ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BarChart({ items, labelKey, valueKey, maxBars = 10 }) {
  const data = items.slice(0, maxBars)
  const max = Math.max(...data.map((d) => d[valueKey]), 1)

  return (
    <div className="space-y-2">
      {data.length === 0 ? (
        <p className="text-sm text-slate-400">Sin datos</p>
      ) : (
        data.map((item) => (
          <div key={item[labelKey]} className="flex items-center gap-3">
            <span className="text-xs text-muted w-28 md:w-40 truncate flex-shrink-0">
              {item[labelKey]}
            </span>
            <div className="flex-1 h-6 bg-surface-container rounded overflow-hidden">
              <div
                className="h-full bg-accent rounded transition-all"
                style={{ width: `${(item[valueKey] / max) * 100}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-muted w-6 text-right">
              {item[valueKey]}
            </span>
          </div>
        ))
      )}
    </div>
  )
}

export function ResumenCharts({ stats }) {
  if (!stats) return null

  const { teachersBySchool, subscriptions } = stats

  const statusItems = [
    { status: 'trial', label: 'Trial' },
    { status: 'activa', label: 'Activa' },
    { status: 'vencida', label: 'Vencida' },
    { status: 'pendiente_pago', label: 'Pendiente pago' },
    { status: 'cancelada', label: 'Cancelada' },
  ].map(({ status, label }) => ({
    name: label,
    count: (subscriptions || []).filter((s) => s.status === status).length,
  }))

  return (
    /* Una encima de otra y del mismo ancho, ocupando lo que la tabla de
       indicadores deja libre a su derecha. */
    <div className="flex-1 min-w-0 w-full space-y-3">
      <div className="bg-surface-card rounded-card shadow-card p-4">
        <h3 className="font-semibold text-on-surface mb-3">Docentes por escuela (top 10)</h3>
        <BarChart items={teachersBySchool} labelKey="school" valueKey="count" />
      </div>

      <div className="bg-surface-card rounded-card shadow-card p-4">
        <h3 className="font-semibold text-on-surface mb-3">Estado de suscripciones</h3>
        <BarChart items={statusItems} labelKey="name" valueKey="count" />
      </div>
    </div>
  )
}
