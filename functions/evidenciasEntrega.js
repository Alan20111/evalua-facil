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

// Tope de evidencias analizadas por entrega — acota costo/latencia de la
// llamada multimodal. Aplica al TOTAL de archivos elegibles (imagen + PDF +
// Word juntos), no por tipo.
const MAX_EVIDENCIAS = 3

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

const EXT_IMAGEN = new Set(['jpg', 'jpeg', 'png'])

// Tipos MIME de imagen que Claude puede procesar como bloque nativo.
// wmf/emf son formatos vectoriales de Windows que no están en la lista de
// la API — se descartan silenciosamente.
const TIPOS_IMAGEN_DOCX = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'])

function extension(url, nombre) {
  const s = String(nombre || url || '').split('?')[0]
  const m = /\.([a-z0-9]+)$/i.exec(s)
  return m ? m[1].toLowerCase() : ''
}

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

// Cuenta páginas de un PDF (para decidir si cabe en el presupuesto de costo
// del análisis visual nativo) reutilizando pdf-parse, que docExtract.js ya
// trae como dependencia — una descarga extra y local, sin llamar a Claude.
async function contarPaginasPDF(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    const pdfParse = require('pdf-parse')
    const datos = await pdfParse(buffer).catch(() => null)
    if (!datos) return null
    return { numPaginas: datos.numpages || null, texto: (datos.text || '').trim() }
  } catch {
    return null
  }
}

/**
 * Convierte los archivos de una entrega (`[{url, nombre}]`) en content
 * blocks listos para `messages.create`. Nunca truena por un archivo
 * individual que falle: ese archivo se descarta y se cuenta en
 * `ignoradosPorFormato`, y la operación sigue con lo que sí se pudo leer.
 */
async function prepararEvidenciasEntrega(archivos) {
  const lista = (Array.isArray(archivos) ? archivos : []).filter((a) => a?.url)

  const elegibles = []
  let ignoradosPorFormato = 0
  for (const a of lista) {
    const ext = extension(a.url, a.nombre)
    if (EXT_IMAGEN.has(ext) || ext === 'pdf' || ext === 'docx') elegibles.push({ ...a, ext })
    else ignoradosPorFormato++
  }

  const usados = elegibles.slice(0, MAX_EVIDENCIAS)
  const ignoradosPorTope = elegibles.length - usados.length

  const bloques = []
  const detalle = []
  for (const a of usados) {
    if (EXT_IMAGEN.has(a.ext)) {
      bloques.push({ type: 'image', source: { type: 'url', url: limitarResolucionImagen(a.url) } })
      detalle.push({ nombre: a.nombre || 'imagen', tipo: 'imagen' })
    } else if (a.ext === 'pdf') {
      const info = await contarPaginasPDF(a.url)
      if (info?.numPaginas > MAX_PAGINAS_PDF_NATIVO) {
        // Demasiado largo para el análisis visual nativo dentro del
        // presupuesto de costo: se usa solo el texto ya extraído, si lo hay
        // (un PDF escaneado sin texto seleccionable se queda sin nada que
        // ofrecer, y por regla 4 del PO no se inventa nada — se ignora).
        if (info.texto) {
          bloques.push({ type: 'text', text: `[PDF entregado — ${info.numPaginas} páginas, se usa solo el texto (excede el límite de análisis visual de esta versión): ${a.nombre || 'documento.pdf'}]\n${info.texto}` })
          detalle.push({ nombre: a.nombre || 'documento.pdf', tipo: 'pdf-texto' })
        } else {
          logger.warn(`evidenciasEntrega: PDF de ${info.numPaginas} páginas sin texto extraíble, se ignora: ${a.url}`)
          ignoradosPorFormato++
        }
      } else {
        bloques.push({ type: 'document', source: { type: 'url', url: a.url } })
        detalle.push({ nombre: a.nombre || 'documento.pdf', tipo: 'pdf' })
      }
    } else if (a.ext === 'docx') {
      try {
        const res = await fetch(a.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buffer = Buffer.from(await res.arrayBuffer())
        const mammoth = require('mammoth')

        // Extraer texto estructurado e imágenes embebidas en un solo paso.
        // mammoth.images.imgElement intercepta cada imagen antes de que se
        // incruste en el HTML — la acumulamos por separado y devolvemos {}
        // para que no quede el <img> en el HTML que luego convertimos a texto.
        const imagenesEmbebidas = []
        const resultadoHtml = await mammoth.convertToHtml({ buffer }, {
          convertImage: mammoth.images.imgElement(async function (image) {
            try {
              const mediaType = image.contentType || 'image/png'
              if (TIPOS_IMAGEN_DOCX.has(mediaType)) {
                const imgBuffer = await image.read()
                const base64 = Buffer.isBuffer(imgBuffer)
                  ? imgBuffer.toString('base64')
                  : Buffer.from(imgBuffer).toString('base64')
                imagenesEmbebidas.push({ base64, mediaType })
              }
            } catch { /* imagen individual corrupta — se salta */ }
            return {}
          }),
        })

        // Convertir el HTML a texto estructurado: preserva la forma de las
        // tablas (columnas separadas por tabulador, filas por salto de línea)
        // y la jerarquía de listas, que mammoth.extractRawText() aplana.
        const textoEstructurado = (resultadoHtml.value || '')
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

        const imagenesParaMandar = imagenesEmbebidas.slice(0, MAX_IMAGENES_DOCX)

        if (!textoEstructurado && imagenesParaMandar.length === 0) {
          logger.warn(`evidenciasEntrega: DOCX sin texto ni imágenes legibles: ${a.url}`)
          ignoradosPorFormato++
        } else {
          if (textoEstructurado) {
            bloques.push({ type: 'text', text: `[Documento Word entregado: ${a.nombre || 'documento.docx'}]\n${textoEstructurado}` })
          }
          for (const img of imagenesParaMandar) {
            bloques.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } })
          }
          detalle.push({ nombre: a.nombre || 'documento.docx', tipo: 'word', imagenesEmbebidas: imagenesParaMandar.length })
        }
      } catch (e) {
        logger.warn(`evidenciasEntrega: no se pudo leer ${a.url}: ${String(e.message || e).slice(0, 200)}`)
        ignoradosPorFormato++
      }
    }
  }

  return { bloques, detalle, totalEntregados: lista.length, ignoradosPorFormato, ignoradosPorTope }
}

module.exports = { prepararEvidenciasEntrega, MAX_EVIDENCIAS }
