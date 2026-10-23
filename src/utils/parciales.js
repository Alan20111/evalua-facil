// ─── Fecha → parcial — lógica pura, sin ninguna dependencia ──────────────────
//
// Vive separada de attendanceAuto.js a propósito: ese archivo importa
// Firestore/firebase (para sus otras funciones, que sí leen/escriben datos),
// lo que lo hace inutilizable fuera de Vite/el navegador. Esta función no
// necesita nada de eso — por eso es la pieza que se comparte con Cloud
// Functions (ver scripts/sync-functions-shared.mjs).

// Índice del parcial (1-based) cuyo rango [inicio, fin] contiene `fecha`, o
// null si no cae en ninguno (fechas fuera del curso, o parcialesFechas vacío).
export function parcialForDate(parcialesFechas, fecha) {
  if (!Array.isArray(parcialesFechas)) return null
  for (let i = 0; i < parcialesFechas.length; i++) {
    const { inicio, fin } = parcialesFechas[i] || {}
    if (inicio && fin && fecha >= inicio && fecha <= fin) return i + 1
  }
  return null
}

// El parcial VIGENTE de una asignatura — una sola regla para Asistencias y
// Calificaciones. `hoy` es 'YYYY-MM-DD' en hora de México (fechaHoyMexico);
// en UTC, desde las 18:00 ya contaría el día siguiente.
//
//   1. Con fechas: el parcial cuyo rango contiene hoy; antes de que empiece
//      el curso, el 1; en cualquier otro caso (ya terminó), el último.
//   2. Sin fechas: el último parcial que tiene datos en la pantalla que
//      pregunta. Cada pantalla pasa los suyos (`parcialesConDatos`):
//      Asistencias, los parciales con días de asistencia; Calificaciones, los
//      que tienen actividades que cuentan. Sin datos, el 1.
export function parcialVigente(parcialesFechas, hoy, parcialesConDatos = []) {
  if (Array.isArray(parcialesFechas) && parcialesFechas.length) {
    const parcial = parcialForDate(parcialesFechas, hoy)
    if (parcial) return parcial
    if (parcialesFechas[0]?.inicio && hoy < parcialesFechas[0].inicio) return 1
    return parcialesFechas.length
  }
  if (!parcialesConDatos.length) return 1
  return Math.max(...parcialesConDatos)
}
