// Modal canónico — docs/DESIGN_SYSTEM.md §6.7. El backdrop es un <button> real
// hermano del panel (nunca un div de presentación ni aria-hidden), enfocable,
// para que el cierre por teclado/lector funcione sin depender del botón X. El
// panel NO necesita stopPropagation porque es hermano del backdrop, no su hijo.
//
// En el código conviven dos layouts reales de modal — este componente soporta
// ambos para poder migrar sin cambiar nada visual:
//   variant='sheet'    → bottom-sheet en móvil, centrado en desktop (patrón
//                        "objetivo" de §6.7): items-end sm:items-center +
//                        rounded-t-card sm:rounded-card.
//   variant='centered' → centrado siempre (el más común hoy): items-center +
//                        rounded-card.
//
// Props:
//   open, onClose        control.
//   title                encabezado opcional (fila con título + X).
//   variant  'sheet' (default) | 'centered'
//   size     'sm' (default) | 'md' | 'lg' | '3xl'  — max-width del panel.
//   z        50 (default) | 40 | 60 | 90 | 110  — z-index del wrapper (algunos
//            modales son sub-modales y viven por encima de otro).
//   padding  clases de padding del panel (default 'p-4 sm:p-5').
//   footer   nodo opcional para la fila de acciones.
//   busy     bloquea el cierre por backdrop/Escape.
//   closeOnBackdrop  default true.
//   className  clases extra para el panel.
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from './cn'

const SIZES = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', '3xl': 'max-w-3xl' }
const Z = { 40: 'z-40', 50: 'z-50', 60: 'z-[60]', 90: 'z-[90]', 110: 'z-[110]' }

export default function Modal({
  open,
  onClose,
  title,
  variant = 'sheet',
  size = 'sm',
  z = 50,
  padding = 'p-4 sm:p-5',
  footer,
  busy = false,
  closeOnBackdrop = true,
  className = '',
  children,
}) {
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

  const sheet = variant === 'sheet'
  const wrapper = cn(
    'fixed inset-0 flex justify-center',
    Z[z] || Z[50],
    sheet ? 'items-end sm:items-center' : 'items-center px-4'
  )
  const panel = cn(
    'relative bg-surface-card w-full shadow-2xl max-h-[92vh] overflow-y-auto',
    sheet ? 'sm:w-[calc(100%-2rem)] rounded-t-card sm:rounded-card' : 'rounded-card',
    SIZES[size] || SIZES.sm,
    padding,
    className
  )

  return (
    <div className={wrapper}>
      <button
        type="button"
        className="absolute inset-0 bg-black/40 border-none cursor-default"
        onClick={closeOnBackdrop ? requestClose : undefined}
        aria-label="Cerrar"
      />
      <div className={panel}>
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
