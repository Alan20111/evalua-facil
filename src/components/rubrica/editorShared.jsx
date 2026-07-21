import { Plus } from 'lucide-react'

// Compartido por RubricaEditor.jsx y ListaCotejoEditor.jsx — sus tablas
// editables divergen bastante (niveles variables con descriptores vs. una
// sola columna de puntos), pero este botón circular "+" y las clases del
// input transparente dentro de cada celda eran una copia exacta entre ambos.
export function BotonMas({ onClick, label }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} data-tooltip={label}
      className="w-9 h-9 rounded-full border-2 border-on-surface bg-surface-card text-on-surface flex items-center justify-center hover:border-accent hover:text-accent transition-colors flex-shrink-0 shadow-card">
      <Plus size={20} />
    </button>
  )
}

export const EDITOR_INPUT_CELL = 'bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-1'
