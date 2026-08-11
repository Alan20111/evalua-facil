// Fuentes de referencia compartidas (11-ago-2026) — hasta 3 documentos
// (PDF/Word) que el docente puede adjuntar a distintas operaciones de IA
// (OP-03/OP-04 crear_evaluacion_ia, OP-09 reactivos, OP-05 crear_actividad_ia)
// para que el modelo los use como base ADICIONAL de contenido, junto con lo
// que el docente escribió en el campo de texto correspondiente.
//
// Este módulo centraliza lo que antes vivía inline en precheckCrearEvaluacion
// (functions/ia.js): descargar y extraer el texto de cada URL con
// docExtract.extraerTextoDocumento, armar un solo bloque de prompt, y decidir
// cuándo la operación debe detenerse por no poder leer ninguna fuente.

const { HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const docExtract = require('./docExtract')

const MAX_FUENTES = 3

/**
 * Descarga y extrae hasta 3 URLs en paralelo. Una que falle se ignora (log de
 * advertencia) y se sigue con las demás. Si TODAS fallan y sí había fuentes,
 * lanza un HttpsError claro para el docente — antes de que se reserve
 * cualquier crédito. Sin fuentes, devuelve null (caso normal).
 */
async function prepararBloqueFuentes(urls) {
  const lista = (Array.isArray(urls) ? urls : []).filter(Boolean).slice(0, MAX_FUENTES)
  if (!lista.length) return null

  const resultados = await Promise.all(lista.map(async (url, i) => {
    try {
      const texto = await docExtract.extraerTextoDocumento(url)
      return { i, texto }
    } catch (e) {
      logger.warn(`fuentesIA: no se pudo leer la fuente ${url}: ${String(e.message || e).slice(0, 200)}`)
      return null
    }
  }))

  const textos = resultados.filter(Boolean)
  if (!textos.length) {
    throw new HttpsError('failed-precondition',
      'No se pudo leer ninguno de los documentos que adjuntaste. Revisa que sean PDF o Word (.docx) válidos, o continúa sin adjuntarlos. No se descontaron créditos.')
  }

  const cuerpo = textos.map(({ i, texto }) => `"""[Documento ${i + 1}]\n${texto}\n"""`).join('\n\n')
  return 'Documentos de referencia aportados por el docente (úsalos como base cuando sean relevantes):\n' + cuerpo
}

module.exports = { prepararBloqueFuentes, MAX_FUENTES }
