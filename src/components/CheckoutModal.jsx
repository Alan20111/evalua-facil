import { useState, useEffect, useRef } from 'react'
import { collection, doc, addDoc, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { X, Wallet, Landmark, Loader2 } from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import Spinner from './Spinner'
import { usePaymentConfig } from '../hooks/usePaymentConfig'
import { useBackHandler } from '../hooks/useBackHandler'
import { useScrollLock } from '../hooks/useScrollLock'
import {
  MONTHLY_PLAN_ID,
  MONTHLY_PRICE_MXN,
  SUBSCRIPTION_NAME,
  calcDaysRemaining,
  calcVencimiento,
  effectiveVencimiento,
  formatCurrency,
  formatDate,
} from '../utils/subscriptionHelpers'
import { apiUrl } from '../utils/apiBase'
import { isAppOutdated } from '../utils/checkAppVersion'

const inputCls =
  'w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface'

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

export default function CheckoutModal({ open, onClose, subscription, onSuccess }) {
  const { currentUser, userProfile } = useAuth()
  const toast = useToast()
  const { config, loading: configLoading } = usePaymentConfig()

  const [method, setMethod] = useState(null)
  const [referencia, setReferencia] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const paypalRef = useRef(null)

  useBackHandler(onClose, open)
  useScrollLock(open)

  // Dinero de por medio: si esta pestaña se quedó con una versión vieja del
  // bundle (ver UpdateChecker.jsx — SPA que nunca vuelve a descargar el JS
  // sola), aquí no basta con un banner descartable. Se recarga sola al abrir
  // el modal de pago, antes de mostrar nada, para que el cálculo de fechas y
  // montos que ve el docente sea siempre el del código más reciente.
  useEffect(() => {
    if (!open) return
    isAppOutdated().then((outdated) => { if (outdated) window.location.reload() })
  }, [open])

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
    planId: MONTHLY_PLAN_ID,
    escuelaId: userProfile?.escuelaId || '',
    schoolName: userProfile?.schoolName || '',
  })

  // ── Mercado Pago: create a recurring subscription (preapproval), then
  // redirect to MP's hosted checkout. MP charges the card automatically
  // every month after this — no manual renewal needed. ──
  async function payWithMercadoPago() {
    setSubmitting(true)
    try {
      const res = await fetch(apiUrl('/api/mp/create-subscription'), {
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
    if (!open || method !== 'paypal' || !config?.paypal?.clientId) return
    let cancelled = false

    loadPaypalSdk(config.paypal.clientId)
      .then((paypal) => {
        if (cancelled || !paypalRef.current) return
        paypalRef.current.innerHTML = ''
        paypal
          .Buttons({
            style: { layout: 'vertical', color: 'blue', shape: 'pill', label: 'pay' },
            createOrder: async () => {
              const res = await fetch(apiUrl('/api/paypal/create-order'), {
                method: 'POST',
                headers: await authHeader(),
                body: JSON.stringify(planPayload()),
              })
              const data = await res.json()
              if (!res.ok || !data.orderId) throw new Error(data.error || 'Error PayPal')
              return data.orderId
            },
            onApprove: async (data) => {
              const res = await fetch(apiUrl('/api/paypal/capture-order'), {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps
  }, [open, method, config?.paypal?.clientId])

  // ── Bank transfer: manual, creates a pending payment for admin approval ──
  async function submitTransfer(e) {
    e.preventDefault()
    if (!referencia.trim()) {
      return toast('Ingresa la referencia', 'error')
    }
    setSubmitting(true)
    try {
      // Un solo batch: si algo falla a medio camino, NINGUNO de los dos
      // escritos se aplica. Antes eran dos escrituras independientes — una
      // falla entre la primera y la segunda dejaba al docente marcado
      // "pendiente_pago" (su pantalla decía "en revisión") sin que existiera
      // el doc en `payments` que el panel de admin sí revisa, un pago
      // huérfano invisible para ambos lados.
      const batch = writeBatch(db)
      // Sin `planId` aquí a propósito: en todo el proyecto (admin incluido,
      // ver SubscriptionsTable.jsx) `planId` presente = pago YA aprobado.
      // Ponerlo antes de que el admin apruebe hacía que un intento nunca
      // aprobado se leyera como si sí lo hubiera sido (ver Profile.jsx
      // nuncaAprobado) — el mismo bug de fechas de "Pagaste el X" con una
      // cuenta que nunca pagó. `handleApprove` en PaymentsTable.jsx es quien
      // pone el `planId` real, junto con las fechas reales.
      const subData = {
        docenteId: currentUser.uid,
        escuelaId: userProfile?.escuelaId || '',
        schoolName: userProfile?.schoolName || '',
        status: 'pendiente_pago',
        updatedAt: serverTimestamp(),
      }
      let subscriptionId
      if (subscription?.id) {
        batch.update(doc(db, 'subscriptions', subscription.id), subData)
        subscriptionId = subscription.id
      } else {
        const ref = doc(collection(db, 'subscriptions'))
        batch.set(ref, { ...subData, createdAt: serverTimestamp() })
        subscriptionId = ref.id
      }
      batch.set(doc(collection(db, 'payments')), {
        docenteId: currentUser.uid,
        subscriptionId,
        planId: MONTHLY_PLAN_ID,
        escuelaId: userProfile?.escuelaId || '',
        monto: MONTHLY_PRICE_MXN,
        metodo: 'transferencia',
        referencia: referencia.trim(),
        status: 'pendiente',
        createdAt: serverTimestamp(),
      })
      await batch.commit()
      toast('Pago registrado. Lo aprobamos dentro de las próximas 12 horas.')
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

  // Si aún le quedan días vigentes (de prueba o de un plan pagado previo), lo
  // pagado ahora no los recorta: el periodo que se está pagando arranca
  // cuando esos días se agoten, no desde hoy. Se le muestra siempre el rango
  // exacto que cubre este pago para que quede claro desde antes de pagar.
  const vigenteHasta = effectiveVencimiento(subscription)
  const diasVigentes = calcDaysRemaining(vigenteHasta)
  const tieneDiasVigentes = diasVigentes !== null && diasVigentes > 0
  const inicioPeriodo = tieneDiasVigentes ? vigenteHasta : new Date()
  const finPeriodo = calcVencimiento(inicioPeriodo, 'mensual')

  const t = config?.transferencia
  const methods = [
    config?.mercadoPago?.enabled && { id: 'mercadopago', label: 'Mercado Pago', icon: Wallet },
    config?.paypal?.enabled && { id: 'paypal', label: 'PayPal', icon: Wallet },
    config?.transferencia?.enabled && { id: 'transferencia', label: 'Transferencia', icon: Landmark },
  ].filter(Boolean)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={onClose} aria-label="Cerrar" />
      <div
        className="relative bg-surface-card rounded-card p-5 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-on-surface">Activar suscripción mensual</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-muted">
            <X size={20} />
          </button>
        </div>

        {configLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : methods.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted">
            No hay métodos de pago disponibles por el momento. Contacta al administrador.
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="font-semibold text-on-surface">{SUBSCRIPTION_NAME}</p>
              <p className="text-sm text-muted">{formatCurrency(MONTHLY_PRICE_MXN)}/mes</p>
            </div>

            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2.5">
              {tieneDiasVigentes ? (
                <>
                  Todavía te quedan {diasVigentes} día{diasVigentes === 1 ? '' : 's'} vigentes — no los pierdes.
                  Este pago cubre del <strong>{formatDate(inicioPeriodo)}</strong> al{' '}
                  <strong>{formatDate(finPeriodo)}</strong>.
                </>
              ) : (
                <>
                  Este pago cubre del <strong>{formatDate(inicioPeriodo)}</strong> al{' '}
                  <strong>{formatDate(finPeriodo)}</strong>.
                </>
              )}
            </p>

            {/* Method tabs */}
            <div className="flex gap-2">
              {methods.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-semibold border transition-colors ${
                    method === m.id
                      ? 'bg-accent-light border-accent text-accent'
                      : 'border-outline-variant text-muted hover:bg-[var(--accent-tint)]'
                  }`}
                >
                  <m.icon size={16} />
                  {m.label}
                </button>
              ))}
            </div>

            {/* Method body */}
            {method === 'mercadopago' && (
              <button
                type="button"
                onClick={payWithMercadoPago}
                disabled={submitting}
                className="w-full py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <Wallet size={18} />}
                {submitting ? 'Redirigiendo…' : 'Pagar con Mercado Pago'}
              </button>
            )}

            {method === 'paypal' && (
              <div>
                <div ref={paypalRef} />
                <p className="text-sm text-slate-500 mt-2 text-center">
                  Serás cobrado de forma segura por PayPal.
                </p>
              </div>
            )}

            {method === 'transferencia' && (
              <form onSubmit={submitTransfer} className="space-y-3">
                <div className="bg-surface rounded p-4 text-sm space-y-1.5 border border-outline-variant">
                  <p className="font-semibold text-muted mb-1">Datos para transferencia</p>
                  {t?.banco && <p><span className="text-muted">Banco:</span> {t.banco}</p>}
                  {t?.titular && <p><span className="text-muted">Titular:</span> {t.titular}</p>}
                  {t?.cuenta && <p><span className="text-muted">Cuenta:</span> {t.cuenta}</p>}
                  {t?.clabe && <p><span className="text-muted">CLABE:</span> {t.clabe}</p>}
                  {t?.nota && <p className="text-sm text-slate-500 pt-1">{t.nota}</p>}
                </div>
                <input
                  type="text"
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  required
                  className={inputCls}
                  placeholder="Folio de operación / folio bancario"
                />
                <p className="text-xs text-slate-500 -mt-2">
                  Es el número que te muestra tu banco al confirmar la transferencia — con él lo cotejamos en nuestro estado de cuenta.
                </p>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {submitting ? <Spinner size="sm" /> : null}
                  {submitting ? 'Registrando…' : 'Registrar pago'}
                </button>
                <p className="text-xs text-slate-500 text-center">
                  Lo revisamos y aprobamos dentro de las 12 horas siguientes a tu transferencia.
                </p>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
