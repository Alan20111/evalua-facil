import { useMemo, useRef, useState } from 'react'
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import statesGeo from '../../data/mexicoStatesGeo.json'

// Proyección equirectangular simple — suficiente para un mapa de referencia
// (no es para medir distancias, solo para ubicar marcadores). Bounding box
// tomado del propio geojson de estados, con margen para que nada quede
// pegado al borde.
const BBOX = { minLng: -118.4, maxLng: -86.7, minLat: 14.5, maxLat: 32.8 }
const VIEW_W = 900
const VIEW_H = 700

// Escala única (mismo factor en x/y) centrada en el bbox, para no deformar
// la silueta del país al proyectar.
const scaleX = (VIEW_W * 0.94) / (BBOX.maxLng - BBOX.minLng)
const scaleY = (VIEW_H * 0.94) / (BBOX.maxLat - BBOX.minLat)
const SCALE = Math.min(scaleX, scaleY)
const offsetX = (VIEW_W - (BBOX.maxLng - BBOX.minLng) * SCALE) / 2
const offsetY = (VIEW_H - (BBOX.maxLat - BBOX.minLat) * SCALE) / 2

function proj([lng, lat]) {
  const x = (lng - BBOX.minLng) * SCALE + offsetX
  const y = (BBOX.maxLat - lat) * SCALE + offsetY
  return [x, y]
}

function ringToPath(ring) {
  return ring.map((p, i) => `${i === 0 ? 'M' : 'L'}${proj(p).join(',')}`).join(' ') + 'Z'
}

function geomToPath(geom) {
  if (geom.type === 'Polygon') return geom.coordinates.map(ringToPath).join(' ')
  return geom.coordinates.map((poly) => poly.map(ringToPath).join(' ')).join(' ')
}

const statePaths = statesGeo.features.map((f) => ({
  nombre: f.properties.name,
  d: geomToPath(f.geometry),
}))

// Escala de azules por intensidad — mismo azul que el resto de la UI de
// docente/admin (ver CLAUDE.md: blue only, nunca índigo).
const ESCALA = ['#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1e3a8a']

function colorPara(valor, max) {
  if (!valor || max <= 0) return '#93c5fd'
  const ratio = valor / max
  if (ratio <= 0.05) return ESCALA[0]
  if (ratio <= 0.25) return ESCALA[1]
  if (ratio <= 0.5) return ESCALA[2]
  if (ratio <= 0.8) return ESCALA[3]
  return ESCALA[4]
}

function radioPara(valor, max) {
  if (!valor || max <= 0) return 4
  const ratio = Math.sqrt(valor / max)
  return 4 + ratio * 14
}

const MIN_ZOOM = 1
const MAX_ZOOM = 10

