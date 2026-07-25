import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { popAndRunTop } from '../hooks/useBackHandler'

// Pedido explícito: la tecla ESC cierra/cancela el modal o ventana abierta
// más reciente, en toda la web (docente y alumno) — mismo mecanismo que ya
// usa el botón físico "atrás" de Android (useBackHandler/popAndRunTop), así
// que reutilizarlo cubre de una vez los ~34 modales que ya lo llaman, sin
// tocar cada uno por separado. Se monta una sola vez en App.jsx. Solo hace
// algo en la web — en la app nativa el botón atrás ya cubre ese rol y no
// hay tecla ESC física.
export default function EscKeyHandler() {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return
      popAndRunTop()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return null
}
