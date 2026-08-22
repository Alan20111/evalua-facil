// Normaliza una palabra de crucigrama/sopa de letras (categoria: 'juego')
// para poder construir la cuadrícula: mayúsculas, sin acentos, Ñ→N, sin
// espacios ni signos — SOLO para el motor de construcción y calificación.
// El contenido ORIGINAL (con acentos y Ñ) se conserva siempre tal cual en
// `juego.contenido[].palabra` para mostrarlo al docente y al estudiante
// (decisión de producto aprobada — ver docs del feature). Nunca se
// sobrescribe el original con esta versión.
//
// Compartido cliente/servidor — ver scripts/sync-functions-shared.mjs.
export function normalizarPalabra(palabra) {
  const s = String(palabra || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos (excepto la Ñ, que NFD no descompone)
    .toUpperCase()
    .replace(/Ñ/g, 'N')
    .replace(/[^A-Z]/g, '') // solo letras A-Z: sin espacios, números ni signos
  return s
}
