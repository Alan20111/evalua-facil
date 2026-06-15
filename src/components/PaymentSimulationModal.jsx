import { useState } from 'react'
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { X } from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import Spinner from './Spinner'
import { BANK_TRANSFER } from '../config/billing'
import { formatCurrency } from '../utils/subscriptionHelpers'

const inputCls =
  'w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50'

export default function PaymentSimulationModal({
  open,
  onClose,
  plans,
  subscription,
  onSuccess,
}) {
  const { currentUser, userProfile } = useAuth()
  const toast = useToast()
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0]?.id || '')
  const [referencia, setReferencia] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  const selectedPlan = plans.find((p) => p.id === selectedPlanId)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!selectedPlanId || !referencia.trim()) {
      toast('Selecciona un plan e ingresa la referencia', 'error')
      return
    }
    setSubmitting(true)
    try {
      const subData = {
        docenteId: currentUser.uid,
        planId: selectedPlanId,
        escuelaId: userProfile?.escuelaId || '',
        schoolName: userProfile?.schoolName || '',
        status: 'pendiente_pago',
        updatedAt: serverTimestamp(),
      }

      let subscriptionId
      if (subscription?.id) {
        await updateDoc(doc(db, 'subscriptions', subscription.id), subData)
        subscriptionId = subscription.id
      } else {
        const ref = await addDoc(collection(db, 'subscriptions'), {
          ...subData,
          createdAt: serverTimestamp(),
        })
        subscriptionId = ref.id
      }

      await addDoc(collection(db, 'payments'), {
        docenteId: currentUser.uid,
        subscriptionId,
        planId: selectedPlanId,
        escuelaId: userProfile?.escuelaId || '',
        monto: selectedPlan?.precio || 0,
        metodo: 'transferencia',
        referencia: referencia.trim(),
        status: 'pendiente',
        createdAt: serverTimestamp(),
      })

      toast('Pago registrado. Espera la confirmación del administrador.')
      setReferencia('')
      onSuccess?.()
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-slate-900">Registrar pago</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Plan</label>
            <select
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value)}
              required
              className={inputCls}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} — {formatCurrency(p.precio)}/{p.periodicidad === 'anual' ? 'año' : 'mes'}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-slate-50 rounded-xl p-4 text-sm space-y-2 border border-slate-100">
            <p className="font-semibold text-slate-700">Datos para transferencia</p>
            <p><span className="text-slate-500">Banco:</span> {BANK_TRANSFER.banco}</p>
            <p><span className="text-slate-500">Titular:</span> {BANK_TRANSFER.titular}</p>
            <p><span className="text-slate-500">Cuenta:</span> {BANK_TRANSFER.cuenta}</p>
            <p><span className="text-slate-500">CLABE:</span> {BANK_TRANSFER.clabe}</p>
            <p className="text-xs text-slate-400 pt-1">{BANK_TRANSFER.nota}</p>
          </div>

          {selectedPlan && (
            <p className="text-sm font-semibold text-slate-800">
              Monto a transferir: {formatCurrency(selectedPlan.precio)}
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Referencia / folio bancario
            </label>
            <input
              type="text"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              required
              className={inputCls}
              placeholder="Ej. 1234567890"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {submitting ? <Spinner size="sm" /> : null}
            {submitting ? 'Registrando…' : 'Registrar pago'}
          </button>
        </form>
      </div>
    </div>
  )
}
