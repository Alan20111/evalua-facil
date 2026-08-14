import { useMemo, useRef, useState } from 'react'
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import statesGeo from '../../data/mexicoStatesGeo.json'
import cityShapes from '../../data/cityShapes.json'

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

// Centroide (en lng/lat) del polígono más grande de cada estado, para poner
// ahí el nombre — con islas o exclaves (BCS, Q. Roo) el polígono chico no
// debe jalar la etiqueta fuera del cuerpo principal del estado.
function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[i + 1]
    const cross = x0 * y1 - x1 * y0
    a += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  a *= 0.5
  if (Math.abs(a) < 1e-9) {
    const n = ring.length
    return { x: ring.reduce((s, p) => s + p[0], 0) / n, y: ring.reduce((s, p) => s + p[1], 0) / n, area: 0 }
  }
  return { x: cx / (6 * a), y: cy / (6 * a), area: Math.abs(a) }
}

function geomCentroidLngLat(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  let best = null
  for (const poly of polys) {
    const c = ringCentroid(poly[0])
    if (!best || c.area > best.area) best = c
  }
  return [best.x, best.y]
}

const stateLabels = statesGeo.features.map((f) => ({
  nombre: f.properties.name,
  pos: proj(geomCentroidLngLat(f.geometry)),
}))

// `cityShapes`: clave "estado|municipio" (la misma que usan los marcadores)
// -> mancha urbana real (contorno del municipio, como aproximación de la
// zona urbana — INEGI vía angelnmara/geojson), solo para las ~70 ciudades
// más grandes. El resto de los marcadores se dibuja como círculo.
const cityShapePaths = Object.fromEntries(
  Object.entries(cityShapes).map(([clave, geom]) => [
    clave,
    { d: geomToPath(geom), centro: proj(geomCentroidLngLat(geom)) },
  ])
)

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

// Proporcional de verdad: el área del círculo (no el radio) es lo que el
// ojo compara, así que el radio va con la raíz del valor — si fuera lineal
// en radio, un marcador con el doble de ventas se vería con 4x el área.
function radioPara(valor, max) {
  if (!valor || max <= 0) return 3
  const ratio = Math.sqrt(valor / max)
  return 3 + ratio * 9
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

  // Nombre visible solo en las ciudades más grandes — con todas encimadas se
  // vuelve ilegible, así que se etiquetan las que más pesan (top 12) más
  // cualquier otra que, aun sin ser top, tenga un valor comparable (dentro
  // del 60% del máximo) para no dejar fuera algo casi tan grande como el 12.
  const etiquetadas = useMemo(() => {
    if (marcadores.length <= 12) return new Set(marcadores.map((m) => m.clave))
    const ordenados = [...marcadores].sort((a, b) => b.valor - a.valor)
    const umbral = Math.min(ordenados[11].valor, max * 0.6)
    return new Set(marcadores.filter((m) => m.valor >= umbral).map((m) => m.clave))
  }, [marcadores, max])

  // El punto p de la vista mapea a scale*p + (x,y) — no a un rango simétrico
  // alrededor de 0. Para poder ver cualquier borde del contenido (incluido
  // el de abajo) el rango válido es [VIEW - VIEW*scale - margen, margen],
  // no ±algo fijo: ese ± era el bug que impedía ver la parte de abajo del
  // mapa al hacer zoom desde el centro.
  const clampView = (v) => {
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.scale))
    const margen = 40
    const minX = VIEW_W - VIEW_W * scale - margen
    const minY = VIEW_H - VIEW_H * scale - margen
    return {
      scale,
      x: Math.min(margen, Math.max(minX, v.x)),
      y: Math.min(margen, Math.max(minY, v.y)),
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
            {stateLabels.map((s) => (
              <text
                key={s.nombre}
                x={s.pos[0]}
                y={s.pos[1]}
                textAnchor="middle"
                fontSize={11 / view.scale}
                fill="#64748b"
                className="pointer-events-none select-none"
                style={{ fontWeight: 500 }}
              >
                {s.nombre}
              </text>
            ))}
            {marcadores.map((m) => {
              const shape = cityShapePaths[m.clave]
              const [x, y] = shape ? shape.centro : proj([m.lng, m.lat])
              const r = radioPara(m.valor, max) / Math.sqrt(view.scale)
              return (
                <g key={m.clave}>
                  {shape ? (
                    <path
                      d={shape.d}
                      fill={colorPara(m.valor, max)}
                      fillOpacity={m.aprox ? 0.55 : 0.85}
                      stroke="#1e3a8a"
                      strokeWidth={1 / view.scale}
                      className="cursor-pointer transition-opacity hover:opacity-100"
                      onMouseEnter={() => setHover(m)}
                      onMouseLeave={() => setHover(null)}
                    />
                  ) : (
                    <circle
                      cx={x}
                      cy={y}
                      r={r}
                      fill={colorPara(m.valor, max)}
                      fillOpacity={m.aprox ? 0.55 : 0.85}
                      stroke="#1e3a8a"
                      strokeWidth={1 / view.scale}
                      className="cursor-pointer transition-opacity hover:opacity-100"
                      onMouseEnter={() => setHover(m)}
                      onMouseLeave={() => setHover(null)}
                    />
                  )}
                  {etiquetadas.has(m.clave) && (
                    <text
                      x={x}
                      y={y - (shape ? 6 : r) - 3 / view.scale}
                      textAnchor="middle"
                      fontSize={12 / view.scale}
                      fill="#1e3a8a"
                      className="pointer-events-none select-none"
                      style={{ fontWeight: 700, paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 / view.scale }}
                    >
                      {m.etiqueta}
                    </text>
                  )}
                </g>
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
            onClick={() => zoomBy(1.4, { x: VIEW_W / 2, y: VIEW_H / 2 })}
            className="w-8 h-8 flex items-center justify-center bg-surface-card shadow-card rounded text-on-surface hover:bg-[var(--accent-tint)]"
            aria-label="Acercar"
          >
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.4, { x: VIEW_W / 2, y: VIEW_H / 2 })}
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
