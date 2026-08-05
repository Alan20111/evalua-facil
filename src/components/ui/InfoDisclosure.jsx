// Texto explicativo que se puede mostrar u ocultar — pedido explícito: varias
// pantallas siempre mostraban su explicación ("qué hace esto"), y eso estorba
// a un docente que ya la leyó antes. El título/etiqueta de la sección sigue
// visible siempre; solo la explicación entra o sale con este botón.
import { useState } from 'react'
import { HelpCircle, ChevronDown, ChevronUp } from 'lucide-react'

export default function InfoDisclosure({ children, label = '¿Qué es esto?', className = '' }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
      >
        <HelpCircle size={13} />
        {label}
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  )
}
