// Lo que el SERVIDOR entrega al estudiante de sus entregas, respuestas y
// promedios, respetando lo que el docente ocultó (visibilidadCalificaciones.js).
//
// Módulo PURO (sin Firebase): lo usa api/student/[action].js (acción
// `mis-entregas`) y lo prueba test/unidad.test.mjs.
//
// REGLA DE FONDO: aquí se QUITAN campos, nunca documentos. Que exista la
// entrega del estudiante cambia el resultado de las fórmulas (ceroPorFaltaDeEntrega
// devuelve false si hay cualquier documento), así que una nota oculta sigue
// siendo una entrega que existe, solo que sin nada que delate la nota.
//
// LISTA BLANCA, no lista negra: con la nota oculta solo sale lo que un flujo
// real del estudiante necesita (entrega, autosave, intentos, reanudar un examen,
// juego, anular). Un campo nuevo que alguien agregue mañana al documento NO
// viaja hasta que se agregue aquí a propósito. Contrastada contra los
// documentos reales de producción (oct-2026).

import { actividadOculta, promedioOculto, finalOculto } from './visibilidadCalificaciones.js'
import {
  cuentaEnPromedioDelAlumno, notasParaPromedio, promedioParcial, ponderacionActivaEnParcial,
  normalizeGrade, resultadoPublicadoAlumno, pesosVisiblesAlumno,
} from './ponderacion.js'

// ── Entregas (submissions/{id}) ───────────────────────────────────────────

// Con la nota OCULTA solo sale esto (más `id`, `estado` normalizado, `intentos`
// reducido y las banderas `calificada` / `notaOculta`).
export const CAMPOS_ENTREGA_OCULTA = [
  'actividadId', 'alumnoId', 'alumnoUid',
  'estadoEvaluacion', 'intentoActual', 'tiempoInicio', 'ordenSeed', 'tiempoSegundos', // examen, reintento, reanudar
  'fechaEntrega', 'tarde', 'sinEntrega', 'completadoSinArchivo',                       // entrega y su estado
  'archivos', 'archivoURL', 'nombreArchivo', 'enlaceURL',                              // lo que entregó y puede anular
  'respuestasJuego',                                                                   // progreso del juego
  'historial',                                                                         // bitácora (sin notas)
]

// Lo que se QUITA, para dejarlo escrito (la prueba exige que nada de esto salga
// con la nota oculta): calificacion, rubricaEval, comentario,
// comentarioVisibleAlumno, pendienteRevision, notificadoCalificacion,
// motivoSinEntrega, cierreParcial, notificadoEntregaDocente,
// intentos[].calificacion y cualquier campo que no esté en la lista de arriba.

const esNumero = (n) => typeof n === 'number' && Number.isFinite(n)

/**
 * @param {object} sub          el documento tal cual, con `id`
 * @param {{notaOculta?: boolean}} opciones
 * @returns {object} la entrega proyectada. Visible → íntegra (+ banderas).
 *   Oculta → solo la lista blanca.
 */
export function proyectarEntrega(sub, { notaOculta = false } = {}) {
  // «Calificada» ya no se deduce en las pantallas de `calificacion != null`
  // (eso es justo lo que se esconde): llega como bandera.
  const calificada = sub.calificacion != null || sub.estado === 'calificado'
  if (!notaOculta) return { ...sub, calificada, notaOculta: false }

  const salida = { id: sub.id }
  for (const campo of CAMPOS_ENTREGA_OCULTA) {
    if (sub[campo] !== undefined) salida[campo] = sub[campo]
  }
  // Los intentos hacen falta (cuántos lleva, cuál es el siguiente), su nota no.
  if (Array.isArray(sub.intentos)) {
    salida.intentos = sub.intentos.map((i) => ({
      numero: esNumero(i?.numero) ? i.numero : null,
      tiempoSegundos: esNumero(i?.tiempoSegundos) ? i.tiempoSegundos : null,
    }))
  }
  // 'calificado' delata que hay nota; el resto de los estados no.
  if (sub.estado !== undefined) salida.estado = sub.estado === 'calificado' ? 'entregado' : sub.estado
  salida.calificada = calificada
  salida.notaOculta = true
  return salida
}

// ── Respuestas (submissions/{id}/respuestas/{preguntaId}) ─────────────────

// Lo que el estudiante ESCRIBE (autosave) y necesita para reanudar. `respondidaEn`
// sirve para reconocer lo rezagado de un intento anterior.
export const CAMPOS_RESPUESTA_ALUMNO = [
  'opcionSeleccionada', 'textoRespuesta', 'otraTexto', 'respondidaEn',
  'archivoURL', 'nombreArchivo', 'tamanoArchivo',
]
// Lo que escribe el SERVIDOR o el docente al calificar. Con la nota a la vista y
// las respuestas publicadas viaja; si no, quien lo viera podría calcular su nota.
export const CAMPOS_RESPUESTA_CLAVES = ['correcta', 'respuestaCorrecta', 'puntosObtenidos', 'comentarioDocente']

/**
 * @param {object} resp  documento de respuesta, con `id`
 * @param {{claves?: boolean}} opciones  `claves` = las respuestas están
 *   publicadas Y la nota no está oculta
 */
