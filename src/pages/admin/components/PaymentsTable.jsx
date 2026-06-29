import { useState } from 'react'
import { doc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { Check, X } from 'lucide-react'
import { db } from '../../../firebase'
import { useToast } from '../../../components/Toast'
import Spinner from '../../../components/Spinner'
import {
  calcVencimientoTimestamp,
  formatCurrency,
  formatDate,
  getPaymentStatusColor,
} from '../../../utils/subscriptionHelpers'

function StatusBadge({ status }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getPaymentStatusColor(status)}`}>
      {status}
    </span>
  )
}

export default function PaymentsTable({ stats, onRefresh }) {
  const toast = useToast()
  const [processing, setProcessing] = useState(null)
  const [rejectModal, setRejectModal] = useState(null)
  const [notasAdmin, setNotasAdmin] = useState('')

  if (!stats) return null

  const { payments, teachers, plans } = stats
  const teachersMap = Object.fromEntries(teachers.map((t) => [t.id, t]))
  const plansMap = Object.fromEntries(plans.map((p) => [p.id, p]))

  const rows = [...payments].sort((a, b) => {
    const ta = a.createdAt?.toMillis?.() || 0
    const tb = b.createdAt?.toMillis?.() || 0
    return tb - ta
  })

  async function handleApprove(payment) {
    setProcessing(payment.id)
    try {
      const plan = plansMap[payment.planId]
      const fechaInicio = new Date()
      const fechaVencimiento = calcVencimientoTimestamp(fechaInicio, plan?.periodicidad || 'mensual')

      await updateDoc(doc(db, 'payments', payment.id), {
        status: 'completado',
        updatedAt: serverTimestamp(),
      })

      if (payment.subscriptionId) {
        await updateDoc(doc(db, 'subscriptions', payment.subscriptionId), {
          status: 'activa',
          planId: payment.planId,
          fechaInicio: Timestamp.fromDate(fechaInicio),
          fechaVencimiento,
          updatedAt: serverTimestamp(),
        })
      }

      toast('Pago aprobado y suscripción activada')
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setProcessing(null)
    }
  }

  async function handleReject() {
    if (!rejectModal) return
    setProcessing(rejectModal.id)
    try {
      await updateDoc(doc(db, 'payments', rejectModal.id), {
        status: 'rechazado',
        notasAdmin: notasAdmin.trim(),
        updatedAt: serverTimestamp(),
      })
      toast('Pago rechazado')
      setRejectModal(null)
      setNotasAdmin('')
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setProcessing(null)
    }
  }

  return (
    <div className="bg-surface-card rounded-card shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-outline-variant">
        <h2 className="font-semibold text-on-surface">Pagos</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="bg-surface text-left text-xs text-muted uppercase">
              <th className="px-4 py-2">Docente</th>
              <th className="px-4 py-2">Monto</th>
              <th className="px-4 py-2">Referencia</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Sin pagos registrados
                </td>
              </tr>
            ) : (
              rows.map((payment) => {
                const teacher = teachersMap[payment.docenteId]
                return (
                  <tr key={payment.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2">
                      <p className="font-medium text-on-surface">
                        {teacher?.username || teacher?.email || '—'}
                      </p>
                    </td>
                    <td className="px-4 py-2 font-semibold">{formatCurrency(payment.monto)}</td>
                    <td className="px-4 py-2 font-mono text-xs">{payment.referencia || '—'}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={payment.status} />
                    </td>
                    <td className="px-4 py-2 text-muted">{formatDate(payment.createdAt)}</td>
                    <td className="px-4 py-2">
                      {payment.status === 'pendiente' && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleApprove(payment)}
                            disabled={processing === payment.id}
                            className="flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold hover:bg-emerald-200 disabled:opacity-60"
                          >
                            {processing === payment.id ? <Spinner size="sm" /> : <Check size={14} />}
                            Aprobar
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectModal(payment)}
                            disabled={processing === payment.id}
                            className="flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-semibold hover:bg-red-200 disabled:opacity-60"
                          >
                            <X size={14} /> Rechazar
                          </button>
                        </div>
                      )}
                      {payment.notasAdmin && (
                        <p className="text-xs text-slate-400 mt-1">{payment.notasAdmin}</p>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {rejectModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
          <div className="bg-surface-card rounded-card p-5 w-[calc(100%-2rem)] max-w-sm shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-on-surface mb-2">Rechazar pago</h3>
            <p className="text-sm text-muted mb-3">
              Referencia: {rejectModal.referencia} — {formatCurrency(rejectModal.monto)}
            </p>
            <textarea
              value={notasAdmin}
              onChange={(e) => setNotasAdmin(e.target.value)}
              placeholder="Notas para el docente (opcional)"
              className="w-full px-3 py-2 rounded border border-outline-variant text-sm mb-3 h-20 resize-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setRejectModal(null)
                  setNotasAdmin('')
                }}
                className="flex-1 py-2 border border-outline-variant rounded text-sm font-semibold text-muted"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={!!processing}
                className="flex-1 py-2 bg-red-600 text-white rounded text-sm font-semibold disabled:opacity-60"
              >
                Rechazar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
