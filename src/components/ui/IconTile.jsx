// Fondo de ícono: SIEMPRE círculo (DESIGN_SYSTEM §4.1), en tres tamaños con su
// ícono proporcional (config/iconos.js). `children` reemplaza al ícono (p. ej.
// el logo de YouTube o una inicial).
//
//   size  sm (2rem) · md (2.5rem, filas de lista) · lg (3rem, tarjetas)
//   tone  accent (default) · neutral · danger · success · warning · onColor
import { cn } from './cn'
import { FONDO_ICONO, ICONO_EN_FONDO } from '../../config/iconos'

const TONES = {
  accent: 'bg-accent-light text-accent',
  neutral: 'bg-surface-container text-muted',
  danger: 'bg-red-50 text-red-600',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  onColor: 'bg-white/15 text-white',
}

export default function IconTile({ icon: Icono, size = 'md', tone = 'accent', className = '', style, children, ...rest }) {
  return (
    <span
      aria-hidden={children ? undefined : true}
      className={cn('inline-flex items-center justify-center flex-shrink-0 rounded-full', FONDO_ICONO[size] || FONDO_ICONO.md, TONES[tone] || TONES.accent, className)}
      style={style}
      {...rest}
    >
      {children || (Icono && <Icono size={ICONO_EN_FONDO[size] || ICONO_EN_FONDO.md} />)}
    </span>
  )
}
