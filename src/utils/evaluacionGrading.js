// Pure scoring logic for Evaluaciones (Cuestionario/Examen). Kept separate from
// any component so the calculation has a single source of truth wherever it's
// needed (student finishing an attempt, teacher viewing read-only results).

/**
 * @param {Array<{id: string, ponderacion: number, respuestaCorrecta: string}>} preguntas
 * @param {Record<string, {opcionSeleccionada: string|null}>} respuestasPorPregunta keyed by pregunta id
 * @param {number} maxCalif scale to normalize to (activity's maxCalif, default 10)
 * @returns {number} calificación rounded to 1 decimal
 */
export function calcularCalificacion(preguntas, respuestasPorPregunta, maxCalif = 10) {
  const totalPonderacion = preguntas.reduce((sum, p) => sum + (p.ponderacion || 0), 0)
  if (totalPonderacion === 0) return 0
  const obtenida = preguntas.reduce((sum, p) => {
    const respuesta = respuestasPorPregunta[p.id]
    const correcta = respuesta?.opcionSeleccionada != null && respuesta.opcionSeleccionada === p.respuestaCorrecta
    return sum + (correcta ? (p.ponderacion || 0) : 0)
  }, 0)
  return Math.round((obtenida / totalPonderacion) * maxCalif * 10) / 10
}

/**
 * Resolves the calificación to keep when a new attempt finishes, given the
 * activity's `conservar` policy ('mejor' | 'ultimo').
 */
export function resolverCalificacionFinal(intentosPrevios, calificacionNueva, conservar) {
  if (conservar !== 'mejor' || intentosPrevios.length === 0) return calificacionNueva
  const mejorPrevia = Math.max(...intentosPrevios.map((i) => i.calificacion))
  return Math.max(mejorPrevia, calificacionNueva)
}

/**
 * Group stats for the teacher view (v1: average, max, min, pass/fail %).
 * `calificaciones` is an array of finished attempts' final scores.
 */
export function calcularEstadisticasGrupo(calificaciones, maxCalif = 10) {
  if (calificaciones.length === 0) {
    return { promedio: 0, maxima: 0, minima: 0, porcentajeAprobados: 0, porcentajeReprobados: 0 }
  }
  const aprobatorio = maxCalif * 0.6
  const aprobados = calificaciones.filter((c) => c >= aprobatorio).length
  const suma = calificaciones.reduce((a, b) => a + b, 0)
  return {
    promedio: Math.round((suma / calificaciones.length) * 10) / 10,
    maxima: Math.max(...calificaciones),
    minima: Math.min(...calificaciones),
    porcentajeAprobados: Math.round((aprobados / calificaciones.length) * 100),
    porcentajeReprobados: Math.round(((calificaciones.length - aprobados) / calificaciones.length) * 100),
  }
}
