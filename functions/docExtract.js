// Extracción de texto de documentos de referencia (OP-03/OP-04, 11-ago-2026).
//
// El docente puede adjuntar hasta 3 PDF/Word como fuente del contenido de un
// examen o cuestionario generado con IA. Este módulo SOLO extrae texto plano
// desde una URL de Cloudinary — no interpreta, no resume, no decide nada
// pedagógico. Ese texto se trunca y se agrega al prompt en functions/ia.js.

// 12000 (~4-5 páginas) se quedaba corto para programas de estudios/manuales
// reales de varias decenas de páginas — causa raíz real de que Planeación
// Inicial "perdiera" temas que estaban más adelante en el documento fuente:
// el texto ya venía cortado antes de llegar al prompt, la IA nunca lo vio
// (Kike, 17-ago-2026). 40000 iguala el límite ya usado en functions/ia.js
// (C02_MAX_CHARS) para la misma decisión — "cuánto texto de un documento
// se manda en un solo prompt" — en vez de inventar un número nuevo.
const MAX_CHARS = 40000

function extension(url) {
  const limpio = String(url || '').split('?')[0]
  const m = /\.([a-z0-9]+)$/i.exec(limpio)
  return m ? m[1].toLowerCase() : ''
}

/** Descarga una URL y extrae su texto plano, truncado a MAX_CHARS. */
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
  return texto.slice(0, MAX_CHARS)
}

module.exports = { extraerTextoDocumento, MAX_CHARS }
