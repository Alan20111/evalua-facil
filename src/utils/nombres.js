// Los nombres de los estudiantes llegan capturados de mil formas: listas de la
// SEP en MAYÚSCULAS, capturas a mano en minúsculas, columnas pegadas de Excel
// tal cual venían. En pantalla todos deben verse igual — "García López Juan
// Carlos" — así que la capitalización se aplica en los dos extremos: al
// MOSTRAR (arregla lo que ya está guardado, sin tocar la base) y al GUARDAR
// (deja derecho lo nuevo).
//
// El username NO pasa por aquí: es un identificador (garcia.juan), va siempre
// en minúsculas y compararlo es lo que sostiene la cuenta del estudiante.
export function capitalizarNombre(texto) {
  return String(texto ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es')
    // Después de un espacio, un guion o un apóstrofo empieza otra palabra del
    // nombre: "ana-maría" → "Ana-María", "d'angelo" → "D'Angelo".
    .replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase('es'))
}

// Capitaliza los tres campos de un estudiante de una vez, para las escrituras
// (alta manual, importación de Excel, edición, copiar asignatura). Devuelve
// solo esos campos; el resto del documento lo arma quien llama.
export function capitalizarPersona(persona) {
  return {
    apellidoPaterno: capitalizarNombre(persona?.apellidoPaterno),
    apellidoMaterno: capitalizarNombre(persona?.apellidoMaterno),
    nombre: capitalizarNombre(persona?.nombre),
  }
}
