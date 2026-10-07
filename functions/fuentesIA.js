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
// La definición (tope de 30 páginas, piso de 4 y la fórmula que escala con los
// créditos de la operación) vive en UN solo archivo que comparten el cliente y
// el servidor: src/utils/limiteDocumentosVisuales.js (aquí llega por
// functions/_shared/, que genera scripts/sync-functions-shared.mjs). El porqué
// de cada número está documentado ahí; aquí solo se reexporta.
//
// NO confundir con MAX_PAGINAS_PDF_NATIVO (functions/evidenciasEntrega.js),
// que vale 3 y se queda como está: ese topa la ENTREGA DE UN ALUMNO en
// OP-11, cuyo objetivo de costo es ~$0.25 MXN por entrega — otra operación,
// otra economía.
const { DOCUMENTOS_VISUALES, presupuestoPaginasVisual } = require('./_shared/limiteDocumentosVisuales')
const MAX_PAGINAS_VISUAL = DOCUMENTOS_VISUALES.maxPaginas
const MIN_PAGINAS_VISUAL = DOCUMENTOS_VISUALES.minPaginas

// Código con el que `prepararFuentes` marca un aviso por exceso de páginas;
// lo usa `fuentesManualRequeridas` para rechazar sin cobrar.
const CODIGO_EXCEDE_PAGINAS = 'EXCEDE_PAGINAS'

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
 *   · lo demás         → aviso con el motivo REAL; nunca un "PDF inválido" genérico
 *                        (incluye 'vacio': un PDF en blanco no viaja, no cuesta).
 *
 * Devuelve `{ texto, bloques, avisos, paginasVisuales, paginasVisualesSolicitadas }`
 * (esta última cuenta también las páginas que no cupieron). NUNCA lanza: decidir
 * si se puede continuar es del llamador, que es quien sabe si le basta con lo
 * que sí se pudo leer.
 */
async function prepararFuentes(urls, { etiqueta = 'Documento', maxPaginasVisual = MAX_PAGINAS_VISUAL } = {}) {
  const lista = (Array.isArray(urls) ? urls : []).filter(Boolean)
  if (!lista.length) return { texto: null, textoSinBloques: null, bloques: [], avisos: [], paginasVisuales: 0, paginasVisualesSolicitadas: 0 }

  const clasificados = await clasificarTodos(lista)
  const textos = []
  const bloques = []
  const avisos = []
  let paginasVisuales = 0
  let paginasVisualesSolicitadas = 0

  for (const d of clasificados) {
    if (d.tipo === 'texto') { textos.push(d.texto); continue }

    if (d.tipo === 'visual' || d.tipo === 'mixto') {
      paginasVisualesSolicitadas += d.paginas
      if (paginasVisuales + d.paginas <= maxPaginasVisual) {
        bloques.push({ type: 'document', source: { type: 'url', url: d.url } })
        paginasVisuales += d.paginas
        continue
      }
      // No cabe en el límite de páginas visuales. Si trae algo de texto se
      // aprovecha (mejor eso que nada); si no, se reporta con la cifra
      // concreta para que el docente sepa exactamente qué pasó.
      const base = `Tiene ${d.paginas} páginas y los documentos visuales (PDF hechos de imágenes) admiten un máximo de ${maxPaginasVisual} páginas`
      if (d.texto) {
        textos.push(d.texto)
        avisos.push({ url: d.url, codigo: CODIGO_EXCEDE_PAGINAS, paginas: d.paginas, motivo: `${base}: solo se usó el texto que se pudo extraer.` })
      } else {
        avisos.push({ url: d.url, codigo: CODIGO_EXCEDE_PAGINAS, paginas: d.paginas, motivo: `${base}.` })
      }
      continue
    }

    avisos.push({ url: d.url, motivo: d.motivo || 'No se pudo procesar el documento.' })
  }

  const texto = textos.length
    ? textos.map((t, i) => `"""[${etiqueta} ${i + 1}]\n${t}\n"""`).join('\n\n')
    : null
  return { texto, bloques, avisos, paginasVisuales, paginasVisualesSolicitadas }
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
    // quien llama a esta variante solo sabe mandar texto. Desde el
    // 17-sep-2026 todas las operaciones que aceptan PDF usan
    // fuentesManualRequeridas (o bloqueFuentesOperacion, que la usa); esta
    // queda para el Chat, que es de solo texto a propósito. Se dice tal cual
    // en vez de acusar al archivo de inválido.
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
  if (!lista.length) return { texto: null, textoSinBloques: null, bloques: [], avisos: [], paginasVisuales: 0, paginasVisualesSolicitadas: 0 }
  const r = await prepararFuentes(lista, { ...opciones, etiqueta: 'Documento' })
  return { ...r, texto: conIntro(INTRO_MANUAL, r, { exigirLectura: true }), textoSinBloques: soloTexto(INTRO_MANUAL, r) }
}

/**
 * La capa común para TODA operación que acepta PDF/Word como fuente
 * (17-sep-2026): documentos que el docente eligió para esta operación — o
 * que la operación exige, como el programa de estudios — leídos por el camino
 * que a cada uno le toca (texto si tiene capa de texto, visión si su
 * contenido está en imágenes), dentro del presupuesto de páginas visuales de
 * la operación.
 *
 * Devuelve lo mismo que fuentesManual: `texto` (para el prompt; incluye la
 * nota que le anuncia al modelo los PDF que viajan como imagen), `bloques`
 * (esos PDF, para `bloquesPrefijo` de pedirJSON), `avisos` y
 * `paginasVisuales`. Si había documentos y NINGUNO se pudo usar —dañado, en
 * blanco, formato no soportado, o más páginas visuales que el presupuesto—,
 * lanza con el motivo real. Corre en el precheck, así que eso ocurre antes
 * de reservar créditos.
 */
