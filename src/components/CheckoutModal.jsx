import { useState, useEffect, useRef } from 'react'
import { collection, doc, addDoc, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { X, Wallet, Landmark } from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import Spinner from './Spinner'
import { usePaymentConfig } from '../hooks/usePaymentConfig'
import { useBackHandler } from '../hooks/useBackHandler'
import { useScrollLock } from '../hooks/useScrollLock'
import {
  ANNUAL_PLAN_ID,
  ANNUAL_PRICE_MXN,
  ANNUAL_SAVINGS_MXN,
  ANNUAL_SUBSCRIPTION_NAME,
  LAUNCH_PRICE_NOTE,
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

// Los dos planes que existen — nada de esto se lee de Firestore aquí; el
// precio que de verdad cobra cada pasarela sale del doc `plans/{id}` en el
// servidor (ver api/_lib/billing.js getPlan), esto es solo para mostrar.
const PLAN_INFO = {
  [MONTHLY_PLAN_ID]: { nombre: SUBSCRIPTION_NAME, precio: MONTHLY_PRICE_MXN, periodicidad: 'mensual', unidad: 'mes' },
  [ANNUAL_PLAN_ID]: { nombre: ANNUAL_SUBSCRIPTION_NAME, precio: ANNUAL_PRICE_MXN, periodicidad: 'anual', unidad: 'año' },
}

function loadMpSdk() {
  return new Promise((resolve, reject) => {
    if (window.MercadoPago) return resolve(window.MercadoPago)
    const existing = document.getElementById('mp-sdk')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.MercadoPago))
      existing.addEventListener('error', reject)
      return
    }
    const s = document.createElement('script')
    s.id = 'mp-sdk'
    s.src = 'https://sdk.mercadopago.com/js/v2'
    s.onload = () => resolve(window.MercadoPago)
    s.onerror = reject
    document.body.appendChild(s)
  })
}

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
  const [selectedPlanId, setSelectedPlanId] = useState(MONTHLY_PLAN_ID)
  const [referencia, setReferencia] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const paypalRef = useRef(null)
  const mpBrickRef = useRef(null)
  const mpBrickControllerRef = useRef(null)
  const mpBrickGenerationRef = useRef(0)
  const selectedPlan = PLAN_INFO[selectedPlanId]

  useBackHandler(onClose, open)
  useScrollLock(open)

  // Este modal nunca se desmonta — Profile.jsx lo renderiza siempre y solo
  // alterna `open` (aquí abajo hace `if (!open) return null`), así que su
  // estado interno sobrevive a cerrarlo y volverlo a abrir. Sin esto,
  // cerrar el modal a medio "Redirigiendo…"/"Registrando…" y volver a
  // abrirlo lo dejaba trabado en ese mismo estado para siempre.
  useEffect(() => {
    if (open) setSubmitting(false)
  }, [open])

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
    planId: selectedPlanId,
    escuelaId: userProfile?.escuelaId || '',
    schoolName: userProfile?.schoolName || '',
  })

  // ── Mercado Pago: tarjeta embebida (Card Payment Brick) ──
  // Pedido explícito: el pago debe quedar en la misma pantalla, sin salir de
  // la app ni del sitio — se abandonó Checkout Pro (redirección) por esto.
  // El Brick tokeniza la tarjeta aquí mismo; el token se manda al backend,
  // que cobra directo contra la API de Mercado Pago sin abrir ninguna otra
  // página.
  // Mensual: domiciliación (preapproval) autorizada con el token de tarjeta
  // — MP cobra la misma tarjeta cada mes desde entonces, sin renovación
  // manual.
  // Anual: pago único directo contra la API de Pagos — se cobran los $990
  // una sola vez; el docente decide si renueva el año que sigue. Nada de
  // domiciliar un cobro anual: la API de cobros recurrentes de Mercado Pago
  // no confirma soportar un ciclo de 12 meses, así que no vale la pena el
  // riesgo.
  async function processMpAnnualPayment(cardFormData) {
    const res = await fetch(apiUrl('/api/mp/process-payment'), {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({ ...planPayload(), ...cardFormData }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'No se pudo procesar el pago')
    return data
  }

  async function authorizeMpSubscription(cardFormData) {
    const res = await fetch(apiUrl('/api/mp/create-subscription'), {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({ ...planPayload(), ...cardFormData }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'No se pudo activar la suscripción')
    return data
  }

  useEffect(() => {
    if (!open || method !== 'mercadopago' || !config?.mercadoPago?.publicKey) return
    // Contador de "intento vigente" en vez de un simple booleano `cancelled`:
    // si este efecto se dispara dos veces seguidas (StrictMode en desarrollo,
    // o cualquier re-render que reordene `open`/`method`/`selectedPlanId`
    // antes de que el SDK termine de cargar) sin esto DOS Bricks intentaban
    // crearse sobre el mismo contenedor — el segundo pisaba al primero a
    // medio cargar y el formulario se quedaba trabado en su esqueleto de
    // carga para siempre, sin disparar onError ni ningún log. Cada intento
    // se marca con su propio número; solo el más reciente puede escribir en
    // `mpBrickControllerRef` o el contenedor — cualquier intento anterior que
    // resuelva tarde simplemente se desmonta a sí mismo.
    mpBrickGenerationRef.current += 1
    const myGeneration = mpBrickGenerationRef.current

    loadMpSdk()
      .then((MercadoPago) => {
        if (myGeneration !== mpBrickGenerationRef.current || !mpBrickRef.current) return
        const mp = new MercadoPago(config.mercadoPago.publicKey, { locale: 'es-MX' })
        mpBrickRef.current.innerHTML = ''
        return mp.bricks().create('cardPayment', 'mp-card-brick-container', {
          initialization: { amount: selectedPlan.precio },
          callbacks: {
            // El Brick exige `onReady` explícito — sin él tira un error
            // interno ("Callbacks onReady and/or onError are required") que
            // nunca sale de sus propias promesas, así que el formulario se
            // queda trabado en su esqueleto de carga para siempre sin que
            // `.catch()` de aquí abajo se entere. No hace falta que haga
            // nada: el esqueleto ya lo reemplaza el propio Brick al quedar
            // listo.
            onReady: () => {},
            onSubmit: (cardFormData) =>
              new Promise((resolve, reject) => {
                setSubmitting(true)
                const accion =
                  selectedPlanId === ANNUAL_PLAN_ID
                    ? processMpAnnualPayment(cardFormData)
                    : authorizeMpSubscription(cardFormData)
                accion
                  .then((data) => {
                    if (data.status === 'rejected') {
                      toast('Tu tarjeta fue rechazada' + (data.detail ? `: ${data.detail}` : ''), 'error')
                    } else if (selectedPlanId === ANNUAL_PLAN_ID && data.status !== 'approved') {
                      toast('Tu pago está en revisión. Se activará solo en cuanto se confirme.')
                      onSuccess?.()
                      onClose()
                    } else {
                      toast(
                        selectedPlanId === ANNUAL_PLAN_ID
                          ? '¡Pago confirmado! Tu suscripción ya está activa.'
                          : '¡Suscripción activada! Confirmando el primer cobro…'
                      )
                      onSuccess?.()
                      onClose()
                    }
                    resolve()
                  })
                  .catch((err) => {
                    toast('Error: ' + err.message, 'error')
                    reject(err)
                  })
                  .finally(() => setSubmitting(false))
              }),
            onError: (error) => {
              console.error(error)
              toast('No se pudo procesar la tarjeta', 'error')
            },
          },
        })
      })
      .then((controller) => {
        if (myGeneration !== mpBrickGenerationRef.current) controller?.unmount?.()
        else mpBrickControllerRef.current = controller
      })
      .catch((err) => {
        if (myGeneration !== mpBrickGenerationRef.current) return
        console.error(err)
        toast('No se pudo cargar Mercado Pago', 'error')
      })

    return () => {
      mpBrickGenerationRef.current += 1
      mpBrickControllerRef.current?.unmount?.()
      mpBrickControllerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps
  }, [open, method, config?.mercadoPago?.publicKey, selectedPlanId])

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
              // `d.ok` es true solo si el servidor CAPTURÓ el dinero y activó
              // el plan. Cualquier otra cosa sigue sin confirmarse — se dice.
              if (res.ok && d.ok) {
                toast('¡Pago confirmado! Tu suscripción ya está activa.')
                onSuccess?.()
                onClose()
              } else {
                toast('Tu pago todavía no se confirma. Se activará solo en cuanto se acredite.', 'error')
                onSuccess?.()
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
        planId: selectedPlanId,
        escuelaId: userProfile?.escuelaId || '',
        monto: selectedPlan.precio,
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
  const finPeriodo = calcVencimiento(inicioPeriodo, selectedPlan.periodicidad)

  const t = config?.transferencia
  const methods = [
    config?.mercadoPago?.enabled && { id: 'mercadopago', label: 'Tarjeta de crédito · Tarjeta de débito · Mercado pago', icon: Wallet },
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
          <h3 className="font-bold text-on-surface">Activar suscripción</h3>
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
            {/* Selector de plan — mensual (precio de lanzamiento) o anual
                (paga 10 meses, disfruta 12). Cambia el precio, el rango de
                fechas de abajo y, si se paga con Mercado Pago, si es
                domiciliación automática o pago único — pedido explícito. */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSelectedPlanId(MONTHLY_PLAN_ID)}
                className={`text-left p-2.5 rounded-card border transition-colors ${
                  selectedPlanId === MONTHLY_PLAN_ID ? 'border-accent bg-accent-light' : 'border-outline-variant hover:bg-[var(--accent-tint)]'
                }`}
              >
                <p className="font-semibold text-on-surface text-sm">Mensual</p>
                <p className="text-sm text-muted">{formatCurrency(MONTHLY_PRICE_MXN)}/mes</p>
                <span className="inline-block mt-1 px-1.5 py-0.5 rounded-full bg-accent text-white text-[10px] font-semibold">
                  {LAUNCH_PRICE_NOTE}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedPlanId(ANNUAL_PLAN_ID)}
                className={`text-left p-2.5 rounded-card border transition-colors ${
                  selectedPlanId === ANNUAL_PLAN_ID ? 'border-accent bg-accent-light' : 'border-outline-variant hover:bg-[var(--accent-tint)]'
                }`}
              >
                <p className="font-semibold text-on-surface text-sm">Anual</p>
                <p className="text-sm text-muted">{formatCurrency(ANNUAL_PRICE_MXN)}/año</p>
                <span className="inline-block mt-1 px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-semibold">
                  Ahorra {formatCurrency(ANNUAL_SAVINGS_MXN)}
                </span>
              </button>
            </div>
            {selectedPlanId === ANNUAL_PLAN_ID && (
              <p className="text-xs text-muted -mt-1">
                Paga 10 meses y disfruta 12 — un pago único de {formatCurrency(ANNUAL_PRICE_MXN)} en vez de{' '}
                {formatCurrency(MONTHLY_PRICE_MXN * 12)} pagando mes a mes.
              </p>
            )}

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

            {/* Method tabs — un renglón completo cada una, no repartidas
                lado a lado, pedido explícito para que quepa la etiqueta
                larga de Mercado Pago (tarjeta de crédito/débito). Las tres
                cambian de pestaña y muestran su propio formulario debajo —
                ninguna sale de esta pantalla, pedido explícito. */}
            <div className="flex flex-col gap-2">
              {methods.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={`w-full flex items-center justify-center gap-1.5 py-2 px-2 rounded text-xs font-semibold border transition-colors disabled:opacity-60 ${
                    method === m.id
                      ? 'bg-accent-light border-accent text-accent'
                      : 'border-outline-variant text-muted hover:bg-[var(--accent-tint)]'
                  }`}
                >
                  <m.icon size={16} className="flex-shrink-0" />
                  {m.label}
                </button>
              ))}
            </div>

            {/* Mercado Pago (ver más abajo el formulario embebido) — va aquí,
                visible desde antes de llenar la tarjeta. Pedido explícito: que
                quede claro qué
                pasa con el cobro (domiciliación mensual vs. pago único
                anual), y que ninguno de los dos necesita que el
                administrador apruebe nada — a diferencia de la transferencia. */}
            {config?.mercadoPago?.enabled && selectedPlanId === MONTHLY_PLAN_ID && (
              <p className="text-xs text-muted -mt-1">
                Con tarjeta (Mercado Pago) queda en <strong>Pago automático</strong>: se te cobran{' '}
                {formatCurrency(MONTHLY_PRICE_MXN)} cada mes sin que tengas que volver a pagar. Se
                activa sola en cuanto se confirme el cobro — no necesita aprobación del administrador.
              </p>
            )}
            {config?.mercadoPago?.enabled && selectedPlanId === ANNUAL_PLAN_ID && (
              <p className="text-xs text-muted -mt-1">
                Con tarjeta (Mercado Pago) es un <strong>pago único</strong> de {formatCurrency(ANNUAL_PRICE_MXN)} por
                los 12 meses — no se te vuelve a cobrar solo el año que viene, tú decides si renuevas. Se
                activa sola en cuanto se confirme el cobro — no necesita aprobación del administrador.
              </p>
            )}

            {method === 'mercadopago' && (
              <div>
                <div id="mp-card-brick-container" ref={mpBrickRef} />
                <p className="text-sm text-slate-500 mt-2 text-center">
                  Tu tarjeta se procesa de forma segura por Mercado Pago, sin salir de esta pantalla.
                </p>
              </div>
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
