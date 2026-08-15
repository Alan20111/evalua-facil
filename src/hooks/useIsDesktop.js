import { useEffect, useState } from 'react'

// Mismo punto de corte que el breakpoint `md` de Tailwind (768px), donde
// Layout.jsx cambia de barra superior/inferior (celular) a sidebar fija
// (escritorio) — se usa para decidir cuándo mostrar UI que de plano no
// cabe bien en una pantalla angosta, como la revisión de la Planeación.
export default function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = () => setIsDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}
