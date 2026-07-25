import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { repartirAnchos, MIN_PX } from '../utils/columnWidths'

// Anchos de columna ajustables, recordados y que SIEMPRE llenan el área.
//
// La clave del diseño: el ancho total es fijo (= el ancho del contenedor), así
// que ensanchar una columna angosta a su vecina de la derecha en vez de
// empujar la tabla hacia afuera. Sin esto, arrastrar hacia la derecha hacía
// crecer la tabla y las últimas columnas se salían del área visible.
//
// Los anchos se guardan como PROPORCIONES, no como píxeles: así la tabla se
// ve bien al cambiar el tamaño de la ventana o al abrirla en otro monitor,
// y sigue llenando el área en ambos casos.
//
// Requiere que la tabla use `table-fixed` + <colgroup>: sin eso el navegador
// reparte el ancho a su criterio y el arrastre no se respeta.
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

export function useColumnWidths(storageKey, cols) {
  const keys = useMemo(() => cols.map((c) => c.key), [cols])

  // Proporciones por defecto, derivadas de los anchos sugeridos en COLS.
  const defaults = useMemo(() => {
    const suma = cols.reduce((a, c) => a + c.w, 0)
    return Object.fromEntries(cols.map((c) => [c.key, c.w / suma]))
  }, [cols])

  const anchoNatural = useMemo(() => cols.reduce((a, c) => a + c.w, 0), [cols])

  const [fracs, setFracs] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}')
      // Se parte SIEMPRE de los valores por defecto y encima se aplican los
      // guardados: si mañana se agrega una columna, aparece con su proporción
      // correcta en vez de quedarse sin definir.
      return { ...defaults, ...saved }
    } catch {
      return defaults
    }
  })
  const [containerW, setContainerW] = useState(0)
  const [dragKey, setDragKey] = useState(null)
  const startRef = useRef(null)

  // Ref de callback + ResizeObserver. La medida se toma SOLO desde el
  // callback del observer (que corre fuera del render) y no de forma
  // síncrona dentro de un efecto, que dispara renders en cascada.
  const roRef = useRef(null)
  const containerRef = useCallback((el) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setContainerW(entry.contentRect.width))
    ro.observe(el)
    roRef.current = ro
  }, [])

  useEffect(() => () => roRef.current?.disconnect(), [])

  // Ancho de trabajo: el del área. Si el área es más angosta que el mínimo
  // que necesitan todas las columnas juntas (móvil, ventana chica), se usa
  // ese mínimo y entonces —solo entonces— aparece el scroll horizontal.
  // Antes de la primera medición se usa el ancho natural, para no dibujar un
  // primer cuadro con la tabla encogida.
  const minTotal = keys.length * MIN_PX
  const available = containerW ? Math.max(containerW, minTotal) : anchoNatural

  // Proporciones → píxeles, garantizando que la suma dé exactamente el ancho
  // disponible y que ninguna columna baje del mínimo (ver utils/columnWidths).
  const widths = useMemo(
    () => repartirAnchos(keys, fracs, defaults, available),
    [keys, fracs, defaults, available]
  )

  const persist = useCallback((next) => {
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* almacenamiento lleno */ }
  }, [storageKey])

  // La última columna no lleva tirador: es la que absorbe el sobrante para
  // que el total cuadre exacto con el área.
  const esRedimensionable = useCallback((key) => keys.indexOf(key) < keys.length - 1, [keys])

  const startResize = useCallback((e, key) => {
    if (e.button != null && e.button !== 0) return
    const i = keys.indexOf(key)
    if (i < 0 || i >= keys.length - 1) return
    e.preventDefault()  // sin esto el arrastre selecciona el texto del encabezado
    e.stopPropagation() // …y no debe además disparar el ordenamiento por columna
    startRef.current = { x: e.clientX, i, a: widths[key], b: widths[keys[i + 1]] }
    setDragKey(key)
  }, [keys, widths])

  const resetWidths = useCallback(() => {
    setFracs(defaults)
    persist(defaults)
  }, [defaults, persist])

  // Doble clic en el tirador: esa columna vuelve a su proporción original y la
  // diferencia se le devuelve a su vecina, para no descuadrar el total.
  const resetColumn = useCallback((key) => {
    const i = keys.indexOf(key)
    if (i < 0 || i >= keys.length - 1) return
    setFracs((f) => {
      const vecina = keys[i + 1]
      const par = (f[key] ?? defaults[key]) + (f[vecina] ?? defaults[vecina])
      const minFrac = MIN_PX / available
      const nueva = clamp(defaults[key], minFrac, par - minFrac)
      const next = { ...f, [key]: nueva, [vecina]: par - nueva }
      persist(next)
      return next
    })
  }, [keys, defaults, available, persist])

  useEffect(() => {
    if (!dragKey) return
    function onMove(e) {
      const s = startRef.current
      if (!s) return
      const par = s.a + s.b
      // El par de columnas conserva su ancho conjunto: lo que gana una lo
      // pierde la otra. Ese invariante es lo que mantiene el total pegado al
      // ancho del área y evita que las columnas de la derecha se salgan.
      const nuevaA = clamp(s.a + (e.clientX - s.x), MIN_PX, par - MIN_PX)
      setFracs((f) => ({
        ...f,
        [keys[s.i]]: nuevaA / available,
        [keys[s.i + 1]]: (par - nuevaA) / available,
      }))
    }
    function onUp() {
      setDragKey(null)
      startRef.current = null
      setFracs((f) => { persist(f); return f })
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
  }, [dragKey, keys, available, persist])

  return {
    containerRef,
    widths,
    total: available,
    dragKey,
    startResize,
    resetWidths,
    resetColumn,
    esRedimensionable,
  }
}
