// Campo «Tu escuela» de Registro y Onboarding: abre el SchoolPicker. Antes
// estaba copiado en las dos pantallas. Mide una altura de control, como
// cualquier campo (PLAN_NORMALIZACION_UI §2.1).
import { School } from 'lucide-react'
import { ICONO } from '../config/iconos'
import { Button } from './ui'

export default function BotonEscuela({ etiqueta, onClick, disabled = false }) {
  return (
    <div>
      <span className="block text-sm font-medium text-muted mb-1">Tu escuela</span>
      <Button variant="secondary" fullWidth className="h-control text-left"
        onClick={onClick}
        disabled={disabled}>
        <School size={ICONO.sm} aria-hidden="true" className="text-accent flex-shrink-0" />
        <span className={`text-sm truncate flex-1 ${etiqueta ? 'text-on-surface font-medium' : 'text-muted'}`}>
          {etiqueta || 'Elige tu escuela'}
        </span>
        <span className="text-xs text-accent font-semibold flex-shrink-0">{etiqueta ? 'Cambiar' : 'Buscar'}</span>
      </Button>
    </div>
  )
}
