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

// Presupuesto de páginas que se mandan a análisis VISUAL (bloque `document`
// nativo) sumando TODOS los documentos de una operación (3-sep-2026).
//
// De dónde sale el número — es un techo de costo, no una cifra al azar:
// una página escaneada cuesta ~2,100 tokens de entrada (fórmula de Anthropic
// (ancho×alto)/750 sobre páginas A4 reales), o sea ~$0.039 MXN con la tarifa
// de claude-haiku-4-5 en config/iaTarifas. Una evaluación de 20 reactivos
// ingresa 5 créditos ≈ $5.00 MXN. Topando el gasto documental en ~25% del
// ingreso: $1.25 ÷ $0.039 ≈ 32 páginas → 30, redondeando hacia lo seguro.
//
// Los otros cuatro criterios quedan holgados con ese mismo número: caben en
// la ventana de 200K de Haiku 4.5 (30 × 2,100 ≈ 63K, sobra el 68%), están muy
// por debajo del tope de 100 páginas por PDF del proveedor para modelos de
// 200K, cubren de sobra los materiales reales de un docente (infografías,
// cuadernillos, exámenes escaneados: el caso que originó esto usa 4), y
// cierran el escenario de 3 documentos × 30 páginas que costaría 144% del
// ingreso — es decir, generar a pérdida.
//
// NO confundir con MAX_PAGINAS_PDF_NATIVO (functions/evidenciasEntrega.js),
// que vale 3 y se queda como está: ese topa la ENTREGA DE UN ALUMNO en
// OP-11, cuyo objetivo de costo es ~$0.25 MXN por entrega — otra operación,
// otra economía. Reusar aquel 3 aquí habría rechazado una infografía de 4
// páginas, justo la regresión que este cambio existe para evitar.
const MAX_PAGINAS_VISUAL = 30

// Costo real de mandar UNA página a análisis visual, con la tarifa vigente de
// claude-haiku-4-5 en config/iaTarifas ($1 USD/MTok de entrada, TC 18.50):
// ~2,100 tokens/página × $1/1M × 18.50 ≈ $0.039 MXN.
const COSTO_MXN_POR_PAGINA_VISUAL = 0.039
// Techo de gasto documental como fracción del ingreso de la operación.
const FRACCION_INGRESO_PARA_DOCUMENTOS = 0.25
// 1 crédito = $1 MXN (paquete base de config/iaTarifas.paquetesCreditos).
const MXN_POR_CREDITO = 1
// Piso irrenunciable: el caso real que originó todo esto es una infografía de
// 4 páginas. Ninguna operación, por barata que sea, debe rechazarla — eso
// sería exactamente la regresión que este cambio existe para impedir.
const MIN_PAGINAS_VISUAL = 4

/**
 * Cuántas páginas puede permitirse mandar a visión una operación que cobra
 * `creditos`. El presupuesto ESCALA CON EL INGRESO en vez de ser una
 * constante: 30 páginas son razonables en una evaluación de 20 reactivos
 * (5 créditos), pero arruinarían una operación de tarifa plana de 1 crédito,
 * donde el documento costaría más que lo cobrado.
 */
function presupuestoPaginasVisual(creditos) {
  const ingreso = Math.max(0, Number(creditos) || 0) * MXN_POR_CREDITO
  const paginas = Math.floor((ingreso * FRACCION_INGRESO_PARA_DOCUMENTOS) / COSTO_MXN_POR_PAGINA_VISUAL)
  return Math.min(MAX_PAGINAS_VISUAL, Math.max(MIN_PAGINAS_VISUAL, paginas))
}

/** Clasifica cada URL en paralelo; un fallo se convierte en 'invalido' con su motivo, nunca tumba al resto. */
async function clasificarTodos(urls) {
  return Promise.all(urls.map(async (url, i) => {
    try {
      return { i, url, ...(await docExtract.clasificarDocumento(url)) }
    } catch (e) {
      const motivo = String(e.message || e).slice(0, 200)
      logger.warn(`fuentesIA: no se pudo procesar la fuente ${url}: ${motivo}`)
      return { i, url, tipo: 'invalido', texto: '', paginas: 0, motivo: 'No se pudo descargar el documento.' }
    }
  }))
}

