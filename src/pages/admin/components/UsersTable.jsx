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
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-900">Docentes</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <th className="px-4 py-3">Usuario</th>
              <th className="px-4 py-3">Correo</th>
              <th className="px-4 py-3">Escuela</th>
              <th className="px-4 py-3">Plan actual</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Último pago</th>
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
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800">
                      {teacher.username || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 truncate max-w-[160px]">
                      {teacher.email || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 truncate max-w-[140px]">
                      {school?.nombre || teacher.schoolName || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {sub?.status === 'trial' ? (
                        <span className="text-xs text-blue-600 font-medium">Trial</span>
                      ) : plan ? (
                        plan.nombre
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
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
                    <td className="px-4 py-3 text-slate-600">
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
