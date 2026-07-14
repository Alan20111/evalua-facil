import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { popAndRunTop } from '../hooks/useBackHandler'
import { useToast } from './Toast'

// Ventana para el patrón "presiona atrás de nuevo para salir" en pantalla raíz.
const EXIT_PRESS_WINDOW_MS = 2000

// Se monta una sola vez en App.jsx. Solo hace algo dentro de la app nativa
// (Capacitor); en la web normal no agrega ningún listener.
export default function AndroidBackButton() {
  const toast = useToast()
  const lastPressRef = useRef(0)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let handle
    CapacitorApp.addListener('backButton', () => {
      if (popAndRunTop()) return // cerró un modal o navegó una pantalla

      const now = Date.now()
      if (now - lastPressRef.current < EXIT_PRESS_WINDOW_MS) {
        CapacitorApp.exitApp()
        return
      }
      lastPressRef.current = now
      toast?.('Presiona de nuevo para salir', 'warning')
    }).then((h) => {
      handle = h
    })
    return () => {
      handle?.remove()
    }
  }, [toast])

  return null
}
