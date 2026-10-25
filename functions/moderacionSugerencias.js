// Moderación automática de «Sugerencia a Evalúa Fácil» (24-oct-2026, fase A
// autorizada por Kike): detector PROPIO, en el servidor, sin servicios
// externos. Vive solo en functions/ a propósito: la lista no viaja en el
// paquete de la app.
//
// Qué hace y qué NO hace:
//   · Busca groserías, insultos, amenazas y acoso. Si encuentra algo, la
//     sugerencia queda RETENIDA para que la revise una persona. No se borra,
//     no se bloquea y nadie es sancionado por una detección automática.
//   · Una crítica, aunque sea dura («pésimo», «injusto», «no sirve», «una
//     basura de app»), NO se retiene: esas palabras no están en las listas.
//   · Solo devuelve categorías (`motivos`), nunca las palabras halladas: el
//     texto ya está en el documento y no tiene por qué repetirse en logs.
//
// Para no marcar palabras inocentes:
//   · se compara por PALABRA COMPLETA («computadora» no es «puta», «disputa»
//     tampoco);
//   · las letras repetidas no se fusionan («pera» no es «perra»): cada letra
//     del término acepta repetirse («pendeeejo» sí cuenta);
//   · el lenguaje coloquial leve («pinche», «chafa», «chingón») no está en
//     las listas.
// Variantes que sí se reconocen: mayúsculas, acentos, números por letras
// (p3nd3j0), letras separadas (p.e.n.d.e.j.o, p e n d e j o) y un asterisco en
// lugar de una letra (p*ta).
//
// Si cambian las listas, sube VERSION: cada sugerencia guarda la versión que
// la revisó.

// 1: primera versión. 2 (24-oct-2026): amenazas dirigidas a una persona,
// expresiones figuradas fuera, críticas a la plataforma fuera, ñ en patrones.
const VERSION = 2

// Términos de una palabra. Cada uno con sus terminaciones posibles.
const INSULTOS = [
  'pendej(o|a|os|as|ada|adas|eja|ejo)',
  'idiotas?',
  'imbecil(es)?',
  'estupid(o|a|os|as|ez)',
  'tarad(o|a|os|as)',
  'cabron(a|es|as|azo)?',
  'culer(o|a|os|as)',
  'mamon(a|es|as)?',
  'nac(o|a|os|as)',
  'zorr(a|as)',
  'perr(a|as)',
  'baboso|babosa|babosos|babosas',
  'mens(o|a|os|as)',
  'hdp',
]
const GROSERIAS = [
  'put(o|a|os|as)',
  'putisima|putisimo',
  'verg(a|as|azo)',
  'chingad(o|a|os|as|era|eras)',
  'chinga(r|s|n|ste|ron|tumadre)?',
  'ching(o|ue|uen)',
  'mamad(a|as)',
  'cog(er|e|es|iste|io)',
  'culo',
  'ptm',
  'alv',
  'mierda(s)?',
]
const ACOSO_PALABRAS = [
  'maricon(es)?',
  'jot(o|os)',
  'nalg(a|as)',
  'tet(a|as)',
]

// Amenazas (versión 2, 24-oct-2026). Regla general: una amenaza apunta a una
// PERSONA. «Me voy a matar estudiando», «matar el tiempo», «matar el
// proceso» o «golpear el teclado» no la tienen y no se retienen; «te voy a
// matar», «voy a matar al maestro» o «voy a matarte» sí. Ninguna lista
// reconoce todas las amenazas posibles: lo implícito o muy creativo puede
// pasar, y por eso todo queda además a la vista del admin en el panel.
// Ojo: el texto normalizado conserva la ñ (apuñalar, daño, compañero).
const VIOLENTOS = 'matar|golpear|madrear|violar|apuñalar|acuchillar|balear|balacear|disparar|desaparecer|ahorcar|lastimar'
const ARTICULO = '(el|la|los|las|un|una|unos|unas)'
const FIN = '(?=\\s*(?:[.!?,;]|$))'
const PERSONAS = '(maestr[oa]s?|profes?|profa|profesor(a|es|as)?|director(a|es)?|compañer[oa]s?|todos|todas)'

