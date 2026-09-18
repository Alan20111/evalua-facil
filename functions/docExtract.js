// Extracción de texto de documentos de referencia (OP-03/OP-04, 11-ago-2026).
//
// El docente puede adjuntar hasta 3 PDF/Word como fuente del contenido de un
// examen o cuestionario generado con IA. Este módulo SOLO extrae texto plano
// desde una URL de Cloudinary — no interpreta, no resume, no decide nada
// pedagógico.
//
// REGLA DE ORO (Kike, 17-ago-2026): el tamaño del documento fuente nunca
// debe provocar pérdida silenciosa de contenido. Este módulo devuelve el
// texto COMPLETO extraído del documento — nunca lo trunca (antes lo hacía,
// primero a 12000 caracteres y luego a 40000; ambos eran la misma causa
// raíz con otro número, y "otro límite arbitrario" seguía siendo la
// respuesta equivocada). Si un consumidor necesita acotar cuánto de ese
// texto manda en un solo prompt, esa es una decisión SUYA (ver
// functions/docChunking.js para fragmentar sin perder contenido cuando el
// texto es demasiado grande para una sola llamada) — no de esta función.

function extension(url) {
  const limpio = String(url || '').split('?')[0]
  const m = /\.([a-z0-9]+)$/i.exec(limpio)
  return m ? m[1].toLowerCase() : ''
}

// Umbral de caracteres POR PÁGINA por debajo del cual damos por hecho que lo
// que de verdad dice la página está en la imagen, no en la capa de texto
// (3-sep-2026). No es un número inventado: medido contra los documentos
// reales del proyecto, un PDF de texto rinde >1,000 caracteres por página
// (los manuales de Matemáticas dan 1,200-1,400) y una infografía exportada
// como imagen rinde 0. El hueco entre ambos mundos es enorme; 200 cae
// holgadamente dentro de él y deja del lado "visual" también a los PDF que
// solo traen un encabezado suelto de texto sobre páginas escaneadas.
const MIN_CHARS_POR_PAGINA_TEXTO = 200

/**
 * La regla de decisión, aislada y PURA para poder probarla sin red: dado el
 * texto extraído y el número de páginas, ¿este PDF se lee como texto o hay
 * que mirarlo? Separada de la descarga a propósito — es la línea que antes
 * no existía y que hacía pasar por "inválido" a un documento bueno.
 */
function tipoPorDensidad(texto, paginas) {
  const t = String(texto || '').trim()
  if (!paginas || paginas < 1) return 'invalido'
  if (t.length / paginas >= MIN_CHARS_POR_PAGINA_TEXTO) return 'texto'
  return t ? 'mixto' : 'visual'
}

// ── ¿Un PDF sin texto tiene algo que mirar, o está en blanco? (17-sep-2026) ──
//
// Un PDF sin capa de texto NO está vacío por eso (Windows.pdf: 14 páginas de
// infografía, 0 caracteres). Pero un PDF de páginas en blanco tampoco tiene
// texto, y hasta hoy se mandaba igual a análisis visual: la operación cobraba
// y el modelo recibía hojas vacías. Aquí se distinguen los dos casos SIN IA,
// sin OCR y sin costo, con dos preguntas en orden de costo creciente:
//
//   1. ¿Trae imágenes incrustadas? Toda imagen de un PDF es un stream con
//      `/Subtype /Image` en su diccionario, y los streams nunca van dentro de
//      un object stream comprimido — así que ese texto siempre está en claro,
//      aun en PDF cifrados (el cifrado no toca los nombres del diccionario).
//      Un escaneo o una infografía responden aquí, sin abrir ninguna página.
//   2. Si no, ¿alguna página pinta algo? pdf.js (el mismo que ya trae
//      pdf-parse) arma la lista de operadores de cada página y se buscan los
//      que de verdad dejan tinta: trazos y rellenos vectoriales (diagramas,
//      texto convertido a curvas), glifos sin mapa de caracteres, imágenes en
//      línea. Solo corre con PDF sin texto y sin imágenes, que son pequeños.
const OPERADORES_VISIBLES = [
  'stroke', 'closeStroke', 'fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke',
  'closeEOFillStroke', 'shadingFill', 'showText', 'showSpacedText', 'nextLineShowText',
  'nextLineSetSpacingShowText', 'paintJpegXObject', 'paintImageMaskXObject',
  'paintImageMaskXObjectGroup', 'paintImageXObject', 'paintInlineImageXObject',
  'paintInlineImageXObjectGroup', 'paintImageXObjectRepeat', 'paintImageMaskXObjectRepeat',
  'paintSolidColorImageMask',
]
// Si pdf.js no contesta en este tiempo, se asume que SÍ hay contenido: ante
// la duda se prefiere mandarlo a mirar antes que rechazar un documento bueno.
const MS_MAX_REVISION_VISUAL = 15000

