import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { registrarExplicacionPush } from '../utils/pushNotifications'
import Modal from './ui/Modal'

// Explicación propia ANTES del diálogo nativo de "Permitir notificaciones" —
// pedido explícito: que el estudiante entienda para qué sirven (avisos,
// actividades, calificaciones) antes de que el sistema operativo se lo
// pregunte, en vez del prompt genérico de Android sin contexto. Se muestra
// UNA sola vez en la vida de la app (mientras el permiso siga en "prompt" —
// ver registrarExplicacionPush en pushNotifications.js), y solo bloquea a
// initPushNotifications hasta que el estudiante toca "Entendido, continuar".
export default function PushPermissionPrimer() {
  const [visible, setVisible] = useState(false)
  const resolveRef = useRef(null)

  useEffect(() => {
    registrarExplicacionPush(() => new Promise((resolve) => {
      resolveRef.current = resolve
      setVisible(true)
    }))
    return () => registrarExplicacionPush(null)
  }, [])

  function continuar() {
    setVisible(false)
    resolveRef.current?.()
    resolveRef.current = null
  }

  return (
    <Modal
      open={visible}
      onClose={continuar}
      variant="centered"
      size="sm"
      z={70}
      padding="p-6"
      busy
      closeOnBackdrop={false}
      ariaLabel="Activa tus notificaciones"
    >
      <div className="text-center">
        <div className="w-14 h-14 rounded-full bg-accent-light flex items-center justify-center mx-auto mb-3">
          <Bell size={26} className="text-accent" />
        </div>
        <h2 className="text-lg font-bold text-on-surface mb-2">Activa tus notificaciones</h2>
        <p className="text-sm text-muted mb-5">
          Las usamos para avisarte de nuevos avisos de tus maestros, actividades publicadas, calificaciones y otros eventos de tus asignaturas. Tu teléfono te va a preguntar si lo permites — puedes cambiarlo después desde Notificaciones.
        </p>
        <button type="button" onClick={continuar}
          className="w-full px-4 py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-hover transition-colors">
          Entendido, continuar
        </button>
      </div>
    </Modal>
  )
}
