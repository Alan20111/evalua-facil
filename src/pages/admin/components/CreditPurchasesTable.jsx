// Consulta y trazabilidad básica de compras de créditos adicionales
// (18-ago-2026) — a propósito SIN gráficas/estadísticas/reportes/análisis de
// ventas: solo la lista con lo que pidió el alcance (docente, fecha,
// créditos, importe, estado, id de transacción) y aprobar/rechazar.
//
// Aprobar NUNCA escribe el saldo desde aquí — `iaCreditos` es allow write: if
// false para todo cliente (admin incluido). Llama al callable
// `aprobarCompraCreditos`, que relee el doc en una transacción del lado del
// servidor (creditosLedger.acreditarCompraCreditos) y es idempotente: una
// segunda aprobación del mismo id no vuelve a sumar créditos.
import { useState } from 'react'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { Check, X } from 'lucide-react'
import { db, functions } from '../../../firebase'
import { useToast } from '../../../components/Toast'
import Spinner from '../../../components/Spinner'
import Table from '../../../components/ui/Table'
import { formatCurrency, formatDateTime, getPaymentStatusColor, getPaymentStatusLabel } from '../../../utils/subscriptionHelpers'

function StatusBadge({ status }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getPaymentStatusColor(status)}`}>
      {getPaymentStatusLabel(status)}
    </span>
  )
}

export default function CreditPurchasesTable({ stats, onRefresh }) {
  const toast = useToast()
  const [processing, setProcessing] = useState(null)

  if (!stats) return null
  const { creditPurchases, teachers } = stats
  const teachersMap = Object.fromEntries(teachers.map((t) => [t.id, t]))

  const rows = [...(creditPurchases || [])].sort((a, b) => {
    const ta = a.createdAt?.toMillis?.() || 0
    const tb = b.createdAt?.toMillis?.() || 0
    return tb - ta
  })

  async function handleApprove(purchase) {
    if (!confirm(`¿Confirmas que esta transferencia por ${formatCurrency(purchase.montoMXN)} fue recibida y quieres acreditar ${purchase.creditos} créditos?`)) return
    setProcessing(purchase.id)
    try {
      const llamar = httpsCallable(functions, 'aprobarCompraCreditos')
      await llamar({ purchaseId: purchase.id })
      toast(`Compra aprobada — se acreditaron ${purchase.creditos} créditos`)
      onRefresh?.()
    } catch (err) {
      toast(err?.message || 'No se pudo aprobar la compra', 'error')
    } finally {
      setProcessing(null)
    }
  }

  async function handleReject(purchase) {
    if (!confirm('¿Rechazar esta compra de créditos?')) return
    setProcessing(purchase.id)
    try {
      await updateDoc(doc(db, 'creditPurchases', purchase.id), {
        status: 'rechazado',
        resueltoEn: serverTimestamp(),
      })
      toast('Compra rechazada')
      onRefresh?.()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setProcessing(null)
    }
  }

  const columns = [
    {
      key: 'docente',
      header: 'Docente',
      render: (p) => teachersMap[p.docenteId]?.email || p.docenteId,
      className: 'truncate max-w-xs',
    },
    {
      key: 'creditos',
      header: 'Créditos',
      render: (p) => <span className="font-semibold tabular-nums">{p.creditos?.toLocaleString('es-MX')}</span>,
    },
    { key: 'monto', header: 'Importe', render: (p) => <span className="tabular-nums">{formatCurrency(p.montoMXN)}</span> },
    { key: 'folio', header: 'Folio', render: (p) => <span className="font-mono text-xs text-muted">{p.referencia || '—'}</span> },
    { key: 'estado', header: 'Estado', render: (p) => <StatusBadge status={p.status} /> },
    { key: 'fecha', header: 'Fecha', render: (p) => <span className="text-muted whitespace-nowrap">{formatDateTime(p.createdAt)}</span> },
    { key: 'id', header: 'Id', render: (p) => <span className="font-mono text-xs text-slate-400">{p.id}</span> },
    {
      key: 'acciones',
      header: 'Acciones',
      render: (p) =>
        p.status === 'pendiente' && (
          <div className="flex items-center gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => handleApprove(p)}
              disabled={processing === p.id}
              className="flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold hover:bg-emerald-200 disabled:opacity-60"
            >
              {processing === p.id ? <Spinner size="sm" /> : <Check size={14} />}
              Aprobar
            </button>
            <button
              type="button"
              onClick={() => handleReject(p)}
              disabled={processing === p.id}
              className="flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-semibold hover:bg-red-200 disabled:opacity-60"
            >
              <X size={14} /> Rechazar
            </button>
          </div>
        ),
    },
  ]

  return (
    <div>
      <div className="px-1 pb-3">
        <h2 className="font-semibold text-on-surface">Créditos adicionales</h2>
        <p className="text-xs text-muted mt-0.5">
          Compras de créditos adicionales — distintas de los créditos incluidos en la suscripción mensual.
        </p>
      </div>
      <Table columns={columns} data={rows} rowKey={(p) => p.id} emptyMessage="Sin compras registradas" />
    </div>
  )
}
