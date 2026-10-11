// Pestañas del perfil (docente y alumno), oct-2026. Dos niveles, el mismo
// patrón de la asignatura:
//   · Pestanas     — barra de píldoras a todo lo ancho (Perfil · Créditos · Ajustes)
//   · SubPestanas  — píldoras pequeñas centradas DENTRO de una pestaña
//                    (Perfil → Datos · Escuela · Cuenta)
// La elección vive en la URL (?seccion=…&sub=…): se puede enlazar y recargar
// no te regresa a la primera.
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export function Pestanas({ opciones, valor, onCambio, etiqueta }) {
  return (
    <div className="flex gap-1 bg-surface-container p-1 rounded-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label={etiqueta}>
      {opciones.map((o) => {
        const activa = valor === o.id
        return (
          <button key={o.id} type="button" role="tab" aria-selected={activa}
            onClick={() => onCambio(o.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium rounded-full transition-colors ${
              activa ? 'bg-surface-card shadow-card' : 'hover:bg-[var(--accent-medium)]'
            }`}>
            <o.icono size={15} aria-hidden="true" className={activa ? 'text-accent' : 'text-hint'} />
            {o.etiqueta}
          </button>
        )
      })}
    </div>
  )
}

export function SubPestanas({ opciones, valor, onCambio, etiqueta }) {
  return (
    <div className="flex justify-center flex-wrap gap-1" role="tablist" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={valor === o.id}
          onClick={() => onCambio(o.id)}
          className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
            valor === o.id ? 'bg-accent text-white' : 'text-muted hover:bg-[var(--accent-tint)]'
          }`}>
          {o.etiqueta}
        </button>
      ))}
    </div>
  )
}

// ── Lista de Ajustes: renglones tipo «Ajustes» del teléfono ──
export const FILA_AJUSTE = 'w-full flex items-center gap-3 px-3 py-3 rounded-full text-left text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors'

export function GrupoAjustes({ titulo, children }) {
  return (
    <section className="bg-surface-card rounded-card shadow-card p-2">
      {titulo && <h2 className="px-3 pt-2 pb-1 text-xs font-semibold text-muted">{titulo}</h2>}
      <div className="space-y-1">{children}</div>
    </section>
  )
}

export function FilaAjuste({ to, icono: Icono, titulo, detalle }) {
  return (
    <Link to={to} className={FILA_AJUSTE}>
      <Icono size={19} aria-hidden="true" className="text-accent flex-shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{titulo}</span>
        {/* text-sm y no text-xs: en esta app text-xs se agranda para leerse
            (escala del rol) y quedaba MÁS grande que el título. */}
        {detalle && <span className="block text-muted font-normal mt-0.5">{detalle}</span>}
      </span>
      <FlechaAjuste />
    </Link>
  )
}

// Flecha al final del renglón: ›  para abrir algo dentro de la app, ↗ para
// un sitio externo.
export function FlechaAjuste({ externa = false }) {
  const Icono = externa ? ArrowUpRight : ChevronRight
  return <Icono size={18} aria-hidden="true" className="text-hint flex-shrink-0" />
}
