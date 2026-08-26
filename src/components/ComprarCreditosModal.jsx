import { useState } from 'react'
import { collection, addDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import Modal from './ui/Modal'
import useCreditosIA from '../hooks/useCreditosIA'
import { usePaymentConfig } from '../hooks/usePaymentConfig'
import { uploadToCloudinary } from '../utils/cloudinary'
import { datosDeCompraCreditos, validarComprobante, formatCurrency } from '../utils/creditosHelpers'
import { useToast } from './Toast'
import { Copy, Upload } from 'lucide-react'

const PRECIO_REFERENCIA_MXN = 1

export default function ComprarCreditosModal({ open, onClose }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const { config: payConfig, loading: cargandoConfig } = usePaymentConfig()
  const paquetes = creditosIA.paquetesCreditos

  const [paquete, setPaquete] = useState(null)
  const [referencia, setReferencia] = useState('')
  const [comprobante, setComprobante] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const transferencia = payConfig?.transferencia
  const activo = transferencia?.enabled && transferencia?.clabe

  function resetear() {
    setPaquete(null)
    setReferencia('')
    setComprobante(null)
    setEnviando(false)
  }

  function handleClose() {
    resetear()
    onClose()
  }

  function copiar(texto) {
    navigator.clipboard?.writeText(texto).catch(() => {})
    toast('Copiado al portapapeles')
  }

  function handleComprobante(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const err = validarComprobante(file)
    if (err) { toast(err, 'error'); return }
    setComprobante(file)
  }

  async function enviar() {
    if (!paquete) return
    if (!referencia.trim()) { toast('Escribe el folio o número de referencia de tu transferencia.', 'error'); return }
    setEnviando(true)
    try {
      let comprobanteUrl = null
      if (comprobante) {
        comprobanteUrl = await uploadToCloudinary(comprobante, 'evalua-facil/comprobantes')
      }
      const datos = datosDeCompraCreditos({
        docenteId: currentUser.uid,
        paquete,
        referencia: referencia.trim(),
        comprobanteUrl,
      })
      await addDoc(collection(db, 'creditPurchases'), datos)
      toast('¡Listo! Tu solicitud fue enviada. El administrador la revisará y acreditará los créditos en breve.')
      handleClose()
    } catch (err) {
      toast(err.message || 'No se pudo enviar la solicitud. Intenta de nuevo.', 'error')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Comprar créditos" variant="centered" size="md">
      <div className="space-y-5">

        {/* Selección de paquete */}
        <div>
          <p className="text-sm font-medium text-on-surface mb-2">Elige un paquete</p>
          {paquetes.length === 0 ? (
            <p className="text-sm text-muted">Cargando paquetes…</p>
          ) : (
            <ul className="grid grid-cols-3 gap-1.5">
              {paquetes.map((p) => {
                const ahorro = p.creditos * PRECIO_REFERENCIA_MXN - p.precioMXN
                const seleccionado = paquete?.creditos === p.creditos
                return (
                  <li key={p.creditos}>
                    <button
                      type="button"
                      onClick={() => setPaquete(p)}
                      className={`w-full flex flex-col items-center px-1 py-2.5 rounded-card border transition-colors ${
                        seleccionado
                          ? 'border-accent bg-[var(--accent-tint)]'
                          : 'border-outline-variant hover:border-accent'
                      }`}
                    >
                      <span className="font-bold text-on-surface text-sm tabular-nums">
                        {p.creditos.toLocaleString('es-MX')} cr
                      </span>
                      <span className="text-[12px] text-muted tabular-nums">{formatCurrency(p.precioMXN)}</span>
                      <span className="text-[11px] tabular-nums text-accent">
                        {ahorro > 0 ? `Ahorras ${formatCurrency(ahorro)}` : ' '}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Datos bancarios — solo si hay paquete seleccionado */}
        {paquete && (
          <>
            {cargandoConfig ? (
              <p className="text-sm text-muted">Cargando datos bancarios…</p>
            ) : !activo ? (
              <p className="text-sm text-error">Los datos bancarios no están disponibles en este momento. Inténtalo más tarde.</p>
            ) : (
              <div className="bg-surface rounded-card border border-outline-variant p-4 space-y-2 text-sm">
                <p className="font-semibold text-on-surface mb-1">Realiza una transferencia por {formatCurrency(paquete.precioMXN)}:</p>
                {[
                  { label: 'Banco', valor: transferencia.banco },
                  { label: 'Titular', valor: transferencia.titular },
                  { label: 'Cuenta', valor: transferencia.cuenta },
                  { label: 'CLABE', valor: transferencia.clabe },
                ].map(({ label, valor }) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <span className="text-muted w-14 flex-shrink-0">{label}</span>
                    <span className="font-mono text-on-surface flex-1 truncate">{valor}</span>
                    <button
                      type="button"
                      onClick={() => copiar(valor)}
                      className="p-1 rounded hover:bg-surface-container transition-colors"
                      aria-label={`Copiar ${label}`}
                    >
                      <Copy size={14} className="text-muted" />
                    </button>
                  </div>
                ))}
                {transferencia.nota && (
                  <p className="text-muted pt-1 border-t border-outline-variant">{transferencia.nota}</p>
                )}
              </div>
            )}

            {/* Referencia y comprobante */}
            {activo && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="comp-referencia" className="block text-sm font-medium text-on-surface mb-1">
                    Número de referencia / folio <span className="text-error">*</span>
                  </label>
                  <input
                    id="comp-referencia"
                    type="text"
                    value={referencia}
                    onChange={(e) => setReferencia(e.target.value)}
                    placeholder="Ej. 123456789"
                    className="w-full border border-outline-variant rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div>
                  <label htmlFor="comp-comprobante" className="block text-sm font-medium text-on-surface mb-1">
                    Comprobante de transferencia <span className="text-muted">(opcional)</span>
                  </label>
                  <label htmlFor="comp-comprobante" className="flex items-center gap-2 cursor-pointer border border-dashed border-outline-variant rounded px-3 py-2.5 hover:border-accent transition-colors">
                    <Upload size={16} className="text-muted flex-shrink-0" />
                    <span className="text-sm text-muted truncate">
                      {comprobante ? comprobante.name : 'Toca para subir una foto o captura'}
                    </span>
                    <input
                      id="comp-comprobante"
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={handleComprobante}
                    />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={enviar}
                  disabled={enviando || !referencia.trim()}
                  className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60"
                >
                  {enviando ? 'Enviando…' : 'Confirmar y enviar solicitud'}
                </button>

                <p className="text-xs text-muted text-center">
                  Tus créditos se agregarán después de que el administrador confirme el pago recibido.
                </p>
              </div>
            )}
          </>
        )}

        <p className="text-xs text-muted text-center">
          Los créditos no caducan. Toda la plataforma —asignaturas, actividades, asistencia y descargas— es gratuita.
        </p>

        <button
          type="button"
          onClick={handleClose}
          className="w-full py-2 border border-outline-variant text-on-surface font-semibold rounded transition-colors hover:bg-[var(--accent-tint)] text-sm"
        >
          Cancelar
        </button>
      </div>
    </Modal>
  )
}
