import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'

const VARIANTS = {
  success: {
    icon: CheckCircle2,
    color: 'text-emerald-500',
    bg: 'bg-emerald-100',
    title: '¡Pago recibido!',
    text: 'Tu suscripción se activará en unos segundos. Si no la ves activa, recarga tu perfil.',
  },
  pending: {
    icon: Clock,
    color: 'text-amber-500',
    bg: 'bg-amber-100',
    title: 'Pago pendiente',
    text: 'Tu pago está en proceso. En cuanto se confirme, tu suscripción se activará automáticamente.',
  },
  failure: {
    icon: XCircle,
    color: 'text-red-500',
    bg: 'bg-red-100',
    title: 'Pago no completado',
    text: 'No se concretó el pago. Puedes intentarlo de nuevo desde tu perfil.',
  },
}

export default function PagoResultado() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const status = params.get('status') || 'pending'
  const v = VARIANTS[status] || VARIANTS.pending
  const Icon = v.icon

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 max-w-sm w-full text-center">
        <div className={`w-16 h-16 ${v.bg} rounded-full flex items-center justify-center mx-auto mb-4`}>
          <Icon size={32} className={v.color} />
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">{v.title}</h2>
        <p className="text-slate-500 text-sm mb-6">{v.text}</p>
        <button
          onClick={() => navigate('/profile', { replace: true })}
          className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
        >
          Ir a mi perfil
        </button>
      </div>
    </div>
  )
}
