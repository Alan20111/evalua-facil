import { useState } from 'react'
import { Lock, Download, CreditCard } from 'lucide-react'
import CheckoutModal from './CheckoutModal'
import { useBackHandler } from '../hooks/useBackHandler'
import { useScrollLock } from '../hooks/useScrollLock'
import { MONTHLY_PRICE_LABEL, SUBSCRIPTION_NAME, RETENTION_DAYS, diasParaEliminacion } from '../utils/subscriptionHelpers'

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
  useScrollLock(open && !mostrarPago)

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
    // Sin cierre al tocar el fondo: de aquí se sale por una de las dos
    // puertas de abajo, a propósito.
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center px-4 py-6 overflow-y-auto">
      <div className="relative bg-surface-card rounded-card shadow-2xl w-full max-w-md p-6 my-auto">
        <div className="w-14 h-14 rounded-card bg-amber-100 flex items-center justify-center mx-auto mb-3">
          <Lock size={28} className="text-amber-600" />
        </div>

        <h2 className="text-xl font-bold text-on-surface text-center">Tu suscripción venció</h2>

        <p className="text-sm text-muted mt-2 text-center">
          Tus grupos, tus estudiantes, tus actividades y tus calificaciones siguen completos.
          Puedes consultarlos y descargarlos cuando quieras.
        </p>
        <p className={`text-sm mt-2 text-center ${urgente ? 'text-red-600 font-semibold' : 'text-muted'}`}>
          {urgente
            ? `Se eliminan definitivamente en ${diasRestantes <= 0 ? 'cualquier momento' : `${diasRestantes} día${diasRestantes === 1 ? '' : 's'}`} si no reactivas.`
            : `Los conservamos ${RETENTION_DAYS} días desde que venció tu suscripción — pasado ese plazo se eliminan definitivamente.`}
        </p>
        <p className="text-sm text-on-surface mt-3 text-center font-medium">
          Para volver a trabajar —calificar, pasar lista, crear actividades— activa tu {SUBSCRIPTION_NAME.toLowerCase()}.
        </p>

        <div className="mt-4 rounded-card bg-accent-light px-4 py-3 text-center">
          <p className="text-xs uppercase tracking-wide text-accent font-semibold">{SUBSCRIPTION_NAME}</p>
          <p className="text-2xl font-extrabold text-accent mt-0.5">{MONTHLY_PRICE_LABEL}</p>
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
    </div>
  )
}
