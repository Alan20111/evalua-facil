// Filtro de presentación "Ver solo actividades que se califican" (vista del
// docente). NO define qué es calificable: eso lo decide sinCalificacion() de
// activityVisibility.js. Para el docente un borrador SÍ cuenta (se calificará
// al publicarse); los materiales nunca.
//
// Recibe la lista unificada COMPLETA del parcial (la de buildUnifiedParcial) y
// devuelve las filas a pintar, cada una con `idx`: su posición en la lista
// completa. La zona de soltar que sigue a una fila usa `idx + 1`, de modo que
// el arrastre (que trabaja sobre la lista completa) guarde la posición correcta
// aunque haya filas ocultas entre las visibles.
import { sinCalificacion } from './activityVisibility.js'

export function filasVisiblesParcial(unified, filtrando) {
  return unified
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => !filtrando || (item.type === 'activity' && !sinCalificacion(item.item)))
}