// `marcadores`: [{ clave, lat, lng, valor, etiqueta, aprox }]
export default function MexicoMap({ marcadores = [], etiqueta = 'docentes' }) {
  const [hover, setHover] = useState(null)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const dragRef = useRef(null)
  const svgRef = useRef(null)

  const max = useMemo(() => Math.max(0, ...marcadores.map((m) => m.valor)), [marcadores])

  const clampView = (v) => {
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.scale))
    const maxPanX = (VIEW_W * (scale - 1)) / 2 + 40
    const maxPanY = (VIEW_H * (scale - 1)) / 2 + 40
    return {
      scale,
      x: Math.min(maxPanX, Math.max(-maxPanX, v.x)),
      y: Math.min(maxPanY, Math.max(-maxPanY, v.y)),
    }
  }

  const zoomBy = (factor, center) => {
    setView((prev) => {
      const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.scale * factor))
      if (!center) return clampView({ ...prev, scale: nextScale })
      // mantiene el punto bajo el cursor fijo al hacer zoom
      const ratio = nextScale / prev.scale
      const x = center.x - (center.x - prev.x) * ratio
      const y = center.y - (center.y - prev.y) * ratio
      return clampView({ scale: nextScale, x, y })
    })
  }

  const handleWheel = (e) => {
    e.preventDefault()
    const rect = svgRef.current.getBoundingClientRect()
    const cx = ((e.clientX - rect.left) / rect.width) * VIEW_W
    const cy = ((e.clientY - rect.top) / rect.height) * VIEW_H
    zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, { x: cx, y: cy })
  }

  const handlePointerDown = (e) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: view.x, origY: view.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e) => {
    if (!dragRef.current) return
    const { startX, startY, origX, origY } = dragRef.current
    const rect = svgRef.current.getBoundingClientRect()
    const dx = ((e.clientX - startX) / rect.width) * VIEW_W
    const dy = ((e.clientY - startY) / rect.height) * VIEW_H
    setView((prev) => clampView({ ...prev, x: origX + dx, y: origY + dy }))
  }

  const handlePointerUp = () => {
    dragRef.current = null
  }

  const reset = () => setView({ scale: 1, x: 0, y: 0 })

  return (
    <div className="space-y-2">
      <div className="relative w-full h-[560px] bg-[#eff6ff] rounded-card overflow-hidden border border-outline-variant">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full h-full touch-none cursor-grab active:cursor-grabbing select-none"
          style={{ WebkitUserDrag: 'none', userSelect: 'none' }}
          draggable="false"
          onDragStart={(e) => e.preventDefault()}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale}) translate(${VIEW_W / 2} ${VIEW_H / 2}) translate(${-VIEW_W / 2} ${-VIEW_H / 2})`}>
            {statePaths.map((s) => (
              <path key={s.nombre} d={s.d} fill="#dbeafe" stroke="#fff" strokeWidth={1 / view.scale} />
            ))}
            {marcadores.map((m) => {
              const [x, y] = proj([m.lng, m.lat])
              return (
                <circle
                  key={m.clave}
                  cx={x}
                  cy={y}
                  r={radioPara(m.valor, max) / Math.sqrt(view.scale)}
                  fill={colorPara(m.valor, max)}
                  fillOpacity={m.aprox ? 0.55 : 0.85}
                  stroke="#1e3a8a"
                  strokeWidth={1 / view.scale}
                  className="cursor-pointer transition-opacity hover:opacity-100"
                  onMouseEnter={() => setHover(m)}
                  onMouseLeave={() => setHover(null)}
                />
              )
            })}
          </g>
        </svg>

        {hover && (
          <div className="absolute top-3 left-3 bg-surface-card shadow-card rounded-card px-3 py-1.5 text-sm pointer-events-none max-w-[220px]">
            <p className="font-semibold text-on-surface">{hover.etiqueta}</p>
            <p className="text-muted">{hover.valor} {etiqueta}</p>
            {hover.aprox && <p className="text-xs text-muted italic">ubicación aproximada (estado)</p>}
          </div>
        )}

        <div className="absolute bottom-3 right-3 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => zoomBy(1.4)}
            className="w-8 h-8 flex items-center justify-center bg-surface-card shadow-card rounded text-on-surface hover:bg-[var(--accent-tint)]"
            aria-label="Acercar"
          >
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.4)}
            className="w-8 h-8 flex items-center justify-center bg-surface-card shadow-card rounded text-on-surface hover:bg-[var(--accent-tint)]"
            aria-label="Alejar"
          >
            <ZoomOut size={16} />
          </button>
          <button
            type="button"
            onClick={reset}
            className="w-8 h-8 flex items-center justify-center bg-surface-card shadow-card rounded text-on-surface hover:bg-[var(--accent-tint)]"
            aria-label="Restablecer vista"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap text-xs text-muted">
        <span>Intensidad ({etiqueta}):</span>
        {ESCALA.map((c, i) => (
          <span key={c} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: c }} />
            {i === 0 ? 'Poco' : i === ESCALA.length - 1 ? 'Mucho' : ''}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full inline-block bg-blue-400 opacity-50" />
          Ubicación aproximada
        </span>
      </div>
    </div>
  )
}
