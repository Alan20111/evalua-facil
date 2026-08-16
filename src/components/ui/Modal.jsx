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
// Accesibilidad (docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 2, B3/B4):
// role="dialog" + aria-modal en el panel (no en el wrapper, que es solo el
// contenedor de centrado). El nombre accesible del diálogo sale de `title`
// (via aria-labelledby a su <h3>) o de `ariaLabel` cuando no hay título
// visible — sin ninguno de los dos, un lector de pantalla anuncia "diálogo"
// sin más contexto. react-focus-lock atrapa el Tab dentro del panel y
// devuelve el foco a quien lo abrió al cerrar (returnFocus). useScrollLock
// vive aquí adentro — antes cada consumidor tenía que acordarse de llamarlo
// aparte (y algunos, como ConfirmModal, no lo hacían).
//
// Props:
//   open, onClose        control.
//   title                encabezado opcional (fila con título + X).
//   ariaLabel            nombre accesible del diálogo cuando no hay `title`
//                        visible (ej. ConfirmModal, LinkAccountModal).
//   variant  'sheet' (default) | 'centered'
//   size     'sm' (default) | 'md' | 'lg' | '3xl'  — max-width del panel.
//   z        50 (default) | 40 | 60 | 90 | 110  — z-index del wrapper (algunos
//            modales son sub-modales y viven por encima de otro).
//   padding  clases de padding del panel (default 'p-4 sm:p-5').
//   footer   nodo opcional para la fila de acciones.
//   busy     bloquea el cierre por backdrop/Escape.
//   closeOnBackdrop  default true.
//   className  clases extra para el panel.
import { useEffect, useId } from 'react'
import FocusLock from 'react-focus-lock'
import { X } from 'lucide-react'
import { cn } from './cn'
import { useScrollLock } from '../../hooks/useScrollLock'

const SIZES = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', '3xl': 'max-w-3xl' }
const Z = { 40: 'z-40', 50: 'z-50', 60: 'z-[60]', 90: 'z-[90]', 110: 'z-[110]' }

export default function Modal({
  open,
  onClose,
  title,
  ariaLabel,
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
  const titleId = useId()

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  useScrollLock(open)

  useEffect(() => {
    if (open && import.meta.env.DEV && !title && !ariaLabel) {
      console.warn('<Modal> sin `title` ni `ariaLabel` — el diálogo no tiene nombre accesible para lectores de pantalla.')
    }
  }, [open, title, ariaLabel])

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
    'relative bg-surface-card w-full drop-shadow-2xl max-h-[92vh] overflow-y-auto',
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
      <FocusLock returnFocus className="contents">
        {/* eslint-disable-next-line jsx-a11y/prefer-tag-over-role --
            role="dialog" + aria-modal es el patrón estándar de la WAI-ARIA
            Authoring Practices Guide para diálogos custom (no el nativo
            <dialog>). Migrar a <dialog> nativo cambiaría el mecanismo de
            apertura (showModal imperativo vs. el prop `open` declarativo
            actual), el backdrop (::backdrop vs. el <button> hermano de
            DESIGN_SYSTEM.md §6.7, ya migrado dos veces antes de converger) y
            el focus trap (nativo vs. FocusLock) — es una migración de
            arquitectura, no un arreglo de accesibilidad puntual; fuera del
            alcance de Fase 2 ("sin refactorizar nada"). */}
        <div
          className={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-label={!title ? ariaLabel : undefined}
        >
          {title && (
            <div className="flex items-center justify-between mb-3">
              <h3 id={titleId} className="text-lg font-bold text-on-surface">
                {title}
              </h3>
              <button
                type="button"
                onClick={requestClose}
                aria-label="Cerrar"
                className="p-3 -m-1 text-slate-400 hover:text-error rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X size={20} />
              </button>
            </div>
          )}
          {children}
          {footer && <div className="flex gap-2 mt-4">{footer}</div>}
        </div>
      </FocusLock>
    </div>
  )
}
