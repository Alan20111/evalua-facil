import { toDateStr } from './horarioBloques'
import { alcanceCompleto } from './asuetos'

// ─── Vacaciones ──────────────────────────────────────────────────────────────
//
// Colección `vacaciones`: cada doc marca un PERIODO (a diferencia de `asuetos`,
// que marca un solo día) en el que, según su alcance, no se permiten clases,
// eventos y/o actividades.
//
//   { docenteId, fechaInicio: 'YYYY-MM-DD', fechaFin: 'YYYY-MM-DD',
//     clases: bool, eventos: bool, actividades: bool, createdAt }
//
// Un flag en `true` significa "ese tipo NO se permite ningún día del periodo".
// Reutiliza TIPOS_ASUETO (mismas tres categorías) para la UI de selección.

const MAX_DIAS_PERIODO = 400 // resguardo ante rangos mal capturados

// Expande un periodo a la lista de fechas 'YYYY-MM-DD' que abarca (inclusive).
function expandirPeriodo(fechaInicio, fechaFin) {
  const fechas = []
  const inicio = new Date(fechaInicio + 'T12:00:00')
  const fin = new Date(fechaFin + 'T12:00:00')
  if (Number.isNaN(+inicio) || Number.isNaN(+fin) || fin < inicio) return fechas
  const cur = new Date(inicio)
  let guard = 0
  while (cur <= fin && guard < MAX_DIAS_PERIODO) {
    fechas.push(toDateStr(cur))
    cur.setDate(cur.getDate() + 1)
    guard++
  }
  return fechas
}

// Índice por fecha para consultas O(1), con la misma forma que buildAsuetoMap
// (mismo consumidor: esAsuetoPara/esAsuetoAlguno/alcanceAsuetoTexto ya sirven
// para vacaciones porque solo leen {clases,eventos,actividades}).
export function buildVacacionMap(vacaciones = []) {
  const m = {}
  vacaciones.forEach(v => {
    if (!v?.fechaInicio || !v?.fechaFin) return
    expandirPeriodo(v.fechaInicio, v.fechaFin).forEach(fecha => {
      const prev = m[fecha] || alcanceCompleto(false)
      m[fecha] = {
        clases: prev.clases || !!v.clases,
        eventos: prev.eventos || !!v.eventos,
        actividades: prev.actividades || !!v.actividades,
        // Mismo arrastre que en asuetos: si el periodo se guardó antes de que
        // existiera `asistencias`, la hereda de `clases`.
        asistencias: prev.asistencias || (v.asistencias ?? !!v.clases),
      }
    })
  })
  return m
}

// Lista plana de fechas 'YYYY-MM-DD' cubiertas por periodos que bloquean
// clases — para alimentar `diasAsueto` de generarBloques() junto con los
// asuetos sueltos.
export function fechasVacacionParaClases(vacaciones = []) {
  const fechas = []
  vacaciones.filter(v => v.clases).forEach(v => fechas.push(...expandirPeriodo(v.fechaInicio, v.fechaFin)))
  return fechas
}
