// ─── Estado y resumen de asistencia — lógica pura, sin Firebase ──────────────
//
// Una sola implementación para las cuatro partes que cuentan asistencia:
// la tabla del docente (countPresence/attendanceState en ./attendance.js),
// el Excel (./excel.js), la Cloud Function que escribe
// attendanceSummaries/{studentId} y seeds-db/backfill-attendance-summaries.js.
// Antes cada una tenía su copia y se desfasaron: la función contaba sesiones
// futuras y el backfill no (sep-2026). Se copia a functions/_shared/ con
// scripts/sync-functions-shared.mjs.

import { parcialForDate } from './parciales.js'

// Estado de un alumno en una sesión (columna de asistencia):
//   'presente'    presentes[id] === true
//   'justificada' justificadas[id] === true
//   'falta'       presentes[id] === false
//   null          sin estado registrado. Dos formas en los datos:
//                   · sin llave — la sesión NO le corresponde (es anterior
//                     al día de su alta, o del mismo día).
//                   · presentes[id] === null — le corresponde (posterior al
//                     día de su alta) pero el docente aún no la registra.
//                 Ninguna de las dos es falta ni asistencia: no se cuentan en
//                 ningún lado. Solo un toque del docente les da estado real.
export function estadoAsistencia(record, studentId) {
  if (record.presentes?.[studentId] === true) return 'presente'
  if (record.justificadas?.[studentId]) return 'justificada'
  if (record.presentes?.[studentId] === false) return 'falta'
  return null
}

// ¿La columna trae la llave del alumno? Distingue "no le corresponde" (sin
// llave) de "le corresponde, sin registro" (llave en null) — estadoAsistencia
// devuelve null para ambas a propósito, para que ningún conteo cambie.
export function tieneLlave(record, studentId) {
  return Object.prototype.hasOwnProperty.call(record?.presentes || {}, studentId)
}

// Le corresponde pero nadie la ha registrado: llave presente con valor null.
export function sinRegistroExplicito(record, studentId) {
  return tieneLlave(record, studentId) && record.presentes[studentId] === null
}

// Regla del alta (30-sep-2026): una sesión le corresponde al alumno solo si su
// fecha es POSTERIOR al día de su alta en hora de México. La del mismo día y
// las anteriores se quedan sin llave; si el alumno sí estuvo, el docente la
// registra a mano. Solo entonces se marca "sin registro" (null) — nunca
// presente ni falta — y solo si la llave no existe todavía.
export function correspondeSinRegistroPorAlta(record, studentId, altaISO) {
  return !!altaISO && record?.fecha > altaISO && !tieneLlave(record, studentId)
}

// 'YYYY-MM-DD' de hoy en la Ciudad de México. El servidor corre en UTC: sin
// esto, desde las 18:00 de México ya contaría las sesiones de mañana.
export function fechaHoyMexico(fecha = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(fecha)
}

// Resumen de un alumno sobre TODAS las columnas de su asignatura — la forma
// exacta de attendanceSummaries/{studentId} (sin asignaturaId/updatedAt).
// Regla del backfill: sesiones con fecha > hoyISO no se cuentan. Parcial
// derivado de las fechas actuales; si la sesión cae fuera de todos los rangos
// se conserva el guardado y, en registros muy viejos, Parcial 1.
//
// `sinRegistro` va APARTE de `registros` a propósito: las versiones de la app
// ya instaladas cuentan todo lo que venga en `registros` (un estado que no
// conocen lo sumarían como asistencia y lo pintarían como Presente). Un campo
// nuevo lo ignoran. No toca porParcial, total ni registros.
export function resumenAsistencia(records, studentId, parcialesFechas, hoyISO) {
  const sesiones = records
    .filter((r) => r.fecha <= hoyISO)
    .map((r) => {
      const parcialActual = parcialForDate(parcialesFechas, r.fecha) ?? r.parcial ?? 1
      return parcialActual === r.parcial ? r : { ...r, parcial: parcialActual }
    })
    .sort((a, b) => (a.fecha === b.fecha ? a.slot - b.slot : a.fecha.localeCompare(b.fecha)))

  const porParcial = {}
  const total = { asist: 0, inasist: 0, justif: 0, total: 0 }
  const registros = []
  const sinRegistro = []
  for (const r of sesiones) {
    const estado = estadoAsistencia(r, studentId)
    if (!estado) {
      if (sinRegistroExplicito(r, studentId)) sinRegistro.push({ fecha: r.fecha, slot: r.slot ?? 1, parcial: r.parcial })
      continue
    }
    const p = String(r.parcial)
    if (!porParcial[p]) porParcial[p] = { asist: 0, inasist: 0, justif: 0, total: 0 }
    porParcial[p].total++
    total.total++
    if (estado === 'falta') { porParcial[p].inasist++; total.inasist++ }
    else {
      porParcial[p].asist++; total.asist++
      if (estado === 'justificada') { porParcial[p].justif++; total.justif++ }
    }
    registros.push({ fecha: r.fecha, slot: r.slot ?? 1, parcial: r.parcial, estado, motivo: r.motivos?.[studentId] || '' })
  }
  return { porParcial, total, registros, sinRegistro }
}
