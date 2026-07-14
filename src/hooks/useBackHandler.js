import { useEffect, useRef } from 'react'

// Pila global module-level (fuera de React) — el listener nativo del botón
// físico de Android siempre ejecuta el handler de hasta arriba: el modal
// abierto más reciente, o si no hay ninguno, la pantalla actual.
const stack = []

export function useBackHandler(handler, active = true) {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    if (!active) return
    const entry = () => handlerRef.current()
    stack.push(entry)
    return () => {
      const i = stack.indexOf(entry)
      if (i !== -1) stack.splice(i, 1)
    }
  }, [active])
}

// Llamado por el listener nativo del botón atrás. Devuelve `true` si cerró
// un modal o navegó una pantalla; `false` si la pila estaba vacía (pantalla raíz).
export function popAndRunTop() {
  const top = stack[stack.length - 1]
  if (top) {
    top()
    return true
  }
  return false
}
