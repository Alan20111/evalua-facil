// Pure scoring logic for Evaluaciones (Cuestionario/Examen). Kept separate from
// any component so the calculation has a single source of truth wherever it's
// needed (student finishing an attempt, teacher reviewing open questions).
//
// Architecture note for a future Premium/AI tier: `preguntas` and
// `bancoReactivos` are already independent documents with an open `tipo`
// enum, so generation/analysis metadata (e.g. `generadoPor`, difficulty
// stats) can be added later without migrating existing data or touching
// this scoring logic.

const TIPOS_OBJETIVOS = ['opcion_multiple', 'verdadero_falso']

/**
 * Resolves the points earned for a single pregunta given the student's
 * respuesta. Objective types (opción múltiple, verdadero/falso) are scored
 * by comparing the selected option to `respuestaCorrecta`. `respuesta_corta`
 * is never auto-scored — it returns `null` (pending teacher review).
 */
export function calcularPuntosPregunta(pregunta, respuesta) {
  if (!TIPOS_OBJETIVOS.includes(pregunta.tipo)) return null
  const correcta = respuesta?.opcionSeleccionada != null && respuesta.opcionSeleccionada === pregunta.respuestaCorrecta
  return correcta ? (pregunta.ponderacion || 0) : 0
}

/**
 * @param {Array<{id: string, ponderacion: number}>} preguntas
 * @param {Record<string, {puntosObtenidos: number|null}>} respuestasPorPregunta keyed by pregunta id
 * @param {number} maxCalif scale to normalize to (activity's maxCalif, default 10)
 * @returns {number} calificación rounded to 1 decimal — pending (null) points count as 0 for now
 */
export function calcularCalificacion(preguntas, respuestasPorPregunta, maxCalif = 10) {
  const totalPonderacion = preguntas.reduce((sum, p) => sum + (p.ponderacion || 0), 0)
  if (totalPonderacion === 0) return 0
  const obtenida = preguntas.reduce((sum, p) => sum + (respuestasPorPregunta[p.id]?.puntosObtenidos ?? 0), 0)
  return Math.round((obtenida / totalPonderacion) * maxCalif * 10) / 10
}

/**
 * True if any `respuesta_corta` pregunta in this attempt is still missing a
 * manually-assigned score — drives the "Finalizado" vs "Calificado" status
 * and the pending-review badge in the teacher view.
 */
export function resolverPendienteRevision(preguntas, respuestasPorPregunta) {
  return preguntas.some((p) => p.tipo === 'respuesta_corta' && (respuestasPorPregunta[p.id]?.puntosObtenidos ?? null) == null)
}

/**
 * Resolves the calificación to keep when a new attempt finishes, given the
 * activity's `conservar` policy ('primero' | 'ultimo' | 'mejor' | 'promedio').
 */
export function resolverCalificacionFinal(intentosPrevios, calificacionNueva, conservar) {
  if (intentosPrevios.length === 0) return calificacionNueva
  const previas = intentosPrevios.map((i) => i.calificacion)
  switch (conservar) {
    case 'primero':
      return previas[0]
    case 'promedio':
      return Math.round((([...previas, calificacionNueva].reduce((a, b) => a + b, 0)) / (previas.length + 1)) * 10) / 10
    case 'mejor':
      return Math.max(...previas, calificacionNueva)
    case 'ultimo':
    default:
      return calificacionNueva
  }
}

/**
 * Group stats for the teacher view (average, max, min, pass/fail %).
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
