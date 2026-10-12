import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { registrarExplicacionPush } from '../utils/pushNotifications'
import { Button } from './ui'
import { ICONO } from '../config/iconos'

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

  if (!visible) return null
  return (
    <div className="fixed inset-0 z-menu bg-black/60 animate-velo flex items-center justify-center px-4">
      <div className="bg-surface-card rounded-card shadow-2xl w-full max-w-sm p-5 text-center">
        <div className="w-14 h-14 rounded-full bg-accent-light flex items-center justify-center mx-auto mb-3">
          <Bell size={ICONO.lg} className="text-accent" />
        </div>
        <h2 className="text-lg font-bold text-on-surface mb-2">Activa tus notificaciones</h2>
        <p className="text-sm text-muted mb-4">
          Las usamos para avisarte de nuevos avisos de tus maestros, actividades publicadas, calificaciones y otros eventos de tus asignaturas. Tu teléfono te va a preguntar si lo permites — puedes cambiarlo después desde Notificaciones.
        </p>
        <Button fullWidth onClick={continuar}>Entendido, continuar</Button>
      </div>
    </div>
  )
}
