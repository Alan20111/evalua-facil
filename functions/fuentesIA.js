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

/** Descarga y extrae cada URL en paralelo; una que falle se ignora (log de advertencia). */
async function extraerTextos(urls) {
  const resultados = await Promise.all(urls.map(async (url, i) => {
    try {
      const texto = await docExtract.extraerTextoDocumento(url)
      return { i, texto }
    } catch (e) {
      logger.warn(`fuentesIA: no se pudo leer la fuente ${url}: ${String(e.message || e).slice(0, 200)}`)
      return null
    }
  }))
  return resultados.filter(Boolean)
}

/**
 * Documentos que el docente adjuntó A MANO en esta operación puntual (hasta
 * 3, tope MAX_FUENTES). Si TODAS fallan y sí había fuentes, lanza un
 * HttpsError claro — antes de que se reserve cualquier crédito, porque el
 * docente las acaba de elegir y merece saber que no se pudieron leer. Sin
 * fuentes, devuelve null (caso normal).
 */
async function prepararBloqueFuentes(urls) {
  const lista = (Array.isArray(urls) ? urls : []).filter(Boolean).slice(0, MAX_FUENTES)
  if (!lista.length) return null

  const textos = await extraerTextos(lista)
  if (!textos.length) {
    throw new HttpsError('failed-precondition',
      'No se pudo leer ninguno de los documentos que adjuntaste. Revisa que sean PDF o Word (.docx) válidos, o continúa sin adjuntarlos. No se descontaron créditos.')
  }

  const cuerpo = textos.map(({ i, texto }) => `"""[Documento ${i + 1}]\n${texto}\n"""`).join('\n\n')
  return 'Documentos de referencia aportados por el docente (úsalos como base cuando sean relevantes):\n' + cuerpo
}

/**
 * Fuentes GENERALES guardadas en la pestaña Planeación Didáctica → Fuentes → "Fuentes
 * para todo el curso" (12-ago-2026, decisión de Kike: se incluyen SIEMPRE
 * como contexto de OP-03/04/05/09, sin que el docente tenga que volver a
 * adjuntarlas). A diferencia de prepararBloqueFuentes: SIN el tope de 3 (ese
 * tope solo aplica a lo que el docente adjunta a mano en esta operación), y
 * nunca bloquea la operación — si una no se puede leer se ignora en
 * silencio, porque el docente ni siquiera las eligió aquí.
 */
async function prepararBloqueFuentesGenerales(urls) {
  const lista = (Array.isArray(urls) ? urls : []).filter(Boolean)
  if (!lista.length) return null

  const textos = await extraerTextos(lista)
  if (!textos.length) return null

  const cuerpo = textos.map(({ i, texto }) => `"""[Fuente general ${i + 1}]\n${texto}\n"""`).join('\n\n')
  return 'Fuentes generales de la asignatura, guardadas por el docente en la pestaña Planeación Didáctica (úsalas como base cuando sean relevantes):\n' + cuerpo
}

/** Une los bloques que sí llegaron (alguno puede ser null) en un solo texto para el prompt. */
function combinarBloquesFuentes(...bloques) {
  const partes = bloques.filter(Boolean)
  return partes.length ? partes.join('\n\n') : null
}

module.exports = { prepararBloqueFuentes, prepararBloqueFuentesGenerales, combinarBloquesFuentes, MAX_FUENTES }
