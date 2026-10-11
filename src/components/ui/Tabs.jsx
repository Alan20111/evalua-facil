// Pestañas de la app, dos niveles (el patrón de la asignatura y del perfil):
//   · Tabs     — barra segmentada a todo lo ancho; la píldora blanca del
//                elegido SE DESLIZA a la nueva opción (PLAN §5.1 y §6.1).
//   · SubTabs  — píldoras chicas centradas dentro de una pestaña; la elegida
//                va rellena de acento.
// options: [{ value, label, icon?, shortLabel? }] — shortLabel se usa en el
// teléfono cuando no caben todas. La barra mide una altura de control.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from './cn'
import { ICONO } from '../../config/iconos'

export function Tabs({ options = [], value, onChange, label, className = '' }) {
  const barra = useRef(null)
  const botones = useRef({})
  const [pildora, setPildora] = useState(null)
  // La primera medición coloca la píldora sin animar; después, se desliza.
  const [animar, setAnimar] = useState(false)

  useLayoutEffect(() => {
    const medir = () => {
      const el = botones.current[value]
      if (!el) return
      setPildora({ x: el.offsetLeft, w: el.offsetWidth })
      // Que la elegida quede a la vista si la barra se desplaza (teléfono),
      // moviendo SOLO la barra, nunca la página.
      const b = barra.current
      if (b && b.scrollWidth > b.clientWidth) {
        const izq = el.offsetLeft - 8
        const der = el.offsetLeft + el.offsetWidth + 8 - b.clientWidth
        if (izq < b.scrollLeft) b.scrollLeft = izq
        else if (der > b.scrollLeft) b.scrollLeft = der
      }
    }
    medir()
    const ro = new ResizeObserver(medir)
    if (barra.current) ro.observe(barra.current)
    return () => ro.disconnect()
  }, [value, options])
  useEffect(() => {
    if (!pildora || animar) return
    const id = requestAnimationFrame(() => setAnimar(true))
    return () => cancelAnimationFrame(id)
  }, [pildora, animar])

  return (
    <div ref={barra} role="tablist" aria-label={label}
      className={cn('relative flex gap-1 bg-surface-container p-1 rounded-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}>
      {pildora && (
        <span aria-hidden="true"
          className={cn('absolute top-1 bottom-1 left-0 rounded-full bg-surface-card shadow-card', animar && 'transition-[transform,width] duration-estandar ease-firma motion-reduce:transition-none')}
          style={{ transform: `translateX(${pildora.x}px)`, width: pildora.w }} />
      )}
      {options.map((o) => {
        const activa = value === o.value
        const Icono = o.icon
        return (
          <button key={o.value} ref={(el) => { botones.current[o.value] = el }}
            type="button" role="tab" aria-selected={activa} onClick={() => onChange?.(o.value)}
            className={cn(
              'relative flex-1 flex items-center justify-center gap-1.5 whitespace-nowrap h-[calc(var(--control)-0.5rem)] px-3 text-sm font-medium rounded-full transition-colors duration-rapida focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              activa ? 'text-on-surface' : 'text-muted hover:text-on-surface'
            )}>
            {Icono && <Icono size={ICONO.sm} aria-hidden="true" className={cn('transition-colors duration-rapida', o.shortLabel && 'hidden sm:block', activa ? 'text-accent' : 'text-hint')} />}
            {o.shortLabel
              ? (<><span className="sm:hidden">{o.shortLabel}</span><span className="hidden sm:inline">{o.label}</span></>)
              : o.label}
          </button>
        )
      })}
    </div>
  )
}

export function SubTabs({ options = [], value, onChange, label, className = '' }) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex justify-center flex-wrap gap-1', className)}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value}
          onClick={() => onChange?.(o.value)}
          className={cn(
            'h-control-sm px-4 text-sm font-medium rounded-full transition-colors duration-rapida active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            value === o.value ? 'bg-accent text-white' : 'text-muted hover:bg-[var(--accent-tint)] hover:text-on-surface'
          )}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default Tabs
