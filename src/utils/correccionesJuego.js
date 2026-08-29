// Utilidades de corrección para Crucigrama y Sopa de letras.
// Compartidas entre ResolucionJuegoModal (docente) y SolucionJuegoModal (alumno).
// Espejo mínimo de las Cloud Functions en functions/index.js — solo pinta
// la cuadrícula, nunca produce valores que se guarden en Firestore.

import { normalizarPalabra } from './normalizarPalabra.js'

/**
 * Devuelve un mapa { "r-c": true|false } indicando si cada celda del crucigrama
 * tiene la letra correcta según la estructura original del juego.
 *
 * Algoritmo idéntico a calificarCrucigrama en functions/index.js.
 */
export function correccionesCrucigrama(estructura, celdasAlumno) {
  const mapa = {}
  for (let r = 0; r < estructura.size; r++) {
    for (let c = 0; c < estructura.size; c++) {
      const letraCorrecta = estructura.grid?.[r]?.row?.[c]
      if (!letraCorrecta) continue
      const respuesta = normalizarPalabra(celdasAlumno[`${r}-${c}`] || '')
      mapa[`${r}-${c}`] = !!respuesta && respuesta === letraCorrecta
    }
  }
  return mapa
}
