import { useEffect } from 'react'

// Contador a nivel de módulo — si hay dos overlays abiertos a la vez (uno
// anidado dentro del otro, ej. el selector de fecha abierto DESDE DENTRO de
// "Nuevo evento"), solo se restaura el scroll cuando se cierra el ÚLTIMO.
let lockCount = 0

// Bloquea el scroll de la página de fondo mientras un overlay (modal/popover)
// está abierto — sin esto, arrastrar el dedo sobre el overlay en Android
// también desplaza lo que está detrás. Usa overflow:hidden en <html>/<body>,
// NO position:fixed — con position:fixed, si el usuario toca un campo de
// texto dentro del overlay y el teclado se abre (WebView Android en modo
// edge-to-edge recalcula los insets del viewport), el WebView se congela en
// un frame en blanco hasta que algo fuerza un repintado — el mismo bug ya
// visto con autoFocus, solo que disparado por CUALQUIER foco de teclado, no
// solo al montar. overflow:hidden nunca toca position/top, así que no puede
// interactuar con la apertura del teclado, y en Chromium/Android alcanza
// para bloquear el scroll (a diferencia de iOS Safari, que sí necesitaría el
// truco de position:fixed por el rebote elástico). El scroll INTERNO de cada
// overlay (sus propios overflow-y-auto) no se toca, sigue igual.
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return
    if (lockCount === 0) {
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
    }
    lockCount++
    return () => {
      lockCount--
      if (lockCount === 0) {
        document.documentElement.style.overflow = ''
        document.body.style.overflow = ''
      }
    }
  }, [active])
}
