import { useEffect, useState } from 'react'

// ¿Se cumple esta media query ahora? Se actualiza sola al girar el dispositivo o cambiar el tamaño de la
// ventana. Sin `matchMedia` (pruebas, navegadores raros) devuelve `false`.
export default function useMediaQuery(consulta) {
  const leer = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(consulta).matches
  const [coincide, setCoincide] = useState(leer)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(consulta)
    const alCambiar = () => setCoincide(mq.matches)
    alCambiar()
    mq.addEventListener('change', alCambiar)
    return () => mq.removeEventListener('change', alCambiar)
  }, [consulta])
  return coincide
}
