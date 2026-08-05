// Lectura de las respuestas de una evaluación (cuestionario/examen), compartida
// por las tres pantallas que las necesitan: las gráficas por reactivo, el PDF de
// resultados y el Excel de resultados. Vive fuera de los componentes porque cada
// uno la pedía por su cuenta y el conteo por opción tiene que dar EXACTAMENTE lo
// mismo en los tres (una gráfica que no cuadre con su propio PDF es peor que no
// tener el PDF).
//
// Las respuestas viven en una subcolección por entrega —
// `submissions/{id}/respuestas/{preguntaId}`— así que hay una lectura por
// estudiante. Se hacen en paralelo (Promise.all) y solo cuando el docente pide
// gráficas o una exportación, nunca al abrir la pestaña de resultados.
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'

// Paleta categórica validada (skill dataviz, references/palette.md) — orden de
// slot fijo, nunca se reasigna ni se cicla. La comparten la gráfica de pastel
// en pantalla y la del PDF: el mismo reactivo debe salir del mismo color en
// los dos lados.
export const SLICE_COLORS = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834']

// Opción múltiple Y verdadero/falso: las dos tienen respuesta cerrada (mismo
// campo `opciones` + `opcionSeleccionada`, ver EvaluacionRunner.jsx), así que
// las dos se pueden contar por opción. Respuesta corta y subir documento no —
// no hay opciones que contar.
export const esGraficable = (p) => p?.tipo === 'opcion_multiple' || p?.tipo === 'verdadero_falso'

/**
 * Lee las respuestas de todas las entregas de una evaluación.
 *
 * @param {Record<string, {id: string}>} submissions entregas por alumnoId (tal
 *        como las guarda EvaluacionManager)
 * @param {Array} preguntas reactivos de la evaluación
 * @returns {Promise<{porAlumno: Record<string, Record<string, object>>, counts: Record<string, Record<string, number>>}>}
 *   `porAlumno[alumnoId][preguntaId]` = la respuesta cruda (para el Excel por
 *   estudiante); `counts[preguntaId][opcionId]` = cuántos la eligieron (para
 *   las gráficas y las tablas de porcentajes).
 */
export async function cargarRespuestasEvaluacion(submissions, preguntas) {
  const graficables = (preguntas || []).filter(esGraficable)
  const idsGraficables = new Set(graficables.map((p) => p.id))
  const counts = {}
  graficables.forEach((p) => { counts[p.id] = {} })
  const porAlumno = {}

  const entregas = Object.entries(submissions || {}).filter(([, s]) => s?.id)
  await Promise.all(entregas.map(async ([alumnoId, sub]) => {
    const snap = await getDocs(collection(db, 'submissions', sub.id, 'respuestas'))
    const respuestas = {}
    snap.docs.forEach((d) => {
      const data = d.data()
      respuestas[d.id] = data
      if (!idsGraficables.has(d.id)) return
      const opcionId = data.opcionSeleccionada
      if (!opcionId) return
      counts[d.id][opcionId] = (counts[d.id][opcionId] || 0) + 1
    })
    porAlumno[alumnoId] = respuestas
  }))

  return { porAlumno, counts }
}

// Cuántos contestaron ESTE reactivo — no siempre son todos los inscritos ni
// todos los que entregaron: alguien pudo dejarlo en blanco.
export function totalRespuestas(preguntaCounts) {
  return Object.values(preguntaCounts || {}).reduce((sum, n) => sum + n, 0)
}

// Filas de la tabla de un reactivo (mismo dato en pantalla, en el PDF y en el
// Excel): opción, si es la correcta, cuántos la eligieron y su porcentaje.
export function filasDeReactivo(pregunta, preguntaCounts) {
  const total = totalRespuestas(preguntaCounts)
  return (pregunta.opciones || []).map((o, idx) => {
    const count = preguntaCounts?.[o.id] || 0
    return {
      id: o.id,
      texto: o.texto || '',
      color: SLICE_COLORS[idx % SLICE_COLORS.length],
      count,
      pct: total ? Math.round((count / total) * 100) : 0,
      correcta: pregunta.respuestaCorrecta != null && o.id === pregunta.respuestaCorrecta,
    }
  })
}

// Texto de la respuesta de UN estudiante a UN reactivo, ya legible para una
// celda de Excel. Cubre los cuatro tipos: opción múltiple y verdadero/falso
// devuelven el texto de la opción elegida (o lo que escribió en la opción
// "Otra"), respuesta corta su texto tal cual, y subir documento el nombre del
// archivo entregado.
export function textoRespuestaAlumno(pregunta, respuesta) {
  if (!respuesta) return ''
  if (esGraficable(pregunta)) {
    const opcion = (pregunta.opciones || []).find((o) => o.id === respuesta.opcionSeleccionada)
    if (!opcion) return ''
    return opcion.esOtra ? (respuesta.otraTexto || 'Otra (sin texto)') : (opcion.texto || '')
  }
  if (pregunta.tipo === 'subir_archivo') return respuesta.nombreArchivo || (respuesta.archivoURL ? 'Documento entregado' : '')
  return respuesta.textoRespuesta || ''
}

// Aciertos de un estudiante entre los reactivos objetivos (los únicos que se
// califican solos). Devuelve null si la evaluación no tiene ninguno, para no
// mostrar un "0 de 0" que no significa nada.
export function aciertosDeAlumno(preguntas, respuestas) {
  const objetivas = (preguntas || []).filter(esGraficable)
  if (!objetivas.length) return null
  const correctas = objetivas.filter((p) => {
    const r = respuestas?.[p.id]
    return r?.opcionSeleccionada != null && r.opcionSeleccionada === p.respuestaCorrecta
  }).length
  return { correctas, total: objetivas.length }
}
