// Tarifa de «Calificar con IA» para entregables — regla ÚNICA para la
// calificación individual y la del lote, en la pantalla y en el servidor.
//
// Regla comercial definitiva (Kike, oct-2026): la tarifa es POR ENTREGA, según
// el CONTENIDO de lo que el estudiante entregó (no según los tipos que acepta
// la actividad ni la extensión):
//   · solo texto procesable → tarifa de documentos (hoy 0.25 créditos);
//   · al menos una imagen o texto escaneado — foto, PDF escaneado (aunque
//     traiga capa de texto), PDF o Word con fotografías → tarifa de imágenes
//     (hoy 0.50), una sola vez por entrega aunque traiga varios archivos;
//   · si no se puede clasificar con fiabilidad, la entrega no se califica ni
//     se cobra.
// Los importes viven en config/iaTarifas; aquí solo está QUÉ clave aplica.
// El servidor descarga y revisa cada PDF/Word (functions/evidenciasEntrega.js)
// y usa las funciones puras de abajo para decidir la clase.
//
// Qué archivos son evidencia (sin ampliar formatos):
//   · imagen: jpg, jpeg, png · documento: pdf, docx;
//   · la extensión sale del NOMBRE del archivo y, si no hay nombre, de la URL;
//   · solo se analizan las primeras EVIDENCIAS_CFG.maxPorEntrega válidas;
//     la tarifa se decide con esas (se cobra lo que se analiza);
//   · cualquier otro formato (o sin extensión) se ignora: no se analiza, no
//     cambia la tarifa y, si la entrega no tiene nada válido, no se cobra.
//
// Lógica pura, sin Firebase: se copia a functions/_shared/ con
// scripts/sync-functions-shared.mjs. El servidor la usa para estimar y cobrar;
// la pantalla, para saber qué entregas son candidatas y para escribir el
// desglose. El IMPORTE que ve el docente lo calcula SIEMPRE el servidor.

export const EVIDENCIAS_CFG = Object.freeze({
  imagenes: Object.freeze(['jpg', 'jpeg', 'png']),
  documentos: Object.freeze(['pdf', 'docx']),
  maxPorEntrega: 3,
  // Umbrales de contenido (oct-2026). Medidos sobre 305 PDF y 8 Word reales
  // (23-oct-2026): un PDF de texto rinde ≥200 caracteres por página (el mismo
  // umbral que ya usa functions/docExtract.js), y una fotografía o escaneo
  // mide ≥200 px por lado; logotipos e iconos quedan por debajo. No son
  // garantías universales: lo que no se puede medir se marca como incierto.
  minCaracteresPorPagina: 200,
  ladoMinimoFotoPx: 200,
})
const EXT_IMAGEN_EVIDENCIA = EVIDENCIAS_CFG.imagenes
const EXT_DOCUMENTO_EVIDENCIA = EVIDENCIAS_CFG.documentos

// Claves de config/iaTarifas por modo y tipo de entrega.
export const CLAVES_TARIFA_CALIFICACION = {
  individual: { imagenes: 'calificar_entregable_ia_imagenes', documentos: 'calificar_entregable_ia' },
  lote: { imagenes: 'calificar_entregable_ia_lote_imagenes', documentos: 'calificar_entregable_ia_lote' },
}

const redondear2 = (n) => Math.round(n * 100) / 100

export function extensionEvidencia(url, nombre) {
  const s = String(nombre || url || '').split('?')[0]
  const m = /\.([a-z0-9]+)$/i.exec(s)
  return m ? m[1].toLowerCase() : ''
}

export function esImagenEvidencia(ext) {
  return EXT_IMAGEN_EVIDENCIA.includes(ext)
}

export function esEvidenciaSoportada(nombre, url) {
  const ext = extensionEvidencia(url, nombre)
  return EXT_IMAGEN_EVIDENCIA.includes(ext) || EXT_DOCUMENTO_EVIDENCIA.includes(ext)
}

// Archivos de una entrega: `archivos[]` o, en entregas viejas de un solo
// archivo, el par archivoURL/nombreArchivo. «Completada sin archivo» no tiene
// evidencia. Solo cuentan los que tienen URL.
export function archivosDeEntrega(sub) {
  if (!sub || sub.completadoSinArchivo) return []
  const lista = Array.isArray(sub.archivos) && sub.archivos.length
    ? sub.archivos
    : (sub.archivoURL ? [{ url: sub.archivoURL, nombre: sub.nombreArchivo }] : [])
  return lista.filter((a) => a && a.url).map((a) => ({ url: a.url, nombre: a.nombre }))
}

// Evidencias válidas que se analizarían (ya con el tope) y lo que queda fuera.
export function evidenciasValidas(archivos) {
  const lista = (Array.isArray(archivos) ? archivos : []).filter((a) => a && a.url)
  const elegibles = []
  let ignoradosPorFormato = 0
  for (const a of lista) {
    const ext = extensionEvidencia(a.url, a.nombre)
    if (EXT_IMAGEN_EVIDENCIA.includes(ext) || EXT_DOCUMENTO_EVIDENCIA.includes(ext)) elegibles.push({ ...a, ext })
    else ignoradosPorFormato++
  }
  const usados = elegibles.slice(0, EVIDENCIAS_CFG.maxPorEntrega)
  return { usados, ignoradosPorFormato, ignoradosPorTope: elegibles.length - usados.length }
}