const FRASES = [
  // «te/lo/la/los/las/le/les voy a matar…»: el pronombre es la persona.
  { motivo: 'amenaza', re: new RegExp(`\\b(te|lo|la|los|las|le|les)\\s+(voy|vamos|van|va)\\s+a\\s+(${VIOLENTOS})\\b`) },
  // «te/le/les voy a pegar/partir/romper/quemar», salvo que siga una cosa
  // («te voy a pegar el link», «les voy a quemar un disco»).
  { motivo: 'amenaza', re: new RegExp(`\\b(te|le|les)\\s+(voy|vamos|van|va)\\s+a\\s+(pegar|partir|romper|quemar)\\b(?!\\s+${ARTICULO}\\b)`) },
  // …salvo que esa «cosa» sea la cara, la madre, los dientes: eso sí es amenaza.
  { motivo: 'amenaza', re: /\b((te|le|les)\s+(voy|vamos|van|va)\s+a\s+(partir|romper|reventar|quemar)|(voy|vamos|van)\s+a\s+(partir|romper|reventar)(te|le|les))\s+(toda\s+)?(la\s+(madre|cara|boca|jeta|cabeza|nariz|espalda)|el\s+(hocico|osico)|los\s+dientes)\b/ },
  { motivo: 'amenaza', re: /\b(te|le|les)\s+(voy|vamos)\s+a\s+hacer\s+daño\b/ },
  // «voy a matarte», «vamos a golpearlos».
  { motivo: 'amenaza', re: new RegExp(`\\b(voy|vamos|van)\\s+a\\s+(${VIOLENTOS})(te|los|las|les)\\b`) },
  // «voy a matar al maestro», «voy a matar a todos»: «a/al» + alguien.
  { motivo: 'amenaza', re: new RegExp(`\\b(voy|vamos|van)\\s+a\\s+(${VIOLENTOS})\\s+(al\\b|a\\s+(alguien|todos|todas|ese|esa|esos|esas|mi|mis|tu|tus|su|sus|la\\s+${PERSONAS}|los\\s+${PERSONAS})\\b)`) },
  { motivo: 'amenaza', re: /\bte\s+vas\s+a\s+morir\b|\bse\s+van\s+a\s+morir\s+todos\b/ },
  // «ojalá te mueras» sí; «ojalá se muera esta app» no; «ojalá se muera el maestro» sí.
  { motivo: 'amenaza', re: /\bojala\s+te\s+mueras\b/ },
  { motivo: 'amenaza', re: new RegExp(`\\bojala\\s+se\\s+muer(a|an)\\s+(el|la|los|las|ese|esa|esos|esas|mi|tu|su)?\\s*${PERSONAS}\\b`) },
  { motivo: 'amenaza', re: /\bse\s+donde\s+vives\b/ },
  // «te va a ir (muy) mal» solo al cerrar la frase o con remate de amenaza;
  // «te va a ir mal en el examen» no.
  { motivo: 'amenaza', re: new RegExp(`\\bte\\s+va\\s+a\\s+ir\\s+(muy\\s+)?mal(${FIN}|\\s+conmigo\\b|\\s+a\\s+la\\s+salida\\b|\\s+cuando\\s+te\\s+(vea|agarre)\\b)`) },
  // Esperar a alguien a la salida o afuera.
  { motivo: 'amenaza', re: /\bte\s+(espero|esperamos|voy\s+a\s+esperar|vamos\s+a\s+esperar)\s+(a\s+la\s+salida|afuera)\b/ },
  { motivo: 'amenaza', re: /\b(vas|van)\s+a\s+ver\s+(lo\s+que\s+(te|les)\s+(pasa|va\s+a\s+pasar)|quien\s+soy)\b/ },
  // «se van a arrepentir» sí; «no se van a arrepentir de usarla» no.
  { motivo: 'amenaza', re: /(?<!\bno\s)\b(te\s+vas|se\s+van|se\s+va)\s+a\s+arrepentir\b/ },
  { motivo: 'amenaza', re: /\b(voy|vamos|van)\s+a\s+(quemar|incendiar|balacear|volar)\s+(la\s+escuela|el\s+plantel|el\s+salon|la\s+casa|el\s+laboratorio|la\s+direccion)\b/ },
  // Buscar o encontrar a alguien: «te voy a buscar la información» no.
  { motivo: 'amenaza', re: new RegExp(`\\bte\\s+(voy|vamos)\\s+a\\s+(encontrar|cazar)\\b(?!\\s+${ARTICULO}\\b)`) },
  { motivo: 'amenaza', re: new RegExp(`\\bte\\s+(voy|vamos)\\s+a\\s+buscar(${FIN}|\\s+(a\\s+la\\s+salida|afuera|en\\s+tu\\s+casa)\\b)`) },
  { motivo: 'amenaza', re: /\bcuidate\s+(porque|que)\s+(te|va|vas|voy|vamos)\b/ },
  { motivo: 'amenaza', re: /\b(llevar|traer|traigo|llevo|voy\s+a\s+llevar|voy\s+a\s+traer)\s+(un|una)?\s*(arma|pistola|cuchillo|navaja)\b/ },
  { motivo: 'amenaza', re: /\b(poner|pongo|ponga|voy\s+a\s+poner)\s+una\s+bomba\b|\bbomba\s+en\s+la\s+escuela\b/ },
  { motivo: 'amenaza', re: /\bbalacera\b/ },
  // Insultos de varias palabras
  { motivo: 'insulto', re: /\bhij[oa]s?\s+de\s+(tu\s+)?(puta|perra)\b/ },
  { motivo: 'insulto', re: /\b(chinga|chingue|chinguen)\s+(a\s+)?(tu|su)\s+madre\b/ },
  { motivo: 'groseria', re: /\b(puta|pinche)\s+madre\b/ },
  // Acoso
  { motivo: 'acoso', re: /\b(mandame|manda|pasame|pasa)\s+(tu\s+)?(pack|fotos?\s+(desnud|sin\s+ropa))/ },
  { motivo: 'acoso', re: /\bestas\s+(bien\s+|muy\s+)?buen[oa]\b/ },
  { motivo: 'acoso', re: /\bte\s+quiero\s+(coger|tocar|besar)\b/ },
]

