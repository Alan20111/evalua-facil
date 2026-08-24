// Compra de créditos — PAUSADA (26-ago-2026, decisión de Kike).
//
// POR QUÉ: www.evaluafacil.mx ya es público. Mientras `montoOficialCredito`
// en firestore.rules no espeje los paquetes vigentes de
// config/iaTarifas.paquetesCreditos, las reglas rechazan las SEIS compras —
// así que un docente podía leer los datos bancarios, transferir de verdad, y
// el sistema quedarse sin forma de registrarle la compra ni acreditarle los
// créditos. Dinero recibido sin contrapartida: el peor fallo posible de esta
// pantalla.
//
// Por eso aquí NO se muestran datos bancarios (banco, titular, cuenta,
// CLABE), ni el campo de folio, ni el de comprobante, ni se escribe nada en
// `creditPurchases`. Los paquetes sí se muestran, como lista de precios: la
// información es correcta y útil, lo que no está listo es el cobro.
//
// PARA REACTIVAR: revertir este commit — vuelven el formulario, la
// integración con usePaymentConfig y la escritura a `creditPurchases`. Los
// ayudantes que usaba (`datosDeCompraCreditos`, `validarComprobante` en
// utils/creditosHelpers.js) se conservan intactos a propósito. Antes de
// reactivar, comprobar que una compra de prueba de verdad pase las reglas.
import Modal from './ui/Modal'
import useCreditosIA from '../hooks/useCreditosIA'
import { formatCurrency } from '../utils/creditosHelpers'
import { Clock } from 'lucide-react'

// Precio de referencia sin descuento — 1 crédito = $1 MXN (regla de
// consumo del entorno, corrección del PO 23-ago-2026) — solo para mostrar
// "Ahorras $X" por paquete; el precio real SIEMPRE sale de
// config/iaTarifas.paquetesCreditos, nunca de esta constante.
const PRECIO_REFERENCIA_MXN = 1

export default function ComprarCreditosModal({ open, onClose }) {
  const creditosIA = useCreditosIA()
  const paquetes = creditosIA.paquetesCreditos

  return (
    <Modal open={open} onClose={onClose} title="Comprar créditos" variant="centered" size="md">
      <div className="space-y-4">
        <div className="flex flex-col items-center text-center gap-2 py-2">
          <span className="grid place-items-center w-11 h-11 rounded-full bg-accent-light text-accent">
            <Clock size={22} />
          </span>
          <p className="font-semibold text-on-surface">Compra de créditos — próximamente</p>
          <p className="text-sm text-muted max-w-sm">
            Estamos afinando el proceso de pago. En cuanto esté listo podrás comprar créditos
            desde aquí mismo, y te avisaremos.
          </p>
        </div>

        {paquetes.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted mb-1.5">Estos serán los paquetes</p>
            {/* Lista de PRECIOS, no botones: no hay nada que elegir mientras la
                compra esté pausada, y un botón que no lleva a ningún lado se
                siente roto. El ahorro se calcula contra la referencia de
                $1 MXN/crédito, nunca hardcodeado por paquete. */}
            <ul className="grid grid-cols-3 gap-1">
              {paquetes.map((p) => {
                const ahorro = p.creditos * PRECIO_REFERENCIA_MXN - p.precioMXN
                return (
                  <li
                    key={p.creditos}
                    className="flex flex-col items-center justify-center px-1 py-2 rounded-card border border-outline-variant"
                  >
                    <span className="font-semibold text-on-surface text-xs tabular-nums">
                      {p.creditos.toLocaleString('es-MX')}
                    </span>
                    <span className="text-[11px] text-muted tabular-nums">{formatCurrency(p.precioMXN)}</span>
                    <span className="text-[10px] tabular-nums text-accent">
                      {ahorro > 0 ? `Ahorras ${formatCurrency(ahorro)}` : ' '}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <p className="text-xs text-muted text-center">
          Tus créditos actuales no caducan y siguen disponibles. Toda la plataforma —asignaturas,
          estudiantes, actividades, asistencia y descargas— es gratuita y no consume créditos.
        </p>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 border border-outline-variant text-on-surface font-semibold rounded transition-colors hover:bg-[var(--accent-tint)]"
        >
          Entendido
        </button>
      </div>
    </Modal>
  )
}
