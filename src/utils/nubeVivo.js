// Nube de palabras EDITORIAL para proyectar (Participación en vivo). Funciones PURAS: sin DOM ni Firebase.
//
// Qué resuelve (ver el plan aprobado):
//   · tamaño proporcional a la frecuencia REAL: tamaño = k·√cantidad (el ÁREA crece con la cantidad). Misma cantidad →
//     mismo tamaño; el orden de tamaños nunca contradice el orden de frecuencia. Solo se recorta en el mínimo y el
//     máximo de legibilidad (ahí se conserva el orden, no la proporción);
//   · mezcla de palabras horizontales y VERTICALES (se leen de abajo hacia arriba). La más frecuente siempre horizontal;
//     la orientación de cada palabra sale de un hash de la palabra, así NO cambia cuando llegan respuestas nuevas;
//   · aprovecha el espacio: se busca el mayor factor de escala con el que caben todas las palabras de la página;
//   · nunca se baja del tamaño mínimo (32 px por omisión). Si no caben todas, se reparten en PÁGINAS por frecuencia y
//     cada página se recompone a tamaño completo (nada de letra reducida);
//   · no inventa palabras ni cambia cantidades: devuelve exactamente lo recibido.
//
// `medir(texto, tamano)` devuelve el ancho en px del texto horizontal. En el navegador se mide con el canvas y la
// fuente real; en las pruebas se usa una estimación determinista.

export const TAMANO_MIN_NUBE = 32
export const MAX_PALABRAS_PAGINA = 40

// Colores armoniosos (coral, violeta, verde azulado, ámbar, magenta, azul) sobre fondo claro. Todos ≥ 7:1 sobre
// blanco; el primero (violeta profundo, ≥ 10:1) es el de la palabra dominante.
export const PALETA_NUBE = ['#4C1D95', '#9F1239', '#115E59', '#92400E', '#86198F', '#1E40AF']

export function hash32(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export const medirEstimado = (texto, tamano) => texto.length * tamano * 0.56

/** Orientación estable: depende solo de la palabra y de si es la dominante (rango 0). */
export function esVertical(clave, texto, rango) {
  return rango > 0 && texto.length >= 4 && texto.length <= 14 && hash32(clave) % 100 < 32
}

export function colorDe(clave, rango) {
  return rango === 0 ? PALETA_NUBE[0] : PALETA_NUBE[1 + (hash32(clave) % (PALETA_NUBE.length - 1))]
}

/** Contraste WCAG entre dos colores hex (#rrggbb). */
export function contraste(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

function cajasPara(palabras, k, tmin, tmax, medir) {
  return palabras.map((p, i) => {
    const tamano = Math.min(tmax, Math.max(tmin, Math.round(k * Math.sqrt(p.n))))
    const vertical = esVertical(p.clave, p.texto, i)
    const largo = Math.ceil(medir(p.texto, tamano))
    const alto = Math.ceil(tamano * 1.12)
    return { clave: p.clave, texto: p.texto, n: p.n, tamano, vertical, w: vertical ? alto : largo, h: vertical ? largo : alto }
  })
}

// Espiral elíptica desde el centro; devuelve las cajas colocadas o null si alguna no cabe.
function colocar(cajas, ancho, alto) {
  const colocadas = []
  const margen = 8
  const cx = ancho / 2
  const cy = alto / 2
  const razon = ancho / alto
  for (const c of cajas) {
    let puesta = null
    for (let paso = 0; paso < 2600 && !puesta; paso++) {
      const ang = paso * 0.42
      const r = 1 + paso * 1.7
      const x = Math.round(cx + Math.cos(ang) * r * razon - c.w / 2)
      const y = Math.round(cy + Math.sin(ang) * r - c.h / 2)
      if (x < margen || y < margen || x + c.w > ancho - margen || y + c.h > alto - margen) continue
      let libre = true
      for (let i = 0; i < colocadas.length; i++) {
        const b = colocadas[i]
        const g = Math.max(6, Math.round(0.12 * Math.min(c.tamano, b.tamano)))
        if (x < b.x + b.w + g && x + c.w + g > b.x && y < b.y + b.h + g && y + c.h + g > b.y) { libre = false; break }
      }
      if (libre) puesta = { ...c, x, y }
    }
    if (!puesta) return null
    colocadas.push(puesta)
  }
  return colocadas
}

function centrar(colocadas, ancho, alto) {
  if (!colocadas.length) return colocadas
  const x0 = Math.min(...colocadas.map((c) => c.x)); const x1 = Math.max(...colocadas.map((c) => c.x + c.w))
  const y0 = Math.min(...colocadas.map((c) => c.y)); const y1 = Math.max(...colocadas.map((c) => c.y + c.h))
  const dx = Math.round((ancho - (x1 - x0)) / 2 - x0)
  const dy = Math.round((alto - (y1 - y0)) / 2 - y0)
  return colocadas.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy }))
}