export function proyectarRespuesta(resp, { claves = false } = {}) {
  const salida = { id: resp.id }
  const campos = claves ? [...CAMPOS_RESPUESTA_ALUMNO, ...CAMPOS_RESPUESTA_CLAVES] : CAMPOS_RESPUESTA_ALUMNO
  for (const campo of campos) {
    if (resp[campo] !== undefined) salida[campo] = resp[campo]
  }
  return salida
}

// ── Promedios ─────────────────────────────────────────────────────────────

/**
 * Promedio de cada parcial y final de UN estudiante en UNA asignatura, con las
 * MISMAS funciones y el mismo orden de pasos que usa el Dashboard del alumno
 * (que a su vez coincide con la tabla del docente): ninguna fórmula nueva.
 * Se calcula con las notas REALES —también las ocultas— y solo al final se
 * enmascara lo que el docente ocultó. Es lo que permite mostrar un promedio
 * correcto aunque el estudiante ya no tenga la nota de alguna actividad.
 *
 * @param {object} subject      asignatura (parcialesOcultos, ponderacion*, parcialesCerrados…)
 * @param {object[]} activities TODAS las actividades de la asignatura, con `id`
 * @param {object} subPorActividad  { [actividadId]: entrega (cruda) } de este estudiante
 * @param {{id: string, createdAt?: any}} inscripcion  su documento de `students`
 * @param {number} [ahora]      reloj inyectado (pruebas)
 * @returns {{
 *   parciales: Object<string, {valor: number|null, publicado: boolean, oculto: boolean, conOcultas: boolean, soloServidor: boolean}>,
 *   final: {valor: number|null, pendiente: boolean, oculto: boolean, conOcultas: boolean, soloServidor: boolean}
 * }}
 */
export function promediosAlumno(subject, activities, subPorActividad, inscripcion, ahora = Date.now()) {
  const todas = activities || []
  const numParciales = subject?.parciales || 3
  const parciales = {}
  const valores = []
  let avgPendiente = false
  let finalConOcultas = false
  let finalSoloServidor = false

  for (let p = 1; p <= numParciales; p++) {
    const pacts = todas.filter((a) => a.parcial === p && cuentaEnPromedioDelAlumno(a, subPorActividad[a.id], subject))
    const conOcultas = pacts.some((a) => actividadOculta(subject, a.id))
    if (conOcultas) finalConOcultas = true
    const oculto = promedioOculto(subject, p)
    const grades = pacts.map((a) => normalizeGrade(subPorActividad[a.id]?.calificacion, a.maxCalif, { decimals: 1 }))

    const publicado = resultadoPublicadoAlumno(subject, p, todas)
    let valor = null
    if (!publicado) {
      // Un parcial ponderado sin publicar no entra en ningún cálculo; si ya tiene
      // notas, el promedio completo queda pendiente (mismo criterio del Dashboard).
      if (grades.some((g) => g != null)) avgPendiente = true
    } else {
      const paraPromedio = notasParaPromedio(
        pacts, grades, pacts.map((a) => subPorActividad[a.id]), { subject, alumno: inscripcion, ahora },
      )
      const raw = promedioParcial(pacts, paraPromedio, ponderacionActivaEnParcial(subject, p))
      valor = raw !== null ? parseFloat(raw.toFixed(1)) : null
      if (valor !== null) valores.push(valor)
    }
    // Parcial ponderado cuya calificación se muestra pero cuyos pesos NO: el
    // cliente no recibe los pesos (ocultarPesosNoPublicados), así que solo el
    // número del servidor es el real; calcularlo en la pantalla daría una media simple.
    const soloServidor = publicado && ponderacionActivaEnParcial(subject, p) && !pesosVisiblesAlumno(subject, p, todas)
    if (soloServidor) finalSoloServidor = true
    parciales[p] = { valor: oculto ? null : valor, publicado, oculto, conOcultas, soloServidor }
  }

  const finalValor = !avgPendiente && valores.length
    ? parseFloat((valores.reduce((x, y) => x + y, 0) / valores.length).toFixed(1))
    : null
  const finalEstaOculto = finalOculto(subject)
  return {
    parciales,
    final: { valor: finalEstaOculto ? null : finalValor, pendiente: avgPendiente, oculto: finalEstaOculto, conOcultas: finalConOcultas, soloServidor: finalSoloServidor },
  }
}

// ── JSON ──────────────────────────────────────────────────────────────────

// Los Timestamps del Admin SDK no sobreviven JSON.stringify con la forma que
// espera el cliente: se pasan a { seconds, nanoseconds } (el mismo formato que
// /api/subject/content, que el cliente rehidrata con rehydrateTimestamps).
export function paraJSON(v) {
  if (v === null || v === undefined) return v
  if (typeof v.toDate === 'function') return { seconds: v._seconds ?? v.seconds, nanoseconds: v._nanoseconds ?? v.nanoseconds }
  if (Array.isArray(v)) return v.map(paraJSON)
  if (typeof v === 'object') {
    const salida = {}
    for (const k of Object.keys(v)) salida[k] = paraJSON(v[k])
    return salida
  }
  return v
}
