// Validación de código postal mexicano sin catálogo.
//
// El catálogo completo de SEPOMEX son ~145 mil registros (varios MB): pesa
// demasiado para una app que también corre en celular y solo lo necesitaríamos
// si quisiéramos autocompletar colonia/municipio. Para lo que sí hace falta
// —que el docente no invente el dato— basta con los rangos oficiales por
// estado: un CP de 5 dígitos que no cae en ninguno de estos rangos no existe
// en México.
const RANGOS = [
  [1000, 16999, 'Ciudad de México'],
  [20000, 20999, 'Aguascalientes'],
  [21000, 22999, 'Baja California'],
  [23000, 23999, 'Baja California Sur'],
  [24000, 24999, 'Campeche'],
  [25000, 27999, 'Coahuila'],
  [28000, 28999, 'Colima'],
  [29000, 30999, 'Chiapas'],
  [31000, 33999, 'Chihuahua'],
  [34000, 35999, 'Durango'],
  [36000, 38999, 'Guanajuato'],
  [39000, 41999, 'Guerrero'],
  [42000, 43999, 'Hidalgo'],
  [44000, 49999, 'Jalisco'],
  [50000, 57999, 'Estado de México'],
  [58000, 61999, 'Michoacán'],
  [62000, 62999, 'Morelos'],
  [63000, 63999, 'Nayarit'],
  [64000, 67999, 'Nuevo León'],
  [68000, 71999, 'Oaxaca'],
  [72000, 75999, 'Puebla'],
  [76000, 76999, 'Querétaro'],
  [77000, 77999, 'Quintana Roo'],
  [78000, 79999, 'San Luis Potosí'],
  [80000, 82999, 'Sinaloa'],
  [83000, 85999, 'Sonora'],
  [86000, 86999, 'Tabasco'],
  [87000, 89999, 'Tamaulipas'],
  [90000, 90999, 'Tlaxcala'],
  [91000, 96999, 'Veracruz'],
  [97000, 97999, 'Yucatán'],
  [98000, 99999, 'Zacatecas'],
]

// Deja solo dígitos y corta a 5 — para usarse en onChange, así el campo nunca
// llega a tener basura que después haya que explicar.
export function soloDigitosCP(valor) {
  return String(valor || '').replace(/\D/g, '').slice(0, 5)
}

// Estado al que pertenece el CP, o null si no es un CP mexicano válido.
// Se muestra debajo del campo como confirmación de que se escribió bien.
export function estadoPorCodigoPostal(cp) {
  const limpio = soloDigitosCP(cp)
  if (limpio.length !== 5) return null
  const n = Number(limpio)
  const rango = RANGOS.find(([min, max]) => n >= min && n <= max)
  return rango ? rango[2] : null
}

// null = válido. Si no, el mensaje que se le muestra al docente.
export function errorCodigoPostal(cp) {
  const limpio = soloDigitosCP(cp)
  if (!limpio) return 'Escribe tu código postal'
  if (limpio.length !== 5) return 'El código postal tiene 5 dígitos'
  if (!estadoPorCodigoPostal(limpio)) return 'Ese código postal no corresponde a ningún estado de México'
  return null
}
