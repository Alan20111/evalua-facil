import { useState, useEffect, useRef } from 'react'
import { collection, doc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { X, Wallet, Landmark, Loader2 } from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import Spinner from './Spinner'
import { usePaymentConfig } from '../hooks/usePaymentConfig'
import { formatCurrency } from '../utils/subscriptionHelpers'

const inputCls =
  'w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50'

function loadPaypalSdk(clientId) {
  return new Promise((resolve, reject) => {
    if (window.paypal) return resolve(window.paypal)
    const existing = document.getElementById('paypal-sdk')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.paypal))
      existing.addEventListener('error', reject)
      return
    }
    const s = document.createElement('script')
    s.id = 'paypal-sdk'
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=MXN`
    s.onload = () => resolve(window.paypal)
    s.onerror = reject
    document.body.appendChild(s)
  })
}

export default function CheckoutModal({ open, onClose, plans, subscription, onSuccess }) {
  const { currentUser, userProfile } = useAuth()
  const toast = useToast()
  const { config, loading: configLoading } = usePaymentConfig()

  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [method, setMethod] = useState(null)
  const [referencia, setReferencia] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const paypalRef = useRef(null)

  const selectedPlan = plans.find((p) => p.id === selectedPlanId)

  // Default selected plan.
  useEffect(() => {
    if (open && !selectedPlanId && plans.length) setSelectedPlanId(plans[0].id)
  }, [open, plans, selectedPlanId])

  // Default method = first enabled one.
  useEffect(() => {
    if (!config || method) return
    if (config.mercadoPago?.enabled) setMethod('mercadopago')
    else if (config.paypal?.enabled) setMethod('paypal')
    else if (config.transferencia?.enabled) setMethod('transferencia')
  }, [config, method])

  async function authHeader() {
    const token = await currentUser.getIdToken()
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  }

  const planPayload = () => ({
    planId: selectedPlanId,
    escuelaId: userProfile?.escuelaId || '',
    schoolName: userProfile?.schoolName || '',
  })

  // ── Mercado Pago: create preference then redirect to checkout ──
  async function payWithMercadoPago() {
    if (!selectedPlanId) return toast('Selecciona un plan', 'error')
    setSubmitting(true)
    try {
      const res = await fetch('/api/mp/create-preference', {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify(planPayload()),
      })
      const data = await res.json()
      if (!res.ok || !data.init_point) {
        throw new Error(data.error || 'No se pudo iniciar el pago')
      }
      window.location.href = data.init_point
    } catch (err) {
      toast('Error: ' + err.message, 'error')
      setSubmitting(false)
    }
  }

  // ── PayPal: render SDK buttons ──
  useEffect(() => {
    if (!open || method !== 'paypal' || !config?.paypal?.clientId || !selectedPlanId) return
    let cancelled = false

    loadPaypalSdk(config.paypal.clientId)
      .then((paypal) => {
        if (cancelled || !paypalRef.current) return
        paypalRef.current.innerHTML = ''
        paypal
          .Buttons({
            style: { layout: 'vertical', color: 'blue', shape: 'pill', label: 'pay' },
            createOrder: async () => {
              const res = await fetch('/api/paypal/create-order', {
                method: 'POST',
                headers: await authHeader(),
                body: JSON.stringify(planPayload()),
              })
              const data = await res.json()
              if (!res.ok || !data.orderId) throw new Error(data.error || 'Error PayPal')
              return data.orderId
            },
            onApprove: async (data) => {
              const res = await fetch('/api/paypal/capture-order', {
                method: 'POST',
                headers: await authHeader(),
                body: JSON.stringify({ orderId: data.orderID }),
              })
              const d = await res.json()
              if (res.ok && d.ok) {
                toast('¡Pago completado! Tu suscripción está activa.')
                onSuccess?.()
                onClose()
              } else {
                toast('No se pudo confirmar el pago', 'error')
              }
            },
            onError: () => toast('Error al procesar con PayPal', 'error'),
          })
          .render(paypalRef.current)
      })
      .catch(() => toast('No se pudo cargar PayPal', 'error'))

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, method, config?.paypal?.clientId, selectedPlanId])

  // ── Bank transfer: manual, creates a pending payment for admin approval ──
  async function submitTransfer(e) {
    e.preventDefault()
    if (!selectedPlanId || !referencia.trim()) {
      return toast('Selecciona un plan e ingresa la referencia', 'error')
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

  if (!open) return null

  const t = config?.transferencia
  const methods = [
    config?.mercadoPago?.enabled && { id: 'mercadopago', label: 'Mercado Pago', icon: Wallet },
    config?.paypal?.enabled && { id: 'paypal', label: 'PayPal', icon: Wallet },
    config?.transferencia?.enabled && { id: 'transferencia', label: 'Transferencia', icon: Landmark },
  ].filter(Boolean)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-slate-900">Contratar plan</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {configLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : methods.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-500">
            No hay métodos de pago disponibles por el momento. Contacta al administrador.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Plan selector */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Plan</label>
              <select
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
                className={inputCls}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} — {formatCurrency(p.precio)}/{p.periodicidad === 'anual' ? 'año' : 'mes'}
                  </option>
                ))}
              </select>
            </div>

            {/* Method tabs */}
            <div className="flex gap-2">
              {methods.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                    method === m.id
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <m.icon size={14} />
                  {m.label}
                </button>
              ))}
            </div>

            {selectedPlan && (
              <p className="text-sm font-semibold text-slate-800">
                Total: {formatCurrency(selectedPlan.precio)}
              </p>
            )}

            {/* Method body */}
            {method === 'mercadopago' && (
              <button
                type="button"
                onClick={payWithMercadoPago}
                disabled={submitting}
                className="w-full py-3 bg-sky-500 hover:bg-sky-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />}
                {submitting ? 'Redirigiendo…' : 'Pagar con Mercado Pago'}
              </button>
            )}

            {method === 'paypal' && (
              <div>
                <div ref={paypalRef} />
                <p className="text-xs text-slate-400 mt-2 text-center">
                  Serás cobrado de forma segura por PayPal.
                </p>
              </div>
            )}

            {method === 'transferencia' && (
              <form onSubmit={submitTransfer} className="space-y-3">
                <div className="bg-slate-50 rounded-xl p-4 text-sm space-y-1.5 border border-slate-100">
                  <p className="font-semibold text-slate-700 mb-1">Datos para transferencia</p>
                  {t?.banco && <p><span className="text-slate-500">Banco:</span> {t.banco}</p>}
                  {t?.titular && <p><span className="text-slate-500">Titular:</span> {t.titular}</p>}
                  {t?.cuenta && <p><span className="text-slate-500">Cuenta:</span> {t.cuenta}</p>}
                  {t?.clabe && <p><span className="text-slate-500">CLABE:</span> {t.clabe}</p>}
                  {t?.nota && <p className="text-xs text-slate-400 pt-1">{t.nota}</p>}
                </div>
                <input
                  type="text"
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  required
                  className={inputCls}
                  placeholder="Referencia / folio bancario"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {submitting ? <Spinner size="sm" /> : null}
                  {submitting ? 'Registrando…' : 'Registrar pago'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
