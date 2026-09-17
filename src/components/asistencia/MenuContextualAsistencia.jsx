import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBackHandler } from '../../hooks/useBackHandler'

// Menú contextual de la tabla de Asistencias (web de escritorio, tablet y
// teléfono; nunca la app nativa). Se abre con clic derecho, con pulsación larga
// en pantalla táctil o, sobre el nombre del estudiante, con la tecla Menú /
// Shift+F10. Va en un portal con posición fija junto al puntero para que el
// scroll de la tabla y su encabezado fijo no lo recorten.
//
// Teclado: el primer elemento recibe el foco al abrir; flechas y Inicio/Fin
// mueven el foco; Esc cierra y devuelve el foco a quien lo abrió; Tab cierra.
// Se cierra también con clic afuera, scroll, cambio de tamaño y botón atrás.
//
// Props:
//   menu     null | { x, y, trigger (HTMLElement), tactil, resumen?, ariaLabel?,
//                     items: [{ label, tooltip?, icon?, onSelect }] }
//            tactil  → opciones más altas (dedo) y sin tooltips.
//            resumen → texto de la observación, resumido arriba de las opciones:
//                      en táctil no hay hover para consultarla.
//   onClose  () => void
export default function MenuContextualAsistencia({ menu, onClose }) {
  const boxRef = useRef(null)
  const [pos, setPos] = useState(null)
  const abierto = !!menu

  useBackHandler(onClose, abierto)

  // Acomoda el menú dentro de la ventana antes de pintarlo.
  useLayoutEffect(() => {
    if (!menu || !boxRef.current) { setPos(null); return }
    const { width, height } = boxRef.current.getBoundingClientRect()
    const margen = 8
    setPos({
      left: Math.max(margen, Math.min(menu.x, window.innerWidth - width - margen)),
      top: Math.max(margen, Math.min(menu.y, window.innerHeight - height - margen)),
    })
  }, [menu])

  useEffect(() => {
    if (!menu || !pos) return
    boxRef.current?.querySelector('[role="menuitem"]')?.focus()
  }, [menu, pos])

  useEffect(() => {
    if (!abierto) return undefined
    const abiertoEn = Date.now()
    const fuera = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) onClose() }
    // Android dispara su propio `contextmenu` con la misma pulsación larga que
    // acaba de abrir este menú: ese no debe cerrarlo.
    const contextmenuFuera = (e) => { if (Date.now() - abiertoEn > 800) fuera(e) }
    const cerrar = () => onClose()
    // pointerdown cubre mouse, dedo y lápiz.
    document.addEventListener('pointerdown', fuera, true)
    document.addEventListener('contextmenu', contextmenuFuera, true)
    window.addEventListener('scroll', cerrar, true)
    window.addEventListener('resize', cerrar)
    window.addEventListener('blur', cerrar)
    return () => {
      document.removeEventListener('pointerdown', fuera, true)
      document.removeEventListener('contextmenu', contextmenuFuera, true)
      window.removeEventListener('scroll', cerrar, true)
      window.removeEventListener('resize', cerrar)
      window.removeEventListener('blur', cerrar)
    }
  }, [abierto, onClose])

  if (!menu) return null

  const cerrarDevolviendoFoco = () => {
    const trigger = menu.trigger
    onClose()
    if (trigger && typeof trigger.focus === 'function' && trigger.isConnected) trigger.focus({ preventScroll: true })
  }

  const onKeyDown = (e) => {
    const items = [...boxRef.current.querySelectorAll('[role="menuitem"]')]
    const i = items.indexOf(document.activeElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarDevolviendoFoco() }
    else if (e.key === 'Tab') { e.preventDefault(); cerrarDevolviendoFoco() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus() }
    // Enter/Espacio activan el elemento con foco de forma explícita (sin
    // depender del clic sintético del navegador, que no todos generan igual).
    else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) { e.preventDefault(); items[i].click() }
  }

  return createPortal(
    <div
      ref={boxRef}
      role="menu"
      aria-label={menu.ariaLabel || 'Opciones'}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      // Antes de acomodarlo se mide en la esquina (oculto): junto al borde
      // derecho mediría angosto y luego crecería fuera de la pantalla.
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
      className={`fixed z-[95] min-w-[12rem] py-1 bg-surface-card border border-outline-variant rounded-card shadow-2xl ${menu.resumen ? 'max-w-xs' : ''}`}
    >
      {menu.resumen && (
        <p className="px-3 pt-1.5 pb-2 mb-1 text-sm text-on-surface whitespace-pre-wrap break-words line-clamp-4 border-b border-outline-variant">
          {menu.resumen}
        </p>
      )}
      {menu.items.map((it) => {
        const Icon = it.icon
        return (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            data-tooltip={menu.tactil ? undefined : it.tooltip}
            data-tooltip-pos={it.tooltip && !menu.tactil ? 'right' : undefined}
            // El foco regresa primero a quien abrió el menú: así el modal que
            // se abra a continuación lo devuelve ahí al cerrarse.
            onClick={() => { cerrarDevolviendoFoco(); it.onSelect() }}
            className={`w-full flex items-center gap-2 text-left px-3 ${menu.tactil ? 'py-3 text-base' : 'py-2 text-sm'} text-on-surface hover:bg-[var(--accent-tint)] focus:outline-none focus-visible:bg-[var(--accent-tint)] transition-colors`}
          >
            {Icon && <Icon size={15} className="text-accent flex-shrink-0" />}
            {it.label}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