/**
 * Convierte una lista de URLs en material listo para el prompt, eligiendo
 * por documento el camino que corresponde (3-sep-2026):
 *
 *   · 'texto'          → se concatena al bloque de texto (camino barato de siempre).
 *   · 'visual'/'mixto' → bloque `document` nativo, para que Claude lo lea con
 *                        visión — mismo mecanismo ya probado en producción por
 *                        evidenciasEntrega.js (OP-11).
 *   · lo demás         → aviso con el motivo REAL; nunca un "PDF inválido" genérico.
 *
 * Devuelve `{ texto, bloques, avisos, paginasVisuales }`. NUNCA lanza: decidir
 * si se puede continuar es del llamador, que es quien sabe si le basta con lo
 * que sí se pudo leer.
 */
async function prepararFuentes(urls, { etiqueta = 'Documento', maxPaginasVisual = MAX_PAGINAS_VISUAL } = {}) {
  const lista = (Array.isArray(urls) ? urls : []).filter(Boolean)
  if (!lista.length) return { texto: null, textoSinBloques: null, bloques: [], avisos: [], paginasVisuales: 0 }

  const clasificados = await clasificarTodos(lista)
  const textos = []
  const bloques = []
  const avisos = []
  let paginasVisuales = 0

  for (const d of clasificados) {
    if (d.tipo === 'texto') { textos.push(d.texto); continue }

    if (d.tipo === 'visual' || d.tipo === 'mixto') {
      if (paginasVisuales + d.paginas <= maxPaginasVisual) {
        bloques.push({ type: 'document', source: { type: 'url', url: d.url } })
        paginasVisuales += d.paginas
        continue
      }
      // No cabe en el presupuesto visual. Si trae algo de texto se aprovecha
      // (mejor eso que nada); si no, se reporta con la cifra concreta para
      // que el docente sepa exactamente qué pasó y pueda partir el archivo.
      if (d.texto) {
        textos.push(d.texto)
        avisos.push({ url: d.url, motivo: `Tiene ${d.paginas} páginas y se superó el máximo de ${maxPaginasVisual} páginas para análisis visual: solo se usó el texto que se pudo extraer.` })
      } else {
        avisos.push({ url: d.url, motivo: `Tiene ${d.paginas} páginas y se superó el máximo de ${maxPaginasVisual} páginas para análisis visual en una sola operación.` })
      }
      continue
    }

    avisos.push({ url: d.url, motivo: d.motivo || 'No se pudo procesar el documento.' })
  }

  const texto = textos.length
    ? textos.map((t, i) => `"""[${etiqueta} ${i + 1}]\n${t}\n"""`).join('\n\n')
    : null
  return { texto, bloques, avisos, paginasVisuales }
}

/**
 * Documentos que el docente adjuntó A MANO en esta operación puntual (hasta
 * 3, tope MAX_FUENTES). Si TODAS fallan y sí había fuentes, lanza un
 * HttpsError claro — antes de que se reserve cualquier crédito, porque el
 * docente las acaba de elegir y merece saber que no se pudieron leer. Sin
 * fuentes, devuelve null (caso normal).
 */
async function prepararBloqueFuentes(urls) {
  const { textoSinBloques, bloques, avisos } = await fuentesManual(urls)
  if (!textoSinBloques && bloques.length) {
    // El documento SÍ es válido, solo que su contenido está en imágenes y
    // esta operación todavía no manda documentos nativos al modelo (hoy solo
    // lo hacen crear evaluación, reactivos y crear actividad, vía
    // bloqueFuentesOperacion). Se dice tal cual en vez de acusar al archivo
    // de inválido, que es justo el error que originó todo esto.
    throw new HttpsError('failed-precondition',
      'El documento que adjuntaste no tiene texto: su contenido está en imágenes (escaneo, infografía o similar) y esta operación todavía necesita documentos con texto. Usa un PDF o Word con texto, o continúa sin adjuntarlo. No se descontaron créditos.')
  }
  if (!textoSinBloques) {
    if (avisos.length) {
      throw new HttpsError('failed-precondition',
        `No se pudo usar ninguno de los documentos que adjuntaste. ${avisos[0].motivo} Corrígelo o continúa sin adjuntarlos. No se descontaron créditos.`)
    }
    return null
  }
  // Había texto Y además documentos visuales: se aprovecha el texto y se deja
  // constancia de lo que esta operación no puede llevar (nunca en silencio).
  if (bloques.length) {
    logger.warn(`fuentesIA: ${bloques.length} documento(s) visual(es) ignorado(s) — esta operación solo manda texto`)
  }
  return textoSinBloques
}

