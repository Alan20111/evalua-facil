// «¿Qué es esto?» que despliega una explicación. Usa Disclosure, así abre y
// cierra animado como todo lo demás (antes aparecía de golpe).
import { HelpCircle } from 'lucide-react'
import Disclosure from './Disclosure'
import { ICONO } from '../../config/iconos'

export default function InfoDisclosure({ children, label = '¿Qué es esto?', className = '' }) {
  return (
    <Disclosure
      className={className}
      inline
      buttonClassName="text-xs font-medium text-accent hover:underline [&>svg]:text-accent"
      panelClassName="pt-1"
      summary={<span className="inline-flex items-center gap-1"><HelpCircle size={ICONO.xs} aria-hidden="true" />{label}</span>}
    >
      {children}
    </Disclosure>
  )
}
