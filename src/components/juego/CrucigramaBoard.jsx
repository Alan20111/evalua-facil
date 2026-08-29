// Crucigrama — tablero interactivo (28-ago-2026).
//
// DOCENTE vs ESTUDIANTE:
//   modoDocente=true  → pistas muestran `descripcion || palabra` (el docente
//                        puede ver la respuesta para verificar el crucigrama)
//   modoDocente=false → pistas muestran solo `descripcion || "(N letras)"`:
//                        la respuesta (palabra) NUNCA se revela al estudiante.
//
// Interacción:
//   • Click en celda → selecciona la palabra que la contiene.
//     Si la celda es intersección (H + V) el primer click elige horizontal;
//     el siguiente click en la misma dirección cambia a vertical (toggle).
//   • Click en una pista → salta a la primera casilla de esa palabra.
//   • Letras → auto-avance a la siguiente casilla de la palabra activa.
//   • Backspace → borra la letra actual y retrocede una casilla (en la
//     dirección de la palabra activa). Si la casilla está vacía, solo retrocede.
//   • La palabra activa se resalta en azul claro.
//
// `readOnly` — modo solo lectura (revisión del docente sobre la entrega del alumno).
// `estadoCorrecto` — mapa { "r-c": true|false } para pintar verde/rojo
//   (solo lo usa ResolucionJuegoModal; ningún otro caller lo pasa).

import { useRef, useState } from 'react'

