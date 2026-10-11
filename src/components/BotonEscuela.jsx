// Campo «Tu escuela» de Registro y Onboarding: abre el SchoolPicker. Antes
// estaba copiado en las dos pantallas. Mide una altura de control, como
// cualquier campo (PLAN_NORMALIZACION_UI §2.1).
import { School } from 'lucide-react'
import { ICONO } from '../config/iconos'

export default function BotonEscuela({ etiqueta, onClick, disabled = false }) {
  return (
    <div>
      <span className="block text-sm font-medium text-muted mb-1">Tu escuela</span>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="w-full flex items-center gap-2 h-control px-4 rounded-full border border-outline-variant bg-surface hover:bg-[var(--accent-tint)] transition-colors text-left disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <School size={ICONO.sm} aria-hidden="true" className="text-accent flex-shrink-0" />
        <span className={`text-sm truncate flex-1 ${etiqueta ? 'text-on-surface font-medium' : 'text-muted'}`}>
          {etiqueta || 'Elige tu escuela'}
        </span>
        <span className="text-xs text-accent font-semibold flex-shrink-0">{etiqueta ? 'Cambiar' : 'Buscar'}</span>
      </button>
    </div>
  )
}
