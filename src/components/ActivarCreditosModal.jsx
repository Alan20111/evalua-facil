// Activación voluntaria de los 30 créditos de bienvenida (20-ago-2026,
// decisión del PO). No se otorgan solos al crear la cuenta — el docente
// confirma aquí, y solo entonces el servidor los acredita
// (functions/index.js → activarCreditosBienvenida, vía useCreditosIA).
import { useState } from 'react'
import { useToast } from './Toast'
import Spinner from './Spinner'
import Modal from './ui/Modal'
import { useCreditosIA } from '../hooks/useCreditosIA'
import { Gift } from 'lucide-react'

export default function ActivarCreditosModal({ open, onClose, onSuccess }) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const [activando, setActivando] = useState(false)

  async function activar() {
    setActivando(true)
    try {
      await creditosIA.activarBienvenida()
      toast('¡Listo! Ya tienes 30 créditos IA disponibles.')
      onSuccess?.()
      onClose()
    } catch (err) {
      toast(err.message || 'No se pudo activar tus créditos.', 'error')
    } finally {
      setActivando(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Activa tus 30 créditos IA de regalo" variant="centered" size="sm">
      <div className="space-y-4 text-center">
        <Gift className="mx-auto text-accent" size={40} />
        <p className="text-sm text-on-surface">
          Recibe 30 créditos de IA gratis para probar las funciones inteligentes de Evalúa Fácil.
        </p>
        <p className="text-sm text-muted">
          No caducan. Úsalos cuando quieras.
        </p>
        <p className="text-sm text-muted">
          Al consumirlos podrás comprar más créditos para seguir utilizando la IA.
        </p>
        <button
          type="button"
          onClick={activar}
          disabled={activando}
          className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {activando ? <Spinner size="sm" /> : null}
          {activando ? 'Activando…' : 'Activar mis 30 créditos'}
        </button>
      </div>
    </Modal>
  )
}
