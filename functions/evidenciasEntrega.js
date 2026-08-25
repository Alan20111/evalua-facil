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
//   · DOCX    → NO existe un tipo de bloque nativo para Word en el SDK. Se
//     extrae el texto con docExtract.extraerTextoDocumento (mismo mecanismo
//     que ya usa fuentesIA.js para las Fuentes de otras operaciones) y se
//     manda como TextBlockParam { type:'text', text }.
//   · .doc antiguo y cualquier otro formato quedan FUERA de esta primera
//     versión — se ignoran sin tronar la operación (se reportan en
//     `ignoradosPorFormato` para que el docente sepa qué no se analizó).

const { logger } = require('firebase-functions')
const docExtract = require('./docExtract')

// Tope de evidencias analizadas por entrega — acota costo/latencia de la
// llamada multimodal. Aplica al TOTAL de archivos elegibles (imagen + PDF +
// Word juntos), no por tipo.
const MAX_EVIDENCIAS = 3

// Tope de páginas de un PDF que se manda como documento nativo (visión +
// texto). Un PDF más largo que esto casi seguro no es "la tarea de un
// alumno" sino un cuadernillo completo o un escaneo de más de lo pedido —
// mandarlo entero dispararía el costo real muy por encima del objetivo de
// ~$0.25 MXN/evaluación (cada página se cobra aprox. como una imagen). Ver
// docs/ia/COSTO_CALIFICAR_ENTREGABLE_IA.md para las cuentas completas.
const MAX_PAGINAS_PDF_NATIVO = 3

const EXT_IMAGEN = new Set(['jpg', 'jpeg', 'png'])

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
        const texto = await docExtract.extraerTextoDocumento(a.url)
        bloques.push({ type: 'text', text: `[Documento Word entregado: ${a.nombre || 'documento.docx'}]\n${texto}` })
        detalle.push({ nombre: a.nombre || 'documento.docx', tipo: 'word' })
      } catch (e) {
        logger.warn(`evidenciasEntrega: no se pudo leer ${a.url}: ${String(e.message || e).slice(0, 200)}`)
        ignoradosPorFormato++
      }
    }
  }

  return { bloques, detalle, totalEntregados: lista.length, ignoradosPorFormato, ignoradosPorTope }
}

module.exports = { prepararEvidenciasEntrega, MAX_EVIDENCIAS }
