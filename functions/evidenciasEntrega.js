// Evidencias de una entrega — capa ÚNICA que convierte los archivos que
// subió un estudiante en los content blocks que espera el mensaje de Claude,
// sin importar el tipo de archivo (OP-11 "Calificar con IA", 21-ago-2026,
// decisión de Kike: JPG/PNG/PDF/DOCX en esta primera versión, MISMO motor de
// evaluación para los tres — lo único que cambia es cómo se obtiene el
// contenido de cada evidencia).
//
// Verificado contra @anthropic-ai/sdk instalado (functions/node_modules/
// @anthropic-ai/sdk/resources/messages/messages.d.ts, API estable, sin
// bandera beta) antes de escribir esto:
//   · JPG/PNG → ImageBlockParam { type:'image', source:{ type:'url', url } }
//     — visión nativa.
//   · PDF     → DocumentBlockParam { type:'document', source:{ type:'url',
//     url } } (URLPDFSource) — Claude lee el PDF de forma nativa, texto Y
//     páginas como imagen; sirve igual para un PDF con texto seleccionable
//     que para uno escaneado (evidencia fotografiada y pegada en un PDF).
//   · DOCX    → NO existe bloque nativo para Word en el SDK. Se procesa con
//     mammoth.convertToHtml (12-sep-2026, decisión de Kike): texto
//     estructurado (tablas, listas, jerarquía) + imágenes embebidas
//     (gráficas de Excel, capturas, fotografías) enviadas como bloques
//     ImageBlockParam separados con source de tipo 'base64'.
//   · .doc antiguo y cualquier otro formato quedan FUERA de esta primera
//     versión — se ignoran sin tronar la operación (se reportan en
//     `ignoradosPorFormato` para que el docente sepa qué no se analizó).

const { logger } = require('firebase-functions')
// Formatos válidos, extensión y tope de evidencias: la MISMA regla que decide
// la tarifa por entrega y que usa la pantalla (fuente: src/utils/
// tarifaCalificacionEvidencias.js, copiada por scripts/sync-functions-shared.mjs).
const tarifa = require('./_shared/tarifaCalificacionEvidencias.js')
const { evidenciasValidas, esImagenEvidencia, EVIDENCIAS_CFG } = tarifa
// Clasificador de PDF ya probado (densidad de texto, PDF en blanco, dibujos):
// se reutiliza, no se duplica.
const docExtract = require('./docExtract')

// Tope de evidencias analizadas por entrega — acota costo/latencia de la
// llamada multimodal. Aplica al TOTAL de archivos elegibles (imagen + PDF +
// Word juntos), no por tipo.
const MAX_EVIDENCIAS = EVIDENCIAS_CFG.maxPorEntrega

// Tope de páginas de un PDF que se manda como documento nativo (visión +
// texto). Subido de 3 a 10 el 12-sep-2026 (decisión de Kike): la tarea
// típica de bachillerato es un cuaderno fotografiado de 4-10 páginas, y con
// el límite anterior esas páginas llegaban solo como texto plano (sin
// gráficas, diagramas ni tablas visuales) o se ignoraban si eran escaneadas.
// Costo real con 10 páginas nativas: ~0.39 MXN por PDF (10 × 2,100 tok ×
// $1/MTok × TC 18.50); con 3 evidencias es ~1.17 MXN de tokens de documento.
// La evaluación cuesta entre 1-2 créditos ($1-2 MXN), así que el documento
// queda dentro del 50-100 % del ingreso de la operación — margen aceptable
// dado que sin este cambio la IA no veía el trabajo real del alumno.
const MAX_PAGINAS_PDF_NATIVO = 10

// Tope de imágenes embebidas que se extraen de un DOCX y se mandan como
// bloques de imagen individuales. Acota costo y latencia: la mayoría de
// tareas escolares en Word tienen 0-3 imágenes; 5 cubre holgadamente los
// casos reales sin disparar el costo si alguien sube un documento con 50
// capturas de pantalla.
const MAX_IMAGENES_DOCX = 5

