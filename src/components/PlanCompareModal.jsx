import { useNavigate } from 'react-router-dom'
import { X, Check, Sparkles, Timer } from 'lucide-react'
import { formatCurrency } from '../utils/subscriptionHelpers'

// Comparison shown when the teacher taps the trial banner: the free trial on the
// left vs. the paid plans (from the admin-managed `plans` catalog) on the right.
export default function PlanCompareModal({ plans = [], trialDays, onClose }) {
  const navigate = useNavigate()
  const paidPlans = [...plans].sort((a, b) => (a.orden || 0) - (b.orden || 0))

  function limitLabel(n) {
    return n === -1 || n == null ? 'Sin límite' : n
  }

  function goToPlans() {
    onClose?.()
    navigate('/profile')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-surface-card w-full max-w-2xl rounded-t-card sm:rounded-card p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold text-on-surface">Compara los planes</h3>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-muted rounded">
            <X size={18} />
          </button>
        </div>
        <p className="text-sm text-muted mb-5">
          Estás en tu periodo de prueba. Cuando termine, elige un plan para seguir usando todo.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* ── Free trial ── */}
          <div className="rounded-card border border-outline-variant p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <Timer size={18} className="text-muted" />
              <h4 className="font-bold text-on-surface">Prueba gratis</h4>
            </div>
            <p className="text-2xl font-bold text-on-surface mt-2">Gratis</p>
            <p className="text-xs text-muted mb-4">
              {trialDays > 0 ? `Te quedan ${trialDays} día${trialDays !== 1 ? 's' : ''}` : 'Tu prueba terminó'}
            </p>
            <ul className="space-y-2 text-sm text-on-surface flex-1">
              <li className="flex items-start gap-2"><Check size={16} className="text-emerald-500 flex-shrink-0 mt-0.5" /> Todas las funciones disponibles</li>
              <li className="flex items-start gap-2"><Check size={16} className="text-emerald-500 flex-shrink-0 mt-0.5" /> Asignaturas y alumnos sin límite</li>
              <li className="flex items-start gap-2"><Check size={16} className="text-emerald-500 flex-shrink-0 mt-0.5" /> Calificaciones, asistencia y reportes</li>
              <li className="flex items-start gap-2 text-muted"><Timer size={16} className="text-slate-400 flex-shrink-0 mt-0.5" /> Solo durante el periodo de prueba</li>
            </ul>
          </div>

          {/* ── Paid plans ── */}
          {paidPlans.length === 0 ? (
            <div className="rounded-card border border-accent/40 bg-accent-light/40 p-5 flex flex-col items-center justify-center text-center">
              <Sparkles size={22} className="text-accent mb-2" />
              <p className="font-semibold text-on-surface">Planes próximamente</p>
              <p className="text-sm text-muted mt-1">Aún estamos definiendo los planes de paga. Te avisaremos antes de que termine tu prueba.</p>
            </div>
          ) : (
            paidPlans.map((plan) => (
              <div key={plan.id} className="rounded-card border-2 border-accent p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles size={18} className="text-accent" />
                  <h4 className="font-bold text-on-surface">{plan.nombre}</h4>
                </div>
                <p className="text-2xl font-bold text-on-surface mt-2">
                  {formatCurrency(plan.precio)}
                  <span className="text-sm font-normal text-muted">/{plan.periodicidad === 'anual' ? 'año' : 'mes'}</span>
                </p>
                {plan.descripcion && <p className="text-xs text-muted mb-4">{plan.descripcion}</p>}
                <ul className="space-y-2 text-sm text-on-surface flex-1 mt-2">
                  <li className="flex items-start gap-2"><Check size={16} className="text-emerald-500 flex-shrink-0 mt-0.5" /> {limitLabel(plan.maxAsignaturas)} asignaturas</li>
                  <li className="flex items-start gap-2"><Check size={16} className="text-emerald-500 flex-shrink-0 mt-0.5" /> {limitLabel(plan.maxAlumnos)} alumnos</li>
                  <li className="flex items-start gap-2"><Check size={16} className="text-emerald-500 flex-shrink-0 mt-0.5" /> Todas las funciones, sin límite de tiempo</li>
                </ul>
                <button
                  type="button"
                  onClick={goToPlans}
                  className="mt-5 w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors"
                >
                  Elegir {plan.nombre}
                </button>
              </div>
            ))
          )}
        </div>

        <button
          type="button"
          onClick={goToPlans}
          className="mt-5 w-full py-2.5 border border-outline-variant rounded text-sm font-medium text-muted hover:bg-surface transition-colors"
        >
          Ver detalles y administrar mi plan
        </button>
      </div>
    </div>
  )
}
