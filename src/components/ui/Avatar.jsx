// Foto de perfil o inicial, siempre en círculo. Tamaños de la escala de fondos
// de ícono más uno grande para perfiles. PLAN_NORMALIZACION_UI §3.
import { cn } from './cn'

const SIZES = { sm: 'size-8 text-sm', md: 'size-10 text-base', lg: 'size-12 text-lg', xl: 'size-20 text-3xl' }

export default function Avatar({ src, name = '', size = 'md', className = '' }) {
  const inicial = (name || '?').trim().charAt(0).toUpperCase()
  return (
    <span className={cn('inline-flex items-center justify-center flex-shrink-0 rounded-full overflow-hidden bg-accent-light text-accent-hover font-bold', SIZES[size] || SIZES.md, className)}>
      {src ? <img src={src} alt="" className="size-full object-cover" /> : <span aria-hidden="true">{inicial}</span>}
    </span>
  )
}
