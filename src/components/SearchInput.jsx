import { useLayoutEffect, useRef, useState } from 'react'
import { Search, XCircle } from 'lucide-react'

// Caja de búsqueda estándar del proyecto: ícono de lupa a la izquierda, y un
// círculo con "x" que solo aparece cuando hay texto — toca para limpiar la
// búsqueda al instante, sin tener que posicionar el cursor y usar backspace.
// El botón se coloca justo DESPUÉS de las letras escritas (no en el borde
// derecho de la caja): se mide el ancho del texto con un <span> espejo
// invisible y se posiciona ahí, con tope en el borde derecho para textos
// largos que llenan la caja.
const PAD_LEFT = 36 // px — coincide con pl-9 (2.25rem), donde arranca el texto
const GAP = 4

export default function SearchInput({
  value, onChange, placeholder, size = 16, className = '', autoFocus = false,
}) {
  const inputRef = useRef(null)
  const measureRef = useRef(null)
  const [clearLeft, setClearLeft] = useState(PAD_LEFT)

  useLayoutEffect(() => {
    if (!inputRef.current || !measureRef.current) return
    const textWidth = measureRef.current.offsetWidth
    const maxLeft = inputRef.current.offsetWidth - 28 // espacio para el propio botón + margen
    setClearLeft(Math.min(PAD_LEFT + textWidth + GAP, Math.max(PAD_LEFT, maxLeft)))
  }, [value])

  return (
    <div className="relative">
      <Search size={size} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`w-full pl-9 pr-9 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface-card ${className}`}
      />
      {/* Espejo invisible — mismo texto/tamaño de fuente que el input, solo para medir el ancho */}
      <span ref={measureRef} className="absolute invisible whitespace-pre text-sm pointer-events-none" aria-hidden="true">
        {value}
      </span>
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Limpiar búsqueda"
          style={{ left: clearLeft }}
          className="absolute top-1/2 -translate-y-1/2 text-slate-400 hover:text-muted rounded-full transition-colors"
        >
          <XCircle size={size} />
        </button>
      )}
    </div>
  )
}
