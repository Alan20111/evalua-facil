// Límite de páginas de los documentos VISUALES (PDF cuyo contenido son
// imágenes: escaneos, infografías, capturas) que una operación de IA puede
// leer. UNA sola definición para cliente y servidor: el servidor (functions/
// fuentesIA.js) la usa vía functions/_shared/ (copia generada por
// scripts/sync-functions-shared.mjs) y la pantalla del docente la importa
// directo de aquí — nunca se escribe el número en otro lado.
//
// DOS REGLAS (6-oct-2026, decisión de Kike):
//
// 1) crear_evaluacion_ia y reactivos: el máximo es SIEMPRE `maxPaginas` (30),
//    sin importar cuántos reactivos pida el docente. Más de 30 se rechaza ANTES
//    de reservar créditos y no hay recargo por páginas: el único cobro es 1
//    crédito por reactivo. Estas dos operaciones NO usan la fórmula de abajo.
//
// 2) Las demás operaciones que leen documentos visuales (crear_actividad_ia,
//    Crucigrama y Sopa de letras, diagnóstico, planeación) conservan el
//    presupuesto que escala con lo que cobran:
//
//      límite(créditos) = min( MAX, max( MIN, floor( créditos × MXN_POR_CRÉDITO
//                                                     × FRACCIÓN / COSTO_POR_PÁGINA ) ) )
//
//    con MAX = 30, MIN = 4, FRACCIÓN = 0.25, COSTO_POR_PÁGINA = 0.039 MXN y
//    MXN_POR_CRÉDITO = 1. `créditos` sale de config/iaTarifas — jamás escrito a
//    mano. Una página escaneada cuesta ~2,100 tokens de entrada según la fórmula
//    de Anthropic, o ~$0.039 MXN con la tarifa de claude-haiku-4-5 (medido: ~1,588
//    tokens/página, así que la cifra es conservadora); se topa el gasto en
//    documentos en ~25% del ingreso de la operación.
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
