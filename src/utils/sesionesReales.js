// ─── Calendario real de sesiones — capa de cálculo puro ──────────────────────
//
// `calcularSesionesReales()` NO materializa nada en Firestore ni reemplaza
// `horarioBloques`: es una PROYECCIÓN en memoria de las sesiones académicas de
// una asignatura (o de uno de sus parciales), a partir de datos que ya existen
// como fuente de verdad:
//
//   subjects.fechaInicio / fechaFin      — rango del curso
//   subjects.parcialesFechas             — rango de cada parcial
//   subjects.horarioPatron               — patrón semanal vigente
//   diasAsueto (asuetos+vacaciones ya combinados por el llamador)
//
// Es intencionalmente una capa fina: NO reimplementa el recorrido de fechas
// (eso lo hace generarBloques), NO reimplementa "¿a qué parcial pertenece
// esta fecha?" (eso lo hace parcialForDate) — solo orquesta ambas y numera el
// resultado.
//
// Al usar `horarioPatron` vigente sin historial, el cálculo es una proyección
// del patrón ACTUAL sobre todo el rango pedido — no reconstruye patrones que
// hayan estado vigentes en el pasado. Para fechas ya transcurridas, la fuente
// de verdad de lo que realmente ocurrió sigue siendo `horarioBloques`/
// `attendance`, no esta función.

import { generarBloques, diaSemanaLunes, toDateStr } from './horarioBloques.js'
import { parcialForDate } from './attendanceAuto.js'

function resumenVacio() {
  return {
    semanas: 0,
    diasEfectivos: 0,
    sesionesTotales: 0,
    sesionesPorParcial: {},
    sesionesSinParcial: 0,
  }
}

// Lunes de la semana que contiene `fechaStr` — para contar "semanas con al
// menos una sesión real" en vez de la diferencia de calendario cruda entre
// fechaInicio/fechaFin (que cuenta semanas vacías por vacaciones/asuetos como
// si tuvieran clase).
function inicioDeSemana(fechaStr) {
  const d = new Date(fechaStr + 'T12:00:00')
  d.setDate(d.getDate() - diaSemanaLunes(d))
  return toDateStr(d)
}

// `parcial` es opcional y 1-based (1 = parcialesFechas[0]). Sin él, calcula
// sobre todo el rango [fechaInicio, fechaFin] del curso.
export function calcularSesionesReales({
  fechaInicio,
  fechaFin,
  parcialesFechas = [],
  horarioPatron = [],
  diasAsueto = [],
  parcial = null,
} = {}) {
  // Sin patrón guardado no hay nada que proyectar — no se reconstruye con
  // derivarPatrones() aquí (esa es una decisión de quien llama, no de esta
  // capa de cálculo puro).
  if (!horarioPatron?.length) return { sesiones: [], resumen: resumenVacio() }

  let rangoInicio = fechaInicio
  let rangoFin = fechaFin
  if (parcial != null) {
    const p = parcialesFechas?.[parcial - 1]
    if (!p?.inicio || !p?.fin) return { sesiones: [], resumen: resumenVacio() }
    rangoInicio = p.inicio
    rangoFin = p.fin
  }
  if (!rangoInicio || !rangoFin) return { sesiones: [], resumen: resumenVacio() }

  const bloques = generarBloques({ fechaInicio: rangoInicio, fechaFin: rangoFin, diasAsueto, patrones: horarioPatron })
  if (!bloques.length) return { sesiones: [], resumen: resumenVacio() }

  const ordenados = [...bloques].sort((a, b) => (
    a.fecha === b.fecha ? a.horaInicio.localeCompare(b.horaInicio) : a.fecha.localeCompare(b.fecha)
  ))

  const sesionesPorParcial = {}
  if (Array.isArray(parcialesFechas)) parcialesFechas.forEach((_, i) => { sesionesPorParcial[i + 1] = 0 })
  const contadorPorParcial = {}
  let sesionesSinParcial = 0
  const fechasVistas = new Set()
  const semanasVistas = new Set()

  const sesiones = ordenados.map((b, idx) => {
    const p = parcialForDate(parcialesFechas, b.fecha)
    if (p) {
      contadorPorParcial[p] = (contadorPorParcial[p] || 0) + 1
      sesionesPorParcial[p] = (sesionesPorParcial[p] || 0) + 1
    } else {
      sesionesSinParcial++
    }
    fechasVistas.add(b.fecha)
    semanasVistas.add(inicioDeSemana(b.fecha))
    return {
      fecha: b.fecha,
      diaSemana: b.diaSemana,
      horaInicio: b.horaInicio,
      horaFin: b.horaFin,
      parcial: p,
      numeroSesionParcial: p ? contadorPorParcial[p] : null,
      numeroSesionAsignatura: idx + 1,
    }
  })

  return {
    sesiones,
    resumen: {
      semanas: semanasVistas.size,
      diasEfectivos: fechasVistas.size,
      sesionesTotales: sesiones.length,
      sesionesPorParcial,
      sesionesSinParcial,
    },
  }
}
