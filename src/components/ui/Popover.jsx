// Menú emergente y popover (PLAN_NORMALIZACION_UI §3 y §6.1). Vive en un
// portal sobre todo (z-menu, por encima de las hojas), se posiciona junto a su
// botón, CRECE desde él al abrir y se encoge más rápido al cerrar. Cierra con
// Escape, con clic fuera y al elegir; en el Menu, ↑ ↓ recorren las opciones.
//
// <Popover trigger={({ ref, ...props }) => <Button ref={ref} {...props}>…</Button>}>
//   contenido
// </Popover>
//
// <Menu label="Más opciones" items={[{ label, icon, onClick, danger, disabled }]} />
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'
import { cn } from './cn'
import IconButton from './IconButton'
import { ICONO } from '../../config/iconos'

export function Popover({ trigger, children, align = 'end', className = '', label }) {
  const [estado, setEstado] = useState('cerrado') // cerrado · abierto · saliendo
  const ancla = useRef(null)
  const panel = useRef(null)
  const id = useId()
  const abierto = estado !== 'cerrado'
  // Coloca el panel junto a su botón (abajo, o arriba si no cabe) escribiendo
  // directo en su estilo: no hay estado que provoque renders en cascada.
  useLayoutEffect(() => {
    if (!abierto) return undefined
    const medir = () => {
      const a = ancla.current?.getBoundingClientRect()
      const p = panel.current
      if (!a || !p) return
      const margen = 8
      let left = align === 'start' ? a.left : a.right - p.offsetWidth
      left = Math.max(margen, Math.min(left, window.innerWidth - p.offsetWidth - margen))
      const abajo = a.bottom + 4
      const arriba = abajo + p.offsetHeight > window.innerHeight - margen && a.top - p.offsetHeight - 4 > margen
      p.style.left = `${left}px`
      p.style.top = `${arriba ? a.top - p.offsetHeight - 4 : abajo}px`
      p.style.transformOrigin = `${align === 'start' ? 'left' : 'right'} ${arriba ? 'bottom' : 'top'}`
    }
    medir()
    window.addEventListener('resize', medir)
    window.addEventListener('scroll', medir, true)
    return () => {
      window.removeEventListener('resize', medir)
      window.removeEventListener('scroll', medir, true)
    }
  }, [abierto, ancla, panel, align])

  const cerrar = () => setEstado((e) => (e === 'abierto' ? 'saliendo' : e))
  useEffect(() => {
    if (estado !== 'saliendo') return undefined
    const t = setTimeout(() => setEstado('cerrado'), 120)
    return () => clearTimeout(t)
  }, [estado])
  useEffect(() => {
    if (!abierto) return undefined
    const salir = () => setEstado((e) => (e === 'abierto' ? 'saliendo' : e))
    const fuera = (e) => {
      if (panel.current?.contains(e.target) || ancla.current?.contains(e.target)) return
      salir()
    }
    const tecla = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); salir(); ancla.current?.focus() }
    }
    document.addEventListener('pointerdown', fuera)
    document.addEventListener('keydown', tecla, true)
    return () => {
      document.removeEventListener('pointerdown', fuera)
      document.removeEventListener('keydown', tecla, true)
    }
  }, [abierto])

  const alternar = () => setEstado((e) => (e === 'cerrado' ? 'abierto' : 'saliendo'))

  return (
    <>
      {trigger({ ref: ancla, onClick: alternar, 'aria-expanded': estado === 'abierto', 'aria-controls': abierto ? id : undefined, 'aria-haspopup': 'true' })}
      {abierto && createPortal(
        <div
          ref={panel}
          id={id}
          aria-label={label}
          className={cn(
            'fixed z-menu min-w-[12rem] max-w-[calc(100vw-1rem)] bg-surface-card rounded-card shadow-card-hover p-1',
            estado === 'saliendo' ? 'animate-menu-sale' : 'animate-menu',
            'motion-reduce:animate-none',
            className
          )}
          style={{ left: -9999, top: -9999 }}
        >
          {typeof children === 'function' ? children({ cerrar }) : children}
        </div>,
        document.body
      )}
    </>
  )
}

const ITEM =
  'group w-full flex items-center gap-3 h-control px-3 rounded-full text-left text-sm font-medium transition-colors focus:outline-none focus-visible:bg-[var(--accent-tint)] disabled:opacity-40 disabled:cursor-not-allowed'

export function Menu({ items = [], label = 'Más opciones', align = 'end', trigger, className = '' }) {
  const lista = useRef(null)
  const mover = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const botones = [...(lista.current?.querySelectorAll('button:not(:disabled)') || [])]
    const i = botones.indexOf(document.activeElement)
    const sig = e.key === 'ArrowDown' ? (i + 1) % botones.length : (i - 1 + botones.length) % botones.length
    botones[sig]?.focus()
  }
  return (
    <Popover
      align={align}
      label={label}
      className={className}
      trigger={trigger || ((props) => <IconButton icon={MoreVertical} label={label} {...props} />)}
    >
      {({ cerrar }) => (
      <div ref={lista} className="space-y-0.5">
        {items.filter(Boolean).map((it) => {
          const Icono = it.icon
          return (
            <button key={it.label} type="button" disabled={it.disabled} onKeyDown={mover}
              onClick={() => { cerrar(); it.onClick?.() }}
              className={cn(ITEM, it.danger ? 'text-red-600 hover:bg-red-50' : 'text-on-surface hover:bg-[var(--accent-tint)]')}>
              {Icono && <Icono size={ICONO.sm} aria-hidden="true" className={cn('flex-shrink-0', it.danger ? 'text-red-600' : 'text-muted')} />}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
            </button>
          )
        })}
      </div>
      )}
    </Popover>
  )
}

export default Popover