// Tipos MIME de imagen que Claude puede procesar como bloque nativo.
// wmf/emf son formatos vectoriales de Windows que no están en la lista de
// la API — se descartan silenciosamente.
const TIPOS_IMAGEN_DOCX = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'])


// Cloudinary entrega la imagen en el tamaño que se le pida vía la URL de
// transformación (mismo mecanismo que ya usa downloadUrl/pdfPageImageUrl en
// src/utils/cloudinary.js). Claude cobra tokens de imagen ≈ (ancho×alto)/750
// (fórmula documentada por Anthropic) — 1568px de lado largo (su tope de
// reescalado interno) resulta en ~1,920 tok/imagen; 1200px deja el texto de
// un cuaderno perfectamente legible y baja el costo con margen (ver
// docs/ia/COSTO_CALIFICAR_ENTREGABLE_IA.md). Si la URL no es de Cloudinary
// (`/upload/` ausente), se manda tal cual.
function limitarResolucionImagen(url) {
  if (!url || !url.includes('/upload/')) return url
  return url.replace('/upload/', '/upload/w_1200,h_1200,c_limit,q_auto,f_jpg/')
}

// ── Caché de lecturas descargadas (oct-2026) ──────────────────────────────
// La estimación del costo de "Calificar con IA" corre esta MISMA preparación
// (así sabe qué entregas se podrán procesar, de qué clase son y no anuncia
// cobros que no se harán), y la ejecución la vuelve a correr segundos
// después. Para no descargar ni revisar dos veces el mismo PDF o Word, cada
// instancia guarda lo leído por URL unos minutos. Una URL de Cloudinary con
// versión apunta siempre al mismo contenido; si el estudiante vuelve a subir,
// la URL cambia. Acotada en tiempo y en tamaño (se descartan las más viejas):
// 8 M caracteres ≈ 16 MB, holgado frente a los 256 MB de la función. Solo
// guarda lecturas que no dependen de la red (un fallo de descarga o una
// revisión que no terminó NO se guardan: se reintenta la próxima vez).
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX_CARACTERES = 8 * 1024 * 1024
const _cacheLecturas = new Map() // url → { en, tam, valor }
let _cacheTam = 0

function tamLectura(valor) {
  if (!valor) return 0
  let n = (valor.texto || '').length
  for (const img of valor.imagenes || []) n += (img.base64 || '').length
  return n
}

function leerCache(clave) {
  const e = _cacheLecturas.get(clave)
  if (!e) return undefined
  if (Date.now() - e.en > CACHE_TTL_MS) {
    _cacheLecturas.delete(clave); _cacheTam -= e.tam
    return undefined
  }
  return e.valor
}

function guardarCache(clave, valor) {
  const tam = tamLectura(valor)
  if (tam > CACHE_MAX_CARACTERES) return
  const previa = _cacheLecturas.get(clave)
  if (previa) { _cacheLecturas.delete(clave); _cacheTam -= previa.tam }
  _cacheLecturas.set(clave, { en: Date.now(), tam, valor })
  _cacheTam += tam
  // Map conserva el orden de inserción: se descartan las más viejas.
  for (const [k, e] of _cacheLecturas) {
    if (_cacheTam <= CACHE_MAX_CARACTERES) break
    _cacheLecturas.delete(k); _cacheTam -= e.tam
  }
}

// ── Tamaño de una imagen (px) leyendo solo su cabecera ─────────────────────
// PNG, JPEG, GIF, WEBP y BMP. null si no se reconoce: quien clasifica trata
// una imagen sin medida como incierta (no se adivina si es foto o icono).
function medirImagen(b) {
  try {
    if (!b || b.length < 24) return null
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) }
    if (b[0] === 0x42 && b[1] === 0x4d) return { w: Math.abs(b.readInt32LE(18)), h: Math.abs(b.readInt32LE(22)) }
    if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
      const f = b.toString('latin1', 12, 16)
      if (f === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
      if (f === 'VP8L') { const n = b.readUInt32LE(21); return { w: 1 + (n & 0x3fff), h: 1 + ((n >> 14) & 0x3fff) } }
      if (f === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
      return null
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null
        const m = b[i + 1]
        if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue }
        const l = b.readUInt16BE(i + 2)
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) }
        i += 2 + l
      }
    }
  } catch { /* cabecera truncada */ }
  return null
}

