// Crucigrama / Sopa de letras — tablero de Crucigrama (22-ago-2026).
//
// Grid mobile-first (aspect-square) con un <input maxLength=1> por celda
// ocupada. Auto-avance: al escribir una letra el foco salta a la siguiente
// celda de la palabra activa (funciona con teclado físico y táctil, porque
// son <input> nativos). Las pistas se listan debajo, agrupadas
// Horizontales/Verticales por numeración estándar.
//
// `readOnly` queda disponible para un futuro caller que solo necesite ver la
// forma de la cuadrícula sin captura de respuestas — RevisionJuegoBorrador
// (preview jugable del docente) y JuegoRunner (alumno) usan el modo normal.

import { useRef } from 'react'

export default function CrucigramaBoard({ estructura, celdas = {}, onCambioCelda, readOnly = false }) {
  const { size, grid, palabras } = estructura
  const refs = useRef({})

  const horizontales = palabras.filter((p) => p.horizontal).sort((a, b) => (a.numero || 0) - (b.numero || 0))
  const verticales = palabras.filter((p) => !p.horizontal).sort((a, b) => (a.numero || 0) - (b.numero || 0))

  function siguienteCelda(p, r, c) {
    const i = p.horizontal ? c - p.col : r - p.fila
    if (i + 1 >= p.longitud) return null
    return p.horizontal ? { r, c: c + 1 } : { r: r + 1, c }
  }

  function palabraQueContiene(r, c) {
    return palabras.find((p) => {
      for (let i = 0; i < p.longitud; i++) {
        const pr = p.horizontal ? p.fila : p.fila + i
        const pc = p.horizontal ? p.col + i : p.col
        if (pr === r && pc === c) return true
      }
      return false
    })
  }

  function handleChange(r, c, valor) {
    if (readOnly) return
    const letra = valor.slice(-1).toUpperCase()
    onCambioCelda?.(r, c, letra)
    const p = palabraQueContiene(r, c)
    if (p && letra) {
      const sig = siguienteCelda(p, r, c)
      if (sig) refs.current[`${sig.r}-${sig.c}`]?.focus()
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid aspect-square w-full max-w-md mx-auto" style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
        {grid.map(({ row: fila }, r) => fila.map((letra, c) => {
          if (!letra) return <div key={`${r}-${c}`} className="bg-transparent" />
          const p = palabras.find((pp) => (pp.horizontal ? pp.fila === r && pp.col === c : pp.fila === r && pp.col === c))
          return (
            <div key={`${r}-${c}`} className="relative border border-outline-variant bg-surface">
              {p?.numero && <span className="absolute top-0 left-0.5 text-[7px] sm:text-[9px] text-muted leading-none">{p.numero}</span>}
              <input
                ref={(el) => { refs.current[`${r}-${c}`] = el }}
                value={celdas[`${r}-${c}`] || ''}
                disabled={readOnly}
                maxLength={1}
                onChange={(e) => handleChange(r, c, e.target.value)}
                className="w-full h-full text-center text-xs sm:text-sm font-semibold uppercase bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
            </div>
          )
        }))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <h4 className="font-semibold text-on-surface mb-1">Horizontales</h4>
          <ol className="space-y-0.5 text-muted">
            {horizontales.map((p) => <li key={p.index}>{p.numero}. {p.descripcion || p.palabra}</li>)}
          </ol>
        </div>
        <div>
          <h4 className="font-semibold text-on-surface mb-1">Verticales</h4>
          <ol className="space-y-0.5 text-muted">
            {verticales.map((p) => <li key={p.index}>{p.numero}. {p.descripcion || p.palabra}</li>)}
          </ol>
        </div>
      </div>
    </div>
  )
}
