import { useState, useEffect } from 'react'
import { collection, doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { X } from 'lucide-react'
import { db } from '../firebase'
import { uploadToCloudinary } from '../utils/cloudinary'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import Spinner from './Spinner'
import PlanComparisonTable from './PlanComparisonTable'
import { usePaymentConfig } from '../hooks/usePaymentConfig'
import useCreditosIA from '../hooks/useCreditosIA'
import { useBackHandler } from '../hooks/useBackHandler'
import { useScrollLock } from '../hooks/useScrollLock'
import {
  MAYOR_PLAN_ID,
  MAYOR_PRICE_MXN,
  MAYOR_SUBSCRIPTION_NAME,
  MESES_DESCUENTO,
  MONTHLY_PLAN_ID,
  MONTHLY_PRICE_MXN,
  calcDaysRemaining,
  calcVencimiento,
  datosDePagoTransferencia,
  effectiveVencimiento,
  formatCurrency,
  formatDate,
  validarComprobante,
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
  const creditosIA = useCreditosIA()

  const [planId, setPlanId] = useState(MONTHLY_PLAN_ID)
  const [meses, setMeses] = useState(1)
  const [referencia, setReferencia] = useState('')
  const [file, setFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  // `mayor` (Asistente IA Pro) todavía no se ofrece: `plans/mayor.activo`
  // sigue en `false` a propósito (ver seeds-db/seed-ia-tarifas.js) hasta que
  // se tome la decisión comercial de lanzarlo. El checkout ya sabe cobrarlo
  // — falta solo esta bandera para que aparezca — así que activarlo después
  // no requiere tocar código, solo ese documento.
  const [mayorDisponible, setMayorDisponible] = useState(false)

  useBackHandler(onClose, open)
  useScrollLock(open)

  useEffect(() => {
    if (!open) return
    getDoc(doc(db, 'plans', 'mayor'))
      .then((snap) => setMayorDisponible(!!snap.data()?.activo))
      .catch(() => setMayorDisponible(false))
  }, [open])

  // Plan efectivo: derivado, no estado — si mayor se apaga a medio checkout
  // (o nunca estuvo disponible), el valor se recalcula solo en el siguiente
  // render sin necesitar un efecto que reescriba `planId` por su cuenta.
  const planIdEfectivo = planId === MAYOR_PLAN_ID && !mayorDisponible ? MONTHLY_PLAN_ID : planId
  const esMayor = planIdEfectivo === MAYOR_PLAN_ID
  // `mayor` no tiene todavía política de varios meses (decisión comercial
  // pendiente) — se le fija 1 mes siempre, tanto aquí como en
  // datosDePagoTransferencia y firestore.rules, así nadie puede colarle un
  // `meses` distinto desde ningún punto de entrada. También derivado, no
  // estado: evita el mismo patrón "setState dentro de un efecto".
  const mesesEfectivos = esMayor ? 1 : meses

  // Este modal nunca se desmonta — Profile.jsx lo renderiza siempre y solo
  // alterna `open` (aquí abajo hace `if (!open) return null`), así que su
  // estado interno sobrevive a cerrarlo y volverlo a abrir. Sin esto,
  // cerrar el modal a medio "Registrando…" y volver a abrirlo lo dejaba
  // trabado en ese mismo estado para siempre.
  // El archivo elegido tampoco debe sobrevivir: volver a abrir el modal con
  // una foto ya cargada, sin verla en pantalla (el campo se vacía al
  // desmontarse), la mandaría adjunta a un pago distinto del que era.
  useEffect(() => {
    if (open) { setSubmitting(false); setFile(null) }
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
    // Se revisa ANTES de subir nada: una foto de 40 MB por datos de celular
    // tarda minutos en fallar, y el error de Cloudinary no dice qué hacer.
    const problema = validarComprobante(file)
    if (problema) return toast(problema, 'error')
    // Sin suscripción no se crea una desde aquí: crearlas es exclusivo del
    // servidor (ver onDocenteCreado en functions/index.js y el `create` de
    // subscriptions en firestore.rules). Es una ventana de segundos entre
    // registrarse y que la prueba exista, así que basta con pedirle que lo
    // intente de nuevo en vez de dejarlo con un error de permisos a secas.
    if (!subscription?.id) {
      return toast('Estamos preparando tu cuenta. Intenta de nuevo en unos segundos.', 'warning')
    }
    setSubmitting(true)
    try {
      // La foto se sube primero y por fuera del lote: si falla (o si el
      // docente se queda sin señal a media carga), no queda ni el pago ni la
      // suscripción tocada — se le avisa y vuelve a intentar, sin residuos.
      let comprobanteUrl = null
      if (file) {
        try {
          comprobanteUrl = await uploadToCloudinary(file, 'evalua-facil/comprobantes')
        } catch {
          toast('No se pudo subir la foto del comprobante. Revisa tu conexión e intenta de nuevo.', 'error')
          return
        }
      }
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
      // el `planId` real, junto con las fechas reales. (El `planId` que sí
      // lleva el PAGO es otra cosa: de cuál plan es el folio.)
      const subData = {
        docenteId: currentUser.uid,
        escuelaId: userProfile?.escuelaId || '',
        schoolName: userProfile?.schoolName || '',
        status: 'pendiente_pago',
        updatedAt: serverTimestamp(),
      }
      batch.update(doc(db, 'subscriptions', subscription.id), subData)
      // El documento del pago se arma en un solo lugar para los dos caminos
      // que lo crean (aquí y el reenvío de un rechazado, en Profile.jsx) —
      // ver datosDePagoTransferencia.
      batch.set(doc(collection(db, 'payments')), datosDePagoTransferencia({
        docenteId: currentUser.uid,
        subscriptionId: subscription.id,
        escuelaId: userProfile?.escuelaId || '',
        planId: planIdEfectivo,
        meses: mesesEfectivos,
        referencia,
        comprobanteUrl,
      }))
      await batch.commit()
      toast('Pago registrado. Lo aprobamos dentro de las próximas 12 horas.')
      setReferencia('')
      setFile(null)
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
  const finPeriodo = calcVencimiento(inicioPeriodo, 'mensual', mesesEfectivos)

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
            {/* Tabla comercial (Bloque 7, 13-ago-2026): para que el docente
                entienda en segundos qué obtiene con cada plan, cuánto cuesta
                y cuál le conviene — visible siempre en el momento de decidir,
                no escondida detrás de un toggle. Solo nombres comerciales:
                nada de planId/pro/mayor/trial ni de dónde salen los datos. */}
            <PlanComparisonTable
              mostrarMayor={mayorDisponible}
              creditosGratuito={creditosIA.tarifas?.capacidadPorPlan?.trial}
              creditosPro={creditosIA.tarifas?.planes?.pro?.creditos}
              creditosMayor={creditosIA.tarifas?.planes?.mayor?.creditos}
            />

            {/* Selector de plan — solo aparece si `plans/mayor.activo` es
                true (Bloque 4: técnicamente listo, comercialmente apagado
                hasta nueva orden). Con un solo plan disponible no se muestra
                nada aquí, igual que antes. */}
            {mayorDisponible && (
              <div>
                <p className="text-xs font-medium text-muted mb-1.5">Elige tu plan</p>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { id: MONTHLY_PLAN_ID, nombre: 'Asistente IA', precio: MONTHLY_PRICE_MXN },
                    { id: MAYOR_PLAN_ID, nombre: MAYOR_SUBSCRIPTION_NAME, precio: MAYOR_PRICE_MXN },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlanId(p.id)}
                      className={`flex items-center justify-between text-left px-3 py-2.5 rounded-card border transition-colors ${
                        planIdEfectivo === p.id ? 'border-accent bg-accent-light' : 'border-outline-variant hover:bg-[var(--accent-tint)]'
                      }`}
                    >
                      <span className="font-semibold text-on-surface text-sm">{p.nombre}</span>
                      <span className="text-sm text-muted tabular-nums">{formatCurrency(p.precio)}/mes</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Selector de meses — reemplaza al selector mensual/anual: en
                v1.0.1 solo hay un plan (mensual) y transferencia como único
                método, así que el incentivo de "paga varios meses de una
                vez" (antes el plan anual) vive aquí. `mayor` todavía no
                tiene política de descuento por varios meses (decisión
                comercial pendiente), así que para ese plan se muestra solo
                el mes único a $199, sin selector. */}
            {esMayor ? (
              <div className="rounded-card border border-accent bg-accent-light px-3 py-2.5">
                <p className="font-semibold text-on-surface text-sm">1 mes</p>
                <p className="text-base text-muted tabular-nums">{formatCurrency(MAYOR_PRICE_MXN)}</p>
              </div>
            ) : (
            <div>
              <p className="text-xs font-medium text-muted mb-1.5">¿Cuántos meses deseas pagar?</p>
              <div className="grid grid-cols-3 gap-2">
                {MESES_DESCUENTO.map((r) => (
                  <button
                    key={r.meses}
                    type="button"
                    onClick={() => setMeses(r.meses)}
                    className={`text-left px-1.5 py-2 rounded-card border transition-colors ${
                      meses === r.meses ? 'border-accent bg-accent-light' : 'border-outline-variant hover:bg-[var(--accent-tint)]'
                    }`}
                  >
                    <p className="font-semibold text-on-surface text-sm">{r.meses} {r.meses === 1 ? 'mes' : 'meses'}</p>
                    {/* El precio es el dato que se compara entre las seis
                        tarjetas, así que va un punto más grande que la
                        etiqueta. `whitespace-nowrap` para que nunca se parta en
                        dos renglones, y el relleno lateral bajó a 6px para que
                        el importe más largo ($474.00 = 60px a 16px con Outfit)
                        entre completo hasta en pantallas de 320px de ancho,
                        donde la tarjeta mide 65px por dentro. */}
                    <p className="text-base text-muted tabular-nums whitespace-nowrap">{formatCurrency(r.pagas)}</p>
                    {r.ahorras > 0 && (
                      <span className="inline-block mt-1 px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-semibold">
                        Ahorra {formatCurrency(r.ahorras)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
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
              <p className="text-xs text-slate-500 -mt-2 text-center">
                <strong className="text-on-surface font-semibold">Folio</strong> es el número que te muestra tu banco al confirmar la transferencia — con él lo cotejamos en nuestro estado de cuenta.
              </p>
              {/* Comprobante desde el primer intento — opcional. Antes solo se
                  podía adjuntar DESPUÉS de que el pago fuera rechazado (ver
                  "Reenviar pago" en Profile.jsx), que es exactamente al revés
                  de lo que conviene: con la foto a la mano el admin aprueba de
                  una y el docente se ahorra el rechazo y la espera. Se deja
                  opcional para no ponerle un obstáculo a quien solo tiene el
                  folio. */}
              <div>
                <label htmlFor="checkout-comprobante" className="block text-xs font-medium text-muted mb-1">
                  Foto del comprobante <span className="font-normal text-slate-400">(opcional — con ella lo aprobamos más rápido)</span>
                </label>
                <input
                  id="checkout-comprobante"
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const elegido = e.target.files?.[0] || null
                    const problema = validarComprobante(elegido)
                    if (problema) { toast(problema, 'error'); e.target.value = ''; setFile(null); return }
                    setFile(elegido)
                  }}
                  className="w-full text-sm text-muted file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-accent-light file:text-accent file:font-semibold file:text-sm"
                />
              </div>
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
