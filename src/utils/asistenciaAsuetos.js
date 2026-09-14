import { buildAsuetoMap } from './asuetos.js'
import { buildVacacionMap } from './vacaciones.js'
import { parcialForDate } from './parciales.js'

// ─── Asistencia frente a días de asueto y vacaciones ────────────────────────
//
// Un asueto o periodo vacacional con `asistencias: true` significa "ese día no
// se pasa lista" (los guardados antes de que existiera la opción la heredan de
// `clases` — ver asuetos.js). Esa definición vive AQUÍ, una sola vez, para que
// la usen igual:
//
//   · la creación automática de columnas (attendanceAuto.js),
//   · el denominador de sesiones (SubjectPage y recomputarSesionesEstimadas),
//   · la limpieza de columnas ya creadas (onAsuetoEscrito / onVacacionEscrita).
//
// Antes cada uno decidía por su lado: la creación no miraba asuetos, y el
// denominador descontaba por `clases`. Un asueto que afectaba asistencias
// dejaba columnas contables en un día que el denominador ya no contaba.
//
// Lógica pura: se copia a functions/_shared (scripts/sync-functions-shared.mjs).

// Fechas 'YYYY-MM-DD' (ordenadas, sin repetir) en las que no se pasa lista.
export function fechasSinAsistencia(asuetos = [], vacaciones = []) {
  const fechas = new Set()
  const agregar = (mapa) => Object.entries(mapa).forEach(([fecha, alcance]) => {
    if (alcance.asistencias) fechas.add(fecha)
  })
  agregar(buildAsuetoMap(asuetos))
  agregar(buildVacacionMap(vacaciones))
  return [...fechas].sort()
}

// ¿La columna sigue tal como la creó el sistema, sin trabajo del docente?
// Nace con todos en `true`; cualquier falta, justificada o motivo escrito es
// trabajo del docente y la columna NO se toca. Una llave ausente ("sin
// registro", alta posterior) no es una marca. Si el docente cicló una celda
// hasta volver a Presente, el estado es idéntico al original: no se pierde nada.
export function sesionSinMarcas(record) {
  if (Object.values(record?.presentes || {}).some((v) => v !== true)) return false
  if (Object.values(record?.justificadas || {}).some(Boolean)) return false
  if (Object.values(record?.motivos || {}).some((m) => (typeof m === 'string' ? m.trim() !== '' : Boolean(m)))) return false
  return true
}

// Qué columnas automáticas faltan por crear, sin tocar Firestore.
//   porFecha        — { fecha: nº de bloques no cancelados } (fetchClaseDiasSemana)
//   existingSlots   — "fecha_slot" ya existentes
//   excludedFechas  — días que el docente borró a propósito (se reportan en `missing`)
//   sinAsistencia   — fechasSinAsistencia(): ni se crean ni se ofrecen para restaurar
//   todayISO        — las fechas posteriores se crean cuando llega su día
export function planSesionesAutomaticas({ porFecha = {}, parcialesFechas = [], existingSlots = [], excludedFechas = [], sinAsistencia = [], todayISO }) {
  const existing = new Set(existingSlots)
  const excluded = new Set(excludedFechas)
  const sinLista = new Set(sinAsistencia)
  const writes = [] // { fecha, slot, parcial }
  const missing = [] // { fecha, duracion, parcial } — excluidas pero aún válidas
  Object.keys(porFecha).forEach((fecha) => {
    if (fecha > todayISO) return
    if (sinLista.has(fecha)) return
    const parcial = parcialForDate(parcialesFechas, fecha)
    if (!parcial) return
    if (excluded.has(fecha)) { missing.push({ fecha, duracion: porFecha[fecha], parcial }); return }
    for (let slot = 1; slot <= porFecha[fecha]; slot++) {
      if (existing.has(`${fecha}_${slot}`)) continue
      writes.push({ fecha, slot, parcial })
    }
  })
  missing.sort((a, b) => a.fecha.localeCompare(b.fecha))
  return { writes, missing }
}