// ── Imágenes incrustadas en un PDF, con su tamaño ──────────────────────────
// Toda imagen de un PDF es un objeto `N 0 obj << /Subtype /Image … >> stream`;
// los streams nunca van comprimidos dentro de otro objeto, así que su
// diccionario siempre está legible (mismo principio que
// docExtract.tieneImagenesIncrustadas). Se descartan las máscaras de
// transparencia (/SMask): son la misma imagen, no otra. Un tamaño indirecto
// (`/Width 12 0 R`) queda sin medida → la clasificación lo trata como incierto.
function imagenesDePdf(bytes) {
  const s = Buffer.from(bytes).toString('latin1')
  const mascaras = new Set()
  for (const m of s.matchAll(/\/SMask\s+(\d+)\s+\d+\s+R/g)) mascaras.add(m[1])
  const out = []
  const re = /\/Subtype\s*\/Image\b/g
  let m
  while ((m = re.exec(s))) {
    const ini = s.lastIndexOf(' obj', m.index)
    const cab = ini >= 0 ? /(\d+)\s+\d+\s+obj$/.exec(s.slice(Math.max(0, ini - 20), ini + 4)) : null
    if (cab && mascaras.has(cab[1])) continue
    const fin = s.indexOf('stream', m.index)
    const dic = s.slice(ini >= 0 ? ini : m.index, fin > 0 ? Math.min(fin, m.index + 4000) : m.index + 4000)
    const w = /\/Width\s+(\d+)(?!\s+\d+\s+R)/.exec(dic)
    const h = /\/Height\s+(\d+)(?!\s+\d+\s+R)/.exec(dic)
    out.push({ w: w ? +w[1] : null, h: h ? +h[1] : null })
  }
  return out
}

// ── PDF: clase por contenido ───────────────────────────────────────────────
// Reutiliza docExtract.clasificarBytes (pdf-parse con Uint8Array, densidad de
// texto, PDF en blanco) en modo estricto, y le agrega lo que la tarifa
// necesita: el tamaño de las imágenes incrustadas y, solo si hay poco texto y
// ninguna fotografía, si trae dibujos vectoriales.
// Devuelve { clase, motivo, paginas, texto } — `texto` solo cuando hará falta
// (PDF de texto de más de MAX_PAGINAS_PDF_NATIVO páginas).
async function leerPdf(url) {
  const enCache = leerCache(`pdf:${url}`)
  if (enCache !== undefined) return enCache
  let bytes
  try {
    const res = await fetch(url)
    if (!res.ok) return { clase: 'incierta', motivo: 'No se pudo descargar el PDF.' }
    bytes = await res.arrayBuffer()
  } catch {
    return { clase: 'incierta', motivo: 'No se pudo descargar el PDF.' }
  }
  const base = await docExtract.clasificarBytes('pdf', bytes, { estricto: true })
  const datos = {
    tipoBase: base.tipo, paginas: base.paginas, caracteres: (base.texto || '').length,
    imagenes: base.tipo === 'invalido' ? [] : imagenesDePdf(bytes),
  }
  let r = tarifa.clasificarContenidoPdf({ ...datos, trazosVectoriales: undefined })
  if (r.requiereTrazos) r = tarifa.clasificarContenidoPdf({ ...datos, trazosVectoriales: await docExtract.hayTrazosVectoriales(bytes.slice(0)) })
  // Más páginas de las que la IA puede MIRAR: solo se puede usar el texto.
  // Si el contenido está en imágenes, usar solo el texto ignoraría lo que hay
  // que evaluar — no se califica (ni se cobra) en vez de evaluar a medias.
  if (base.paginas > MAX_PAGINAS_PDF_NATIVO && r.clase === 'imagenes') {
    r = { clase: 'incierta', motivo: `El PDF tiene ${base.paginas} páginas con imágenes o escaneadas; la IA solo puede revisar hasta ${MAX_PAGINAS_PDF_NATIVO}.` }
  }
  const lectura = {
    clase: r.clase, motivo: r.motivo, paginas: base.paginas,
    texto: base.paginas > MAX_PAGINAS_PDF_NATIVO && r.clase === 'documentos' ? base.texto : '',
  }
  // Una revisión que no terminó a tiempo no se guarda: se reintenta.
  if (!r.reintentable) guardarCache(`pdf:${url}`, lectura)
  return lectura
}

