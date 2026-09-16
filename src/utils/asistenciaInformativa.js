// ─── Columnas informativas de asueto — lógica pura ──────────────────────────
//
// Un día de asueto o de vacaciones que afecta asistencias NO genera registros
// en `attendance` (ver ./asistenciaAsuetos.js). El ASUETO sí debe verse en la
// tabla del docente: una columna marcada, con "—", que no se toca y no suma.
// Las VACACIONES no (regla de Kike, 16-sep-2026): durante vacaciones no hay
// sesiones, así que no generan columna ni afectan totales. Una sesión REAL
// creada en una fecha de vacaciones es un registro normal y se pinta como tal.
//
// Estas columnas viven SOLO en memoria. Sus "registros" no tienen documento en
// Firestore: llevan `informativa: true` y un id con PREFIJO_INFORMATIVA, que
// las funciones que escriben asistencia (./attendance.js) rechazan.
//
// Reposiciones: el sistema no tiene un campo que las marque. Una reposición es
// un registro REAL de `attendance` en una fecha de asueto (agregado a mano con
// "Agregar día", y respetado por onAsuetoEscrito porque se creó después del
// asueto). Por eso una fecha con cualquier registro real NUNCA recibe columna
// informativa: se pinta y se cuenta como siempre, igual que los registros
// históricos que quedaron en fechas marcadas después.

import { parcialForDate } from './parciales.js'
import { diaSemanaLunes } from './horarioBloques.js'

export const PREFIJO_INFORMATIVA = 'sin-asistencia:'

// ¿Es un registro/id de columna informativa (sin documento en Firestore)?
export function esSesionInformativa(recordOrId) {
  if (!recordOrId) return false
  if (typeof recordOrId === 'string') return recordOrId.startsWith(PREFIJO_INFORMATIVA)
  return recordOrId.informativa === true || String(recordOrId.id || '').startsWith(PREFIJO_INFORMATIVA)
}

// Cuántas sesiones tendría esa fecha: los bloques que aún existan ese día
// (si el asueto se marcó después de generarlos) o, si no, los del patrón
// semanal para ese día de la semana. Mínimo 1, para que la columna exista.
function sesionesDelDia(fecha, porFecha, horarioPatron) {
  if (porFecha?.[fecha] > 0) return porFecha[fecha]
  if (Array.isArray(horarioPatron) && horarioPatron.length) {
    const [y, m, d] = fecha.split('-').map(Number)
    const dia = diaSemanaLunes(new Date(y, m - 1, d, 12))
    const n = horarioPatron.filter((p) => p?.diaSemana === dia).length
    if (n > 0) return n
  }
  return 1
}

// Días informativos para agregar a la tabla.
//   diasSinAsistencia — [{ fecha, tipo: 'asueto'|'vacaciones' }] (diasSinAsistenciaEnCurso)
//   fechasConRegistro — fechas con al menos un registro real (esas NO se tocan)
//   todayISO          — igual que las columnas normales, aparecen cuando llega su día
// Devuelve [{ fecha, parcial, sinAsistencia: tipo, records: [placeholder…] }].
export function diasInformativosAsistencia({ diasSinAsistencia = [], fechasConRegistro = [], parcialesFechas = [], porFecha = {}, horarioPatron = [], todayISO }) {
  const conRegistro = new Set(fechasConRegistro)
  // Una fecha de vacaciones nunca lleva columna informativa, aunque además
  // esté marcada como asueto.
  const deVacaciones = new Set(diasSinAsistencia.filter((d) => d?.tipo === 'vacaciones').map((d) => d.fecha))
  const vistos = new Set()
  const dias = []
  for (const { fecha, tipo } of diasSinAsistencia) {
    if (!fecha || vistos.has(fecha) || conRegistro.has(fecha) || deVacaciones.has(fecha)) continue
    if (todayISO && fecha > todayISO) continue
    const parcial = parcialForDate(parcialesFechas, fecha)
    if (!parcial) continue
    vistos.add(fecha)
    const n = sesionesDelDia(fecha, porFecha, horarioPatron)
    const records = Array.from({ length: n }, (_, i) => ({
      id: `${PREFIJO_INFORMATIVA}${fecha}_${i + 1}`,
      fecha,
      slot: i + 1,
      parcial,
      informativa: true,
      tipoSinAsistencia: tipo,
    }))
    dias.push({ fecha, parcial, sinAsistencia: tipo, records })
  }
  return dias
}
