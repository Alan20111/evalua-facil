import { useEffect, useRef, useState } from 'react'

// MIN_SCALE por debajo de 1 permite alejar más allá del tamaño ajustado al
// ancho del panel (antes tope duro en 1 — Ctrl+rueda hacia atrás no hacía
// nada una vez llegado al 100%, aunque la página se viera más grande que la
// pantalla y el docente quisiera verla completa).
const MIN_SCALE = 0.5
const MAX_SCALE = 4
const DOUBLE_TAP_SCALE = 2.5
const DOUBLE_TAP_MS = 300

function touchDistance(touches) {
  const [a, b] = touches
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

function clampTransform(t) {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale))
  return scale === 1 ? { scale, x: 0, y: 0 } : { ...t, scale }
}

// Pellizcar/doble-tap/arrastrar DIRECTO sobre la imagen, sin tocar primero
// para abrir una pantalla completa aparte (a diferencia de ZoomableImage).
// Pensado para páginas de PDF, que ya ocupan todo el ancho del panel: el
// pellizcar acerca en el lugar. `touch-action: pan-y` deja que un dedo siga
// haciendo scroll normal entre páginas; el pellizcar (dos dedos) se maneja
// aparte y si el docente ya hizo zoom, arrastrar con un dedo desplaza la
// imagen en vez de hacer scroll.
export default function PinchZoomImage({ src, alt, className = 'block w-full mb-1', imgClassName = 'w-full h-auto', onLoad, onError }) {
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })
  const gesture = useRef({ mode: null, startDist: 0, startScale: 1, startX: 0, startY: 0, lastX: 0, lastY: 0, lastTapTime: 0 })
  const stageRef = useRef(null)

  function toggleZoom(clientX, clientY) {
    setTransform((t) => {
      if (t.scale > 1) return { scale: 1, x: 0, y: 0 }
      const box = stageRef.current?.getBoundingClientRect()
      const dx = box ? (box.width / 2 - (clientX - box.left)) : 0
      const dy = box ? (box.height / 2 - (clientY - box.top)) : 0
      return clampTransform({ scale: DOUBLE_TAP_SCALE, x: dx * (DOUBLE_TAP_SCALE - 1), y: dy * (DOUBLE_TAP_SCALE - 1) })
    })
  }

  function handleTouchStart(e) {
    if (e.touches.length === 2) {
      gesture.current.mode = 'pinch'
      gesture.current.startDist = touchDistance(e.touches)
      gesture.current.startScale = transform.scale
    } else if (e.touches.length === 1) {
      const now = Date.now()
      if (now - gesture.current.lastTapTime < DOUBLE_TAP_MS) {
        gesture.current.lastTapTime = 0
        gesture.current.mode = null
        toggleZoom(e.touches[0].clientX, e.touches[0].clientY)
        return
      }
      gesture.current.lastTapTime = now
      if (transform.scale > 1) {
        gesture.current.mode = 'pan'
        gesture.current.startX = transform.x
        gesture.current.startY = transform.y
        gesture.current.lastX = e.touches[0].clientX
        gesture.current.lastY = e.touches[0].clientY
      }
    }
  }

  function handleTouchMove(e) {
    if (gesture.current.mode === 'pinch' && e.touches.length === 2) {
      e.preventDefault()
      const dist = touchDistance(e.touches)
      const factor = dist / (gesture.current.startDist || dist)
      setTransform((t) => clampTransform({ ...t, scale: gesture.current.startScale * factor }))
    } else if (gesture.current.mode === 'pan' && e.touches.length === 1 && transform.scale > 1) {
      e.preventDefault()
      const dx = e.touches[0].clientX - gesture.current.lastX
      const dy = e.touches[0].clientY - gesture.current.lastY
      setTransform((t) => ({ ...t, x: gesture.current.startX + dx, y: gesture.current.startY + dy }))
    }
  }

  function handleTouchEnd(e) {
    if (e.touches.length === 0) gesture.current.mode = null
  }

  // Nativo y no-pasivo a propósito: el onWheel sintético de React se registra
  // como pasivo, así que e.preventDefault() ahí NO evita el zoom nativo del
  // navegador (Ctrl+rueda hace zoom a toda la pantalla, no solo aquí) — con
  // un listener nativo { passive: false } sí se puede bloquear. Solo con
  // Ctrl/Cmd presionado: la rueda sola sigue haciendo scroll normal.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    function handleWheel(e) {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setTransform((t) => clampTransform({ ...t, scale: t.scale - e.deltaY * 0.01 }))
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  return (
    <div
      ref={stageRef}
      className={`${className} overflow-hidden relative`}
      style={{ touchAction: 'pan-y' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onDoubleClick={(e) => toggleZoom(e.clientX, e.clientY)}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={onLoad}
        onError={onError}
        className={imgClassName}
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: 'center',
        }}
      />
    </div>
  )
}
