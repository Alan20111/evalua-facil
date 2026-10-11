// Microanimaciones de ícono (docs/PLAN_NORMALIZACION_UI.md §6.2). Envuelve un
// ícono y le da vida SOLO al interactuar o cuando ocurre algo:
//
//   cuando="hover"   al pasar/enfocar el control padre (que lleva `group`;
//                    Button, IconButton, ListRow y Chip ya lo llevan)
//   cuando="activo"  mientras `activo` sea true (IA generando, sincronizando)
//   cuando="una"     una vez cada que cambia `disparador` (llegó un aviso,
//                    se envió, se copió)
//
// Efectos: gira90 (＋ crear) · sacude (campana) · gira (actualizar) ·
// empujaArriba / empujaAbajo (subir/descargar) · destello (IA) · balanceo
// (eliminar) · parpadeo (ver contraseña) · despega (enviar) · pop (éxito) ·
// late (punto de «Hoy»). Con movimiento reducido no se mueve nada.
import { cn } from './cn'
import { clasesEfecto } from './efectos'

export default function Animado({ efecto, cuando = 'hover', activo = false, disparador, className = '', children }) {
  const clase = cuando === 'activo' ? (activo ? clasesEfecto(efecto, 'activo') : '') : clasesEfecto(efecto, cuando)
  return (
    <span
      // Cambiar la key vuelve a montar el span y repite la animación «una».
      key={cuando === 'una' ? String(disparador) : undefined}
      aria-hidden="true"
      className={cn('inline-flex flex-shrink-0 motion-reduce:!animate-none motion-reduce:!transform-none', clase, className)}
    >
      {children}
    </span>
  )
}