/**
 * items: [{clave, texto, n}] ordenados por n desc (como los devuelve frecuenciasNube).
 * Devuelve { paginas: [{ palabras: [{clave,texto,n,x,y,w,h,tamano,vertical,color}], desde, hasta }], total }.
 */
export function componerNube(items, ancho, alto, { medir = medirEstimado, tamanoMin = TAMANO_MIN_NUBE, tamanoMax = Math.floor(Math.min(ancho, alto) * 0.3), maxPorPagina = MAX_PALABRAS_PAGINA } = {}) {
  const lista = [...(items || [])]
  if (!lista.length || !(ancho > 0) || !(alto > 0)) return { paginas: [], total: 0 }
  const tmax = Math.max(tamanoMin, tamanoMax)
  const paginas = []
  let inicio = 0
  while (inicio < lista.length) {
    const resto = lista.slice(inicio, inicio + maxPorPagina)
    let m = resto.length
    let aceptada = null
    while (m >= 1 && !aceptada) {
      const grupo = resto.slice(0, m)
      const kMin = tamanoMin / Math.sqrt(grupo[grupo.length - 1].n)
      const area = cajasPara(grupo, kMin, tamanoMin, tmax, medir).reduce((a, c) => a + c.w * c.h, 0)
      if (area <= ancho * alto * 0.6) {
        const base = colocar(cajasPara(grupo, kMin, tamanoMin, tmax, medir), ancho, alto)
        if (base) aceptada = { grupo, kMin }
      }
      if (!aceptada) m = m > 4 ? m - Math.max(1, Math.floor(m * 0.1)) : m - 1
    }
    if (!aceptada) { // una sola palabra que no cabe ni al mínimo: se coloca igual (no se omite ni se encoge)
      const c = cajasPara([resto[0]], tamanoMin / Math.sqrt(resto[0].n), tamanoMin, tmax, medir)[0]
      paginas.push({ palabras: [{ ...c, x: Math.round((ancho - c.w) / 2), y: Math.round((alto - c.h) / 2), color: colorDe(c.clave, 0) }], desde: inicio, hasta: inicio + 1 })
      inicio += 1
      continue
    }
    const { grupo, kMin } = aceptada
    const kMax = Math.max(kMin, tmax / Math.sqrt(grupo[0].n))
    let lo = kMin
    let mejor = colocar(cajasPara(grupo, kMin, tamanoMin, tmax, medir), ancho, alto)
    let hi = kMax
    for (let i = 0; i < 9 && hi - lo > 0.01; i++) {
      const mid = (lo + hi) / 2
      const intento = colocar(cajasPara(grupo, mid, tamanoMin, tmax, medir), ancho, alto)
      if (intento) { lo = mid; mejor = intento } else hi = mid
    }
    paginas.push({
      palabras: centrar(mejor, ancho, alto).map((c) => ({ ...c, color: colorDe(c.clave, grupo.findIndex((g) => g.clave === c.clave)) })),
      desde: inicio, hasta: inicio + grupo.length,
    })
    inicio += grupo.length
  }
  return { paginas, total: lista.length }
}
