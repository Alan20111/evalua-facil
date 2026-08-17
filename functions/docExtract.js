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

module.exports = { extraerTextoDocumento }
