// Barra de progreso (subidas, generación con IA, cuotas). `value` de 0 a 1;
// sin `value` es indeterminada (una franja que recorre la barra).
// PLAN_NORMALIZACION_UI §3.
import { cn } from './cn'

export default function Progress({ value, label = 'Progreso', className = '' }) {
  const indeterminada = value == null
  const pct = indeterminada ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100)
  // El <progress> nativo (oculto) es el que leen los lectores de pantalla;
  // la barra visible es decorativa (el nativo no se puede estilizar igual en
  // todos los navegadores).
  return (
    <div className={cn('relative h-2 w-full overflow-hidden rounded-full bg-surface-container', className)}>
      <progress className="sr-only" aria-label={label} max={100} value={pct} />
      {indeterminada
        ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-accent animate-progreso motion-reduce:animate-none" />
        : <span aria-hidden="true" className="block h-full rounded-full bg-accent transition-[width] duration-estandar ease-firma" style={{ width: `${pct}%` }} />}
    </div>
  )
}
