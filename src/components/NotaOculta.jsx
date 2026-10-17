import { EyeOff } from 'lucide-react'
import { ICONO } from '../config/iconos'

// Lo que ve el estudiante cuando el docente ocultó una calificación, un promedio
// o la calificación final. Distinto de «sin calificar» y de «no entregó»: la nota
// EXISTE, solo que su docente aún no la publica.
export const TEXTO_NOTA_OCULTA = 'Tu docente aún no publica esta calificación'

// `compacta`: solo el ojo tachado, para el lugar donde iría el número (una fila
// de lista, un promedio); el texto completo va como etiqueta accesible y como
// ayuda al pasar el cursor. Sin `compacta`: ícono y texto, para una tarjeta.
export default function NotaOculta({ compacta = false, className = '' }) {
  if (compacta) {
    // data-tooltip-pos="left": el ojo va pegado al borde derecho de tarjetas con
    // overflow-hidden (parcial, inicio); el globo centrado arriba se cortaba por
    // arriba y por la derecha. Ver [data-tooltip-pos='left'] en index.css.
    return (
      <span data-tooltip={TEXTO_NOTA_OCULTA} data-tooltip-pos="left" className={`inline-flex items-center text-hint ${className}`}>
        <EyeOff size={ICONO.md} aria-hidden="true" />
        <span className="sr-only">{TEXTO_NOTA_OCULTA}</span>
      </span>
    )
  }
  return (
    <p className={`flex items-center gap-2 text-sm text-muted ${className}`}>
      <EyeOff size={ICONO.sm} className="flex-shrink-0" aria-hidden="true" />
      {TEXTO_NOTA_OCULTA}
    </p>
  )
}
