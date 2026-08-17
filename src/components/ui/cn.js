// Une clases condicionales y resuelve conflictos de Tailwind de verdad.
// La versión casera anterior (join de strings) asumía que "la clase que
// aparece después en el string gana en el navegador" — falso para
// Tailwind: el CSS final ordena las utilidades por su propio criterio
// interno, no por el orden en que aparecen en el atributo className. Sin
// tailwind-merge, un consumidor que pasa className="p-4" a un <Button>
// cuya variante ya trae "p-2" puede terminar viendo CUALQUIERA de los dos
// según cómo Tailwind haya generado el CSS ese build, no el que "se ve
// después" en el string — bug real, no teórico, en cuanto los consumidores
// de ui/ empiecen a pasar className (docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md
// Fase 3, paso 3.1).
//
// extendTailwindMerge: 'rounded-card' y 'rounded-pill' (tailwind.config.js)
// son sufijos de borderRadius que Tailwind Merge no reconoce por defecto —
// sin esto, className="rounded-pill" en un consumidor NO le ganaría al
// "rounded" de la variante base (ambos quedarían aplicados a la vez).
import { clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      rounded: ['rounded-card', 'rounded-pill'],
    },
  },
})

export function cn(...parts) {
  return twMerge(clsx(parts))
}
