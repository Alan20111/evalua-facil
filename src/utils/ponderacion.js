// Optional per-activity weighting (PONDERACIÓN) for parcial averages.
//
// Default behaviour (no weighting): every activity in the parcial is worth
// the same — the parcial average is the simple mean of the graded ones.
//
// When the subject has `ponderacionActivada` AND at least one activity of the
// parcial has a positive `pesoCalificacion` (0–10, assigned by the teacher so
// the parcial adds up to 10), the average becomes the weighted mean
// Σ(nota·peso)/Σ(peso) over GRADED activities — ungraded ones don't drag the
// average down, mirroring the simple-mean behaviour.

import { cuentaParaCalificacion } from './activityVisibility.js'

// Per-parcial activation. The subject's `ponderacionParciales` map
// ({ '1': true, '2': false … }) wins when it has an entry for the parcial;
// otherwise the legacy subject-wide `ponderacionActivada` flag applies to all.
export function ponderacionActivaEnParcial(subject, parcial) {
  const map = subject?.ponderacionParciales
  if (map && map[String(parcial)] !== undefined) return !!map[String(parcial)]
  return !!subject?.ponderacionActivada
}

// Normaliza una calificación cruda (sobre `maxCalif`) a una escala base — 10
// por defecto — para que actividades con distinto máximo (un examen sobre
// 100, un cuestionario sobre 20…) puedan promediarse juntas. Antes esta
// misma división vivía copiada en 7 sitios distintos (excel.js x2, pdf.js
// x2, SubjectPage.jsx docente y alumno, Dashboard.jsx alumno), cada uno
// redondeando distinto (o sin redondear). Sin `decimals` regresa el número
// completo, para quien todavía va a promediar/agregar antes de mostrar; con
// `decimals` regresa ya redondeado a esos decimales.
export function normalizeGrade(calificacion, maxCalif, { base = 10, decimals } = {}) {
  if (calificacion == null) return null
  const value = (calificacion / (maxCalif || 10)) * base
  return decimals == null ? value : parseFloat(value.toFixed(decimals))
}

export const pesoDe = (a) => {
  const n = parseFloat(a?.pesoCalificacion)
  return isNaN(n) || n < 0 ? 0 : n
}

export const pesoTotal = (acts) =>
  parseFloat(acts.reduce((s, a) => s + pesoDe(a), 0).toFixed(2))

// acts and grades are parallel arrays; grades holds normalized 0–10 numbers
// or null for ungraded. Returns a number or null.
export function promedioParcial(acts, grades, ponderacionOn) {
  const usePesos = ponderacionOn && acts.some((a) => pesoDe(a) > 0)
  if (usePesos) {
    let sg = 0
    let sw = 0
    acts.forEach((a, i) => {
      const g = grades[i]
      const w = pesoDe(a)
      if (g !== null && g !== undefined && w > 0) {
        sg += g * w
        sw += w
      }
    })
    return sw > 0 ? sg / sw : null
  }
  const valid = grades.filter((g) => g !== null && g !== undefined)
  return valid.length ? valid.reduce((x, y) => x + y, 0) / valid.length : null
}

// ── Estado del parcial y publicación del resultado ponderado ──────────────
//
// Fuente única de verdad. Calcular (promedioParcial, arriba) es una cosa;
// PUBLICAR el resultado al estudiante es otra, y vive solo aquí.
//
// Estados por parcial, derivados de dos mapas de `subjects` ({ '1': ISO }):
//   · cerrado  → parcialesCerrados[p]  (cierre definitivo, flujo de siempre)
//   · atencion → parcialesAtencion[p]  (atención de inquietudes: el docente
//                publicó el resultado; la llave nunca se borra)
//   · abierto  → ninguno de los dos
//
// Un parcial SIN ponderación publica siempre (comportamiento de siempre). Uno
// CON ponderación —activada, aunque los pesos todavía no sumen 10— publica
// solo fuera de "abierto" y con los pesos sumando exactamente 10: no hay
// ningún camino que muestre un resultado con la ponderación incompleta.
//
// `activities` es la lista COMPLETA de actividades de la asignatura (la misma
// que entrega /api/subject/content); aquí se filtra lo que cuenta.

export function estadoParcial(subject, parcial) {
  const p = String(parcial)
  if (subject?.parcialesCerrados?.[p]) return 'cerrado'
  if (subject?.parcialesAtencion?.[p]) return 'atencion'
  return 'abierto'
}

export function actividadesQueCuentan(activities, parcial) {
  return (activities || []).filter((a) => a.parcial === parcial && cuentaParaCalificacion(a))
}

export function pesosSumanDiez(acts) {
  return Math.abs(pesoTotal(acts) - 10) <= 0.001
}

export function resultadoPublicadoAlumno(subject, parcial, activities) {
  if (!ponderacionActivaEnParcial(subject, parcial)) return true
  return estadoParcial(subject, parcial) !== 'abierto' &&
    pesosSumanDiez(actividadesQueCuentan(activities, parcial))
}

export function pesosVisiblesAlumno(subject, parcial, activities) {
  return ponderacionActivaEnParcial(subject, parcial) && resultadoPublicadoAlumno(subject, parcial, activities)
}

export function puedeIniciarAtencion(subject, parcial, activities) {
  if (estadoParcial(subject, parcial) !== 'abierto') return false
  return !ponderacionActivaEnParcial(subject, parcial) ||
    pesosSumanDiez(actividadesQueCuentan(activities, parcial))
}

// Lo que el servidor entrega al estudiante: `pesoCalificacion` se quita de
// toda actividad cuyo parcial no tiene los pesos publicados. Sin pesos, lo
// único que puede sacarse de sus notas es una media simple, nunca la
// ponderada. `activities` = todas las de UNA asignatura.
export function ocultarPesosNoPublicados(subject, activities) {
  const visiblePorParcial = new Map()
  return activities.map((a) => {
    if (!('pesoCalificacion' in a)) return a
    if (!visiblePorParcial.has(a.parcial)) {
      visiblePorParcial.set(a.parcial, pesosVisiblesAlumno(subject, a.parcial, activities))
    }
    if (visiblePorParcial.get(a.parcial)) return a
    const sinPeso = { ...a }
    delete sinPeso.pesoCalificacion
    return sinPeso
  })
}
