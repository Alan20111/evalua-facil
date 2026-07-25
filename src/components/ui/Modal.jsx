// Modal canónico — extraído literal de docs/DESIGN_SYSTEM.md §6.7.
// Bottom-sheet en móvil, centrado en desktop. El backdrop es un <button> real
// hermano del panel (nunca un div de presentación ni aria-hidden), enfocable,
// para que el cierre por teclado/lector funcione sin depender del botón X. El
// panel NO necesita stopPropagation porque es hermano del backdrop, no su hijo.
//
// Props:
//   open      si es false, no renderiza nada.
//   onClose   se llama al tocar el backdrop, la X, o Escape.
//   title     encabezado (opcional). Con `title` aparece la fila header + X.
//   size      'sm' (default) | 'lg' | '3xl'  — max-width del panel.
//   footer    nodo opcional para la fila de acciones (Cancelar / acción).
//   busy      bloquea el cierre por backdrop/Escape (para operaciones async).
//   closeOnBackdrop  default true.
//   children  cuerpo del modal.
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from './cn'

const SIZES = {
  sm: 'max-w-sm',
  lg: 'max-w-lg',
  '3xl': 'max-w-3xl',
}

export default function Modal({
  open,
  onClose,
  title,
  size = 'sm',
  footer,
  busy = false,
  closeOnBackdrop = true,
  className = '',
  children,
}) {
  // Cerrar con Escape (mismo criterio que el backdrop).
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const requestClose = () => {
    if (!busy) onClose?.()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 border-none cursor-default"
        onClick={closeOnBackdrop ? requestClose : undefined}
        aria-label="Cerrar"
      />
      <div
        className={cn(
          'relative bg-surface-card w-full sm:w-[calc(100%-2rem)] rounded-t-card sm:rounded-card p-4 sm:p-5 shadow-2xl max-h-[92vh] overflow-y-auto',
          SIZES[size] || SIZES.sm,
          className
        )}
      >
        {title && (
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-bold text-on-surface">{title}</h3>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Cerrar"
              className="p-1 text-slate-400 hover:text-error rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X size={20} />
            </button>
          </div>
        )}
        {children}
        {footer && <div className="flex gap-2 mt-4">{footer}</div>}
      </div>
    </div>
  )
}
