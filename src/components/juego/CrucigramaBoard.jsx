// Crucigrama — tablero interactivo (29-ago-2026).
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
//
// DIAGNÓSTICO TEMPORAL (Backspace Android):
//   Los console.log con prefijo [EF-crucigrama] están aquí para detectar qué
//   evento real llega desde el teclado virtual de Android/Capacitor WebView.
//   Se eliminan una vez confirmado el fix en dispositivo físico.

import { useRef, useState, useEffect, useLayoutEffect } from 'react'
import { resolverBackspace } from '../../utils/crucigramaBackspace.js'

export default function CrucigramaBoard({
  estructura,
  celdas = {},
  onCambioCelda,
  readOnly = false,
  estadoCorrecto = null,
  modoDocente = false,
}) {
  const { size = 0, grid = [], palabras = [] } = estructura || {}
  const refs = useRef({})
  // activaIdx: índice en `palabras` de la palabra seleccionada (null = ninguna)
  const [activaIdx, setActivaIdx] = useState(null)

  const palabraActiva = activaIdx != null ? palabras[activaIdx] : null

  // ─── Anti-stale-closure para listeners nativos ────────────────────────────
  // Los listeners nativos (añadidos vía addEventListener en useEffect) se
  // crean UNA SOLA VEZ por elemento y quedan en memoria. Sin este ref,
  // capturarían la versión de `celdas`/`palabraActiva` del primer render y
  // nunca se actualizarían. useLayoutEffect actualiza el ref síncronamente
  // después de cada commit, antes de que el usuario pueda interactuar.
  const liveRef = useRef({ celdas: {}, palabraActiva: null, onCambioCelda: null })
  useLayoutEffect(() => {
    liveRef.current.celdas = celdas
    liveRef.current.palabraActiva = palabraActiva
    liveRef.current.onCambioCelda = onCambioCelda
  })

  // Timestamp para detectar si el Backspace ya fue procesado en este ciclo de
  // eventos. Múltiples caminos (keydown, beforeinput, input, onChange) pueden
  // disparar para el mismo Backspace físico; solo el primero actúa.
  const backspaceAtRef = useRef(0)
  const markHandled = () => { backspaceAtRef.current = performance.now() }
  const wasHandled = () => (performance.now() - backspaceAtRef.current) < 80

  // WeakMap que rastrea qué elementos ya tienen listeners nativos para no
  // añadirlos dos veces si el componente re-renderiza con el mismo DOM.
  const boundRef = useRef(new WeakMap())

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

  // Aplica la lógica de Backspace usando SIEMPRE el estado más reciente
  // (liveRef). Se invoca tanto desde listeners nativos como desde handlers
  // de React; en ambos casos `liveRef.current` tiene el snapshot actual.
  function aplicarBackspace(r, c) {
    const { celdas: lc, palabraActiva: lp, onCambioCelda: loc } = liveRef.current
    const { borrar, foco } = resolverBackspace(r, c, lc, lp)
    if (borrar) loc?.(borrar.r, borrar.c, '')
    if (foco) refs.current[`${foco.r}-${foco.c}`]?.focus()
  }

  // ─── Listeners nativos — bypass de la delegación de eventos de React ──────
  // React 17+ delega eventos en la raíz del árbol. En Capacitor/Android
  // WebView el navegador puede procesar la eliminación de texto (IME
  // deleteSurroundingText) ANTES de que el evento burbujee hasta React, por
  // lo que e.preventDefault() en onBeforeInput de React llega demasiado tarde.
  // Añadir el listener directamente en el elemento (captura en origen) evita
  // ese retraso y garantiza que preventDefault actúe antes del cambio en el DOM.
  useEffect(() => {
    if (readOnly) return

    Object.entries(refs.current).forEach(([key, el]) => {
      if (!el || boundRef.current.has(el)) return

      const [r, c] = key.split('-').map(Number)

      // ── 1. keydown: teclado físico y Android con teclado hardware ──────────
      const onKeyDown = (e) => {
        console.log(
          `[EF-crucigrama keydown] key="${e.key}" code="${e.code}" keyCode=${e.keyCode} which=${e.which}`
        )
        if (e.key === 'Backspace') {
          e.preventDefault()
          markHandled()
          aplicarBackspace(r, c)
        }
      }

      // ── 2. beforeinput: teclado virtual Android (debe llegar ANTES del DOM) ─
      // inputType posibles en Android:
      //   deleteContentBackward  → Backspace estándar
      //   deleteCompositionText  → Backspace durante composición IME (Samsung KB)
      //   deleteSoftLineBackward → Backspace larga pulsación en algunos teclados
      const BACKWARD_TYPES = new Set([
        'deleteContentBackward',
        'deleteCompositionText',
        'deleteSoftLineBackward',
      ])
      const onBeforeInput = (e) => {
        console.log(
          `[EF-crucigrama beforeinput] inputType="${e.inputType}" data="${e.data}"`
        )
        if (BACKWARD_TYPES.has(e.inputType)) {
          e.preventDefault()
          if (!wasHandled()) {
            markHandled()
            aplicarBackspace(r, c)
          }
        }
      }

      // ── 3. input: fallback cuando beforeinput no cancela el DOM change ─────
      // En algunos WebViews el DOM ya fue modificado antes de que llegue
      // beforeinput. El evento `input` (nativo, no React) llega después del
      // cambio y aún contiene inputType con la causa real.
      const onInput = (e) => {
        console.log(
          `[EF-crucigrama input] inputType="${e.inputType}" value="${el.value}"`
        )
        if (BACKWARD_TYPES.has(e.inputType) && !wasHandled()) {
          markHandled()
          aplicarBackspace(r, c)
        }
      }

      el.addEventListener('keydown', onKeyDown)
      el.addEventListener('beforeinput', onBeforeInput)
      el.addEventListener('input', onInput)

      boundRef.current.set(el, { onKeyDown, onBeforeInput, onInput })
    })
    // Sin cleanup por elemento: los listeners se eliminan automáticamente
    // cuando el DOM element es desmontado (WeakMap lo permite GC).
    // El cleanup del componente entero no es necesario porque los elementos
    // se destruyen con él.
  }) // Sin dependency array: se ejecuta tras cada render para capturar celdas nuevas

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

  // ─── onChange: último fallback para Android WebView ────────────────────────
  // Recibe el evento completo (no solo e.target.value) para poder leer
  // e.nativeEvent.inputType. En WebViews donde ni keydown ni beforeinput
  // funcionan, el onChange aún llega con el inputType correcto.
  function handleChange(r, c, e) {
    if (readOnly) return

    const nativeType = e?.nativeEvent?.inputType || ''
    console.log(
      `[EF-crucigrama React onChange] nativeInputType="${nativeType}" value="${e?.target?.value}"`
    )

    // Backspace detectado vía onChange (DOM ya fue modificado)
    if (
      nativeType === 'deleteContentBackward' ||
      nativeType === 'deleteCompositionText' ||
      nativeType === 'deleteSoftLineBackward'
    ) {
      if (!wasHandled()) {
        markHandled()
        aplicarBackspace(r, c)
      }
      // Siempre return: aunque wasHandled, no procesar como letra
      return
    }

    const valor = e?.target?.value || ''
    const letra = valor.slice(-1).toUpperCase()
    onCambioCelda?.(r, c, letra)
    if (letra) {
      const sig = siguiente(r, c)
      if (sig) refs.current[`${sig.r}-${sig.c}`]?.focus()
    }
  }

  // React-level keydown: backup del listener nativo (llega después, wasHandled
  // lo detecta y lo descarta si el nativo ya actuó).
  function handleKeyDown(r, c, e) {
    if (readOnly) return
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (!wasHandled()) {
        markHandled()
        aplicarBackspace(r, c)
      }
    }
  }

  // React-level beforeinput: backup del listener nativo.
  function handleBeforeInput(r, c, e) {
    if (readOnly) return
    const BACKWARD_TYPES = ['deleteContentBackward', 'deleteCompositionText', 'deleteSoftLineBackward']
    if (BACKWARD_TYPES.includes(e.inputType)) {
      e.preventDefault()
      if (!wasHandled()) {
        markHandled()
        aplicarBackspace(r, c)
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
    return p.descripcion || '⚠ sin pista'
  }

  return (
    <div className="space-y-4">
      {/* Cuadrícula */}
      <div
        className="grid w-full max-w-md mx-auto"
        style={{ gridTemplateColumns: `repeat(${size}, 1fr)`, aspectRatio: '1 / 1' }}
      >
        {grid.map(({ row: fila = [] } = {}, r) =>
          fila.map((letra, c) => {
            if (!letra) return <div key={`${r}-${c}`} className="bg-transparent" />
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
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  onChange={(e) => handleChange(r, c, e)}
                  onKeyDown={(e) => handleKeyDown(r, c, e)}
                  onBeforeInput={(e) => handleBeforeInput(r, c, e)}
                  onFocus={() => {
                    if (readOnly || activaIdx != null) return
                    const enCelda = palabrasEnCelda(r, c)
                    if (enCelda.length > 0) {
                      const preferH = enCelda.find((p) => p.horizontal) || enCelda[0]
                      setActivaIdx(preferH.index)
                    }
                  }}
                  className="w-full h-full text-center text-xs sm:text-sm font-semibold uppercase bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer disabled:opacity-100 disabled:text-on-surface disabled:[-webkit-text-fill-color:currentColor]"
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
