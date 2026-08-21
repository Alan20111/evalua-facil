// Compra de créditos (modelo de créditos puros, 20-ago-2026 — ver
// docs/ia/PLAN_TECNICO_CREDITOS_PUROS.md). Único método hoy es transferencia
// bancaria con aprobación manual del admin (ver [[project_solo_transferencia_v101]]).
// La cantidad/precio del paquete elegido NUNCA se manda suelta — siempre sale
// de `paquetes` (config/iaTarifas.paquetesCreditos, vía useCreditosIA), la
// MISMA fuente que revalida firestore.rules (montoOficialCredito). El
// servidor es quien de verdad decide: esto solo evita mandar una combinación
// que las reglas van a rechazar de todos modos.
import { useState } from 'react'
import { collection, doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { uploadToCloudinary } from '../utils/cloudinary'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import Spinner from './Spinner'
import Modal from './ui/Modal'
import { usePaymentConfig } from '../hooks/usePaymentConfig'
import useCreditosIA from '../hooks/useCreditosIA'
import { datosDeCompraCreditos, formatCurrency, validarComprobante } from '../utils/creditosHelpers'

const inputCls =
  'w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface'

// Precio de referencia sin descuento ($2 MXN/crédito, plan técnico §12) —
// solo para mostrar "Ahorras $X" por paquete; el precio real que se cobra
// SIEMPRE sale de config/iaTarifas.paquetesCreditos (paquetes ya trae el
// precio con descuento aplicado), nunca de esta constante.
const PRECIO_REFERENCIA_MXN = 2

export default function ComprarCreditosModal({ open, onClose, onSuccess }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const { config, loading: configLoading } = usePaymentConfig()
  const creditosIA = useCreditosIA()
  const paquetes = creditosIA.paquetesCreditos

  const [paqueteIdx, setPaqueteIdx] = useState(0)
  const [referencia, setReferencia] = useState('')
  const [file, setFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const paquete = paquetes[paqueteIdx]
  const t = config?.transferencia

  // Este modal no se desmonta al cerrarse — se limpia al CERRAR (no al abrir,
  // que dispararía un setState síncrono dentro del efecto) para que la
  // próxima apertura ya empiece en blanco.
  function handleClose() {
    setSubmitting(false)
    setFile(null)
    setReferencia('')
    setPaqueteIdx(0)
    onClose()
  }

  async function submitCompra(e) {
    e.preventDefault()
    if (!paquete) return
    if (!referencia.trim()) return toast('Ingresa la referencia', 'error')
    const problema = validarComprobante(file)
    if (problema) return toast(problema, 'error')

    setSubmitting(true)
    try {
      let comprobanteUrl = null
      if (file) {
        try {
          comprobanteUrl = await uploadToCloudinary(file, 'evalua-facil/comprobantes')
        } catch {
          toast('No se pudo subir la foto del comprobante. Revisa tu conexión e intenta de nuevo.', 'error')
          return
        }
      }
      await setDoc(doc(collection(db, 'creditPurchases')), datosDeCompraCreditos({
        docenteId: currentUser.uid,
        paquete,
        referencia,
        comprobanteUrl,
      }))
      toast('Compra registrada. La aprobamos dentro de las próximas 12 horas.')
      onSuccess?.()
      handleClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Comprar créditos" variant="centered" size="md">
      <>
        {configLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : !t?.enabled ? (
          <div className="text-center py-8 text-sm text-muted">
            No hay métodos de pago disponibles por el momento. Contacta al administrador.
          </div>
        ) : paquetes.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted">
            No hay paquetes de créditos disponibles por el momento.
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Los créditos se agregan a tu saldo y no caducan. Úsalos cuando los necesites.
            </p>
            <div>
              <p className="text-xs font-medium text-muted mb-1.5">Elige un paquete</p>
              {/* 6 paquetes definitivos (20-ago-2026, modelo de créditos
                  puros — ver docs/ia/PLAN_TECNICO_CREDITOS_PUROS.md), en 2
                  filas de 3 para que quepan cómodos incluso en pantallas
                  angostas. El ahorro se calcula aquí mismo contra la
                  referencia de $2 MXN/crédito — nunca hardcodeado por
                  paquete, así que sigue siendo correcto si config/iaTarifas
                  cambia. */}
              <div className="grid grid-cols-3 gap-1">
                {paquetes.map((p, i) => {
                  const ahorro = p.creditos * PRECIO_REFERENCIA_MXN - p.precioMXN
                  return (
                    <button
                      key={p.creditos}
                      type="button"
                      onClick={() => setPaqueteIdx(i)}
                      className={`flex flex-col items-center justify-center px-1 py-2 rounded-card border transition-colors ${
                        paqueteIdx === i ? 'border-accent bg-accent-light' : 'border-outline-variant hover:bg-[var(--accent-tint)]'
                      }`}
                    >
                      <span className="font-semibold text-on-surface text-xs tabular-nums">{p.creditos.toLocaleString('es-MX')}</span>
                      <span className="text-[11px] text-muted tabular-nums">{formatCurrency(p.precioMXN)}</span>
                      <span className="text-[10px] tabular-nums text-accent">
                        {ahorro > 0 ? `Ahorras ${formatCurrency(ahorro)}` : ' '}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <p className="text-xs text-accent bg-accent-light rounded p-2.5 text-center">
              Los créditos se agregarán a tu saldo una vez confirmado tu pago.
            </p>

            <form onSubmit={submitCompra} className="space-y-3">
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
              <div>
                <label htmlFor="creditos-comprobante" className="block text-xs font-medium text-muted mb-1">
                  Foto del comprobante <span className="font-normal text-slate-400">(opcional — con ella lo aprobamos más rápido)</span>
                </label>
                <input
                  id="creditos-comprobante"
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
                {submitting ? 'Registrando…' : `Registrar compra · ${formatCurrency(paquete.precioMXN)}`}
              </button>
              <p className="text-xs text-slate-500 text-center">
                Lo revisamos y aprobamos dentro de las 12 horas siguientes a tu transferencia.
              </p>
            </form>
          </div>
        )}
      </>
    </Modal>
  )
}
