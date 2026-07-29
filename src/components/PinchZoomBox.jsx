import { useRef, useState } from 'react'

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
  return scale === 1 ? { scale, x: 0, y: 0 } : { ...t, scale }
}

// Igual gesto que ZoomableImage (pellizcar, doble-tap, arrastrar) pero EN SU
// LUGAR — no abre una pantalla completa aparte, porque el contenido que
// envuelve (un PDF) ya ocupa todo el panel. Sirve para cualquier `children`,
// no solo <img>: el transform de CSS se aplica al envoltorio, no al
// contenido en sí.
//
// Riesgo conocido y sin resolver: si `children` es un <object>/<embed> (el
// visor nativo de PDF del navegador), algunos navegadores aíslan ese
// contenido como si fuera un plugin aparte — el gesto de los dedos puede no
// llegar nunca a los manejadores de aquí cuando el dedo está justo encima
// del PDF. No hay forma de confirmar esto sin probarlo en un dispositivo
// real; si el pellizcar no responde, el visor propio (con pdf.js) es el
// siguiente paso.
export default function PinchZoomBox({ children, className = 'w-full h-full overflow-hidden relative' }) {
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

  // Solo con Ctrl/Cmd presionado: la rueda del mouse sola debe seguir
  // haciendo scroll normal por las páginas del PDF, no zoom sin querer.
  function handleWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    setTransform((t) => clampTransform({ ...t, scale: t.scale - e.deltaY * 0.01 }))
  }

  return (
    <div
      ref={stageRef}
      className={className}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onWheel={handleWheel}
      onDoubleClick={(e) => toggleZoom(e.clientX, e.clientY)}
    >
      <div
        className="w-full h-full origin-center"
        style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
      >
        {children}
      </div>
    </div>
  )
}
