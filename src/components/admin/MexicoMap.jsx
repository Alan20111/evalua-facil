import { useEffect, useMemo, useRef, useState } from 'react'
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import statesGeo from '../../data/mexicoStatesGeo.json'
import cityShapes from '../../data/cityShapes.json'

// Mapa dibujado en <canvas>, no SVG — con ~300 nodos DOM (32 estados + 69
// manchas urbanas + sus etiquetas) el navegador tenía que llevar la cuenta
// de cada uno como elemento individual (estilos, hit-testing, layout) en
// cada paneo/zoom. Canvas pinta píxeles directo a un bitmap: repintar 300
// formas o 30 cuesta básicamente lo mismo, porque no hay nodos que
// mantener. Es el mismo enfoque que usan Google Maps/Mapbox/Leaflet.

// Proyección equirectangular simple — suficiente para un mapa de referencia
// (no es para medir distancias, solo para ubicar marcadores). Bounding box
// tomado del propio geojson de estados, con margen para que nada quede
// pegado al borde.
const BBOX = { minLng: -118.4, maxLng: -86.7, minLat: 14.5, maxLat: 32.8 }
const VIEW_W = 900
const VIEW_H = 700

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

// Convierte una geometría (Polygon/MultiPolygon en lng/lat) a un array de
// anillos ya proyectados — cada anillo es un array de [x,y].
function geomToRings(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  return polys.flatMap((poly) => poly.map((ring) => ring.map(proj)))
}

function ringArea(ring) {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  return Math.abs(a) / 2
}

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
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]
  }
  return [cx / (6 * a), cy / (6 * a)]
}

// Punto dentro de un anillo (ray casting) — ya en coordenadas proyectadas.
function puntoEnAnillo(px, py, ring) {
  let dentro = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const cruza = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (cruza) dentro = !dentro
  }
  return dentro
}

const statePaths = statesGeo.features.map((f) => {
  const rings = geomToRings(f.geometry)
  const mayor = rings.reduce((a, b) => (ringArea(b) > ringArea(a) ? b : a))
  return { nombre: f.properties.name, rings, labelPos: ringCentroid(mayor) }
})

function cpTexto(info) {
  if (!info.cpMin) return null
  return info.cpMin === info.cpMax ? info.cpMin : `${info.cpMin}–${info.cpMax}`
}

// `cityShapes`: clave "estado|municipio" -> mancha urbana real (contorno del
// municipio, aproximación de la zona urbana — INEGI vía angelnmara/geojson),
// con población aproximada (Censo 2020) y rango de código postal (catálogo
// propio). Es una capa de referencia FIJA: las ~70 ciudades más grandes se
// ven siempre, tengan o no datos de venta todavía.
const CIUDADES = Object.entries(cityShapes).map(([clave, info]) => {
  const rings = geomToRings(info)
  const mayor = rings.reduce((a, b) => (ringArea(b) > ringArea(a) ? b : a))
  return {
    clave,
    municipio: clave.split('|')[1],
    rings,
    mayor,
    centro: ringCentroid(mayor),
    poblacion: info.poblacion,
    cp: cpTexto(info),
  }
})

// Escala de azules por intensidad de ventas.
const ESCALA = ['#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1e3a8a']
// Manchas urbanas sin ventas todavía: naranja notorio, para que la ciudad
// se distinga de un vistazo del resto del mapa (pedido explícito, aunque el
// resto de la UI de docente/admin sea azul).
const SIN_DATOS = '#fdba74'
const SIN_DATOS_BORDE = '#ea580c'
// Fronteras de estado en guinda.
const GUINDA = '#7c2d48'
const MAR = '#7dd3fc'
const TIERRA = '#f8fafc'

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
const MAX_ZOOM = 60

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

function dibujarAnillos(ctx, rings) {
  ctx.beginPath()
  for (const ring of rings) {
    ring.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])))
    ctx.closePath()
  }
}

