import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useBackHandler } from '../../hooks/useBackHandler'
import { PAYMENT_STATUS } from '../../utils/subscriptionHelpers'

// Lo que diga esta pantalla lo decide dónde está el dinero, NUNCA el query
// string. Mercado Pago regresa al docente con ?status=success apenas se cierra
// el checkout, pero el depósito solo es nuestro cuando nuestro webhook volvió
// a leer el pago desde la API de MP y lo marcó 'completado'. Hasta entonces lo
// único honesto es decir que se está confirmando.
const VARIANTS = {
  verifying: {
    icon: Loader2,
    spin: true,
    color: 'text-accent',
    bg: 'bg-accent-light',
    title: 'Confirmando tu pago',
    text: 'Estamos verificando el depósito con el banco. En cuanto se confirme, tu suscripción se activa sola — puedes cerrar esta página.',
  },
  confirmed: {
    icon: CheckCircle2,
    color: 'text-emerald-500',
    bg: 'bg-emerald-100',
    title: '¡Pago confirmado!',
    text: 'Recibimos tu depósito y tu suscripción ya está activa.',
  },
  settling: {
    icon: Clock,
    color: 'text-amber-500',
    bg: 'bg-amber-100',
    title: 'Pago en proceso',
    text: 'Mercado Pago tomó tu pago pero el depósito aún no se acredita. Tu suscripción se activará automáticamente en cuanto se confirme.',
  },
  failure: {
    icon: XCircle,
    color: 'text-red-500',
    bg: 'bg-red-100',
    title: 'Pago no completado',
    text: 'No se concretó el pago, así que no se te cobró nada. Puedes intentarlo de nuevo desde tu perfil.',
  },
}

// Cuánto esperamos antes de avisar que la confirmación va lenta. Seguimos
// escuchando de todos modos — esto solo cambia el texto.
const CONFIRMACION_LENTA_MS = 30000

export default function PagoResultado() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()

  // `pid` lo pone create-preference.js; `external_reference` lo agrega Mercado
  // Pago. Cualquiera de los dos es el id del doc payments/{id} a vigilar.
  // `sid` lo pone create-subscription.js (domiciliación, sin doc de pago
  // previo): ahí se vigila la suscripción hasta verla activa.
  const paymentId = params.get('pid') || params.get('external_reference')
  const subscriptionId = params.get('sid')
  const urlStatus = params.get('status')

  const [paymentStatus, setPaymentStatus] = useState(null)
  const [subActiva, setSubActiva] = useState(false)
  const [sinRegistro, setSinRegistro] = useState(false)
  const [lento, setLento] = useState(false)

  useEffect(() => {
    if (!paymentId || !currentUser) return
    return onSnapshot(
      doc(db, 'payments', paymentId),
      (snap) => {
        if (!snap.exists()) return setSinRegistro(true)
        setPaymentStatus(snap.data().status || null)
      },
      () => setSinRegistro(true)
    )
  }, [paymentId, currentUser])

  useEffect(() => {
    if (!subscriptionId || !currentUser) return
    return onSnapshot(
      doc(db, 'subscriptions', subscriptionId),
      (snap) => setSubActiva(snap.exists() && snap.data().status === 'activa'),
      () => setSinRegistro(true)
    )
  }, [subscriptionId, currentUser])

  useEffect(() => {
    const t = setTimeout(() => setLento(true), CONFIRMACION_LENTA_MS)
    return () => clearTimeout(t)
  }, [])

  // Botón físico de Android: lo mismo que "Ir a mi perfil" — esta pantalla es
  // solo un acuse del pago, no debe atrapar a nadie.
  useBackHandler(() => navigate('/profile', { replace: true }))

  let key = 'verifying'
  if (paymentStatus === PAYMENT_STATUS.COMPLETADO || subActiva) {
    key = 'confirmed'
  } else if (paymentStatus === PAYMENT_STATUS.RECHAZADO) {
    key = 'failure'
  } else if (paymentStatus === PAYMENT_STATUS.EN_PROCESO) {
    key = 'settling'
  } else if (urlStatus === 'failure') {
    // El docente canceló o la tarjeta se rechazó en la pasarela y todavía no
    // tenemos nada registrado — el único caso en que la URL sola es segura,
    // porque solo afirma MENOS de lo que confirmaríamos por nuestra cuenta.
    key = 'failure'
  }

  const v = VARIANTS[key]
  const Icon = v.icon
  const esperando = key === 'verifying'

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="bg-surface-card rounded-card shadow-card p-8 max-w-sm w-full text-center">
        <div className={`w-16 h-16 ${v.bg} rounded-full flex items-center justify-center mx-auto mb-3`}>
          <Icon size={32} className={`${v.color} ${v.spin ? 'animate-spin' : ''}`} />
        </div>
        <h2 className="text-xl font-bold text-on-surface mb-2">{v.title}</h2>
        <p className="text-muted text-sm mb-4">{v.text}</p>

        {esperando && (!paymentId && !subscriptionId ? true : sinRegistro) && (
          <p className="text-slate-400 text-xs mb-4">
            No pudimos localizar el registro de este pago. Revisa tu perfil en unos minutos.
          </p>
        )}

        {esperando && lento && (
          <p className="text-slate-400 text-xs mb-4">
            Esto está tardando más de lo normal. Si ya te cobraron y tu suscripción sigue
            inactiva en unos minutos, avísale al administrador — no vuelvas a pagar.
          </p>
        )}

        <button
          type="button"
          onClick={() => navigate('/profile', { replace: true })}
          className="w-full py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-hover transition-colors"
        >
          Ir a mi perfil
        </button>
      </div>
    </div>
  )
}
