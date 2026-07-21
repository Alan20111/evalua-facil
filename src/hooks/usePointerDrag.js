import { useState, useRef, useEffect } from 'react'
import { IS_NATIVE_APP } from '../utils/platform'

const MOVE_THRESHOLD = 5

// Arrastre genérico con el puntero para "mover una pastilla existente":
// rastrea la posición, decide si hubo arrastre real (> 5px — en la App un
// toque SIEMPRE cuenta como tap, nunca como arrastre) y llama a onDrop con el
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
export function usePointerDrag(onDrop, { grab = true, freezeX } = {}) {
  const [drag, setDrag] = useState(null)
  const startRef = useRef(null)
  const onDropRef = useRef(onDrop)
  const freezeXRef = useRef(freezeX)
  useEffect(() => {
    onDropRef.current = onDrop
    freezeXRef.current = freezeX
  })

  function startDrag(e, payload) {
    if (e.button != null && e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    startRef.current = { x: e.clientX, y: e.clientY }
    setDrag({
      ...payload,
      x: e.clientX,
      y: e.clientY,
      w: rect.width,
      ...(grab ? { grabDX: e.clientX - rect.left, grabDY: e.clientY - rect.top, h: rect.height } : {}),
      moved: false,
    })
  }

  useEffect(() => {
    if (!drag) return
    function onMove(e) {
      const s = startRef.current
      const moved = !IS_NATIVE_APP && s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_THRESHOLD
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
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag])

  return { drag, startDrag }
}
