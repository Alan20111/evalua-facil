import { useCallback, useEffect, useRef, useState } from 'react'

// Reproductor de YouTube (IFrame Player API) para el Video interactivo.
//
// Reglas de YouTube que condicionan el diseño (developers.google.com/youtube/
// terms/required-minimum-functionality):
//   · NADA puede ir encima del reproductor (ni sobre sus controles): la pregunta
//     y los botones viven FUERA del recuadro del video, nunca encima.
//   · El reproductor mide al menos 200×200 px (en vertical, 16:9 a ancho de
//     teléfono ya cumple).
//   · Solo se inicia la reproducción por gesto del estudiante (botón propio).
//
// Los controles nativos se apagan (`controls: 0`, sin teclado, sin pantalla
// completa) porque la línea de tiempo es la nuestra: es la que sabe hasta dónde
// puede llegar el estudiante. No es una barrera por sí sola — la detección de
// saltos y la regla de Firestore son las que la sostienen (ver videoProgreso.js).
//
// El video se sirve desde youtube-nocookie.com (menos cookies de seguimiento).

export const ESTADO_YT = { SIN_INICIAR: -1, TERMINADO: 0, REPRODUCIENDO: 1, PAUSADO: 2, CARGANDO: 3, LISTO: 5 }

let promesaApi = null
function cargarApiYouTube() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Sin ventana'))
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (promesaApi) return promesaApi
  promesaApi = new Promise((resolve, reject) => {
    const previo = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { try { previo?.() } catch { /* el previo no es asunto nuestro */ } resolve(window.YT) }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    s.onerror = () => { promesaApi = null; reject(new Error('No se pudo cargar el reproductor de YouTube')) }
    document.head.appendChild(s)
  })
  return promesaApi
}

// Códigos de error del reproductor → mensaje para el estudiante.
export function mensajeErrorYouTube(codigo) {
  if (codigo === 100) return 'Este video ya no está disponible en YouTube.'
  if (codigo === 101 || codigo === 150) return 'El dueño del video no permite verlo aquí.'
  if (codigo === 2) return 'El enlace del video no es válido.'
  if (codigo === 5) return 'Tu navegador no pudo reproducir este video.'
  return 'No se pudo cargar el video.'
}

// `contenedorRef`: div vacío con el tamaño del video (la API crea dentro el iframe).
// `onEstado(código)` y `onError(código)` se leen siempre en su última versión.
export default function useYouTubePlayer({ videoId, contenedorRef, inicioSeg = 0, onEstado, onError }) {
  const playerRef = useRef(null)
  const [listo, setListo] = useState(false)
  const [error, setError] = useState(null)
  const [intento, setIntento] = useState(0)
  const onEstadoRef = useRef(onEstado)
  const onErrorRef = useRef(onError)
  useEffect(() => { onEstadoRef.current = onEstado; onErrorRef.current = onError })

  useEffect(() => {
    const contenedor = contenedorRef.current
    if (!videoId || !contenedor) return undefined
    let cancelado = false
    let player = null
    const hijo = document.createElement('div')
    hijo.style.width = '100%'
    hijo.style.height = '100%'
    contenedor.appendChild(hijo)
    setListo(false)
    setError(null)
    cargarApiYouTube().then((YT) => {
      if (cancelado) return
      player = new YT.Player(hijo, {
        videoId,
        host: 'https://www.youtube-nocookie.com',
        width: '100%',
        height: '100%',
        playerVars: {
          controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1, playsinline: 1,
          iv_load_policy: 3, cc_load_policy: 1, hl: 'es', start: Math.max(0, Math.floor(inicioSeg)),
          origin: window.location.origin,
        },
        events: {
          onReady: () => { if (!cancelado) { playerRef.current = player; setListo(true) } },
          onStateChange: (e) => { if (!cancelado) onEstadoRef.current?.(e.data) },
          onError: (e) => {
            if (cancelado) return
            setError(e.data)
            onErrorRef.current?.(e.data)
          },
        },
      })
    }).catch(() => { if (!cancelado) setError(-1) })
    return () => {
      cancelado = true
      playerRef.current = null
      try { player?.destroy() } catch { /* ya destruido */ }
      hijo.remove()
    }
    // `inicioSeg` solo importa al crear; reintentar recrea el reproductor.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- creación única por video/intento
  }, [videoId, intento])

  const llamar = (fn, def) => { try { return playerRef.current ? fn(playerRef.current) : def } catch { return def } }
  const tiempo = useCallback(() => llamar((p) => Number(p.getCurrentTime()) || 0, 0), [])
  const estado = useCallback(() => llamar((p) => p.getPlayerState(), ESTADO_YT.SIN_INICIAR), [])
  const duracion = useCallback(() => llamar((p) => Number(p.getDuration()) || 0, 0), [])
  const reproducir = useCallback(() => llamar((p) => p.playVideo(), null), [])
  const pausar = useCallback(() => llamar((p) => p.pauseVideo(), null), [])
  const saltarA = useCallback((seg) => llamar((p) => p.seekTo(Math.max(0, seg), true), null), [])
  const reintentar = useCallback(() => setIntento((n) => n + 1), [])

  return { listo, error, tiempo, estado, duracion, reproducir, pausar, saltarA, reintentar }
}
