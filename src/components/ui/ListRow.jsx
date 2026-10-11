// Fila de lista navegable (ajustes, tablero, entregas…): ícono, título,
// detalle opcional y una flecha al final. Una sola anatomía para toda la app.
// PLAN_NORMALIZACION_UI §3. Se agrupan con ListGroup.
//
//   to (Link interno) · href (enlace externo, abre pestaña nueva) · onClick (botón)
//   icon      componente de ícono (va en color de acento)
//   leading   nodo propio en lugar del ícono (IconTile, Avatar, logo…)
//   title, detail
//   trailing  'chevron' (default) · 'external' · null · nodo propio
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import { cn } from './cn'
import { ICONO } from '../../config/iconos'

export const FILA_LISTA =
  'w-full flex items-center gap-3 px-3 py-2 min-h-control rounded-full text-left text-sm text-on-surface transition-colors hover:bg-[var(--accent-tint)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'

export function FlechaFila({ external = false }) {
  const Icono = external ? ArrowUpRight : ChevronRight
  return <Icono size={ICONO.sm} aria-hidden="true" className="text-hint flex-shrink-0 transition-transform duration-rapida group-hover:translate-x-0.5" />
}

export default function ListRow({ to, href, onClick, icon: Icono, leading, title, detail, trailing = 'chevron', className = '', children, ...rest }) {
  const externo = !!href
  const contenido = (
    <>
      {leading || (Icono && <Icono size={ICONO.md} aria-hidden="true" className="text-accent flex-shrink-0" />)}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        {detail && <span className="block text-muted font-normal mt-0.5">{detail}</span>}
        {children}
      </span>
      {trailing === 'chevron' ? <FlechaFila /> : trailing === 'external' || (trailing === 'auto' && externo) ? <FlechaFila external /> : trailing}
    </>
  )
  const cls = cn('group', FILA_LISTA, className)
  if (to) return <Link to={to} className={cls} {...rest}>{contenido}</Link>
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" className={cls} {...rest}>{contenido}</a>
  return <button type="button" onClick={onClick} className={cls} {...rest}>{contenido}</button>
}

// Grupo de filas en una tarjeta, con título opcional (estilo «Ajustes»).
export function ListGroup({ title, className = '', children }) {
  return (
    <section className={cn('bg-surface-card rounded-card shadow-card p-2', className)}>
      {title && <h2 className="px-3 pt-2 pb-1 text-xs font-semibold text-muted">{title}</h2>}
      <div className="space-y-1">{children}</div>
    </section>
  )
}