function tieneImagenesIncrustadas(bytes) {
  return /\/Subtype\s*\/Image\b/.test(Buffer.from(bytes).toString('latin1'))
}

/** Pura: ¿alguno de estos códigos de operador de pdf.js deja algo visible? */
function hayOperadorVisible(fnArray, OPS) {
  const visibles = new Set(OPERADORES_VISIBLES.map((n) => OPS?.[n]).filter((v) => v !== undefined))
  return (fnArray || []).some((f) => visibles.has(f))
}

// pdf-parse usa pdf.js 1.10 en modo "sin worker". Si una página usa una
// fuente, pdf.js intenta registrarla en el DOM (document.createElement) y en
// Node eso tumba el proceso entero — no es un error atrapable. Con
// disableFontFace la fuente se lee pero no se registra. Leer el texto nunca
// registra fuentes, así que para el resto de los usos de pdf-parse no cambia
// nada.
function pdfjsSinFuentesDom() {
  const pdfjs = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js')
  pdfjs.disableFontFace = true
  if (globalThis.PDFJS) globalThis.PDFJS.disableFontFace = true
  return pdfjs
}

async function hayTrazosVisibles(bytes) {
  const pdfjs = pdfjsSinFuentesDom()
  const pdfParse = require('pdf-parse')
  let visible = false
  const revision = pdfParse(new Uint8Array(bytes), {
    pagerender: async (pagina) => {
      if (!visible) visible = hayOperadorVisible((await pagina.getOperatorList()).fnArray, pdfjs.OPS)
      return ''
    },
  }).then(() => visible)
  const limite = new Promise((resolve) => setTimeout(() => resolve(true), MS_MAX_REVISION_VISUAL).unref?.())
  return Promise.race([revision, limite]).catch(() => true)
}

/** ¿Este PDF (sin texto extraíble) tiene algo que se pueda ver? */
async function tieneContenidoVisible(bytes) {
  if (tieneImagenesIncrustadas(bytes)) return true
  return hayTrazosVisibles(bytes)
}

/**
 * Clasifica un documento SIN emitir juicios de validez (3-sep-2026).
 *
 * Existe porque `extraerTextoDocumento` mezcla dos preguntas distintas —
 * "¿qué contiene?" y "¿sirve?" — y por eso trataba como INVÁLIDO un PDF
 * perfectamente bueno cuyo contenido vive dentro de imágenes (escaneos,
 * infografías, diagramas, capturas). Un PDF sin capa de texto no está roto:
 * simplemente hay que leerlo con visión en vez de con un extractor.
 *
 * Devuelve `{ tipo, texto, paginas, motivo }` con `tipo`:
 *   · 'texto'        — capa de texto suficiente; se usa el camino barato de siempre.
 *   · 'visual'       — PDF válido, CERO texto extraíble (escaneo/imágenes puras).
 *   · 'mixto'        — PDF válido con algo de texto, pero tan poco por página que
 *                      el contenido real está en las imágenes.
 *   · 'vacio'        — PDF válido pero en blanco: ni texto ni nada visible
 *                      (17-sep-2026). Mandarlo a mirar sería cobrar por hojas vacías.
 *   · 'invalido'     — ni siquiera se puede abrir/paginar: archivo dañado.
 *   · 'no_soportado' — formato que no sabemos leer (.doc antiguo y demás).
 *
 * Nunca lanza por "no tiene texto" — esa decisión es de quien consume.
 * Sí lanza si no se pudo descargar, porque eso no es una propiedad del
 * documento sino un fallo de red que conviene reportar tal cual.
 */
async function clasificarDocumento(url) {
  const ext = extension(url)
  if (ext !== 'pdf' && ext !== 'docx') return clasificarBytes(ext, null)

  let res
  try {
    res = await fetch(url)
  } catch {
    throw new Error(`No se pudo descargar el documento: ${url}`)
  }
  if (!res.ok) throw new Error(`No se pudo descargar el documento (HTTP ${res.status}): ${url}`)
  return clasificarBytes(ext, await res.arrayBuffer())
}

/**
 * La clasificación en sí, sobre los bytes ya descargados — separada de la
 * descarga para poder probarla con PDF reales sin red.
 */
