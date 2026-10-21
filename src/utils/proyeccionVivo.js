// Reglas PURAS de la proyección de Participación en vivo (vista del grupo): tamaños mínimos de legibilidad, cómo
// presentar una pregunta de opción única según el largo de sus opciones y el tamaño del código QR.
//
// CONTRATO DE LEGIBILIDAD (proyección pública): todo se mide con unidades de la altura de la ventana (vmin) y con un
// piso absoluto en píxeles. Si algo no cabe, se DIVIDE EN MOMENTOS: nunca se reduce la letra por debajo del piso ni se
// trunca el texto.

export const PISOS_PROYECCION = { pregunta: 48, opcion: 36, numero: 44, respuesta: 32, resto: 28 }

/** Tamaños de letra (px) para una ventana de ancho×alto. A 1080p: pregunta 65, opción 45, número 56, respuesta 43, resto 32. */
export function tamanosProyeccion(ancho, alto) {
  const vmin = Math.min(ancho, alto)
  return {
    pregunta: Math.max(PISOS_PROYECCION.pregunta, Math.round(vmin * 0.06)),
    opcion: Math.max(PISOS_PROYECCION.opcion, Math.round(vmin * 0.042)),
    numero: Math.max(PISOS_PROYECCION.numero, Math.round(vmin * 0.052)),
    respuesta: Math.max(PISOS_PROYECCION.respuesta, Math.round(vmin * 0.04)),
    resto: Math.max(PISOS_PROYECCION.resto, Math.round(vmin * 0.03)),
  }
}

// Líneas que ocupa un texto a un tamaño dado en un ancho dado (estimación conservadora: 0.56 em por carácter y
// 12 % extra por cortes de palabra).
export function lineasDe(texto, tamano, anchoDisponible) {
  const porLinea = Math.max(1, Math.floor(anchoDisponible / (tamano * 0.56 * 1.12)))
  return Math.max(1, Math.ceil(String(texto || '').length / porLinea))
}

/**
 * Cómo presentar una pregunta de opción única SIN tocar su contenido:
 *   · 'directo'  → opciones cortas: el texto va directamente sobre cada columna;
 *   · 'lista'    → opciones medianas: lista de opciones (letra + texto completo) junto a las columnas con letras;
 *   · 'momentos' → opciones largas: primero pregunta + opciones completas, después las columnas con letras.
 */
export function planOpciones(enunciado, opciones, ancho, alto) {
  const t = tamanosProyeccion(ancho, alto)
  const n = (opciones || []).length
  const margen = Math.round(ancho * 0.05)
  const W = ancho - 2 * margen
  const altoPregunta = lineasDe(enunciado, t.pregunta, W) * t.pregunta * 1.15
  const maxLargo = Math.max(0, ...(opciones || []).map((o) => String(o.texto || '').length))
  const anchoColumna = (W / Math.max(1, n)) * 0.86
  if (n <= 5 && maxLargo * t.opcion * 0.56 <= anchoColumna && altoPregunta + alto * 0.42 <= alto - 2 * margen) return 'directo'
  const anchoLista = W * 0.46 - t.opcion * 1.6
  const lineas = (opciones || []).reduce((a, o) => a + lineasDe(o.texto, t.opcion, anchoLista), 0)
  const altoLista = lineas * t.opcion * 1.2 + n * t.opcion * 0.5
  if (altoPregunta + altoLista <= (alto - 2 * margen) * 0.92) return 'lista'
  return 'momentos'
}

/** Lado (px) del código QR de la sala de espera: entre 40 % y 55 % de la altura útil, siempre cuadrado. */
export function ladoQr(ancho, alto) {
  const margen = Math.round(alto * 0.04)
  const altoUtil = alto - 2 * margen
  const porAlto = altoUtil * 0.52
  const porAncho = ancho * 0.46 // en pantallas muy verticales el ancho manda
  return Math.round(Math.min(porAlto, porAncho))
}

/** Alto (px) que ocupa el enunciado a su tamaño de proyección: lo que sobra es para los resultados. */
export function altoEnunciado(enunciado, ancho, alto) {
  const t = tamanosProyeccion(ancho, alto)
  return Math.round(lineasDe(enunciado, t.pregunta, ancho * 0.9) * t.pregunta * 1.2 + t.pregunta * 0.4)
}

/** Reparte las respuestas abiertas en páginas de hasta 4 tarjetas; una que no cabe a media tarjeta va sola. Nunca trunca. */
export function paginarMuro(respuestas, area, tamano) {
  const anchoTarjeta = (area.ancho * 0.92) / 2 - tamano
  const alto = area.alto * 0.7
  const maxLineas = Math.max(2, Math.floor((alto / 2) / (tamano * 1.3)))
  const paginas = []
  let actual = []
  for (const r of respuestas) {
    const grande = lineasDe(r.texto, tamano, anchoTarjeta) > maxLineas
    if (grande) { if (actual.length) { paginas.push(actual); actual = [] } paginas.push([r]); continue }
    actual.push(r)
    if (actual.length === 4) { paginas.push(actual); actual = [] }
  }
  if (actual.length) paginas.push(actual)
  return paginas
}

export const rutaProyeccion = (codigo) => `/proyeccion-vivo/${codigo}`

/**
 * Reparte las opciones (texto COMPLETO) en páginas que caben en el alto disponible, sin reducir la letra: devuelve
 * rangos [desde, hasta). Siempre al menos una opción por página; la última página lleva el resto.
 */
export function paginarOpciones(opciones, ancho, alto) {
  const t = tamanosProyeccion(ancho, alto)
  const disponible = alto - Math.round(t.resto * 2.8) - 8
  const anchoTexto = ancho * 0.92 - t.opcion * 1.5 - 24
  const paginas = []
  let desde = 0
  let usado = 0
  ;(opciones || []).forEach((o, i) => {
    const h = lineasDe(o.texto, t.opcion, anchoTexto) * t.opcion * 1.3 + t.opcion * 0.6
    if (i > desde && usado + h > disponible) { paginas.push([desde, i]); desde = i; usado = 0 }
    usado += h
  })
  if ((opciones || []).length > desde) paginas.push([desde, opciones.length])
  return paginas
}
