import {
  formatCurrency,
  formatDate,
  getSubscriptionStatusColor,
} from '../../../utils/subscriptionHelpers'

export default function UsersTable({ stats }) {
  if (!stats) return null

  const { teachers, subscriptions, payments, schoolsMap, plans } = stats
  const plansMap = Object.fromEntries(plans.map((p) => [p.id, p]))

  const subsByTeacher = {}
  subscriptions.forEach((s) => {
    const existing = subsByTeacher[s.docenteId]
    if (
      !existing ||
      (s.updatedAt?.toMillis?.() || 0) > (existing.updatedAt?.toMillis?.() || 0)
    ) {
      subsByTeacher[s.docenteId] = s
    }
  })

  const lastPaymentByTeacher = {}
  payments.forEach((p) => {
    const existing = lastPaymentByTeacher[p.docenteId]
    if (
      !existing ||
      (p.createdAt?.toMillis?.() || 0) > (existing.createdAt?.toMillis?.() || 0)
    ) {
      lastPaymentByTeacher[p.docenteId] = p
    }
  })

  const rows = [...teachers].sort((a, b) =>
    (a.username || a.email || '').localeCompare(b.username || b.email || '')
  )

  return (
    <div className="bg-surface-card rounded-card shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-outline-variant">
        <h2 className="font-semibold text-on-surface">Docentes</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="bg-surface text-left text-xs text-muted uppercase">
              <th className="px-4 py-2">Usuario</th>
              <th className="px-4 py-2">Correo</th>
              <th className="px-4 py-2">Escuela</th>
              <th className="px-4 py-2">Plan actual</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2">Último pago</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Sin docentes registrados
                </td>
              </tr>
            ) : (
              rows.map((teacher) => {
                const sub = subsByTeacher[teacher.id]
                const plan = sub ? plansMap[sub.planId] : null
                const lastPayment = lastPaymentByTeacher[teacher.id]
                const school = schoolsMap[teacher.escuelaId]

                return (
                  <tr key={teacher.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2 font-mono text-xs font-semibold text-on-surface">
                      {teacher.username || '—'}
                    </td>
                    <td className="px-4 py-2 text-muted truncate max-w-[160px]">
                      {teacher.email || '—'}
                    </td>
                    <td className="px-4 py-2 text-muted truncate max-w-[140px]">
                      {school?.nombre || teacher.schoolName || '—'}
                    </td>
                    <td className="px-4 py-2">
                      {sub?.status === 'trial' ? (
                        <span className="text-xs text-blue-600 font-medium">Trial</span>
                      ) : plan ? (
                        plan.nombre
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {sub ? (
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getSubscriptionStatusColor(sub.status)}`}
                        >
                          {sub.status?.replace('_', ' ')}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Sin plan</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted">
                      {lastPayment ? (
                        <span>
                          {formatCurrency(lastPayment.monto)} — {formatDate(lastPayment.createdAt)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
