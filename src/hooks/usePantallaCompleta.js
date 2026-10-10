import { useCallback, useEffect, useRef, useState } from 'react'
import { useScrollLock } from './useScrollLock'
import { useBackHandler } from './useBackHandler'
import {
  MODO_PANTALLA, elementoEnPantallaCompleta, esTelefono, modoPantallaCompleta, pedirPantallaCompleta,
  salirDePantallaCompleta,
} from '../components/video/pantallaCompletaVideo'

// Pantalla completa del contenedor del Video interactivo (ver components/video/pantallaCompletaVideo.js para
// el porqué y la compatibilidad real). `ref` apunta al contenedor que incluye video + controles +
// pregunta. El MISMO elemento cambia de tamaño: no se remonta, así el iframe de YouTube, la
// posición, el progreso y la pregunta abierta sobreviven a entrar, salir y girar el teléfono.
//
//   modo 'nativa'   → requestFullscreen() del contenedor (Android, escritorio, iPad).
//   modo 'simulada' → el contenedor a toda la ventana (iPhone y navegadores sin la API); el botón
//                     «atrás» de Android y Esc lo cierran.
// Algunos navegadores integrados (WebViews, apps de mensajería) tienen la API pero nunca resuelven ni
// rechazan la promesa: sin límite de espera el botón parecería muerto. A los 1.5 s se pasa a la simulada.
const ESPERA_MS = 1500
const conLimite = (promesa, ms) => Promise.race([
  promesa,
  new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('Sin respuesta del navegador')), ms)),
])

export default function usePantallaCompleta(ref) {
  const [modo, setModo] = useState(null)
  const modoRef = useRef(null)
  const poner = useCallback((m) => { modoRef.current = m; setModo(m) }, [])

  const soltarOrientacion = useCallback(() => {
    try { screen.orientation?.unlock?.() } catch { /* sin API o sin bloqueo vigente */ }
  }, [])

  const salir = useCallback(() => {
    const previo = modoRef.current
    if (!previo) return
    poner(null)
    soltarOrientacion()
    if (previo === MODO_PANTALLA.NATIVA && elementoEnPantallaCompleta(document)) {
      salirDePantallaCompleta(document).catch(() => { /* ya salió */ })
    }
  }, [poner, soltarOrientacion])

  const entrar = useCallback(async () => {
    const el = ref.current
    if (!el || modoRef.current) return
    if (modoPantallaCompleta({ elemento: el, documento: document }) === MODO_PANTALLA.NATIVA) {
      try {
        await conLimite(pedirPantallaCompleta(el), ESPERA_MS)
        poner(MODO_PANTALLA.NATIVA)
        // En teléfonos intenta horizontal (donde el navegador lo permite: Chrome/Firefox Android).
        // Si no se puede, el diseño se adapta a cualquier orientación: nada depende de esto.
        const tactil = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
        if (esTelefono({ tactil, ancho: screen.width, alto: screen.height })) {
          try { await screen.orientation?.lock?.('landscape') } catch { /* no soportado o no permitido */ }
        }
        return
      } catch {
        // La rechazó o no contestó (permiso, política, WebView): cae a la simulada. Si justo se concedió
        // tarde, se respeta: el estado debe decir lo que el navegador hizo de verdad.
        if (elementoEnPantallaCompleta(document) === el) { poner(MODO_PANTALLA.NATIVA); return }
      }
    }
    poner(MODO_PANTALLA.SIMULADA)
  }, [ref, poner])

  const alternar = useCallback(() => { if (modoRef.current) salir(); else entrar() }, [entrar, salir])

  // Salir con Esc / gesto del navegador en la nativa: el navegador avisa con `fullscreenchange`.
  useEffect(() => {
    const alCambiar = () => {
      if (modoRef.current === MODO_PANTALLA.NATIVA && !elementoEnPantallaCompleta(document)) {
        poner(null)
        soltarOrientacion()
      }
    }
    document.addEventListener('fullscreenchange', alCambiar)
    document.addEventListener('webkitfullscreenchange', alCambiar)
    return () => {
      document.removeEventListener('fullscreenchange', alCambiar)
      document.removeEventListener('webkitfullscreenchange', alCambiar)
    }
  }, [poner, soltarOrientacion])

  // La simulada: Esc la cierra, el botón «atrás» de Android también, y la página de fondo no se desplaza.
  useEffect(() => {
    if (modo !== MODO_PANTALLA.SIMULADA) return undefined
    const alTeclear = (e) => { if (e.key === 'Escape') salir() }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [modo, salir])
  useScrollLock(modo === MODO_PANTALLA.SIMULADA)
  useBackHandler(salir, modo === MODO_PANTALLA.SIMULADA)

  // Al desmontar (p. ej. el estudiante entrega) no se deja el navegador en pantalla completa.
  useEffect(() => () => {
    if (modoRef.current === MODO_PANTALLA.NATIVA && elementoEnPantallaCompleta(document)) {
      salirDePantallaCompleta(document).catch(() => {})
    }
    soltarOrientacion()
  }, [soltarOrientacion])

  return { activa: modo !== null, modo, alternar, salir }
}
