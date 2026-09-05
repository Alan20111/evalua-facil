// ¿Una pregunta ya tiene respuesta válida? Regla de sistema, no un toggle.
// Vive fuera del runner para que se pueda probar directo sin renderizar React.
//
// Contrato:
//   - `pregunta` = { id, tipo, opciones? }
//   - `respuesta` = valor guardado para esa pregunta (id de opción, string,
//     objeto {archivoURL, ...}, null, undefined). Es lo mismo que
//     `respuestas[pregunta.id]` en EvaluacionRunner.
//   - `otraTexto` = texto libre cuando la opción elegida es "Otra". Es lo
//     mismo que `otraTextos[pregunta.id]` en el runner.
//
// "Vacío" es SOLO null, undefined y ''. Un `false` o un `0` legítimos cuentan
// como respuesta válida — un `!respuesta` desnudo los mezclaba con vacío.
export function estaRespondida(pregunta, respuesta, otraTexto) {
  if (!pregunta) return false
  if (pregunta.tipo === 'respuesta_corta') {
    return typeof respuesta === 'string' && respuesta.trim() !== ''
  }
  if (pregunta.tipo === 'subir_archivo') {
    return typeof respuesta?.archivoURL === 'string' && respuesta.archivoURL !== ''
  }
  if (respuesta === null || respuesta === undefined || respuesta === '') return false
  const opcionElegida = pregunta.opciones?.find((o) => o.id === respuesta)
  if (opcionElegida?.esOtra) {
    return typeof otraTexto === 'string' && otraTexto.trim() !== ''
  }
  return true
}
