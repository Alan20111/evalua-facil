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
