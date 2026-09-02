import { useState, useRef, useEffect } from 'react'
import { IS_NATIVE_APP } from '../utils/platform'

const MOVE_THRESHOLD = 5
const LONG_PRESS_MS = 450
const SCROLL_CANCEL_PX = 8

// Arrastre genérico con el puntero para "mover una pastilla existente":
// rastrea la posición, decide si hubo arrastre real y llama a onDrop con el
// estado final al soltar. Antes esta misma mecánica (estado + listeners de
// window en pointermove/pointerup + limpieza al desmontar) estaba copiada a
// mano en las 3 vistas del Calendario (Agenda, Semana, Mes) — cada una con su
// propio umbral y su propia limpieza.
//
// `payload` en startDrag(e, payload) es justo lo que antes cada vista pasaba
// a su propio setDrag (kind/b/ev/item…) — el hook solo le agrega x/y/moved y,
// si `grab` está activo, el offset de agarre (grabDX/DY) y el tamaño (w/h)
// del elemento, para que la vista pueda dibujar el "fantasma" pegado al dedo.
//
// `onDrop(dragState, pointerUpEvent)` se llama SIEMPRE al soltar — incluso
// sin arrastre real (dragState.moved distingue tap de arrastre, igual que
// antes, para abrir el editor/diálogo de acciones en vez de mover algo).
//
// `freezeX(dragState)` es un hook opcional (lo usa Semana): si regresa true,
// la coordenada X del fantasma se queda fija mientras se arrastra un bloque
// de clase, que solo se mueve en vertical (mismo día, otra hora).
//
// ── Cómo se activa el arrastre, según la plataforma ──────────────────────
//
// WEB: activación inmediata al presionar (como siempre). El arrastre se
// considera real en cuanto el puntero se aleja más de MOVE_THRESHOLD (5 px)
// del origen; por debajo de eso, soltar es un tap (moved: false).
//
// APP NATIVA: activación por LONG PRESS, porque el dedo tiene que poder
// hacer scroll sobre estos mismos elementos. Al presionar NO se arrastra
// nada todavía; arranca un temporizador de LONG_PRESS_MS (450 ms) y se
// resuelve en uno de tres caminos excluyentes:
//   · TAP    — se suelta antes de los 450 ms → onDrop con moved: false.
//   · SCROLL — el dedo se mueve más de SCROLL_CANCEL_PX (8 px) antes de los
//              450 ms → se cancela el temporizador y el hook se retira; el
//              gesto de scroll del navegador gana y NO se llama a onDrop.
//   · DRAG   — se cumplen los 450 ms sin soltar ni rebasar los 8 px → el
//              arrastre se activa (moved: true, aparece el fantasma) y a
//              partir de ahí se comporta igual que en la web.
// Esto reemplaza la regla anterior de "en la App un toque SIEMPRE cuenta
// como tap, nunca como arrastre", que impedía mover nada desde el teléfono.
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
      // El callback del padre se llama FUERA del updater de setDrag (evita
      // "setState durante render").
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