async function fuentesManualRequeridas(urls, opciones = {}) {
  const { rechazarExcedente = false, ...opcionesFuentes } = opciones
  const lista = (Array.isArray(urls) ? urls : []).filter(Boolean)
  const r = await fuentesManual(lista, opcionesFuentes)
  // Con `rechazarExcedente` (crear evaluación y reactivos, 6-oct-2026) los
  // documentos que el docente adjuntó a mano NO se descartan en silencio si
  // rebasan el límite de páginas visuales: la operación se detiene ANTES de
  // reservar créditos y se le dice cuánto es el máximo. Los demás usos
  // conservan su comportamiento de siempre (se omite el documento y se avisa).
  if (rechazarExcedente && r.avisos.some((a) => a.codigo === CODIGO_EXCEDE_PAGINAS)) {
    throw new HttpsError('failed-precondition',
      mensajeExcedePaginas(r.paginasVisualesSolicitadas, opcionesFuentes.maxPaginasVisual ?? MAX_PAGINAS_VISUAL),
      { codigo: 'EXCEDE_PAGINAS_VISUALES' })
  }
  if (lista.length && !r.texto && !r.bloques.length) {
    const motivo = r.avisos[0]?.motivo || 'No se pudo procesar el documento.'
    throw new HttpsError('failed-precondition',
      `No se pudo usar ninguno de los documentos que adjuntaste. ${motivo} Corrígelo o continúa sin adjuntarlos. No se descontaron créditos.`)
  }
  return r
}

/** El mensaje que ve el docente cuando lo que adjuntó rebasa el límite de páginas visuales (30 en crear evaluación y reactivos). */
function mensajeExcedePaginas(paginas, max) {
  const que = `Los documentos visuales (PDF hechos de imágenes, como escaneos o infografías) que adjuntaste suman ${paginas} páginas y el máximo es de ${max} páginas`
  return `${que}. Quita alguno o adjunta solo las secciones que necesites. No se descontaron créditos.`
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
  if (!lista.length) return { texto: null, textoSinBloques: null, bloques: [], avisos: [], paginasVisuales: 0, paginasVisualesSolicitadas: 0 }
  const r = await prepararFuentes(lista, { ...opciones, etiqueta: 'Fuente general' })
  return { ...r, texto: conIntro(INTRO_GENERAL, r), textoSinBloques: soloTexto(INTRO_GENERAL, r) }
}

const INTRO_MANUAL = 'MATERIAL APORTADO POR EL DOCENTE — segundo insumo en orden de prioridad (úsalos como base directa para desarrollar lo que el docente indicó; tienen prioridad sobre la planeación didáctica):\n'
const INTRO_GENERAL = 'Fuentes generales de la asignatura, guardadas por el docente en la pestaña Planeación Didáctica (contexto de referencia; úsalas solo cuando el docente no haya indicado instrucciones ni adjuntado material más específico):\n'

// Clave que el modelo devuelve cuando no puede leer los PDF que se le
// mandaron a mirar (17-sep-2026). pedirJSON (functions/ia.js) la detecta y
// detiene la operación: el callable reembolsa la reserva completa.
const CLAVE_DOCUMENTO_ILEGIBLE = 'documentoIlegible'
const MENSAJE_DOCUMENTO_ILEGIBLE =
  'No se pudo leer el contenido del documento que adjuntaste: sus páginas están en blanco o la imagen es ' +
  'ilegible. Usa una versión más clara del documento o continúa sin adjuntarlo. No se descontaron créditos.'

/**
 * La línea que le anuncia al modelo los PDF que viajan como imagen: sin ella
 * el prompt no los menciona y el modelo no sabe qué son las páginas que le
 * llegan adjuntas. Con `exigirLectura` (documentos que el docente eligió o
 * que la operación exige) se le pide además que NO invente si no los puede
 * leer — un escaneo borroso no se distingue de uno bueno sin mirarlo, y
 * mirarlo es justo lo que hace el modelo.
 */
function notaDocumentosVisuales(cantidad, { exigirLectura = false } = {}) {
  if (!cantidad) return null
  let nota =
    `Se adjuntan además ${cantidad} documento(s) PDF de referencia cuyo contenido está en imágenes ` +
    '(escaneos, infografías, diagramas o capturas). Léelos directamente y trátalos como material fuente ' +
    'con el mismo peso que el texto anterior.'
  if (exigirLectura) {
    nota += ` Si no logras leer NINGUNO de los documentos PDF adjuntos (páginas en blanco o imagen ilegible), ` +
      `no inventes contenido: responde únicamente {"${CLAVE_DOCUMENTO_ILEGIBLE}": true} en lugar del JSON indicado.`
  }
  return nota
}

// Arma el texto final del bloque: el texto extraído más, si hay documentos
// que viajan como imagen (bloque nativo), la nota que se los anuncia.
function conIntro(intro, { texto, bloques }, { exigirLectura = false } = {}) {
  const partes = []
  if (texto) partes.push(intro + texto)
  const nota = notaDocumentosVisuales(bloques.length, { exigirLectura })
  if (nota) partes.push(nota)
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
  prepararFuentes, fuentesManual, fuentesManualRequeridas, fuentesGenerales,
  MAX_PAGINAS_VISUAL, MIN_PAGINAS_VISUAL, presupuestoPaginasVisual, CODIGO_EXCEDE_PAGINAS, mensajeExcedePaginas,
  notaDocumentosVisuales, CLAVE_DOCUMENTO_ILEGIBLE, MENSAJE_DOCUMENTO_ILEGIBLE,
}
