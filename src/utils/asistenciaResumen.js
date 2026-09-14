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
//   null          sin registro: el alumno no tiene llave en esa columna
//                 porque se dio de alta después de que se creó. No es una
//                 falta ni una asistencia — no se cuenta en ningún lado.
export function estadoAsistencia(record, studentId) {
  if (record.presentes?.[studentId] === true) return 'presente'
  if (record.justificadas?.[studentId]) return 'justificada'
  if (record.presentes?.[studentId] === false) return 'falta'
  return null
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
  for (const r of sesiones) {
    const estado = estadoAsistencia(r, studentId)
    if (!estado) continue
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
  return { porParcial, total, registros }
}
