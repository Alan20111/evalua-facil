// Reparto de anchos de columna. Vive aparte del hook (sin React) para poder
// probarse solo: es pura aritmética con dos invariantes que deben cumplirse
// SIEMPRE, porque de ellos depende que no se salgan columnas del área:
//
//   1. La suma de los anchos es EXACTAMENTE el ancho disponible.
//   2. Ninguna columna baja de MIN_PX.
//
// El intento ingenuo —multiplicar la proporción por el ancho y aplicar
// Math.max(MIN, …) a cada columna— rompe el invariante 1 en cuanto el área se
// angosta: cada columna elevada al mínimo suma ancho de más y el total se
// pasa. Por eso el reparto se hace fijando primero las que no caben y
// redistribuyendo el resto entre las demás, hasta que ninguna quede por
// debajo del mínimo.
export const MIN_PX = 60

export function repartirAnchos(keys, fracs, defaults, available) {
  if (keys.length === 0) return {}
  const frac = (k) => fracs[k] ?? defaults[k] ?? 0

  // Fase 1: fijar al mínimo las columnas que no alcanzan, y repetir — fijar
  // una reduce el espacio de las demás y puede dejar a otra por debajo.
  const fijas = new Set()
  let libres = [...keys]
  for (;;) {
    const espacio = available - fijas.size * MIN_PX
    const sumaFrac = libres.reduce((a, k) => a + frac(k), 0)
    const nuevas = sumaFrac > 0
      ? libres.filter((k) => (frac(k) / sumaFrac) * espacio < MIN_PX)
      : [...libres]
    if (nuevas.length === 0) break
    nuevas.forEach((k) => fijas.add(k))
    libres = libres.filter((k) => !fijas.has(k))
    if (libres.length === 0) break
  }

  // Fase 2: repartir el espacio restante entre las libres, en proporción.
  const espacio = available - fijas.size * MIN_PX
  const sumaFrac = libres.reduce((a, k) => a + frac(k), 0)
  const px = {}
  keys.forEach((k) => { px[k] = MIN_PX })
  libres.forEach((k) => {
    px[k] = sumaFrac > 0
      ? Math.round((frac(k) / sumaFrac) * espacio)
      : Math.round(espacio / libres.length)
  })

  // Fase 3: el redondeo deja una diferencia de 1-2 px; se le carga a la
  // columna libre más ancha (la que menos lo nota) para que la suma cuadre al
  // píxel. Sin esto aparece una franja vacía o un scroll de un par de píxeles.
  const diff = available - keys.reduce((a, k) => a + px[k], 0)
  if (diff !== 0) {
    const destino = libres.length
      ? libres.reduce((mejor, k) => (px[k] > px[mejor] ? k : mejor), libres[0])
      : keys[keys.length - 1]
    px[destino] = Math.max(MIN_PX, px[destino] + diff)
  }
  return px
}
