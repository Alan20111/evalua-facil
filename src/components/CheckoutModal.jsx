import { useState, useEffect } from 'react'
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { X } from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import Spinner from './Spinner'
import { usePaymentConfig } from '../hooks/usePaymentConfig'
import { useBackHandler } from '../hooks/useBackHandler'
import { useScrollLock } from '../hooks/useScrollLock'
import {
  MONTHLY_PLAN_ID,
  MESES_DESCUENTO,
  mesesDescuentoDe,
  calcDaysRemaining,
  calcVencimiento,
  effectiveVencimiento,
  formatCurrency,
  formatDate,
} from '../utils/subscriptionHelpers'
import { isAppOutdated } from '../utils/checkAppVersion'

const inputCls =
  'w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface'

// v1.0.1: Mercado Pago y PayPal quedan fuera (ver [[project_solo_transferencia_v101]])
// — implican demasiados detalles (validación de tarjeta, domiciliación,
// webhooks) para esta primera versión, se retoman en 1.0.2. Solo queda
// transferencia bancaria con aprobación manual del administrador. El
// incentivo de "paga varios meses de una vez" que antes vivía en el plan
// anual ahora es este selector de meses (ver MESES_DESCUENTO).
export default function CheckoutModal({ open, onClose, subscription, onSuccess }) {
  const { currentUser, userProfile } = useAuth()
  const toast = useToast()
  const { config, loading: configLoading } = usePaymentConfig()

  const [meses, setMeses] = useState(1)
  const [referencia, setReferencia] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useBackHandler(onClose, open)
  useScrollLock(open)

  // Este modal nunca se desmonta — Profile.jsx lo renderiza siempre y solo
  // alterna `open` (aquí abajo hace `if (!open) return null`), así que su
  // estado interno sobrevive a cerrarlo y volverlo a abrir. Sin esto,
  // cerrar el modal a medio "Registrando…" y volver a abrirlo lo dejaba
  // trabado en ese mismo estado para siempre.
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

  // ── Transferencia bancaria: manual, crea un pago pendiente para que el
  // administrador lo apruebe ──
  async function submitTransfer(e) {
    e.preventDefault()
    if (!referencia.trim()) {
      return toast('Ingresa la referencia', 'error')
    }
    setSubmitting(true)
    try {
      // Un solo batch: si algo falla a medio camino, NINGUNO de los dos
      // escritos se aplica. Dos escrituras independientes dejaban al
      // docente marcado "pendiente_pago" (su pantalla decía "en revisión")
      // sin que existiera el doc en `payments` que el panel de admin sí
      // revisa, un pago huérfano invisible para ambos lados.
      const batch = writeBatch(db)
      // Sin `planId` aquí a propósito: en todo el proyecto (admin incluido,
      // ver SubscriptionsTable.jsx) `planId` presente = pago YA aprobado.
      // Ponerlo antes de que el admin apruebe hacía que un intento nunca
      // aprobado se leyera como si sí lo hubiera sido (ver Profile.jsx
      // nuncaAprobado). `handleApprove` en PaymentsTable.jsx es quien pone
      // el `planId` real, junto con las fechas reales.
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
        monto: mesesDescuentoDe(meses).pagas,
        // Cuántos meses cubre este folio — handleApprove en PaymentsTable.jsx
        // lo usa para extender la suscripción esa cantidad de meses en vez
        // de siempre 1.
        mesesPagados: meses,
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
  // cuando esos días se agotan, no desde hoy. Se le muestra siempre el rango
  // exacto que cubre este pago para que quede claro desde antes de pagar.
  const vigenteHasta = effectiveVencimiento(subscription)
  const diasVigentes = calcDaysRemaining(vigenteHasta)
  const tieneDiasVigentes = diasVigentes !== null && diasVigentes > 0
  const inicioPeriodo = tieneDiasVigentes ? vigenteHasta : new Date()
  const finPeriodo = calcVencimiento(inicioPeriodo, 'mensual', meses)

  const t = config?.transferencia

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
        ) : !t?.enabled ? (
          <div className="text-center py-8 text-sm text-muted">
            No hay métodos de pago disponibles por el momento. Contacta al administrador.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Selector de meses — reemplaza al selector mensual/anual: en
                v1.0.1 solo hay un plan (mensual) y transferencia como único
                método, así que el incentivo de "paga varios meses de una
                vez" (antes el plan anual) vive aquí. */}
            <div>
              <p className="text-xs font-medium text-muted mb-1.5">¿Cuántos meses pagas?</p>
              <div className="grid grid-cols-3 gap-2">
                {MESES_DESCUENTO.map((r) => (
                  <button
                    key={r.meses}
                    type="button"
                    onClick={() => setMeses(r.meses)}
                    className={`text-left p-2 rounded-card border transition-colors ${
                      meses === r.meses ? 'border-accent bg-accent-light' : 'border-outline-variant hover:bg-[var(--accent-tint)]'
                    }`}
                  >
                    <p className="font-semibold text-on-surface text-sm">{r.meses} {r.meses === 1 ? 'mes' : 'meses'}</p>
                    <p className="text-sm text-muted">{formatCurrency(r.pagas)}</p>
                    {r.ahorras > 0 && (
                      <span className="inline-block mt-1 px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-semibold">
                        Ahorra {formatCurrency(r.ahorras)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
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
          </div>
        )}
      </div>
    </div>
  )
}
