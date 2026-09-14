import { useEffect, useState } from 'react'
import { IS_NATIVE_APP } from '../utils/platform'

// ¿Es un TELÉFONO abierto en el navegador? — nunca la app nativa, que tiene
// su propio camino (IS_NATIVE_APP) y aquí siempre da `false`.
//
// No basta con el ancho: un teléfono girado mide más de 768px (800×360,
// 915×412…) y cae en el breakpoint `md` de escritorio. Por eso se pide
// puntero táctil Y, o bien pantalla angosta (vertical), o bien pantalla muy
// baja (horizontal). Así quedan fuera las tablets (768×1024 / 1024×768), el
// escritorio y una ventana angosta manejada con mouse.
//
// La orientación se lee de la media query y no se fuerza: un navegador no
// puede bloquearla como la app (en iPhone no existe, en Android solo en
// pantalla completa). La pantalla se adapta a como el docente tenga el
// teléfono.
const Q_TELEFONO = '(pointer: coarse) and (max-width: 767.98px), (pointer: coarse) and (max-height: 500px)'
const Q_HORIZONTAL = '(orientation: landscape)'

function leer() {
  if (IS_NATIVE_APP || typeof window === 'undefined' || !window.matchMedia) {
    return { telefono: false, horizontal: false }
  }
  return {
    telefono: window.matchMedia(Q_TELEFONO).matches,
    horizontal: window.matchMedia(Q_HORIZONTAL).matches,
  }
}

export default function useTelefonoWeb() {
  const [estado, setEstado] = useState(leer)
  useEffect(() => {
    if (IS_NATIVE_APP) return undefined
    const mqs = [window.matchMedia(Q_TELEFONO), window.matchMedia(Q_HORIZONTAL)]
    const update = () => setEstado((prev) => {
      const next = leer()
      return prev.telefono === next.telefono && prev.horizontal === next.horizontal ? prev : next
    })
    mqs.forEach((mq) => mq.addEventListener('change', update))
    return () => mqs.forEach((mq) => mq.removeEventListener('change', update))
  }, [])
  return estado
}
