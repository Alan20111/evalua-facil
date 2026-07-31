import { useState } from 'react'
import { doc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { Check, X, RefreshCw, Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { db } from '../../../firebase'
import { useToast } from '../../../components/Toast'
import Spinner from '../../../components/Spinner'
import { useBackHandler } from '../../../hooks/useBackHandler'
import { useScrollLock } from '../../../hooks/useScrollLock'
import {
  calcVencimientoTimestamp,
  formatCurrency,
  formatDateTime,
  getPaymentStatusColor,
} from '../../../utils/subscriptionHelpers'

function StatusBadge({ status }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getPaymentStatusColor(status)}`}>
      {status}
    </span>
  )
}

const METODO_LABELS = {
  mercadopago: 'Mercado Pago',
  paypal: 'PayPal',
  transferencia: 'Transferencia',
}

// Comentario editable de la transacción — solo escribe al perder el foco y
// si cambió, para no disparar un update por cada tecla.
function ComentarioCell({ payment, onSaved }) {
  const toast = useToast()
  const [value, setValue] = useState(payment.comentarios || '')

  async function handleBlur() {
    if (value === (payment.comentarios || '')) return
    try {
      await updateDoc(doc(db, 'payments', payment.id), { comentarios: value.trim() })
      toast('Comentario guardado')
      onSaved?.()
    } catch (err) {
      toast('Error al guardar el comentario: ' + err.message, 'error')
    }
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      placeholder="—"
      className="w-full min-w-[140px] px-2 py-1 rounded border border-transparent bg-transparent text-sm hover:border-outline-variant focus:border-accent focus:bg-surface focus:outline-none"
    />
  )
}

export default function PaymentsTable({ stats, onRefresh }) {
  const toast = useToast()
  const [processing, setProcessing] = useState(null)
  const [rejectModal, setRejectModal] = useState(null)
  const [notasAdmin, setNotasAdmin] = useState('')
  const [soloArchivadas, setSoloArchivadas] = useState(false)
  const [deleteArchivado, setDeleteArchivado] = useState(null)

  function closeRejectModal() {
    setRejectModal(null)
    setNotasAdmin('')
  }

  useBackHandler(() => {
    if (deleteArchivado) setDeleteArchivado(null)
    else closeRejectModal()
  }, !!rejectModal || !!deleteArchivado)
  useScrollLock(!!rejectModal || !!deleteArchivado)

  if (!stats) return null

  const { payments, teachers, plans, subscriptions } = stats
  const teachersMap = Object.fromEntries(teachers.map((t) => [t.id, t]))
  const plansMap = Object.fromEntries(plans.map((p) => [p.id, p]))
  const subscriptionsMap = Object.fromEntries((subscriptions || []).map((s) => [s.id, s]))

  // Número de transacción — folio fijo y legible (a diferencia del id de
  // Firestore), asignado por orden cronológico de creación sobre TODOS los
  // pagos (archivados incluidos) para que nunca cambie al archivar/restaurar.
  const porAntiguedad = [...payments].sort((a, b) => {
    const ta = a.createdAt?.toMillis?.() || 0
    const tb = b.createdAt?.toMillis?.() || 0
    return ta - tb
  })
  const numeroPorId = Object.fromEntries(porAntiguedad.map((p, i) => [p.id, i + 1]))

  const todas = [...payments].sort((a, b) => {
    const ta = a.createdAt?.toMillis?.() || 0
    const tb = b.createdAt?.toMillis?.() || 0
    return tb - ta
  })
  const archivadas = todas.filter((p) => p.archivado)
  // Archivar se comporta como "mover", no como etiqueta: en cuanto una
  // transacción se archiva, deja de aparecer en "Pagos" — mismo criterio que
  // "Guardado" en Avisos.
  const rows = soloArchivadas ? archivadas : todas.filter((p) => !p.archivado)

  async function handleArchivar(payment) {
    try {
      await updateDoc(doc(db, 'payments', payment.id), { archivado: true })
      toast('Transacción archivada')
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function handleRestaurar(payment) {
    try {
      await updateDoc(doc(db, 'payments', payment.id), { archivado: false })
      toast('Transacción restaurada a Pagos')
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function handleEliminarDefinitivo() {
    if (!deleteArchivado) return
    try {
      await deleteDoc(doc(db, 'payments', deleteArchivado.id))
      toast('Transacción eliminada definitivamente')
      setDeleteArchivado(null)
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function handleApprove(payment) {
    if (!confirm('¿Confirmas que este pago fue recibido y quieres activar la suscripción?')) return
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
      <div className="px-5 py-3 border-b border-outline-variant space-y-2">
        <h2 className="font-semibold text-on-surface">Pagos</h2>
        {/* Pagos / Archivadas — mismo patrón que Todos / Guardados en Avisos */}
        <div className="flex gap-1 bg-surface-container p-1 rounded w-fit">
          <button type="button" onClick={() => setSoloArchivadas(false)}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${!soloArchivadas ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'}`}>
            Pagos
          </button>
          <button type="button" onClick={() => setSoloArchivadas(true)}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${soloArchivadas ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'}`}>
            <Archive size={13} /> Archivadas{archivadas.length > 0 ? ` (${archivadas.length})` : ''}
          </button>
        </div>
      </div>

      {/* Scroll propio — pedido explícito: la lista no debe empujar el resto
          del panel hacia abajo conforme crezca (mismo criterio que la caja
          de historial en Avisos). */}
      <div className="overflow-x-auto overflow-y-auto max-h-[60vh]">
        <table className="w-full text-sm min-w-[880px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-surface text-left text-xs text-muted uppercase">
              <th className="px-4 py-2">Transacción</th>
              <th className="px-4 py-2">Correo</th>
              <th className="px-4 py-2">Monto</th>
              <th className="px-4 py-2">Medio</th>
              <th className="px-4 py-2">Referencia</th>
              <th className="px-4 py-2">Situación</th>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Comentarios</th>
              <th className="px-4 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  {soloArchivadas ? 'No hay transacciones archivadas' : 'Sin pagos registrados'}
                </td>
              </tr>
            ) : (
              rows.map((payment) => {
                const teacher = teachersMap[payment.docenteId]
                const subscription = subscriptionsMap[payment.subscriptionId]
                const domiciliado = payment.metodo === 'mercadopago' && !!subscription?.mpPreapprovalId
                return (
                  <tr key={payment.id} className="hover:bg-[var(--accent-tint)]">
                    <td className="px-4 py-2 font-mono text-xs text-muted">#{numeroPorId[payment.id]}</td>
                    <td className="px-4 py-2">
                      <p className="font-medium text-on-surface">
                        {teacher?.email || '—'}
                      </p>
                    </td>
                    <td className="px-4 py-2 font-semibold">{formatCurrency(payment.monto)}</td>
                    <td className="px-4 py-2">
                      <p className="text-sm">{METODO_LABELS[payment.metodo] || payment.metodo || '—'}</p>
                      {domiciliado && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-semibold mt-0.5">
                          <RefreshCw size={11} /> Domiciliado
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{payment.referencia || '—'}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={payment.status} />
                    </td>
                    <td className="px-4 py-2 text-muted">{formatDateTime(payment.createdAt)}</td>
                    <td className="px-4 py-2">
                      <ComentarioCell key={`${payment.id}:${payment.comentarios || ''}`} payment={payment} onSaved={onRefresh} />
                    </td>
                    <td className="px-4 py-2">
                      {soloArchivadas ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleRestaurar(payment)}
                            data-tooltip="Restaurar a Pagos"
                            className="flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold hover:bg-emerald-200"
                          >
                            <ArchiveRestore size={13} /> Restaurar
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteArchivado(payment)}
                            data-tooltip="Eliminar definitivamente"
                            className="flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-semibold hover:bg-red-200"
                          >
                            <Trash2 size={13} /> Eliminar
                          </button>
                        </div>
                      ) : (
                        <>
                          {payment.status === 'pendiente' && (
                            <div className="flex items-center gap-1 mb-1">
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
                          <button
                            type="button"
                            onClick={() => handleArchivar(payment)}
                            data-tooltip="Archivar"
                            className="flex items-center gap-1 px-2 py-1 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded text-xs font-medium transition-colors"
                          >
                            <Archive size={13} /> Archivar
                          </button>
                        </>
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
                onClick={closeRejectModal}
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

      {/* ── Confirmación de borrado definitivo ── */}
      {deleteArchivado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setDeleteArchivado(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-lg font-semibold mb-2">¿Eliminar esta transacción?</h3>
            <p className="text-sm text-muted mb-4">
              Se borrará permanentemente el registro #{numeroPorId[deleteArchivado.id]}. Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteArchivado(null)}
                className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={handleEliminarDefinitivo}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 transition-colors">
                Eliminar definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
