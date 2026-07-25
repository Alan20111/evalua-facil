import { useState, useRef, useEffect } from 'react'
import { X, Check } from 'lucide-react'
import { useBackHandler } from '../hooks/useBackHandler'
import Spinner from './Spinner'

// Pedido explícito: al elegir una foto de perfil (docente o alumno), poder
// acercar/alejar con la rueda del mouse y que solo se guarde lo que se ve
// dentro del círculo — antes se subía el archivo tal cual, sin recortar.
// Un solo componente compartido entre las dos pantallas de Perfil.
const VIEWPORT = 240 // px — diámetro del círculo en pantalla
const OUTPUT = 480   // px — tamaño del cuadro exportado (se sube como imagen)
const MIN_ZOOM = 1
const MAX_ZOOM = 4

export default function AvatarCropModal({ file, onCancel, onConfirm, saving }) {
  const [imgEl, setImgEl] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef(null)
  const viewportRef = useRef(null)

  useBackHandler(onCancel, true)

  useEffect(() => {
    if (!file) return undefined
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      setImgEl(img)
      setZoom(1)
      setOffset({ x: 0, y: 0 })
    }
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Escala "base" — la mínima que cubre el círculo por completo sin dejar
  // huecos — el zoom del usuario multiplica sobre esta.
  const baseScale = imgEl ? Math.max(VIEWPORT / imgEl.naturalWidth, VIEWPORT / imgEl.naturalHeight) : 1
  const scale = baseScale * zoom
  const dispW = imgEl ? imgEl.naturalWidth * scale : 0
  const dispH = imgEl ? imgEl.naturalHeight * scale : 0

  // No deja que el usuario arrastre la imagen más allá de donde dejaría un
  // hueco vacío dentro del círculo.
  function clampOffset(o, w, h) {
    const maxX = Math.max(0, (w - VIEWPORT) / 2)
    const maxY = Math.max(0, (h - VIEWPORT) / 2)
    return { x: Math.min(maxX, Math.max(-maxX, o.x)), y: Math.min(maxY, Math.max(-maxY, o.y)) }
  }

  useEffect(() => {
    setOffset((o) => clampOffset(o, dispW, dispH))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, imgEl])

  // React adjunta onWheel como passive por default desde React 17, así que
  // e.preventDefault() ahí no hace nada — el scroll se le sigue yendo a la
  // página de atrás. Hay que engancharse nativamente con { passive: false }.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return undefined
    const onWheelNative = (e) => {
      e.preventDefault()
      e.stopPropagation()
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z - e.deltaY * 0.0015)))
    }
    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', onWheelNative)
  }, [])
  function handlePointerDown(e) {
    // El círculo de recorte necesita su propio arrastre — sin esto, el
    // listener global de "arrastrar cualquier ventana" (installDraggableOverlays,
    // que también escucha en fase de captura) movía el modal completo en vez
    // de solo la foto de adentro. La clase ef-nodrag ya lo excluye, pero
    // stopPropagation es un segundo seguro por si algo más escucha pointerdown.
    e.stopPropagation()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: offset }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function handlePointerMove(e) {
    if (!dragRef.current) return
    e.stopPropagation()
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    setOffset(clampOffset(
      { x: dragRef.current.origin.x + dx, y: dragRef.current.origin.y + dy },
      dispW, dispH,
    ))
  }
  function handlePointerUp() { dragRef.current = null }

  function handleConfirm() {
    if (!imgEl) return
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT
    canvas.height = OUTPUT
    const ctx = canvas.getContext('2d')
    // Recorta a círculo — lo de afuera del círculo nunca se dibuja.
    ctx.beginPath()
    ctx.arc(OUTPUT / 2, OUTPUT / 2, OUTPUT / 2, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    const outScale = OUTPUT / VIEWPORT
    const drawW = dispW * outScale
    const drawH = dispH * outScale
    const drawX = OUTPUT / 2 - drawW / 2 + offset.x * outScale
    const drawY = OUTPUT / 2 - drawH / 2 + offset.y * outScale
    ctx.drawImage(imgEl, drawX, drawY, drawW, drawH)
    canvas.toBlob((blob) => {
      if (blob) onConfirm(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.92)
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4">
      <button type="button" className="absolute inset-0 border-none cursor-default bg-transparent" onClick={onCancel} aria-label="Cancelar" />
      <div className="relative bg-surface-card rounded-card shadow-2xl p-4 w-full max-w-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-on-surface">Ajusta tu foto</h3>
          <button type="button" onClick={onCancel} aria-label="Cancelar" className="p-1 text-slate-400 hover:text-muted rounded"><X size={20} /></button>
        </div>
        <p className="text-xs text-muted mb-3 text-center">Rueda del mouse para acercar/alejar · arrastra para mover</p>
        <div
          ref={viewportRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="ef-nodrag mx-auto rounded-full overflow-hidden bg-slate-100 relative cursor-move select-none"
          style={{ width: VIEWPORT, height: VIEWPORT, minWidth: VIEWPORT, minHeight: VIEWPORT, maxWidth: VIEWPORT, maxHeight: VIEWPORT, touchAction: 'none' }}
        >
          {imgEl ? (
            <img
              src={imgEl.src}
              alt=""
              draggable={false}
              className="absolute pointer-events-none"
              style={{
                width: dispW,
                height: dispH,
                maxWidth: 'none',
                maxHeight: 'none',
                left: '50%',
                top: '50%',
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center"><Spinner size="md" /></div>
          )}
        </div>
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={onCancel}
            className="flex-1 py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors">
            Cancelar
          </button>
          <button type="button" onClick={handleConfirm} disabled={!imgEl || saving}
            className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60 transition-colors flex items-center justify-center gap-2">
            {saving ? <Spinner size="sm" /> : <Check size={16} />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
