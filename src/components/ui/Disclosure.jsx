// Sección que se abre y se cierra con animación (el patrón de los parciales,
// ahora en un solo lugar): alto con grid-rows 0fr→1fr, el chevron gira, el
// contenido se monta la primera vez que se abre y queda `inert` cerrado.
// PLAN_NORMALIZACION_UI §6.1.
//
//   summary        lo que se ve siempre (dentro del botón)
//   open / onOpenChange   controlado; si no, defaultOpen
//   chevron        true (a la derecha) · false
//   inline         botón del ancho de su texto (enlaces tipo «¿Qué es esto?»)
import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from './cn'
import { ICONO } from '../../config/iconos'

export default function Disclosure({ summary, children, defaultOpen = false, open: abiertoProp, onOpenChange, chevron = true, inline = false, className = '', buttonClassName = '', panelClassName = '' }) {
  const [abiertoInterno, setAbiertoInterno] = useState(defaultOpen)
  const abierto = abiertoProp ?? abiertoInterno
  // Se monta la primera vez que se abre y ya no se desmonta (cerrar no pierde
  // lo escrito). Estado derivado durante el render: patrón válido de React.
  const [visto, setVisto] = useState(abierto)
  if (abierto && !visto) setVisto(true)
  const id = useId()
  const alternar = () => {
    const nuevo = !abierto
    if (abiertoProp === undefined) setAbiertoInterno(nuevo)
    onOpenChange?.(nuevo)
  }
  return (
    <div className={className || undefined}>
      <button type="button" aria-expanded={abierto} aria-controls={id} onClick={alternar}
        className={cn(inline ? 'inline-flex' : 'w-full flex', 'items-center gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full', buttonClassName)}>
        <span className={inline ? undefined : 'min-w-0 flex-1'}>{summary}</span>
        {chevron && <ChevronDown size={ICONO.sm} aria-hidden="true" className={cn('flex-shrink-0 text-muted transition-transform duration-estandar ease-firma', abierto && 'rotate-180')} />}
      </button>
      <div id={id} className={cn('grid transition-[grid-template-rows] duration-estandar ease-firma motion-reduce:transition-none', abierto ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
        inert={!abierto}>
        <div className="overflow-hidden min-h-0">
          {visto && <div className={cn('pt-2', panelClassName)}>{children}</div>}
        </div>
      </div>
    </div>
  )
}