// `marcadores`: [{ clave, lat, lng, valor, etiqueta, aprox }] — solo ciudades
// CON datos de venta, para las que no tienen mancha urbana cargada (pueblos
// chicos): esas se ven como círculo, solo si hay datos.
export default function MexicoMap({ marcadores = [], etiqueta = 'docentes' }) {
  const [hover, setHover] = useState(null)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [size, setSize] = useState({ w: 900, h: 560 })
  const dragRef = useRef(null)
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const hoverRef = useRef(null)

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

  // Ajusta el <canvas> al tamaño real del contenedor (con devicePixelRatio
  // para que no se vea borroso en pantallas de alta densidad).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setSize({ w: width, h: height })
      rectRef.current = canvasRef.current?.getBoundingClientRect() || null
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Ajuste "meet" (como preserveAspectRatio de SVG): el VIEW_W x VIEW_H
  // lógico se escala uniformemente para caber en el contenedor real, sin
  // deformar, con barras vacías si la proporción no coincide exacto.
  const fit = useMemo(() => {
    const s = Math.min(size.w / VIEW_W, size.h / VIEW_H) || 1
    return { s, ox: (size.w - VIEW_W * s) / 2, oy: (size.h - VIEW_H * s) / 2 }
  }, [size])

  // Convierte un punto en píxeles CSS del contenedor a coordenadas lógicas
  // (las mismas que usan statePaths/CIUDADES/proj) deshaciendo fit + view.
  const aCoordLogica = (px, py) => {
    const x1 = (px - fit.ox) / fit.s
    const y1 = (py - fit.oy) / fit.s
    const x2 = (x1 - viewRef.current.x) / viewRef.current.scale
    const y2 = (y1 - viewRef.current.y) / viewRef.current.scale
    return [x2, y2]
  }

  const dibujar = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const cssW = size.w, cssH = size.h
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
    }
    // desynchronized:true se probó para bajar latencia, pero causaba justo
    // lo contrario: con la página quieta, el navegador no "presentaba" el
    // canvas en pantalla hasta el primer evento de entrada (se veía
    // congelado hasta mover el mouse encima). Se quita.
    const ctx = canvas.getContext('2d', { alpha: false })
    const v = viewRef.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = MAR
    ctx.fillRect(0, 0, cssW, cssH)
    ctx.save()
    ctx.translate(fit.ox, fit.oy)
    ctx.scale(fit.s, fit.s)
    ctx.translate(v.x, v.y)
    ctx.scale(v.scale, v.scale)

    const escalaTrazo = 1 / (fit.s * v.scale)
    const escalaTexto = 1 / (fit.s * v.scale)

    // Estados
    ctx.lineJoin = 'round'
    for (const s of statePaths) {
      dibujarAnillos(ctx, s.rings)
      ctx.fillStyle = TIERRA
      ctx.fill('evenodd')
      ctx.strokeStyle = GUINDA
      ctx.lineWidth = 1.4 * escalaTrazo
      ctx.stroke()
    }

    // Nombres de estado
    ctx.fillStyle = '#94a3b8'
    ctx.font = `500 ${11 * escalaTexto}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const s of statePaths) ctx.fillText(s.nombre, s.labelPos[0], s.labelPos[1])

    // Ciudades — capa fija, se ven siempre
    for (const c of CIUDADES) {
      const m = marcadorPorClave[c.clave]
      const valor = m?.valor || 0
      dibujarAnillos(ctx, c.rings)
      ctx.fillStyle = colorPara(valor)
      ctx.globalAlpha = valor ? (m?.aprox ? 0.6 : 0.9) : 0.75
      ctx.fill('evenodd')
      ctx.globalAlpha = 1
      ctx.strokeStyle = valor ? '#1e3a8a' : SIN_DATOS_BORDE
      ctx.lineWidth = (valor ? 1 : 1.2) * escalaTrazo
      ctx.stroke()
    }
    ctx.fillStyle = '#1e3a8a'
    ctx.font = `600 ${11 * escalaTexto}px sans-serif`
    ctx.lineWidth = 3 * escalaTexto
    ctx.strokeStyle = '#fff'
    ctx.textBaseline = 'alphabetic'
    for (const c of CIUDADES) {
      const y = c.centro[1] - 6 * escalaTexto
      ctx.strokeText(c.municipio, c.centro[0], y)
      ctx.fillText(c.municipio, c.centro[0], y)
    }

    // Círculos: solo pueblos chicos con datos de venta (sin mancha urbana)
    for (const m of circulos) {
      const [x, y] = proj([m.lng, m.lat])
      const r = radioPara(m.valor) * escalaTexto
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = colorPara(m.valor)
      ctx.globalAlpha = m.aprox ? 0.6 : 0.9
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = '#1e3a8a'
      ctx.lineWidth = escalaTrazo
      ctx.stroke()
      if (circulosEtiquetados.has(m.clave)) {
        const ty = y - r - 3 * escalaTexto
        ctx.font = `700 ${11 * escalaTexto}px sans-serif`
        ctx.strokeText(m.etiqueta, x, ty)
        ctx.fillText(m.etiqueta, x, ty)
      }
    }

    ctx.restore()
  }

  useEffect(dibujar)

  // Calienta el canvas al montar: la primera vez que el navegador tiene que
  // repintarlo seguido (el primer arrastre/zoom del usuario) suele pagar un
  // costo único — promoverlo a su propia capa de composición en GPU, y en
  // V8 optimizar la función de dibujo tras las primeras llamadas — que se
  // siente como lag justo al empezar y desaparece después. Se paga ese
  // costo aquí, con dibujos de sobra apenas se monta, antes de que el
  // usuario toque nada.
  useEffect(() => {
    let n = 0
    let id
    const paso = () => {
      dibujar()
      n++
      if (n < 20) id = requestAnimationFrame(paso)
    }
    id = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hit-testing: qué ciudad/círculo hay bajo un punto (en coords lógicas).
  const detectarHover = (lx, ly) => {
    for (const m of circulos) {
      const [x, y] = proj([m.lng, m.lat])
      const r = radioPara(m.valor)
      if (Math.hypot(lx - x, ly - y) <= r + 2) return m
    }
    for (const c of CIUDADES) {
      if (puntoEnAnillo(lx, ly, c.mayor)) {
        const m = marcadorPorClave[c.clave]
        return { ...c, valor: m?.valor || 0, aprox: m?.aprox }
      }
    }
    return null
  }

  const aplicarHover = (next) => {
    const prev = hoverRef.current
    const cambio = (prev?.clave || prev?.etiqueta) !== (next?.clave || next?.etiqueta)
    hoverRef.current = next
    if (cambio) setHover(next)
  }

  // Durante el arrastre/zoom con rueda NO se pasa por setState — solo se
  // actualiza viewRef y se agenda un redibujo por requestAnimationFrame.
  // Con canvas esto es barato de por sí (no hay ~300 nodos DOM que
  // recalcular), pero se sigue agrupando por frame para no pintar más
  // veces de las que la pantalla puede mostrar.
  const rafRef = useRef(null)
  const agendarRedibujo = () => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      dibujar()
    })
  }

  const wheelCommitRef = useRef(null)
  const zoomBy = (factor, center, inmediato = true) => {
    const prev = viewRef.current
    const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.scale * factor))
    let next
    if (!center) {
      next = clampView({ ...prev, scale: nextScale })
    } else {
      const ratio = nextScale / prev.scale
      const x = center.x - (center.x - prev.x) * ratio
      const y = center.y - (center.y - prev.y) * ratio
      next = clampView({ scale: nextScale, x, y })
    }
    viewRef.current = next
    if (inmediato) {
      setView(next)
      return
    }
    agendarRedibujo()
    if (wheelCommitRef.current) clearTimeout(wheelCommitRef.current)
    wheelCommitRef.current = setTimeout(() => setView(viewRef.current), 150)
  }

  // React trata onWheel como listener "passive" por default, así que
  // e.preventDefault() ahí no bloquea el scroll/zoom nativo del navegador.
  // Hace falta un listener nativo con passive:false.
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const [lx, ly] = [(e.clientX - rect.left - fit.ox) / fit.s, (e.clientY - rect.top - fit.oy) / fit.s]
      // El factor va con la magnitud real de deltaY (un mouse dispara pocos
      // eventos grandes, un trackpad muchos chicos) Y se topa a ±100 por
      // evento — medido en el navegador real: un solo gesto de scroll puede
      // reportar un deltaY de varios cientos, disparando el zoom de golpe
      // si no se topa.
      const deltaClamp = Math.max(-100, Math.min(100, e.deltaY))
      const factor = Math.pow(1.0015, -deltaClamp)
      zoomBy(factor, { x: lx, y: ly }, false)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [fit])

  useEffect(() => () => {
    if (wheelCommitRef.current) clearTimeout(wheelCommitRef.current)
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
  }, [])

  // El rect del canvas se cachea (al entrar el puntero y al medir el
  // contenedor) en vez de pedirlo en cada pointermove — igual que en el
  // arrastre, hacerlo por evento fuerza un recálculo de layout síncrono.
  const rectRef = useRef(null)
  const actualizarRect = () => {
    if (canvasRef.current) rectRef.current = canvasRef.current.getBoundingClientRect()
  }

  const handlePointerDown = (e) => {
    e.preventDefault()
    actualizarRect()
    const rect = rectRef.current
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: viewRef.current.x, origY: viewRef.current.y, rect, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.style.cursor = 'grabbing'
    aplicarHover(null)
  }

  const handlePointerMove = (e) => {
    const rect = dragRef.current?.rect || rectRef.current
    if (!dragRef.current) {
      if (!rect) actualizarRect()
      const r = rectRef.current
      if (!r) return
      const [lx, ly] = aCoordLogica(e.clientX - r.left, e.clientY - r.top)
      aplicarHover(detectarHover(lx, ly))
      return
    }
    const { startX, startY, origX, origY } = dragRef.current
    const dx = ((e.clientX - startX) / fit.s)
    const dy = ((e.clientY - startY) / fit.s)
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) dragRef.current.moved = true
    const next = clampView({ ...viewRef.current, x: origX + dx, y: origY + dy })
    viewRef.current = next
    agendarRedibujo()
  }

  const handlePointerUp = () => {
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab'
    if (!dragRef.current) return
    dragRef.current = null
    setView(viewRef.current)
  }

  const reset = () => setView({ scale: 1, x: 0, y: 0 })

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="relative w-full h-[560px] rounded-card overflow-hidden border border-outline-variant">
        <canvas
          ref={canvasRef}
          className="w-full h-full touch-none select-none"
          style={{ WebkitUserDrag: 'none', userSelect: 'none', cursor: 'grab', display: 'block', willChange: 'transform' }}
          onPointerDown={handlePointerDown}
          onPointerEnter={actualizarRect}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => { handlePointerUp(); aplicarHover(null) }}
        />

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