// ── Clasificación por CONTENIDO (oct-2026, regla definitiva de Kike) ───────
// Cada archivo queda en una de cuatro clases:
//   · 'imagenes'   — hay que interpretar imágenes: foto, PDF escaneado (aunque
//                    traiga capa de texto de la app), PDF o Word con fotografías,
//                    dibujo vectorial con poco texto → tarifa de imágenes;
//   · 'documentos' — solo texto procesable → tarifa de documentos;
//   · 'vacio'      — no hay nada que evaluar (en blanco): no es evidencia;
//   · 'incierta'   — no se puede saber con fiabilidad (dañado, inaccesible,
//                    imagen que no se puede medir, revisión que no terminó):
//                    la entrega NO se califica ni se cobra.
// `motivo` explica al docente por qué una entrega quedó fuera.

const esFoto = (img) => Number.isFinite(img?.w) && Number.isFinite(img?.h) &&
  Math.min(img.w, img.h) >= EVIDENCIAS_CFG.ladoMinimoFotoPx
const medida = (img) => Number.isFinite(img?.w) && Number.isFinite(img?.h) && img.w > 0 && img.h > 0

// PDF. `tipoBase` es el de functions/docExtract.clasificarBytes ('texto',
// 'mixto', 'visual', 'vacio', 'invalido', 'incierto'); `imagenes`, las
// imágenes incrustadas con su tamaño en px (w/h null si no se pudo leer);
// `trazosVectoriales`: true/false/null (null = no se pudo revisar); solo se
// consulta con poco texto y sin fotografías.
export function clasificarContenidoPdf({ tipoBase, paginas = 0, caracteres = 0, imagenes = [], trazosVectoriales }) {
  if (tipoBase === 'invalido') return { clase: 'incierta', motivo: 'El PDF está dañado o protegido y no se puede abrir.' }
  if (tipoBase === 'incierto') return { clase: 'incierta', motivo: 'No se pudo revisar el contenido del PDF.', reintentable: true }
  if (!paginas) return { clase: 'incierta', motivo: 'No se pudo revisar el contenido del PDF.' }
  if (tipoBase === 'vacio') return { clase: 'vacio', motivo: 'El PDF está en blanco.' }
  if (tipoBase === 'visual') return { clase: 'imagenes', motivo: 'PDF escaneado o de imágenes.' }
  if (imagenes.some(esFoto)) return { clase: 'imagenes', motivo: 'PDF con fotografías o escaneado.' }
  const sinMedir = imagenes.filter((img) => !medida(img)).length
  if (caracteres / paginas >= EVIDENCIAS_CFG.minCaracteresPorPagina) {
    // Texto con, a lo más, imágenes chicas (logotipos, iconos).
    if (sinMedir) return { clase: 'incierta', motivo: 'El PDF trae una imagen cuyo tamaño no se pudo medir.' }
    return { clase: 'documentos', motivo: 'PDF de texto.' }
  }
  // Poco texto por página: el contenido puede estar en imágenes o dibujos.
  if (sinMedir) return { clase: 'incierta', motivo: 'El PDF trae una imagen cuyo tamaño no se pudo medir.' }
  // Escaneos partidos en tiras: muchas imágenes chicas que juntas ocupan lo
  // que una fotografía.
  const area = imagenes.reduce((s, img) => s + img.w * img.h, 0)
  if (area >= EVIDENCIAS_CFG.ladoMinimoFotoPx ** 2) return { clase: 'imagenes', motivo: 'PDF escaneado en partes.' }
  if (trazosVectoriales === true) return { clase: 'imagenes', motivo: 'PDF con dibujos o diagramas que hay que interpretar.' }
  if (trazosVectoriales === false) return { clase: 'documentos', motivo: 'PDF de texto breve.' }
  // undefined: todavía no se revisó (quien llama la revisa y vuelve a preguntar);
  // null: la revisión no terminó — no se sabe, y vale la pena reintentar.
  if (trazosVectoriales === undefined) return { clase: 'incierta', motivo: 'Falta revisar si el PDF trae dibujos.', requiereTrazos: true }
  return { clase: 'incierta', motivo: 'No se pudo revisar si el PDF trae dibujos.', reintentable: true }
}