// Formatos vectoriales de Office: no son fotografías y la IA no los recibe.
const TIPOS_VECTORIALES_DOCX = new Set(['image/x-emf', 'image/emf', 'image/x-wmf', 'image/wmf', 'image/svg+xml'])

// ── Word: texto estructurado + imágenes, con su clase ──────────────────────
// Devuelve { clase, motivo, texto, imagenes } — `imagenes` son las que se
// mandan a la IA (hasta MAX_IMAGENES_DOCX, las MÁS GRANDES primero para que un
// icono no deje fuera una fotografía, en su orden original).
async function leerDocx(url) {
  const enCache = leerCache(`docx:${url}`)
  if (enCache !== undefined) return enCache
  let buffer
  try {
    const res = await fetch(url)
    if (!res.ok) return { clase: 'incierta', motivo: 'No se pudo descargar el documento Word.', texto: '', imagenes: [] }
    buffer = Buffer.from(await res.arrayBuffer())
  } catch {
    return { clase: 'incierta', motivo: 'No se pudo descargar el documento Word.', texto: '', imagenes: [] }
  }
  const mammoth = require('mammoth')

  // Extraer texto estructurado e imágenes embebidas en un solo paso.
  // mammoth.images.imgElement intercepta cada imagen antes de que se
  // incruste en el HTML — la acumulamos por separado y devolvemos {}
  // para que no quede el <img> en el HTML que luego convertimos a texto.
  const imagenesEmbebidas = []
  let resultadoHtml
  try {
    resultadoHtml = await mammoth.convertToHtml({ buffer }, {
      convertImage: mammoth.images.imgElement(async function (image) {
        const mediaType = image.contentType || 'image/png'
        if (TIPOS_VECTORIALES_DOCX.has(mediaType)) return {}
        let imgBuffer = null
        try { imgBuffer = Buffer.from(await image.read()) } catch { /* imagen corrupta: queda sin medida */ }
        const medida = imgBuffer ? medirImagen(imgBuffer) : null
        imagenesEmbebidas.push({
          w: medida?.w ?? null, h: medida?.h ?? null, mediaType,
          legible: TIPOS_IMAGEN_DOCX.has(mediaType) && !!imgBuffer,
          base64: imgBuffer && TIPOS_IMAGEN_DOCX.has(mediaType) ? imgBuffer.toString('base64') : null,
        })
        return {}
      }),
    })
  } catch {
    return { clase: 'incierta', motivo: 'El documento Word está dañado o no se pudo abrir.', texto: '', imagenes: [] }
  }

  // Convertir el HTML a texto estructurado: preserva la forma de las
  // tablas (columnas separadas por tabulador, filas por salto de línea)
  // y la jerarquía de listas, que mammoth.extractRawText() aplana.
  const texto = (resultadoHtml.value || '')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/th>|<\/td>/gi, '\t')
    .replace(/<\/p>|<\/li>|<br\s*\/?>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const r = tarifa.clasificarContenidoDocx({ ok: true, texto, imagenes: imagenesEmbebidas })
  const area = (img) => (img.w || 0) * (img.h || 0)
  const elegidas = new Set(imagenesEmbebidas
    .filter((img) => img.legible && img.base64)
    .sort((a, b) => area(b) - area(a))
    .slice(0, MAX_IMAGENES_DOCX))
  const lectura = {
    clase: r.clase, motivo: r.motivo, texto,
    imagenes: imagenesEmbebidas.filter((img) => elegidas.has(img)).map(({ base64, mediaType }) => ({ base64, mediaType })),
  }
  guardarCache(`docx:${url}`, lectura)
  return lectura
}

