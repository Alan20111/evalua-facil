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

// Centroide (en lng/lat) del polígono más grande de una geometría, para
// poner ahí una etiqueta — con islas o exclaves el polígono chico no debe
// jalar la etiqueta fuera del cuerpo principal.
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

// `cityShapes`: clave "estado|municipio" -> mancha urbana real (contorno del
// municipio, aproximación de la zona urbana — INEGI vía angelnmara/geojson),
// con población aproximada (Censo 2020) y rango de código postal (catálogo
// propio). Es una capa de referencia FIJA: las ~70 ciudades más grandes se
// ven siempre, tengan o no datos de venta todavía.
function cpTexto(info) {
  if (!info.cpMin) return null
  return info.cpMin === info.cpMax ? info.cpMin : `${info.cpMin}–${info.cpMax}`
}

const CIUDADES = Object.entries(cityShapes).map(([clave, info]) => ({
  clave,
  municipio: clave.split('|')[1],
  d: geomToPath(info),
  centro: proj(geomCentroidLngLat(info)),
  poblacion: info.poblacion,
  cp: cpTexto(info),
}))

// Escala de azules por intensidad — mismo azul que el resto de la UI de
// docente/admin (ver CLAUDE.md: blue only, nunca índigo).
const ESCALA = ['#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1e3a8a']
const SIN_DATOS = '#dbeafe'

// Bandas absolutas, no relativas al máximo del set actual — con pocos datos
// (o uno solo, como en pruebas) "relativo al máximo" hace que ese único
// punto siempre se pinte como el más grande/intenso posible, sin importar
// si es 1 docente o 100. Los cortes son para conteo de docentes por ciudad;
// generosos a propósito (la mayoría de las ciudades tiene pocos).
function colorPara(valor) {
  if (!valor) return SIN_DATOS
  if (valor <= 2) return ESCALA[0]
  if (valor <= 5) return ESCALA[1]
  if (valor <= 15) return ESCALA[2]
  if (valor <= 40) return ESCALA[3]
  return ESCALA[4]
}

// Proporcional de verdad y en absoluto (no relativo al máximo del momento):
// el área del círculo es lo que el ojo compara, así que el radio va con la
// raíz del valor — si fuera lineal en radio, el doble de docentes se vería
// con 4x el área.
function radioPara(valor) {
  if (!valor) return 3
  return Math.min(16, 3 + Math.sqrt(valor) * 2.5)
}

const MIN_ZOOM = 1
const MAX_ZOOM = 10

function formatoPoblacion(n) {
  if (!n) return null
  return n.toLocaleString('es-MX')
}

