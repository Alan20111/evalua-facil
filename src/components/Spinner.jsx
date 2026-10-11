// Indicador de carga circular. `current`: toma el color del texto (dentro de
// botones de color, donde el acento no se vería).
export default function Spinner({ size = 'md', current = false, className = '' }) {
  const s = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-10 w-10' : 'h-6 w-6'
  return (
    <div aria-hidden="true" className={`${s} animate-spin rounded-full border-2 ${current ? 'border-current' : 'border-accent'} border-t-transparent ${className}`} />
  )
}
