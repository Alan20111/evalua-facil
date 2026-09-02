import { useState, useRef, useEffect } from 'react'
import { IS_NATIVE_APP } from '../utils/platform'

const MOVE_THRESHOLD = 5
const LONG_PRESS_MS = 450
const SCROLL_CANCEL_PX = 8

// En la app nativa los elementos arrastrables usan LONG PRESS:
// mantener 450 ms → activa el arrastre (ghost aparece).
// Mover > 8 px antes de 450 ms → cancela (gesto de scroll ganó).
// Soltar antes de 450 ms → tap (opened = moved:false).
// En la web el arrastre es inmediato, igual que antes.
export function usePointerDrag(onDrop, { grab = true, freezeX } = {}) {
  const [drag, setDrag]           = useState(null)
  const [hasPending, setHasPending] = useState(false)

  const startRef   = useRef(null)
  const pendingRef = useRef(null)   // datos del item en espera (native)
  const timerRef   = useRef(null)
  const onDropRef  = useRef(onDrop)
  const freezeXRef = useRef(freezeX)

  useEffect(() => {
    onDropRef.current  = onDrop
    freezeXRef.current = freezeX
  })

  function clearTimer() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  function startDrag(e, payload) {
    if (e.button != null && e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    startRef.current = { x: e.clientX, y: e.clientY }

    const base = {
      ...payload,
      x: e.clientX, y: e.clientY,
      w: rect.width,
      ...(grab
        ? { grabDX: e.clientX - rect.left, grabDY: e.clientY - rect.top, h: rect.height }
        : {}),
    }

    if (IS_NATIVE_APP) {
      // Nativo: espera long press antes de activar arrastre
      pendingRef.current = base
      setHasPending(true)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        const p = pendingRef.current
        if (!p) return          // ya fue cancelado (scroll o tap)
        pendingRef.current = null
        setHasPending(false)
        setDrag({ ...p, moved: true })
      }, LONG_PRESS_MS)
      return
    }

    // Web: activación inmediata
    setDrag({ ...base, moved: false })
  }

  // Nativo: escucha ANTES de que el arrastre se active (durante long press)
  useEffect(() => {
    if (!IS_NATIVE_APP || !hasPending) return
    function onMove(e) {
      const s = startRef.current
      if (!pendingRef.current || !s) return
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > SCROLL_CANCEL_PX) {
        // Dedo se movió demasiado → era un scroll, cancelar long press
        clearTimer()
        pendingRef.current = null
        setHasPending(false)
      }
    }
    function onUp(e) {
      const p = pendingRef.current   // guardar antes de limpiar
      clearTimer()
      pendingRef.current = null
      setHasPending(false)
      if (p) onDropRef.current({ ...p, moved: false }, e)  // tap
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup',   onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup',   onUp)
    }
  }, [hasPending])

  // Arrastre activo (web y nativo, después del long press)
  useEffect(() => {
    if (!drag) return
    function onMove(e) {
      const s     = startRef.current
      const moved = s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_THRESHOLD
      setDrag(d => {
        if (!d) return d
        const nextX = freezeXRef.current?.(d) ? d.x : e.clientX
        return { ...d, x: nextX, y: e.clientY, moved: d.moved || moved }
      })
    }
    function onUp(e) {
      const d = drag
      setDrag(null)
      if (d) onDropRef.current(d, e)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup',   onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup',   onUp)
    }
  }, [drag])

  return { drag, startDrag }
}
