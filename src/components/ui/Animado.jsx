// Microanimaciones de ícono (docs/PLAN_NORMALIZACION_UI.md §6.2). Envuelve un
// ícono y le da vida SOLO al interactuar o cuando ocurre algo:
//
//   cuando="hover"   al pasar/enfocar el control padre (que lleva `group`;
//                    Button, IconButton, ListRow y Chip ya lo llevan)
//   cuando="activo"  mientras `activo` sea true (IA generando, sincronizando)
//   cuando="una"     una vez cada que cambia `disparador` (llegó un aviso,
//                    se envió, se copió)
//   reposo           (solo `varita`) destello periódico en reposo (varita + 3 estrellas),
//                    mientras la función esté disponible; `quieto` lo apaga
//                    junto con todo el efecto (botón deshabilitado)
//
// Efectos: gira90 (＋ crear) · sacude (campana) · gira (actualizar) ·
// empujaArriba / empujaAbajo (subir/descargar) · destello (IA) · varita (IA: pulso en reposo, inclinación y
// estrellas al pasar o enfocar, giro mientras trabaja) · balanceo
// (eliminar) · parpadeo (ver contraseña) · despega (enviar) · pop (éxito) ·
// late (punto de «Hoy»). Con movimiento reducido no se mueve nada.
import { useId } from 'react'
import { cn } from './cn'
import { clasesEfecto } from './efectos'

// Tres estrellitas de la varita: salen al pasar el cursor o enfocar el control
// padre (que lleva `group`). Son absolutas: no cambian el tamaño del botón.
const ESTRELLAS = [
  'size-1.5 -top-1 -right-1 delay-0',
  'size-1 -top-1.5 left-0 delay-75',
  'size-1 -bottom-1 -right-1.5 delay-150',
]
const ESTRELLA_BASE = 'pointer-events-none absolute opacity-0 scale-50 transition duration-rapida motion-reduce:hidden group-hover:opacity-100 group-hover:scale-100 group-focus-visible:opacity-100 group-focus-visible:scale-100'

// Fase del pulso en reposo, distinta por instancia (derivada del id, sin azar
// en el render) para que botones cercanos no destellen sincronizados.
const faseDe = (id) => -(([...id].reduce((a, ch) => a + ch.charCodeAt(0) * 7, 0) % 70) / 10)

// Con `reposo`, las estrellas salen en el pulso (mismo ciclo y fase que la
// varita, que les llega por la variable CSS). Al pasar o enfocar se apaga esa
// animación y mandan las reglas de hover/foco de ESTRELLA_BASE.
const ESTRELLA_REPOSO = 'animate-estrellas-reposo group-hover:animate-none group-focus-visible:animate-none'

export default function Animado({ efecto, cuando = 'hover', activo = false, reposo = false, quieto = false, disparador, className = '', children }) {
  const id = useId()
  const esVarita = efecto === 'varita'
  let clase = ''
  if (!quieto) {
    clase = cuando === 'activo'
      ? (activo ? clasesEfecto(efecto, 'activo') : '')
      : cn(clasesEfecto(efecto, cuando), reposo && clasesEfecto(efecto, 'reposo'))
  }
  const conEstrellas = esVarita && cuando === 'hover' && !quieto
  return (
    <span
      // Cambiar la key vuelve a montar el span y repite la animación «una».
      key={cuando === 'una' ? String(disparador) : undefined}
      aria-hidden="true"
      className={cn('inline-flex flex-shrink-0 motion-reduce:!animate-none motion-reduce:!transform-none', conEstrellas && 'relative', clase, className)}
      style={reposo && !quieto && esVarita ? { '--varita-fase': `${faseDe(id)}s` } : undefined}
    >
      {children}
      {conEstrellas && ESTRELLAS.map((e) => (
        <svg key={e} viewBox="0 0 24 24" fill="currentColor" className={cn(ESTRELLA_BASE, reposo && ESTRELLA_REPOSO, e)}>
          <path d="M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6z" />
        </svg>
      ))}
    </span>
  )
}
