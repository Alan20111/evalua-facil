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
        <div key={key} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5">
          <div className="flex items-center gap-2 text-slate-400 mb-2">
            <Icon size={16} />
            <span className="text-xs font-medium">{label}</span>
          </div>
          <p className="text-xl md:text-2xl font-bold text-slate-900">{format(kpis[key] ?? 0)}</p>
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
            <span className="text-xs text-slate-600 w-28 md:w-40 truncate flex-shrink-0">
              {item[labelKey]}
            </span>
            <div className="flex-1 h-6 bg-slate-100 rounded-lg overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-lg transition-all"
                style={{ width: `${(item[valueKey] / max) * 100}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-slate-700 w-6 text-right">
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

  const { subsByPlan, teachersBySchool, kpis, revenueByPlan, subsistemaDist } = stats

  const subsistemaItems = Object.entries(subsistemaDist || {}).map(([name, count]) => ({
    name,
    count,
  }))

  return (
    <div className="grid md:grid-cols-2 gap-4 mt-6">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <h3 className="font-semibold text-slate-900 mb-4">Suscripciones activas por plan</h3>
        <BarChart
          items={subsByPlan.map((s) => ({ name: s.plan.nombre, count: s.count }))}
          labelKey="name"
          valueKey="count"
        />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <h3 className="font-semibold text-slate-900 mb-4">Docentes por escuela (top 10)</h3>
        <BarChart items={teachersBySchool} labelKey="school" valueKey="count" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <h3 className="font-semibold text-slate-900 mb-4">Ingresos por plan</h3>
        <BarChart
          items={revenueByPlan.map((r) => ({ name: r.plan.nombre, total: r.total }))}
          labelKey="name"
          valueKey="total"
        />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <h3 className="font-semibold text-slate-900 mb-4">Estadísticas adicionales</h3>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">En trial</dt>
            <dd className="font-semibold">{kpis.trialCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Vencidas</dt>
            <dd className="font-semibold">{kpis.expiredCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Canceladas</dt>
            <dd className="font-semibold">{kpis.cancelledCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Nuevos docentes (mes)</dt>
            <dd className="font-semibold">{kpis.newTeachersThisMonth}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Prom. asignaturas/docente</dt>
            <dd className="font-semibold">{kpis.avgSubjects.toFixed(1)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Prom. alumnos/docente</dt>
            <dd className="font-semibold">{kpis.avgStudents.toFixed(1)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Churn (30 días)</dt>
            <dd className="font-semibold">{kpis.churnCount}</dd>
          </div>
        </dl>
        {subsistemaItems.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Por subsistema</p>
            <BarChart items={subsistemaItems} labelKey="name" valueKey="count" />
          </div>
        )}
      </div>
    </div>
  )
}