/** Igual que prepararBloqueFuentes pero conservando los bloques nativos y los avisos. */
async function fuentesManual(urls, opciones = {}) {
  const lista = (Array.isArray(urls) ? urls : []).filter(Boolean).slice(0, MAX_FUENTES)
  if (!lista.length) return { texto: null, textoSinBloques: null, bloques: [], avisos: [], paginasVisuales: 0 }
  const r = await prepararFuentes(lista, { ...opciones, etiqueta: 'Documento' })
  return { ...r, texto: conIntro(INTRO_MANUAL, r), textoSinBloques: soloTexto(INTRO_MANUAL, r) }
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
  return (await fuentesGenerales(urls)).textoSinBloques
}

/** Igual que prepararBloqueFuentesGenerales pero conservando bloques nativos y avisos. Nunca lanza. */
async function fuentesGenerales(urls, opciones = {}) {
  const lista = (Array.isArray(urls) ? urls : []).filter(Boolean)
  if (!lista.length) return { texto: null, textoSinBloques: null, bloques: [], avisos: [], paginasVisuales: 0 }
  const r = await prepararFuentes(lista, { ...opciones, etiqueta: 'Fuente general' })
  return { ...r, texto: conIntro(INTRO_GENERAL, r), textoSinBloques: soloTexto(INTRO_GENERAL, r) }
}

const INTRO_MANUAL = 'Documentos de referencia aportados por el docente (úsalos como base cuando sean relevantes):\n'
const INTRO_GENERAL = 'Fuentes generales de la asignatura, guardadas por el docente en la pestaña Planeación Didáctica (úsalas como base cuando sean relevantes):\n'

// Arma el texto final del bloque. Cuando además hay documentos que viajan
// como imagen (bloque nativo), se le dice al modelo que existen: sin esta
// línea el prompt no los menciona y el modelo no sabe qué son las páginas
// que le llegan adjuntas.
function conIntro(intro, { texto, bloques }) {
  const partes = []
  if (texto) partes.push(intro + texto)
  if (bloques.length) {
    partes.push(
      `Se adjuntan además ${bloques.length} documento(s) PDF de referencia cuyo contenido está en imágenes ` +
      '(escaneos, infografías, diagramas o capturas). Léelos directamente y trátalos como material fuente ' +
      'con el mismo peso que el texto anterior.'
    )
  }
  return partes.length ? partes.join('\n\n') : null
}

// Variante para los llamadores que NO saben mandar bloques nativos: nunca
// anuncia documentos visuales, porque esos documentos no van a viajar y
// prometérselos al modelo lo llevaría a inventar contenido que nunca vio.
function soloTexto(intro, { texto }) {
  return texto ? intro + texto : null
}

/** Une los bloques que sí llegaron (alguno puede ser null) en un solo texto para el prompt. */
function combinarBloquesFuentes(...bloques) {
  const partes = bloques.filter(Boolean)
  return partes.length ? partes.join('\n\n') : null
}

module.exports = {
  prepararBloqueFuentes, prepararBloqueFuentesGenerales, combinarBloquesFuentes, MAX_FUENTES,
  prepararFuentes, fuentesManual, fuentesGenerales,
  MAX_PAGINAS_VISUAL, MIN_PAGINAS_VISUAL, presupuestoPaginasVisual,
}
