import { Search, XCircle } from 'lucide-react'

// Caja de búsqueda estándar del proyecto: ícono de lupa a la izquierda, y un
// círculo con "x" a la derecha que solo aparece cuando hay texto — toca para
// limpiar la búsqueda al instante, sin tener que posicionar el cursor y usar
// backspace.
export default function SearchInput({
  value, onChange, placeholder, size = 16, className = '', autoFocus = false,
}) {
  return (
    <div className="relative">
      <Search size={size} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`w-full pl-9 pr-9 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface-card ${className}`}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Limpiar búsqueda"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-muted rounded-full transition-colors"
        >
          <XCircle size={size} />
        </button>
      )}
    </div>
  )
}
