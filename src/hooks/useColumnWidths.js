import { useState, useEffect, useCallback, useRef } from 'react'

// Anchos de columna ajustables y recordados. El usuario arrastra el borde
// derecho de cualquier encabezado y el ancho queda guardado en localStorage,
// así que la tabla se ve igual la próxima vez que entre.
//
// Requiere que la tabla use `table-fixed` + <colgroup>: sin eso el navegador
// reparte el ancho a su criterio y el arrastre no se respeta.
const MIN = 56
const MAX = 640

const clamp = (px) => Math.min(MAX, Math.max(MIN, Math.round(px)))

export function useColumnWidths(storageKey, defaults) {
  const [widths, setWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}')
      // Se parte SIEMPRE de los valores por defecto y encima se aplican los
      // guardados: si mañana se agrega una columna nueva, aparece con su
      // ancho correcto en vez de quedarse sin definir.
      return { ...defaults, ...saved }
    } catch {
      return defaults
    }
  })
  // La columna que se está arrastrando; null cuando no hay arrastre.
  const [dragKey, setDragKey] = useState(null)
  const startRef = useRef({ x: 0, w: 0 })

  const persist = useCallback((next) => {
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* almacenamiento lleno */ }
  }, [storageKey])

  const startResize = useCallback((e, key) => {
    if (e.button != null && e.button !== 0) return
    e.preventDefault() // sin esto el arrastre selecciona el texto del encabezado
    e.stopPropagation() // …y no debe además disparar el ordenamiento por columna
    startRef.current = { x: e.clientX, w: widths[key] ?? MIN }
    setDragKey(key)
  }, [widths])

  const resetWidths = useCallback(() => {
    setWidths(defaults)
    persist(defaults)
  }, [defaults, persist])

  // Doble clic en el separador: solo esa columna vuelve a su ancho original.
  const resetColumn = useCallback((key) => {
    setWidths((w) => {
      const next = { ...w, [key]: defaults[key] }
      persist(next)
      return next
    })
  }, [defaults, persist])

  useEffect(() => {
    if (!dragKey) return
    function onMove(e) {
      const { x, w } = startRef.current
      setWidths((prev) => ({ ...prev, [dragKey]: clamp(w + (e.clientX - x)) }))
    }
    function onUp() {
      setDragKey(null)
      setWidths((prev) => { persist(prev); return prev })
    }
    // Mientras se arrastra, el cursor de redimensionado manda en toda la
    // página y se bloquea la selección de texto, que si no se pinta de azul
    // al pasar por encima de las filas.
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
  }, [dragKey, persist])

  const total = Object.values(widths).reduce((a, b) => a + b, 0)

  return { widths, total, dragKey, startResize, resetWidths, resetColumn }
}