// Word (.docx). `ok`: se pudo abrir; `texto`: texto extraído; `imagenes`:
// imágenes de mapa de bits incrustadas con su tamaño (w/h null si no se pudo
// leer) y `legible` (si la IA puede recibir ese formato). Los dibujos
// vectoriales de Office (EMF/WMF) no llegan a la IA y no se cuentan aquí.
export function clasificarContenidoDocx({ ok, texto = '', imagenes = [] }) {
  if (!ok) return { clase: 'incierta', motivo: 'El documento Word está dañado o no se pudo abrir.' }
  if (imagenes.some((img) => !medida(img))) return { clase: 'incierta', motivo: 'El Word trae una imagen cuyo tamaño no se pudo medir.' }
  if (imagenes.some((img) => esFoto(img) && img.legible === false)) {
    return { clase: 'incierta', motivo: 'El Word trae una fotografía en un formato que la IA no puede leer.' }
  }
  if (imagenes.some(esFoto)) return { clase: 'imagenes', motivo: 'Word con fotografías.' }
  if (String(texto).trim()) return { clase: 'documentos', motivo: 'Word de texto.' }
  return { clase: 'vacio', motivo: 'El documento Word está vacío.' }
}

// Clase de una ENTREGA a partir de la de sus archivos analizados: cualquier
// incierta → incierta (no se califica a medias ni se cobra a ciegas); si no,
// cualquier imagen → imágenes; si no, documentos. null si no hay evidencia.
export function claseEntrega(clases) {
  const validas = (clases || []).filter((c) => c && c !== 'vacio')
  if (!validas.length) return null
  if (validas.includes('incierta')) return 'incierta'
  return validas.includes('imagenes') ? 'imagenes' : 'documentos'
}

// Tarifas vigentes de un modo ('individual' | 'lote'); null si falta alguna.
export function tarifasCalificacion(tarifas, modo) {
  const claves = CLAVES_TARIFA_CALIFICACION[modo]
  if (!claves) return null
  const imagenes = tarifas?.tarifas?.[claves.imagenes]
  const documentos = tarifas?.tarifas?.[claves.documentos]
  if (typeof imagenes !== 'number' || typeof documentos !== 'number') return null
  return { imagenes, documentos }
}

// Costo de un conjunto de entregas ya clasificadas. `tipos`: lista de
// 'imagenes' | 'documentos' (una por entrega que se cobraría).
export function calcularCostoCalificacion({ tipos, tarifas, modo }) {
  const t = tarifasCalificacion(tarifas, modo)
  if (!t) return null
  const conImagenes = tipos.filter((x) => x === 'imagenes').length
  const soloDocumentos = tipos.filter((x) => x === 'documentos').length
  return {
    modo,
    entregas: conImagenes + soloDocumentos,
    conImagenes,
    soloDocumentos,
    tarifaImagenes: t.imagenes,
    tarifaDocumentos: t.documentos,
    total: redondear2(conImagenes * t.imagenes + soloDocumentos * t.documentos),
  }
}

// Clave de operación con la que se registra el cobro: la de imágenes si TODAS
// las entregas llevan imagen, la base si no (un lote mixto se registra con la
// base y su desglose real va en el detalle). Solo nombra el movimiento; el
// importe es siempre el calculado arriba.
export function claveOperacionCalificacion(costo) {
  const claves = CLAVES_TARIFA_CALIFICACION[costo?.modo]
  if (!claves) return null
  return costo.entregas > 0 && costo.conImagenes === costo.entregas ? claves.imagenes : claves.documentos
}

// ¿La estimación que confirmó el docente es exactamente la que el servidor
// acaba de recalcular? Compara conteos, tarifas, total y la firma (qué
// entregas y de qué tipo). Cualquier diferencia → nueva confirmación.
export function mismaEstimacion(a, b) {
  if (!a || !b) return false
  return a.firma === b.firma &&
    a.entregas === b.entregas &&
    a.conImagenes === b.conImagenes &&
    a.soloDocumentos === b.soloDocumentos &&
    a.tarifaImagenes === b.tarifaImagenes &&
    a.tarifaDocumentos === b.tarifaDocumentos &&
    (a.noClasificables?.length || 0) === (b.noClasificables?.length || 0) &&
    redondear2(a.total) === redondear2(b.total)
}

function formato2(n) {
  return (Number(n) || 0).toFixed(2)
}

function plural(n, uno, varios) {
  return `${n} ${n === 1 ? uno : varios}`
}

// «4 × 0.50 + 6 × 0.25 = 3.50» (solo los tipos que hay).
export function formulaCostoCalificacion(d) {
  const partes = []
  if (d.conImagenes) partes.push(`${d.conImagenes} × ${formato2(d.tarifaImagenes)}`)
  if (d.soloDocumentos) partes.push(`${d.soloDocumentos} × ${formato2(d.tarifaDocumentos)}`)
  if (!partes.length) return formato2(0)
  return `${partes.join(' + ')} = ${formato2(redondear2(d.conImagenes * d.tarifaImagenes + d.soloDocumentos * d.tarifaDocumentos))}`
}

// Desglose para el registro de movimientos y las confirmaciones, p. ej.
// «Lote · 10 entregas · 4 × 0.50 + 6 × 0.25 = 3.50 créditos».
export function textoDesgloseCalificacion(d) {
  if (!d || !Number.isInteger(d.entregas)) return null
  const modo = d.modo === 'lote' ? 'Lote' : 'Individual'
  return `${modo} · ${plural(d.entregas, 'entrega', 'entregas')} · ${formulaCostoCalificacion(d)} créditos`
}