// El punto p de la vista mapea a scale*p + (x,y) — no a un rango simétrico
// alrededor de 0. Para poder ver cualquier borde del contenido (incluido el
// de abajo) el rango válido es [VIEW - VIEW*scale - margen, margen], no
// ±algo fijo.
function clampView(v) {
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

function transformDe(v) {
  return `translate(${v.x} ${v.y}) scale(${v.scale}) translate(${VIEW_W / 2} ${VIEW_H / 2}) translate(${-VIEW_W / 2} ${-VIEW_H / 2})`
}

// `marcadores`: [{ clave, lat, lng, valor, etiqueta, aprox }] — solo ciudades
// CON datos de venta, para las que no tienen mancha urbana cargada (pueblos
// chicos): esas se ven como círculo, solo si hay datos.
export default function MexicoMap({ marcadores = [], etiqueta = 'docentes' }) {
  const [hover, setHover] = useState(null)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const dragRef = useRef(null)
  const svgRef = useRef(null)
  const gRef = useRef(null)
  const viewRef = useRef(view)
  viewRef.current = view

  const marcadorPorClave = useMemo(() => Object.fromEntries(marcadores.map((m) => [m.clave, m])), [marcadores])
  // Círculos solo para marcadores con datos que NO tienen mancha urbana
  // cargada (pueblos chicos) — las ciudades grandes ya están en CIUDADES.
  const circulos = useMemo(() => marcadores.filter((m) => !cityShapes[m.clave]), [marcadores])

  // Nombre visible en las ciudades grandes (capa fija) siempre, más los
  // círculos de pueblos chicos que más pesan (top 12) para no dejar la
  // pantalla ilegible si hay muchos.
  const circulosEtiquetados = useMemo(() => {
    if (circulos.length <= 12) return new Set(circulos.map((m) => m.clave))
    const ordenados = [...circulos].sort((a, b) => b.valor - a.valor)
    const umbral = ordenados[11].valor
    return new Set(circulos.filter((m) => m.valor >= umbral).map((m) => m.clave))
  }, [circulos])

  // Durante el arrastre se mueve el <g> directamente en el DOM (sin pasar
  // por React) para que no dependa de un re-render por cada pixel movido —
  // con ~140 paths (32 estados + 69 manchas urbanas) hacerlo vía setState
  // se sentía trabado. El estado de React solo se actualiza al soltar.
  const aplicarTransformDom = (v) => {
    if (gRef.current) gRef.current.setAttribute('transform', transformDe(v))
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
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: view.x, origY: view.y, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e) => {
    if (!dragRef.current) return
    const { startX, startY, origX, origY } = dragRef.current
    const rect = svgRef.current.getBoundingClientRect()
    const dx = ((e.clientX - startX) / rect.width) * VIEW_W
    const dy = ((e.clientY - startY) / rect.height) * VIEW_H
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) dragRef.current.moved = true
    const next = clampView({ ...viewRef.current, x: origX + dx, y: origY + dy })
    viewRef.current = next
    aplicarTransformDom(next)
  }

  const handlePointerUp = () => {
    if (!dragRef.current) return
    dragRef.current = null
    setView(viewRef.current)
  }

  const reset = () => setView({ scale: 1, x: 0, y: 0 })

  const escalaTexto = 1 / view.scale

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
          <g ref={gRef} transform={transformDe(view)}>
            {statePaths.map((s) => (
              <path key={s.nombre} d={s.d} fill="#eff6ff" stroke="#93c5fd" strokeWidth={1.4 / view.scale} />
            ))}
            {stateLabels.map((s) => (
              <text
                key={s.nombre}
                x={s.pos[0]}
                y={s.pos[1]}
                textAnchor="middle"
                fontSize={11 * escalaTexto}
                fill="#94a3b8"
                className="pointer-events-none select-none"
                style={{ fontWeight: 500 }}
              >
                {s.nombre}
              </text>
            ))}

            {/* Capa fija: las ciudades grandes se ven siempre, tengan o no venta */}
            {CIUDADES.map((c) => {
              const m = marcadorPorClave[c.clave]
              const valor = m?.valor || 0
              return (
                <g key={c.clave}>
                  <path
                    d={c.d}
                    fill={colorPara(valor)}
                    fillOpacity={m?.aprox ? 0.6 : 0.9}
                    stroke="#1e3a8a"
                    strokeWidth={(valor ? 1 : 0.6) / view.scale}
                    className="cursor-pointer transition-opacity hover:opacity-100"
                    onMouseEnter={() => setHover({ ...c, valor })}
                    onMouseLeave={() => setHover(null)}
                  />
                  <text
                    x={c.centro[0]}
                    y={c.centro[1] - 6 * escalaTexto}
                    textAnchor="middle"
                    fontSize={11 * escalaTexto}
                    fill="#1e3a8a"
                    className="pointer-events-none select-none"
                    style={{ fontWeight: 600, paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 * escalaTexto }}
                  >
                    {c.municipio}
                  </text>
                </g>
              )
            })}

            {/* Círculos: solo pueblos chicos con datos de venta (sin mancha urbana) */}
            {circulos.map((m) => {
              const [x, y] = proj([m.lng, m.lat])
              const r = radioPara(m.valor) * escalaTexto
              return (
                <g key={m.clave}>
                  <circle
                    cx={x}
                    cy={y}
                    r={r}
                    fill={colorPara(m.valor)}
                    fillOpacity={m.aprox ? 0.6 : 0.9}
                    stroke="#1e3a8a"
                    strokeWidth={1 / view.scale}
                    className="cursor-pointer transition-opacity hover:opacity-100"
                    onMouseEnter={() => setHover(m)}
                    onMouseLeave={() => setHover(null)}
                  />
                  {circulosEtiquetados.has(m.clave) && (
                    <text
                      x={x}
                      y={y - r - 3 * escalaTexto}
                      textAnchor="middle"
                      fontSize={11 * escalaTexto}
                      fill="#1e3a8a"
                      className="pointer-events-none select-none"
                      style={{ fontWeight: 700, paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 * escalaTexto }}
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
          <div className="absolute top-3 left-3 bg-surface-card shadow-card rounded-card px-3 py-1.5 text-sm pointer-events-none max-w-[240px]">
            <p className="font-semibold text-on-surface">{hover.municipio || hover.etiqueta}</p>
            <p className="text-muted">{hover.valor || 0} {etiqueta}</p>
            {hover.poblacion != null && (
              <p className="text-muted">{formatoPoblacion(hover.poblacion)} habitantes</p>
            )}
            {hover.cp && <p className="text-muted">CP {hover.cp}</p>}
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
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm inline-block" style={{ background: SIN_DATOS }} />
          Sin datos
        </span>
        {['1-2', '3-5', '6-15', '16-40', '40+'].map((rango, i) => (
          <span key={rango} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: ESCALA[i] }} />
            {rango}
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
