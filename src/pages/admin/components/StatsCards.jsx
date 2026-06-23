import {
  Users,
  GraduationCap,
  CreditCard,
  DollarSign,
  Clock,
  AlertTriangle,
  TrendingUp,
  Timer,
} from 'lucide-react'
import { formatCurrency } from '../../../utils/subscriptionHelpers'

const KPI_CONFIG = [
  { key: 'teacherCount', label: 'Docentes', icon: Users, format: (v) => v },
  { key: 'activeStudentCount', label: 'Alumnos activos', icon: GraduationCap, format: (v) => v },
  { key: 'activeSubCount', label: 'Suscripciones activas', icon: CreditCard, format: (v) => v },
  { key: 'trialCount', label: 'En periodo trial', icon: Timer, format: (v) => v },
  { key: 'totalRevenue', label: 'Ingresos totales', icon: DollarSign, format: formatCurrency },
  { key: 'monthRevenue', label: 'Ingresos del mes', icon: DollarSign, format: formatCurrency },
  { key: 'pendingPaymentCount', label: 'Pagos pendientes', icon: Clock, format: (v) => v },
  { key: 'conversionRate', label: 'Tasa conversión', icon: TrendingUp, format: (v) => `${v.toFixed(1)}%` },
]

export default function StatsCards({ kpis }) {
  if (!kpis) return null

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
      {KPI_CONFIG.map(({ key, label, icon: Icon, format }) => (
        <div key={key} className="bg-surface-card rounded-card shadow-card p-4 md:p-5">
          <div className="flex items-center gap-2 text-slate-400 mb-2">
            <Icon size={16} />
            <span className="text-xs font-medium">{label}</span>
          </div>
          <p className="text-xl md:text-2xl font-bold text-on-surface">{format(kpis[key] ?? 0)}</p>
        </div>
      ))}
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
        data.map((item, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs text-muted w-28 md:w-40 truncate flex-shrink-0">
              {item[labelKey]}
            </span>
            <div className="flex-1 h-6 bg-surface-container rounded overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded transition-all"
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
    <div className="grid md:grid-cols-2 gap-4 mt-6">
      <div className="bg-surface-card rounded-card shadow-card p-5">
        <h3 className="font-semibold text-on-surface mb-4">Docentes por escuela (top 10)</h3>
        <BarChart items={teachersBySchool} labelKey="school" valueKey="count" />
      </div>

      <div className="bg-surface-card rounded-card shadow-card p-5">
        <h3 className="font-semibold text-on-surface mb-4">Estado de suscripciones</h3>
        <BarChart items={statusItems} labelKey="name" valueKey="count" />
      </div>
    </div>
  )
}