async function clasificarBytes(ext, arrayBuffer) {
  if (ext !== 'pdf' && ext !== 'docx') {
    return {
      tipo: 'no_soportado',
      texto: '',
      paginas: 0,
      motivo: ext === 'doc'
        ? 'Es un Word antiguo (.doc): conviértelo a .docx o PDF.'
        : `No podemos leer archivos .${ext || '?'}: usa PDF o Word (.docx).`,
    }
  }

  if (ext === 'docx') {
    const mammoth = require('mammoth')
    const datos = await mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer) }).catch(() => null)
    const texto = (datos?.value || '').trim()
    if (!texto) {
      return { tipo: 'invalido', texto: '', paginas: 0, motivo: 'El documento Word no se pudo leer o está vacío.' }
    }
    // Word no tiene "páginas" que podamos contar sin renderizar, y Claude no
    // tiene bloque nativo para .docx — siempre es camino de texto.
    return { tipo: 'texto', texto, paginas: 0, motivo: '' }
  }

  // A pdf-parse se le da un Uint8Array, NUNCA un Buffer (17-sep-2026). Su
  // pdf.js clona lo que recibe con `new value.constructor(value)`; con un
  // Buffer de menos de 4 KB, Node saca esa copia de su pool compartido, y
  // pdf.js luego lee el ArrayBuffer ENTERO ignorando el desplazamiento: un
  // PDF pequeño (justo el caso de uno en blanco) salía "dañado" o, peor, con
  // el texto de OTRO documento procesado antes. Reproducido en Node 20 (el
  // de producción), 22 y 24.
  const pdfParse = require('pdf-parse')
  const datos = await pdfParse(new Uint8Array(arrayBuffer.slice(0))).catch(() => null)
  if (!datos || !datos.numpages) {
    return { tipo: 'invalido', texto: '', paginas: 0, motivo: 'El PDF está dañado o protegido y no se puede abrir.' }
  }

  const texto = (datos.text || '').trim()
  const paginas = datos.numpages
  if (!texto && !(await tieneContenidoVisible(arrayBuffer.slice(0)))) {
    return {
      tipo: 'vacio',
      texto: '',
      paginas,
      motivo: paginas === 1
        ? 'El PDF está en blanco: su página no tiene texto ni ningún contenido visible.'
        : `El PDF está en blanco: ninguna de sus ${paginas} páginas tiene texto ni contenido visible.`,
    }
  }
  // Con o sin restos de texto, si la densidad es baja el contenido real está
  // en las imágenes. En ese caso el PDF se manda NATIVO y Claude lee texto e
  // imagen a la vez, así que quien consuma esto NO debe además mandar el
  // texto por separado: duplicaría el mismo contenido en el prompt y sesgaría
  // los reactivos hacia lo repetido.
  return { tipo: tipoPorDensidad(texto, paginas), texto, paginas, motivo: '' }
}

/** Descarga una URL y extrae su texto plano COMPLETO — sin truncar. */
async function extraerTextoDocumento(url) {
  let res
  try {
    res = await fetch(url)
  } catch {
    throw new Error(`No se pudo descargar el documento: ${url}`)
  }
  if (!res.ok) throw new Error(`No se pudo descargar el documento (HTTP ${res.status}): ${url}`)
  const buffer = Buffer.from(await res.arrayBuffer())

  const ext = extension(url)
  let texto
  if (ext === 'pdf') {
    const pdfParse = require('pdf-parse')
    const datos = await pdfParse(buffer).catch(() => { throw new Error('No se pudo leer el PDF: puede estar dañado o protegido.') })
    texto = datos.text || ''
  } else if (ext === 'docx') {
    const mammoth = require('mammoth')
    const datos = await mammoth.extractRawText({ buffer }).catch(() => { throw new Error('No se pudo leer el documento Word (.docx).') })
    texto = datos.value || ''
  } else if (ext === 'doc') {
    // mammoth solo lee el formato moderno .docx (es XML); el .doc binario
    // antiguo necesitaría otra librería que no vale la pena sumar solo para
    // esto — se le pide al docente que convierta.
    throw new Error('No podemos leer archivos .doc antiguos: conviértelo a .docx o PDF.')
  } else {
    throw new Error(`Formato de documento no soportado: .${ext || '?'}`)
  }

  texto = texto.trim()
  if (!texto) throw new Error('El documento no tiene texto extraíble.')
  return texto
}

module.exports = {
  extraerTextoDocumento, clasificarDocumento, clasificarBytes, tipoPorDensidad, MIN_CHARS_POR_PAGINA_TEXTO,
  hayOperadorVisible, tieneImagenesIncrustadas,
}
