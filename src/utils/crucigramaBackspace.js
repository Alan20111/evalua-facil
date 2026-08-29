// Lógica pura de Backspace para el Crucigrama. Sin dependencias de React/DOM.
// Exportado para tests de unidad en test/unidad.test.mjs.
//
// Por qué existe este módulo separado:
//   Los teclados virtuales de Android (Gboard, etc.) NO disparan keydown con
//   key='Backspace'. En su lugar disparan beforeinput con
//   inputType='deleteContentBackward'. Este módulo centraliza la decisión de
//   qué borrar y a dónde mover el foco, de modo que tanto el manejador de
//   keydown (teclado físico/desktop) como el de beforeinput (Android virtual)
//   usen exactamente el mismo algoritmo.

/**
 * calcAnterior — celda previa en la palabra activa desde (r, c).
 * Devuelve null si estamos al inicio de la palabra o no hay palabra activa.
 */
function calcAnterior(r, c, palabraActiva) {
  if (!palabraActiva) return null
  const p = palabraActiva
  const i = p.horizontal ? c - p.col : r - p.fila
  if (i <= 0) return null
  return p.horizontal ? { r, c: c - 1 } : { r: r - 1, c }
}

/**
 * resolverBackspace — determina qué celda borrar y a dónde mover el foco
 * cuando se presiona Backspace sobre la celda (r, c).
 *
 * Reglas (especificación del PO):
 *   1. Celda con letra:  borra ESTA celda → mueve foco a la anterior.
 *   2. Celda vacía:      mueve foco a la anterior → si tiene letra, la borra.
 *   3. Inicio de palabra: no hay anterior → no hace nada (no navega fuera).
 *
 * Parámetros:
 *   r, c          — posición de la celda actualmente enfocada
 *   celdas        — mapa { 'r-c': letra } con el estado actual del tablero
 *   palabraActiva — objeto palabra { horizontal, fila, col, longitud, ... }
 *
 * Retorna: { borrar: {r,c}|null, foco: {r,c}|null }
 *   borrar — celda a limpiar (null = no borrar nada)
 *   foco   — celda a la que mover el foco (null = quedarse aquí)
 */
export function resolverBackspace(r, c, celdas, palabraActiva) {
  const prev = calcAnterior(r, c, palabraActiva)

  // Inicio de palabra (sin celda anterior): no hace nada.
  // Evita que el teclado virtual de Android dispare la navegación nativa
  // "atrás" cuando no hay adónde retroceder dentro del crucigrama.
  if (!prev) return { borrar: null, foco: null }

  const tieneletra = !!celdas[`${r}-${c}`]

  if (tieneletra) {
    // Celda con letra: borra la actual y mueve foco a la anterior.
    return { borrar: { r, c }, foco: prev }
  }

  // Celda vacía: mueve foco a la anterior y, si tiene letra, la borra.
  if (celdas[`${prev.r}-${prev.c}`]) {
    return { borrar: prev, foco: prev }
  }

  return { borrar: null, foco: prev }
}
