// Tarjeta: superficie blanca, radio de tarjeta y filo de 1px (elevación plana).
// El relleno sale de la tabla de DESIGN_SYSTEM §4.4, no se escribe a mano.
//
//   padding      none · sm (p-3, filas/compactas) · md (p-4, default) · lg (p-5, diálogos)
//   interactive  hover que levanta un poco + presión (para tarjetas que navegan)
//   as           'div' (default), 'section', 'button', Link…
import { forwardRef } from 'react'
import { cn } from './cn'

const PADDING = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5' }

const Card = forwardRef(function Card({ as: Tag = 'div', padding = 'md', interactive = false, className = '', ...rest }, ref) {
  return (
    <Tag
      ref={ref}
      className={cn(
        'bg-surface-card rounded-card shadow-card',
        PADDING[padding] ?? PADDING.md,
        interactive && 'block w-full text-left transition hover:shadow-card-hover active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        className
      )}
      {...rest}
    />
  )
})

export default Card