const SUSTITUCIONES = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' }

// Texto comparable: minúsculas, sin acentos (la ñ se conserva), números y
// símbolos usados como letras, y letras sueltas separadas vueltas a unir.
function normalizar(texto) {
  let t = String(texto || '')
    .toLowerCase()
    // La ñ se aparta con un carácter de uso privado para que NFD no le quite
    // la tilde junto con los acentos, y luego se devuelve.
    .replace(/ñ/g, '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(//g, 'ñ')
    .replace(/[013457@$]/g, (c) => SUSTITUCIONES[c])
  // «p.e.n.d.e.j.o», «p e n d e j o», «p-u-t-a»: cuatro o más letras sueltas.
  t = t.replace(/(?:\b[a-zñ*][\s.\-_,]+){3,}[a-zñ*]\b/g, (m) => m.replace(/[^a-zñ*]/g, ''))
  return t
}

// Regex de un término que acepta letras repetidas y un «*» por letra.
function patronFlexible(fuente) {
  let out = ''
  for (let i = 0; i < fuente.length; i++) {
    const c = fuente[i]
    if (/[a-zñ]/.test(c)) {
      const sigueModificador = /[?*+{]/.test(fuente[i + 1] || '')
      out += sigueModificador ? `(?:${c}|\\*)` : `(?:${c}|\\*)+`
    } else {
      out += c
    }
  }
  return out
}

function compilar(lista, motivo) {
  return lista.map((t) => ({ motivo, re: new RegExp(`(?<![a-zñ*])(?:${patronFlexible(t)})(?![a-zñ*])`) }))
}

const PALABRAS = [
  ...compilar(INSULTOS, 'insulto'),
  ...compilar(GROSERIAS, 'groseria'),
  ...compilar(ACOSO_PALABRAS, 'acoso'),
]

// { estado: 'limpia' | 'retenida', motivos: [...], version }
// Crítica a la PLATAFORMA con un adjetivo de insulto («esta app es estúpida»,
// «qué plataforma tan idiota», «es estúpido que no se pueda…»): es una crítica,
// no un insulto a una persona. Esas apariciones se quitan antes de buscar
// insultos. Lo dicho de una persona («el que hizo esta app es un idiota»,
// «el profe es un estúpido») sigue contando, y las groserías («el sistema es
// una mierda») también: no son adjetivos de esta lista.
const COSAS = '(app|aplicacion|plataforma|pagina|sistema|boton|programa|opcion|diseño|funcion|herramienta|version|actualizacion|pantalla|menu|formato|evalua\\s+facil|evaluafacil)'
const ADJETIVOS_CRITICA = '(estupid[oa]s?|idiotas?|pendej[oa]s?|tont[oa]s?|mens[oa]s?|tarad[oa]s?)'
const INTENSIDAD = '((muy|bien|bastante|super|demasiado)\\s+)?'
const CRITICAS_A_COSAS = [
  new RegExp(`\\b${COSAS}\\s+(es|esta|son|estan)\\s+${INTENSIDAD}${ADJETIVOS_CRITICA}\\b`, 'g'),
  new RegExp(`\\b${COSAS}\\s+tan\\s+${ADJETIVOS_CRITICA}\\b`, 'g'),
  new RegExp(`\\bes\\s+${INTENSIDAD}${ADJETIVOS_CRITICA}\\s+que\\b`, 'g'),
]
function sinCriticasACosas(t) {
  return CRITICAS_A_COSAS.reduce((acc, re) => acc.replace(re, ' ~ '), t)
}

function evaluarTexto(texto) {
  const t = normalizar(texto)
  const motivos = new Set()
  for (const { motivo, re } of FRASES) if (re.test(t)) motivos.add(motivo)
  const paraPalabras = sinCriticasACosas(t)
  for (const { motivo, re } of PALABRAS) if (re.test(paraPalabras)) motivos.add(motivo)
  const orden = ['amenaza', 'acoso', 'insulto', 'groseria']
  const lista = orden.filter((m) => motivos.has(m))
  return { estado: lista.length ? 'retenida' : 'limpia', motivos: lista, version: VERSION }
}

module.exports = { evaluarTexto, normalizar, VERSION }