export default function CrucigramaBoard({
  estructura,
  celdas = {},
  onCambioCelda,
  readOnly = false,
  estadoCorrecto = null,
  modoDocente = false,
}) {
  const { size, celdas: grid, palabras } = estructura
  const refs = useRef({})
  // activaIdx: índice en `palabras` de la palabra seleccionada (null = ninguna)
  const [activaIdx, setActivaIdx] = useState(null)

  const palabraActiva = activaIdx != null ? palabras[activaIdx] : null

  const horizontales = palabras.filter((p) => p.horizontal).sort((a, b) => (a.numero || 0) - (b.numero || 0))
  const verticales = palabras.filter((p) => !p.horizontal).sort((a, b) => (a.numero || 0) - (b.numero || 0))

  // Todas las palabras que contienen la celda (r, c)
  function palabrasEnCelda(r, c) {
    return palabras.filter((p) => {
      for (let i = 0; i < p.longitud; i++) {
        if (p.horizontal ? p.fila === r && p.col + i === c : p.fila + i === r && p.col === c) return true
      }
      return false
    })
  }

  // ¿La celda (r, c) pertenece a la palabra activa?
  function esEnActiva(r, c) {
    if (!palabraActiva) return false
    const p = palabraActiva
    for (let i = 0; i < p.longitud; i++) {
      if (p.horizontal ? p.fila === r && p.col + i === c : p.fila + i === r && p.col === c) return true
    }
    return false
  }

  // Celda siguiente en la palabra activa desde (r, c)
  function siguiente(r, c) {
    if (!palabraActiva) return null
    const p = palabraActiva
    const i = p.horizontal ? c - p.col : r - p.fila
    if (i + 1 >= p.longitud) return null
    return p.horizontal ? { r, c: c + 1 } : { r: r + 1, c }
  }

  // Celda anterior en la palabra activa desde (r, c)
  function anterior(r, c) {
    if (!palabraActiva) return null
    const p = palabraActiva
    const i = p.horizontal ? c - p.col : r - p.fila
    if (i <= 0) return null
    return p.horizontal ? { r, c: c - 1 } : { r: r - 1, c }
  }

  function handleClickCelda(r, c) {
    if (readOnly) return
    const enCelda = palabrasEnCelda(r, c)
    if (enCelda.length === 0) return

    if (enCelda.length === 1) {
      setActivaIdx(enCelda[0].index)
    } else {
      // Intersección: si ya hay una palabra activa en esta celda, cambiar a la otra
      if (palabraActiva && enCelda.some((p) => p.index === palabraActiva.index)) {
        const otra = enCelda.find((p) => p.index !== palabraActiva.index)
        setActivaIdx(otra ? otra.index : enCelda[0].index)
      } else {
        // Preferir horizontal al entrar por primera vez
        const preferH = enCelda.find((p) => p.horizontal) || enCelda[0]
        setActivaIdx(preferH.index)
      }
    }
    refs.current[`${r}-${c}`]?.focus()
  }

  function handleChange(r, c, valor) {
    if (readOnly) return
    const letra = valor.slice(-1).toUpperCase()
    onCambioCelda?.(r, c, letra)
    if (letra) {
      const sig = siguiente(r, c)
      if (sig) refs.current[`${sig.r}-${sig.c}`]?.focus()
    }
  }

  function handleKeyDown(r, c, e) {
    if (readOnly) return
    if (e.key === 'Backspace') {
      e.preventDefault()
      const tieneletra = !!celdas[`${r}-${c}`]
      if (tieneletra) {
        // Borrar letra actual y retroceder
        onCambioCelda?.(r, c, '')
        const prev = anterior(r, c)
        if (prev) refs.current[`${prev.r}-${prev.c}`]?.focus()
      } else {
        // Celda vacía: solo retroceder (sin borrar la anterior)
        const prev = anterior(r, c)
        if (prev) refs.current[`${prev.r}-${prev.c}`]?.focus()
      }
    }
  }

  function handleSelectPalabra(p) {
    if (readOnly) return
    setActivaIdx(p.index)
    refs.current[`${p.fila}-${p.col}`]?.focus()
  }

  function textoClue(p) {
    if (modoDocente) return p.descripcion || p.palabra || ''
    // En modo estudiante NUNCA revelar la palabra. Si no hay pista, es un error
    // de datos (el editor ya lo bloquea): mostrar advertencia en lugar de la respuesta.
    return p.descripcion || '⚠ sin pista'
  }

  return (
    <div className="space-y-4">
      {/* Cuadrícula */}
      <div
        className="grid w-full max-w-md mx-auto"
        style={{ gridTemplateColumns: `repeat(${size}, 1fr)`, aspectRatio: '1 / 1' }}
      >
        {grid.map((fila, r) =>
          fila.map((letra, c) => {
            if (!letra) return <div key={`${r}-${c}`} className="bg-transparent" />
            // Celda que inicia una palabra (para mostrar su número)
            const inicioP = palabras.find((pp) => pp.fila === r && pp.col === c)
            const correcto = estadoCorrecto?.[`${r}-${c}`]
            const enActiva = !readOnly && esEnActiva(r, c)
            const bgCelda =
              correcto === true
                ? 'bg-emerald-100'
                : correcto === false
                ? 'bg-red-100'
                : enActiva
                ? 'bg-blue-100'
                : 'bg-surface'
            return (
              /* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
              <div
                key={`${r}-${c}`}
                className={`relative border border-outline-variant ${bgCelda}`}
                onClick={() => handleClickCelda(r, c)}
              >
                {inicioP?.numero != null && (
                  <span className="absolute top-0 left-0.5 text-[7px] sm:text-[9px] text-muted leading-none pointer-events-none select-none">
                    {inicioP.numero}
                  </span>
                )}
                <input
                  ref={(el) => { refs.current[`${r}-${c}`] = el }}
                  value={celdas[`${r}-${c}`] || ''}
                  disabled={readOnly}
                  maxLength={1}
                  onChange={(e) => handleChange(r, c, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(r, c, e)}
                  onFocus={() => {
                    if (readOnly || activaIdx != null) return
                    const enCelda = palabrasEnCelda(r, c)
                    if (enCelda.length > 0) {
                      const preferH = enCelda.find((p) => p.horizontal) || enCelda[0]
                      setActivaIdx(preferH.index)
                    }
                  }}
                  className="w-full h-full text-center text-xs sm:text-sm font-semibold uppercase bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
                />
              </div>
            )
          })
        )}
      </div>

      {/* Pistas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <h4 className="font-semibold text-on-surface mb-1">Horizontales</h4>
          <ol className="space-y-0.5 text-muted">
            {horizontales.map((p) => (
              <li key={p.index} className="leading-snug">
                <button
                  type="button"
                  onClick={() => handleSelectPalabra(p)}
                  className={`w-full text-left cursor-pointer hover:text-accent transition-colors ${
                    !readOnly && palabraActiva?.index === p.index ? 'text-accent font-medium' : ''
                  }`}
                >
                  {p.numero}. {textoClue(p)}
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h4 className="font-semibold text-on-surface mb-1">Verticales</h4>
          <ol className="space-y-0.5 text-muted">
            {verticales.map((p) => (
              <li key={p.index} className="leading-snug">
                <button
                  type="button"
                  onClick={() => handleSelectPalabra(p)}
                  className={`w-full text-left cursor-pointer hover:text-accent transition-colors ${
                    !readOnly && palabraActiva?.index === p.index ? 'text-accent font-medium' : ''
                  }`}
                >
                  {p.numero}. {textoClue(p)}
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}
