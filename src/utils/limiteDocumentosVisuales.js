// Límite de páginas de los documentos VISUALES (PDF cuyo contenido son
// imágenes: escaneos, infografías, capturas) que una operación de IA puede
// leer. UNA sola definición para cliente y servidor: el servidor (functions/
// fuentesIA.js) la usa vía functions/_shared/ (copia generada por
// scripts/sync-functions-shared.mjs) y la pantalla del docente la importa
// directo de aquí — nunca se escribe el número en otro lado.
//
// REGLA (matemática, exacta):
//
//   límite(créditos) = min( MAX, max( MIN, floor( créditos × MXN_POR_CRÉDITO
//                                                  × FRACCIÓN / COSTO_POR_PÁGINA ) ) )
//
// con MAX = 30, MIN = 4, FRACCIÓN = 0.25, COSTO_POR_PÁGINA = 0.039 MXN y
// MXN_POR_CRÉDITO = 1. `créditos` es lo que cobra la operación (tarifa × reactivos),
// leído de config/iaTarifas — jamás escrito a mano.
//
// De dónde sale: una página escaneada cuesta ~2,100 tokens de entrada según la
// fórmula de Anthropic ((ancho×alto)/750 sobre A4), o ~$0.039 MXN con la tarifa
// de claude-haiku-4-5 (medido con Anthropic real: ~1,588 tokens/página, así que
// la cifra es conservadora). Se topa el gasto en documentos en ~25% del ingreso
// de la operación. Con 1 crédito por reactivo el resultado es:
//
//     1 reactivo → 6    2 → 12    3 → 19    4 → 25    5 o más → 30
//
// (5 reactivos darían 32 sin tope; el tope MAX = 30 manda — 32 nunca se alcanza).
// MAX = 30 es además un límite duro: aunque la operación sea carísima, nunca se
// mandan más de 30 páginas visuales. Con 30 páginas y 5 reactivos la IA cuesta
// ~24% del ingreso; por encima de 30 dejaría de ser sostenible, por eso el
// límite es 30 y no hay recargo por páginas adicionales: se rechaza, sin cobrar.
//
// NO confundir con el límite de la ENTREGA de un alumno en OP-11
// (functions/evidenciasEntrega.js, 3 páginas): otra operación, otra economía.

export const DOCUMENTOS_VISUALES = Object.freeze({
  maxPaginas: 30,
  minPaginas: 4,
  costoMxnPorPagina: 0.039,
  fraccionIngreso: 0.25,
  mxnPorCredito: 1,
})

/**
 * Cuántas páginas visuales puede leer una operación que cobra `creditos`.
 * El presupuesto ESCALA CON EL INGRESO: 30 páginas son razonables cuando el
 * docente pagó 5 créditos o más, pero arruinarían una operación de 1 crédito.
 */
export function presupuestoPaginasVisual(creditos) {
  const { maxPaginas, minPaginas, costoMxnPorPagina, fraccionIngreso, mxnPorCredito } = DOCUMENTOS_VISUALES
  const ingreso = Math.max(0, Number(creditos) || 0) * mxnPorCredito
  const paginas = Math.floor((ingreso * fraccionIngreso) / costoMxnPorPagina)
  return Math.min(maxPaginas, Math.max(minPaginas, paginas))
}
