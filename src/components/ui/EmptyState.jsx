// Estado vacío o resultado: ícono grande en círculo, título, texto y acción.
// Entra con `aparece`. PLAN_NORMALIZACION_UI §3 (reemplaza los ~19 sueltos).
import { cn } from './cn'
import { ICONO } from '../../config/iconos'

export default function EmptyState({ icon: Icono, title, action, tone = 'accent', className = '', children }) {
  return (
    <div className={cn('flex flex-col items-center text-center gap-3 p-8 animate-aparece motion-reduce:animate-none', className)}>
      {Icono && (
        <span aria-hidden="true" className={cn('size-20 rounded-full flex items-center justify-center', tone === 'neutral' ? 'bg-surface-container text-muted' : 'bg-accent-light text-accent')}>
          <Icono size={ICONO.xl} strokeWidth={1.75} />
        </span>
      )}
      {title && <p className="text-base font-semibold text-on-surface">{title}</p>}
      {children && <div className="text-sm text-muted max-w-sm">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
