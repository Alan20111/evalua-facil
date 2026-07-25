// Códigos postales de México.
//
// Los datos salen del Catálogo Nacional de Códigos Postales de Correos de
// México (CPdescarga.xls, versión del 23/07/2026). El original pesa 72 MB
// porque trae cada colonia; de ahí solo se conserva lo que la app necesita
// —estado, municipio y ciudad de cada CP— y queda en 0.51 MB repartido en 96
// archivos por prefijo de 2 dígitos (~5.5 KB cada uno) bajo /public/cp/.
// Así, escribir un CP descarga un solo fragmento pequeño, no el catálogo.
//
// Ver scripts/extraer-cp.js para regenerarlos cuando Correos publique una
// versión nueva.

// Prefijo de 2 dígitos → estado. Se verificó contra el catálogo completo que
// ningún prefijo cruza dos estados, así que esta tabla es exacta; los nombres
// son literalmente los del catálogo ("México", no "Estado de México") para
// que el texto no cambie cuando llega el dato bueno. Vive en el bundle: deja
// ver el estado en cuanto se escribe el quinto dígito, sin esperar descarga.
// Los prefijos 17, 18 y 19 no existen — ningún estado los usa.
const RANGOS = [
  [1, 16, 'Ciudad de México'],
  [20, 20, 'Aguascalientes'],
  [21, 22, 'Baja California'],
  [23, 23, 'Baja California Sur'],
  [24, 24, 'Campeche'],
  [25, 27, 'Coahuila de Zaragoza'],
  [28, 28, 'Colima'],
  [29, 30, 'Chiapas'],
  [31, 33, 'Chihuahua'],
  [34, 35, 'Durango'],
  [36, 38, 'Guanajuato'],
  [39, 41, 'Guerrero'],
  [42, 43, 'Hidalgo'],
  [44, 49, 'Jalisco'],
  [50, 57, 'México'],
  [58, 61, 'Michoacán de Ocampo'],
  [62, 62, 'Morelos'],
  [63, 63, 'Nayarit'],
  [64, 67, 'Nuevo León'],
  [68, 71, 'Oaxaca'],
  [72, 75, 'Puebla'],
  [76, 76, 'Querétaro'],
  [77, 77, 'Quintana Roo'],
  [78, 79, 'San Luis Potosí'],
  [80, 82, 'Sinaloa'],
  [83, 85, 'Sonora'],
  [86, 86, 'Tabasco'],
  [87, 89, 'Tamaulipas'],
  [90, 90, 'Tlaxcala'],
  [91, 96, 'Veracruz de Ignacio de la Llave'],
  [97, 97, 'Yucatán'],
  [98, 99, 'Zacatecas'],
]

// Deja solo dígitos y corta a 5 — para usarse en onChange, así el campo nunca
// llega a tener basura que después haya que explicar.
export function soloDigitosCP(valor) {
  return String(valor || '').replace(/\D/g, '').slice(0, 5)
}

// Estado al que pertenece el CP según su prefijo, sin descargar nada.
// null si el prefijo no está asignado a ningún estado (17, 18 y 19 no existen).
export function estadoPorCodigoPostal(cp) {
  const limpio = soloDigitosCP(cp)
  if (limpio.length !== 5) return null
  const prefijo = Number(limpio.slice(0, 2))
  const rango = RANGOS.find(([min, max]) => prefijo >= min && prefijo <= max)
  return rango ? rango[2] : null
}

// Fragmentos ya descargados, por prefijo. Se quedan en memoria: el docente
// suele escribir su CP más de una vez (se equivoca, corrige, vuelve al perfil).
const fragmentos = new Map()

function cargarFragmento(prefijo) {
  if (!fragmentos.has(prefijo)) {
    fragmentos.set(
      prefijo,
      fetch(`/cp/${prefijo}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    )
  }
  return fragmentos.get(prefijo)
}

// Busca el CP en el catálogo. Devuelve { codigoPostal, estado, municipio,
// ciudad } o null si el CP no existe.
//
// Muchos CP rurales no traen ciudad: en esos casos `ciudad` viene vacía y el
// municipio es la población — por eso `ubicacionTexto()` de abajo elige cuál
// mostrar en vez de asumir que siempre hay ciudad.
export async function buscarCodigoPostal(cp) {
  const limpio = soloDigitosCP(cp)
  if (limpio.length !== 5) return null
  const datos = await cargarFragmento(limpio.slice(0, 2))
  const entrada = datos?.cp?.[limpio]
  if (!entrada) return null
  const [iMunicipio, iCiudad] = entrada
  return {
    codigoPostal: limpio,
    estado: datos.e,
    municipio: datos.m[iMunicipio] || '',
    ciudad: iCiudad >= 0 ? datos.c[iCiudad] || '' : '',
  }
}

// Cómo se le enseña la ubicación al docente: "Celaya, Guanajuato".
//
// Se muestra población y estado, nada más — el municipio solo aparece si la
// población se llama igual que el estado, que es el caso de la Ciudad de
// México: ahí la ciudad y el estado son "Ciudad de México" y lo que ubica de
// verdad es la alcaldía ("Álvaro Obregón, Ciudad de México"). Si el CP no
// trae ciudad —dos de cada tres son rurales— el municipio es la población.
export function ubicacionTexto(ubicacion) {
  if (!ubicacion) return ''
  const { estado, municipio, ciudad } = ubicacion
  let poblacion = ciudad || municipio
  if (poblacion === estado) poblacion = municipio !== estado ? municipio : ''
  return [poblacion, estado].filter(Boolean).join(', ')
}

// null = válido. Si no, el mensaje que se le muestra al docente.
// `ubicacion` es lo que devolvió buscarCodigoPostal() para ese mismo CP.
export function errorCodigoPostal(cp, ubicacion) {
  const limpio = soloDigitosCP(cp)
  if (!limpio) return 'Escribe tu código postal'
  if (limpio.length !== 5) return 'El código postal tiene 5 dígitos'
  if (!ubicacion) return 'Ese código postal no existe — revísalo'
  return null
}
