// Crucigrama / Sopa de letras — tablero de Sopa de letras (22-ago-2026).
//
// Grid mobile-first (aspect-square). Selección: tap/click en la celda de
// inicio, luego tap/click (o arrastre) hasta la celda final — funciona igual
// con mouse y con touch porque solo usa eventos pointer. Si la línea
// resultante coincide (en cualquiera de las 8 direcciones) con una palabra
// de `estructura.palabras`, se marca como encontrada.
//
// `readOnly` queda disponible para un futuro caller que solo necesite ver la
// forma de la cuadrícula sin juego — RevisionJuegoBorrador (preview jugable
// del docente) y JuegoRunner (alumno) usan el modo normal.

import { useRef, useState } from 'react'

// mostrarSolucion: activar SOLO después de que el alumno haya finalizado el
// intento. Muestra las palabras no encontradas en verde esmeralda para
// retroalimentación; nunca durante la resolución activa.
export default function SopaDeLetrasBoard({
  estructura,
  encontradas = [],
  onEncontrada,
  readOnly = false,
  mostrarSolucion = false,
}) {
  const { size, grid, palabras } = estructura
  const [inicio, setInicio] = useState(null)
  const [actual, setActual] = useState(null)
  const contenedorRef = useRef(null)

  const encontradasSet = new Set(encontradas)

  function celdaDesde(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY)
    const r = el?.getAttribute?.('data-r')
    const c = el?.getAttribute?.('data-c')
    if (r == null || c == null) return null
    return { r: Number(r), c: Number(c) }
  }

  function lineaEntre(a, b) {
    const dr = Math.sign(b.r - a.r)
    const dc = Math.sign(b.c - a.c)
    const largo = Math.max(Math.abs(b.r - a.r), Math.abs(b.c - a.c)) + 1
    // Solo líneas rectas (horizontal/vertical/diagonal real).
    if (dr !== 0 && Math.abs(b.r - a.r) !== Math.abs(b.c - a.c) && dc !== 0) return null
    const celdas = []
    for (let i = 0; i < largo; i++) celdas.push({ r: a.r + dr * i, c: a.c + dc * i })
    return celdas
  }

  function coincideConPalabra(celdas) {
    if (celdas.length < 2) return null
    const primera = celdas[0], ultima = celdas[celdas.length - 1]
    return palabras.find((p) => {
      if (p.longitud !== celdas.length) return false
      const finR = p.fila + p.dirFila * (p.longitud - 1)
      const finC = p.col + p.dirCol * (p.longitud - 1)
      return (p.fila === primera.r && p.col === primera.c && finR === ultima.r && finC === ultima.c) ||
             (finR === primera.r && finC === primera.c && p.fila === ultima.r && p.col === ultima.c)
    })
  }

  function handleDown(r, c) {
    if (readOnly) return
    setInicio({ r, c }); setActual({ r, c })
  }
  function handleMove(clientX, clientY) {
    if (readOnly || !inicio) return
    const celda = celdaDesde(clientX, clientY)
    if (celda) setActual(celda)
  }
  function handleUp() {
    if (readOnly || !inicio || !actual) { setInicio(null); setActual(null); return }
    const celdas = lineaEntre(inicio, actual)
    if (celdas) {
      const encontrada = coincideConPalabra(celdas)
      if (encontrada && !encontradasSet.has(encontrada.index)) onEncontrada?.(encontrada.index)
    }
    setInicio(null); setActual(null)
  }

  const seleccion = new Set()
  if (inicio && actual) {
    const celdas = lineaEntre(inicio, actual)
    celdas?.forEach((c) => seleccion.add(`${c.r}-${c.c}`))
  }
  const celdasEncontradas = new Set()
  palabras.forEach((p) => {
    if (!encontradasSet.has(p.index)) return
    for (let i = 0; i < p.longitud; i++) celdasEncontradas.add(`${p.fila + p.dirFila * i}-${p.col + p.dirCol * i}`)
  })

  // Celdas que el alumno NO encontró pero sí están en la solución correcta.
  // Solo se calculan cuando mostrarSolucion=true (post-entrega). Durante la
  // resolución activa este Set siempre está vacío.
  const celdasSolucion = new Set()
  if (mostrarSolucion) {
    palabras.forEach((p) => {
      if (encontradasSet.has(p.index)) return
      for (let i = 0; i < p.longitud; i++) celdasSolucion.add(`${p.fila + p.dirFila * i}-${p.col + p.dirCol * i}`)
    })
  }

  return (
    <div className="space-y-4">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions --
          selección por arrastre (mouse/touch) entre celdas <button>; cada
          celda ya es enfocable y accionable por su cuenta (tabIndex, click),
          este contenedor solo sigue el gesto de arrastre sobre ellas. */}
      <div
        ref={contenedorRef}
        role="application"
        aria-label="Sopa de letras"
        className="grid aspect-square w-full max-w-md mx-auto select-none touch-none"
        style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
        onMouseUp={handleUp} onMouseLeave={() => { setInicio(null); setActual(null) }}
        onTouchMove={(e) => handleMove(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={handleUp}
      >
        {grid.map(({ row: fila }, r) => fila.map((letra, c) => {
          const key = `${r}-${c}`
          const sel = seleccion.has(key)
          const enc = celdasEncontradas.has(key)
          const sol = celdasSolucion.has(key)
          return (
            <button key={key} type="button" data-r={r} data-c={c} tabIndex={-1}
              onMouseDown={() => handleDown(r, c)}
              onMouseEnter={() => { if (inicio) setActual({ r, c }) }}
              onTouchStart={() => handleDown(r, c)}
              style={{ fontSize: `clamp(9px, calc(min(100vw, 28rem) / ${size} * 0.52), 1.5rem)` }}
              className={`flex items-center justify-center font-semibold border border-outline-variant
                ${enc ? 'bg-accent text-white' : sol ? 'bg-emerald-500 text-white' : sel ? 'bg-[var(--accent-tint)] text-accent' : 'bg-surface text-on-surface'}`}>
              {letra}
            </button>
          )
        }))}
      </div>

      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-sm">
        {palabras.map((p) => {
          const hallada = encontradasSet.has(p.index)
          return (
            <li
              key={p.index}
              className={`px-2 py-1 rounded flex items-start gap-1 ${
                hallada
                  ? 'line-through text-muted bg-surface-container'
                  : mostrarSolucion
                  ? 'text-emerald-700 bg-emerald-50'
                  : 'text-on-surface'
              }`}
            >
              {mostrarSolucion && (
                <span className="flex-shrink-0 not-italic no-underline">
                  {hallada ? '✅' : '❌'}
                </span>
              )}
              <span>
                {/* Modalidad "por descripción": SOLO la pista durante el juego,
                    nunca la palabra (revelaría la respuesta). En modo solución
                    (post-entrega) se muestra también la respuesta correcta. */}
                {p.descripcion
                  ? mostrarSolucion
                    ? `${p.descripcion} → ${p.palabra}`
                    : p.descripcion
                  : p.palabra}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
