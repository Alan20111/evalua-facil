// OP-10 · Análisis de resultados de un cuestionario/examen con IA.
//
// Este archivo solo trae el umbral para decidir cuándo MOSTRAR el botón en
// el cliente — la validación real (y la que de verdad protege el gasto de
// créditos) vive en el precheck del servidor (functions/ia.js,
// MIN_ENTREGAS_ANALISIS), que no confía en nada que mande el cliente.
export const MIN_ENTREGAS_ANALISIS = 3
