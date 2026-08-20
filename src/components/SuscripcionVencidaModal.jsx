import { useState } from 'react'
import { Lock, Download, CreditCard } from 'lucide-react'
import CheckoutModal from './CheckoutModal'
import Modal from './ui/Modal'
import { useBackHandler } from '../hooks/useBackHandler'
import {
  LAUNCH_PRICE_NOTE,
  MONTHLY_PRICE_LABEL,
  SUBSCRIPTION_NAME,
  diasParaEliminacion,
  fechaEliminacion,
  formatDate,
} from '../utils/subscriptionHelpers'

// A partir de aquí (30 días o menos para que se cumplan los RETENTION_DAYS)
// el mensaje pasa de informativo a urgente — mismo umbral que el correo
// "temprano" del cron de recordatorios (api/cron/reminders.js).
const DIAS_URGENCIA = 30

// Ventana que ve el docente cuya suscripción venció. Aparece al entrar y cada
// vez que intenta trabajar (ver utils/firestoreGuard.js).
//
// Deliberadamente NO es un muro ciego: se puede cerrar para consultar y
// descargar todo lo suyo, porque un docente a media captura de actas que ni
// siquiera puede sacar sus calificaciones no paga — se va. Lo que queda
// bloqueado es el TRABAJO (crear, editar, calificar, pasar lista, publicar),
// que es justamente lo que se está cobrando. El botón fijo de la esquina la
// vuelve a abrir en cualquier momento.
export default function SuscripcionVencidaModal({ open, subscription, onSoloConsultar, onPagado }) {
  const [mostrarPago, setMostrarPago] = useState(false)
  const diasRestantes = diasParaEliminacion(subscription)
  const urgente = diasRestantes !== null && diasRestantes <= DIAS_URGENCIA

  // Atrás (botón físico de Android) hace lo mismo que "Solo consultar": nunca
  // dejar a nadie encerrado en una pantalla sin salida.
  useBackHandler(() => (mostrarPago ? setMostrarPago(false) : onSoloConsultar?.()), open)

  if (!open) return null

  if (mostrarPago) {
    return (
      <CheckoutModal
        open
        onClose={() => setMostrarPago(false)}
        subscription={subscription}
        onSuccess={onPagado}
      />
    )
  }

  return (
    // Sin cierre al tocar el fondo ni con Escape: de aquí se sale por una de
    // las dos puertas de abajo, a propósito (busy + closeOnBackdrop={false}).
    <Modal
      open
      onClose={onSoloConsultar}
      variant="centered"
      size="md"
      z={60}
      busy
      closeOnBackdrop={false}
      ariaLabel="Tu suscripción venció"
    >
      <div>
        <div className="w-14 h-14 rounded-card bg-amber-100 flex items-center justify-center mx-auto mb-3">
          <Lock size={28} className="text-amber-600" />
        </div>

        <h2 className="text-xl font-bold text-on-surface text-center">Tu suscripción venció</h2>

        <p className="text-sm text-muted mt-2 text-center">
          Tus grupos, estudiantes, actividades, entregas y calificaciones siguen completos.
          Puedes consultarlos y descargarlos cuando quieras.
        </p>
        {diasRestantes !== null && (
          <p className={`text-sm mt-2 text-center ${urgente ? 'text-red-600 font-semibold' : 'text-muted'}`}>
            {diasRestantes <= 0
              ? 'Se eliminan definitivamente en cualquier momento si no reactivas.'
              : `Guardamos toda tu información hasta el ${formatDate(fechaEliminacion(subscription))} (${diasRestantes} día${diasRestantes === 1 ? '' : 's'} más), por si decides volver.`}
          </p>
        )}
        <p className="text-sm text-on-surface mt-3 text-center font-medium">
          Para volver a trabajar —calificar, pasar lista, crear actividades— activa tu {SUBSCRIPTION_NAME.toLowerCase()}.
        </p>

        <div className="mt-4 rounded-card bg-accent-light px-4 py-3 text-center">
          <p className="text-xs uppercase tracking-wide text-accent font-semibold">{SUBSCRIPTION_NAME}</p>
          <p className="text-2xl font-extrabold text-accent mt-0.5">{MONTHLY_PRICE_LABEL}</p>
          {/* Precio promocional de arranque, sin fecha de reversión fija —
              pedido explícito: que quede claro que es un precio de
              lanzamiento y no el precio "de siempre". */}
          <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-accent text-white text-[11px] font-semibold">
            {LAUNCH_PRICE_NOTE}
          </span>
          <p className="text-xs text-muted mt-1">Se paga mes con mes. Cancelas cuando quieras.</p>
        </div>

        <button
          type="button"
          onClick={() => setMostrarPago(true)}
          className="w-full mt-4 py-3 bg-accent text-white font-semibold rounded-card hover:bg-accent-hover transition-colors flex items-center justify-center gap-2"
        >
          <CreditCard size={18} /> Ver formas de pago
        </button>

        <button
          type="button"
          onClick={onSoloConsultar}
          className="w-full mt-2 py-2.5 border border-outline-variant text-muted font-medium rounded-card hover:bg-surface-container transition-colors flex items-center justify-center gap-2"
        >
          <Download size={16} /> Solo consultar y descargar lo mío
        </button>
      </div>
    </Modal>
  )
}
