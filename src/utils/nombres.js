// Cómo se ven los nombres de las personas en pantalla.
//
// Las listas de la SEP llegan en MAYÚSCULAS y las capturas a mano a veces en
// minúsculas, así que un mismo grupo se leía "GARCÍA LÓPEZ JUAN" junto a
// "hernandez maría". Eso se corrige al MOSTRAR, sin tocar lo que hay guardado.
//
// Pero la corrección NO se le impone a quien sí escribió con cuidado: decisión
// de Kike (2026-08-05) — el nombre se ve como el docente lo escribió, ya sea
// en el Excel, al agregarlo a mano o al editarlo. Por eso un texto que ya trae
// MEZCLA de mayúsculas y minúsculas se respeta tal cual: esa mezcla solo puede
// venir de alguien que la tecleó a propósito ("de la Cruz", "McDonald",
// "O'Higgins"). Solo se endereza lo que no trae ninguna intención: todo en
// mayúsculas o todo en minúsculas.
//
// El username NO pasa por aquí: es un identificador (garcia.juan), va siempre
// en minúsculas y compararlo es lo que sostiene la cuenta del estudiante.
export function capitalizarNombre(texto) {
  const limpio = String(texto ?? '').trim().replace(/\s+/g, ' ')
  if (!limpio) return ''
  // ¿Trae mayúsculas Y minúsculas? Entonces alguien decidió cómo se escribe.
  if (/\p{Lu}/u.test(limpio) && /\p{Ll}/u.test(limpio)) return limpio
  return limpio
    .toLocaleLowerCase('es')
    // Después de un espacio, un guion o un apóstrofo empieza otra palabra del
    // nombre: "ANA-MARÍA" → "Ana-María", "D'ANGELO" → "D'Angelo".
    .replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase('es'))
}

// Para BUSCAR, no para mostrar: "maría" y "maria" tienen que ser la misma
// palabra, igual que "Núñez" y "nunez" — nadie escribe acentos en un buscador.
export function sinAcentos(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}
