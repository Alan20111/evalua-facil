import { useEffect } from 'react'

// Contador a nivel de módulo — si hay dos overlays abiertos a la vez (uno
// anidado dentro del otro, ej. el selector de fecha abierto DESDE DENTRO de
// "Nuevo evento"), solo se restaura el scroll cuando se cierra el ÚLTIMO.
let lockCount = 0
let savedScrollY = 0

// Bloquea el scroll de la página de fondo mientras un overlay (modal/popover)
// está abierto — sin esto, arrastrar el dedo sobre el overlay en Android
// también desplaza lo que está detrás. Usa position:fixed (más confiable en
// WebView que overflow:hidden a secas): con el body fijado, físicamente no
// puede hacer scroll sin importar dónde ocurra el gesto. El scroll INTERNO
// de cada overlay (sus propios overflow-y-auto) no se toca, sigue igual.
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return
    if (lockCount === 0) {
      savedScrollY = window.scrollY
      document.body.style.position = 'fixed'
      document.body.style.top = `-${savedScrollY}px`
      document.body.style.left = '0'
      document.body.style.right = '0'
      document.body.style.width = '100%'
    }
    lockCount++
    return () => {
      lockCount--
      if (lockCount === 0) {
        document.body.style.position = ''
        document.body.style.top = ''
        document.body.style.left = ''
        document.body.style.right = ''
        document.body.style.width = ''
        window.scrollTo(0, savedScrollY)
      }
    }
  }, [active])
}
