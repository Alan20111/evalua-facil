import { useState, useEffect, useRef, useCallback } from 'react'

// Ancho ajustable de la barra lateral del panel admin: el usuario arrastra el
// borde derecho y el ancho queda guardado en localStorage, así que sobrevive
// recargas y cambios de pestaña. Solo aplica en escritorio — en móvil la barra
// es un cajón superpuesto de ancho fijo (ver AdminLayout).
const STORAGE_KEY = 'admin-sidebar-w'

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 460
export const SIDEBAR_DEFAULT = 256 // = w-64, el ancho que tenía antes de ser ajustable

const clamp = (px) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(px)))

export function useResizableSidebar() {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY))
      return saved ? clamp(saved) : SIDEBAR_DEFAULT
    } catch {
      return SIDEBAR_DEFAULT
    }
  })
  const [resizing, setResizing] = useState(false)
  const asideRef = useRef(null)

  const persist = useCallback((px) => {
    try { localStorage.setItem(STORAGE_KEY, String(px)) } catch { /* almacenamiento lleno */ }
  }, [])

  const startResize = useCallback((e) => {
    if (e.button != null && e.button !== 0) return
    e.preventDefault() // sin esto el arrastre selecciona el texto de la barra
    setResizing(true)
  }, [])

  // Doble clic en el separador = volver al ancho original, sin tener que
  // adivinarlo arrastrando.
  const resetWidth = useCallback(() => {
    setWidth(SIDEBAR_DEFAULT)
    persist(SIDEBAR_DEFAULT)
  }, [persist])

  // Flechas ←/→ mueven el separador cuando tiene el foco (teclado, sin ratón).
  const onKeyDown = useCallback((e) => {
    const step = e.shiftKey ? 32 : 8
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      setWidth((w) => {
        const next = clamp(w + (e.key === 'ArrowRight' ? step : -step))
        persist(next)
        return next
      })
    } else if (e.key === 'Home') {
      e.preventDefault()
      resetWidth()
    }
  }, [persist, resetWidth])

  useEffect(() => {
    if (!resizing) return
    // El ancho se mide desde el borde izquierdo real de la barra, no desde 0:
    // así sigue siendo correcto si la ventana está desplazada o la barra deja
    // de estar pegada al borde de la pantalla.
    const left = asideRef.current?.getBoundingClientRect().left ?? 0
    function onMove(e) { setWidth(clamp(e.clientX - left)) }
    function onUp(e) {
      setResizing(false)
      persist(clamp(e.clientX - left))
    }
    // Mientras se arrastra, el cursor de redimensionado manda en TODA la
    // página (no solo sobre el separador) y se bloquea la selección de texto,
    // que si no se pinta de azul al pasar por encima del menú.
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
    }
  }, [resizing, persist])

  return { width, resizing, asideRef, startResize, resetWidth, onKeyDown }
}