/**
 * Convierte los archivos de una entrega (`[{url, nombre}]`) en content
 * blocks listos para `messages.create`, y CLASIFICA la entrega para la
 * tarifa (oct-2026): `clasificacion` es 'imagenes', 'documentos',
 * 'incierta' (algún archivo no se pudo clasificar con fiabilidad: la entrega
 * no se califica ni se cobra; `inciertos` dice cuál y por qué) o null (no hay
 * evidencia). Los archivos en blanco o de formato no soportado se ignoran y se
 * cuentan en `ignoradosPorFormato`, como siempre.
 */
async function prepararEvidenciasEntrega(archivos) {
  const lista = (Array.isArray(archivos) ? archivos : []).filter((a) => a?.url)

  // Qué evidencias cuentan y el tope: la regla compartida con la pantalla y
  // con el cálculo de la tarifa (src/utils/tarifaCalificacionEvidencias.js).
  const valido = evidenciasValidas(lista)
  const usados = valido.usados
  let ignoradosPorFormato = valido.ignoradosPorFormato
  const ignoradosPorTope = valido.ignoradosPorTope

  const bloques = []
  const detalle = []
  const inciertos = []
  for (const a of usados) {
    if (esImagenEvidencia(a.ext)) {
      bloques.push({ type: 'image', source: { type: 'url', url: limitarResolucionImagen(a.url) } })
      detalle.push({ nombre: a.nombre || 'imagen', tipo: 'imagen', clase: 'imagenes' })
    } else if (a.ext === 'pdf') {
      const info = await leerPdf(a.url)
      if (info.clase === 'incierta') {
        logger.warn(`evidenciasEntrega: PDF no clasificable (${info.motivo}): ${a.url}`)
        inciertos.push({ nombre: a.nombre || 'documento.pdf', motivo: info.motivo })
      } else if (info.clase === 'vacio') {
        ignoradosPorFormato++
      } else if (info.paginas > MAX_PAGINAS_PDF_NATIVO) {
        // Demasiado largo para el análisis visual nativo dentro del
        // presupuesto de costo: se usa solo el texto (llega aquí únicamente
        // un PDF de TEXTO; uno escaneado o con fotos quedó como incierto).
        bloques.push({ type: 'text', text: `[PDF entregado — ${info.paginas} páginas, se usa solo el texto (excede el límite de análisis visual de esta versión): ${a.nombre || 'documento.pdf'}]\n${info.texto}` })
        detalle.push({ nombre: a.nombre || 'documento.pdf', tipo: 'pdf-texto', clase: info.clase })
      } else {
        bloques.push({ type: 'document', source: { type: 'url', url: a.url } })
        detalle.push({ nombre: a.nombre || 'documento.pdf', tipo: 'pdf', clase: info.clase })
      }
    } else if (a.ext === 'docx') {
      const lectura = await leerDocx(a.url)
      if (lectura.clase === 'incierta') {
        logger.warn(`evidenciasEntrega: Word no clasificable (${lectura.motivo}): ${a.url}`)
        inciertos.push({ nombre: a.nombre || 'documento.docx', motivo: lectura.motivo })
      } else if (lectura.clase === 'vacio') {
        ignoradosPorFormato++
      } else {
        if (lectura.texto) {
          bloques.push({ type: 'text', text: `[Documento Word entregado: ${a.nombre || 'documento.docx'}]\n${lectura.texto}` })
        }
        for (const img of lectura.imagenes) {
          bloques.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } })
        }
        detalle.push({ nombre: a.nombre || 'documento.docx', tipo: 'word', clase: lectura.clase, imagenesEmbebidas: lectura.imagenes.length })
      }
    }
  }

  const clasificacion = tarifa.claseEntrega([...detalle.map((d) => d.clase), ...inciertos.map(() => 'incierta')])
  return { bloques, detalle, totalEntregados: lista.length, ignoradosPorFormato, ignoradosPorTope, clasificacion, inciertos }
}

module.exports = {
  prepararEvidenciasEntrega, MAX_EVIDENCIAS,
  _pruebas: { limpiarCache: () => { _cacheLecturas.clear(); _cacheTam = 0 }, medirImagen, imagenesDePdf },
}
