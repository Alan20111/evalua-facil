// Tarjeta que se despliega (información secundaria del tablero: «Evalúa Fácil
// en tu celular», etc.). Card + Disclosure: abre y cierra animada, con el
// ícono en su círculo estándar. Antes cada tablero la copiaba a mano.
import { cn } from './cn'
import Card from './Card'
import Disclosure from './Disclosure'
import IconTile from './IconTile'

export default function DisclosureCard({ icon, leading, title, defaultOpen = false, className = '', children }) {
  return (
    <Card padding="none" className={cn('overflow-hidden', className)}>
      <Disclosure
        defaultOpen={defaultOpen}
        buttonClassName="p-1.5 pr-4 rounded-card hover:bg-[var(--accent-tint)] transition-colors"
        panelClassName="px-4 pb-4 space-y-1.5 text-sm text-muted"
        summary={(
          <span className="flex items-center gap-3">
            {leading || <IconTile icon={icon} />}
            <span className="font-semibold text-on-surface">{title}</span>
          </span>
        )}
      >
        {children}
      </Disclosure>
    </Card>
  )
}
