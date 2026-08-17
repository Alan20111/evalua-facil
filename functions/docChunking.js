// Fragmentación de texto largo SIN pérdida de contenido (17-ago-2026).
//
// Existe para el caso extremo en el que un documento fuente completo (ver
// docExtract.js, que ya no trunca nada) es demasiado grande para caber en
// una sola llamada al modelo junto con el resto del prompt. La respuesta
// NUNCA es descartar la parte que no cabe — es partir el texto en
// fragmentos que sí quepan, procesarlos TODOS, y consolidar. Ver
// functions/ia.js (extraerTemasDeDocumentoGrande) para cómo se usa esto en
// Planeación Inicial.
//
// Pura, sin dependencias — cero I/O, cero llamadas a IA. Solo corta texto.

/**
 * Divide `texto` en fragmentos de a lo más `maxCharsPorFragmento` caracteres
 * cada uno, respetando límites de párrafo (doble salto de línea) cuando es
 * posible, para no partir una unidad de contenido (un tema, una sesión, un
 * apartado) a la mitad si el propio documento ya la separaba con un
 * párrafo en blanco.
 *
 * GARANTÍA: la concatenación de todos los fragmentos reproduce el texto
 * original completo — ningún carácter se descarta. No hay tope al número
 * de fragmentos que se generan: un documento más grande simplemente
 * produce más fragmentos.
 */
function dividirEnFragmentos(texto, maxCharsPorFragmento) {
  const t = String(texto || '')
  if (!t) return []
  if (t.length <= maxCharsPorFragmento) return [t]

  // Párrafos == bloques separados por una o más líneas en blanco. Se
  // conserva el separador original entre ellos (no se normaliza) para que
  // unir los fragmentos reconstruya el texto tal cual.
  const partes = t.split(/(\n{2,})/)
  // `partes` alterna texto/separador: [parrafo1, sep1, parrafo2, sep2, ...]

  const fragmentos = []
  let actual = ''

  const cerrarFragmentoActual = () => {
    if (actual) fragmentos.push(actual)
    actual = ''
  }

  for (const parte of partes) {
    if (!parte) continue
    if ((actual + parte).length <= maxCharsPorFragmento) {
      actual += parte
      continue
    }
    // Este pedazo no cabe junto con lo acumulado — cierra el fragmento
    // actual y empieza uno nuevo con este pedazo.
    cerrarFragmentoActual()
    if (parte.length <= maxCharsPorFragmento) {
      actual = parte
    } else {
      // Un solo "párrafo" (o el texto entero, si el documento no tiene
      // separaciones dobles) sigue siendo más grande que el límite — no
      // hay una frontera de párrafo que respetar, así que se corta por
      // caracteres para no perder contenido (el resto SIGUE
      // procesándose, en más fragmentos, nunca se descarta).
      for (let i = 0; i < parte.length; i += maxCharsPorFragmento) {
        fragmentos.push(parte.slice(i, i + maxCharsPorFragmento))
      }
    }
  }
  cerrarFragmentoActual()

  return fragmentos
}

module.exports = { dividirEnFragmentos }
