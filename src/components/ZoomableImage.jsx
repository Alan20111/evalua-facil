import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useBackHandler } from '../hooks/useBackHandler'
import { useScrollLock } from '../hooks/useScrollLock'

const MIN_SCALE = 1
const MAX_SCALE = 4
const DOUBLE_TAP_SCALE = 2.5
const DOUBLE_TAP_MS = 300

function touchDistance(touches) {
  const [a, b] = touches
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

function clampTransform(t) {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale))
  // A escala 1 la imagen ya cabe completa — no dejar arrastrarla fuera de vista.
  return scale === 1 ? { scale, x: 0, y: 0 } : { ...t, scale }
}

function ZoomOverlay({ src, alt, onClose }) {
  useBackHandler(onClose, true)
  useScrollLock(true)
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })
  // Estado del gesto en curso — vive en un ref porque cambia en cada evento
  // de touch/mouse y no necesita disparar un re-render por sí solo.
  const gesture = useRef({ mode: null, startDist: 0, startScale: 1, startX: 0, startY: 0, lastX: 0, lastY: 0, lastTapTime: 0 })

  function toggleZoom(clientX, clientY) {
    setTransform((t) => {
      if (t.scale > 1) return { scale: 1, x: 0, y: 0 }
      // Centra el acercamiento en el punto tocado/clickeado.
      const box = document.getElementById('ef-zoom-stage')?.getBoundingClientRect()
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
      gesture.current.mode = 'pan'
      gesture.current.startX = transform.x
      gesture.current.startY = transform.y
      gesture.current.lastX = e.touches[0].clientX
      gesture.current.lastY = e.touches[0].clientY
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

  // Soporte de mouse (arrastrar para desplazar cuando hay zoom) — sobre todo
  // para poder probar este componente desde un navegador de escritorio; el
  // doble-tap táctil arriba tiene su equivalente en onDoubleClick más abajo.
  function handleMouseDown(e) {
    if (transform.scale <= 1) return
    gesture.current.mode = 'pan'
    gesture.current.startX = transform.x
    gesture.current.startY = transform.y
    gesture.current.lastX = e.clientX
    gesture.current.lastY = e.clientY
  }
  function handleMouseMove(e) {
    if (gesture.current.mode !== 'pan') return
    const dx = e.clientX - gesture.current.lastX
    const dy = e.clientY - gesture.current.lastY
    setTransform((t) => ({ ...t, x: gesture.current.startX + dx, y: gesture.current.startY + dy }))
  }
  function handleMouseUp() {
    gesture.current.mode = null
  }
  function handleWheel(e) {
    e.preventDefault()
    setTransform((t) => clampTransform({ ...t, scale: t.scale - e.deltaY * 0.002 }))
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-black/90 flex flex-col"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        data-tooltip="Cerrar"
        className="absolute top-3 right-3 z-10 p-2 text-white/80 hover:text-white bg-black/40 rounded-full safe-top"
      >
        <X size={22} />
      </button>
      {/* Superficie de gesto (pellizcar/arrastrar/rueda) — no un control
          discreto, no hay equivalente de teclado razonable para "pellizcar". */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        id="ef-zoom-stage"
        className="flex-1 min-h-0 flex items-center justify-center overflow-hidden"
        onDoubleClick={(e) => toggleZoom(e.clientX, e.clientY)}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <img
          src={src}
          alt={alt}
          className="max-w-full max-h-full object-contain select-none"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            cursor: transform.scale > 1 ? 'grab' : 'zoom-in',
          }}
          draggable={false}
        />
      </div>
    </div>,
    document.body
  )
}

// Imagen normal que, al tocarla, abre un visor de pantalla completa con
// pinch-zoom (dos dedos), doble-tap para alternar zoom y arrastre para
// desplazar cuando está ampliada — sin salir de la pantalla actual.
// `fit="width"` (default): la miniatura ocupa el ancho del contenedor.
// `fit="height"`: la miniatura ocupa el alto del contenedor y se recorta a
// lo ancho — pensado para tiras horizontales de miniaturas de alto fijo.
export default function ZoomableImage({ src, alt, className, fit = 'width' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`block ${fit === 'height' ? 'h-full flex-shrink-0' : 'w-full'} ${className || ''}`}
        data-tooltip="Toca para ampliar"
      >
        <img
          src={src}
          alt={alt}
          className={fit === 'height' ? 'h-full w-auto object-contain rounded' : 'w-full h-auto rounded'}
          draggable={false}
        />
      </button>
      {open && <ZoomOverlay src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  )
}
