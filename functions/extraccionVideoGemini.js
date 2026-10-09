// Extracción de contenido de un video de YouTube con Gemini — Video interactivo con IA.
//
// Gemini SOLO lee el video y devuelve su contenido organizado por tiempo. Las
// preguntas las sigue generando Claude Haiku 4.5 (functions/videoInteractivoIA.js).
//
// Qué sale de aquí: NO una transcripción literal. Es «contenido extraído del
// video»: segmentos con su marca de tiempo (`inicioSeg`) y un texto que resume lo
// que se dice y se muestra en ese tramo. Nada se guarda: vive en memoria durante
// la operación.
//
// API: la REST oficial de Gemini (`generateContent`) con la URL pública de YouTube
// como `fileData.fileUri` — el formato probado antes en las pruebas de
// diagnóstico (ya eliminadas). Según la documentación de Google solo se admiten
// videos PÚBLICOS (no los «no listados» ni privados).
//
// Credencial: ÚNICAMENTE la variable de entorno GEMINI_API_KEY. Nunca en el
// código, en logs, en mensajes de error ni hacia el cliente. Viaja en la cabecera
// `x-goog-api-key`, no en la URL. Sin ella hay un error controlado. Este módulo no
// crea secretos, funciones ni endpoints: lo llama el precheck de
// `generar_preguntas_video` dentro de `ejecutarOperacionIA`.
//
// COBRO: aquí no se toca el libro de créditos. El precheck corre ANTES de reservar:
// cualquier ErrorExtraccion detiene la operación sin que exista una reserva.
//
// Reintentos: solo fallas TRANSITORIAS (429/500/502/503/504, red, tiempo agotado,
// respuesta vacía o ilegible), con espera creciente y dentro de un presupuesto
// total de tiempo. Los errores permanentes (clave, URL, video inaccesible,
// solicitud rechazada, contenido bloqueado) no se reintentan, y un error temporal
// nunca se presenta como «video no apto».

const { logger } = require('firebase-functions')
const { extraerVideoIdYouTube, urlCanonicaYouTube } = require('./_shared/videoInteractivo.js')

const MODELO_POR_OMISION = 'gemini-3.5-flash-lite' // el probado; cambiable con GEMINI_VIDEO_MODELO
const URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// ejecutarOperacionIA tiene 300 s. La extracción ocurre en el precheck y después
// vienen 1–2 llamadas a Haiku (≈ 30–60 s): a la extracción se le dan, como máximo, 150 s.
const DEFAULTS = {
  maxIntentos: 3,
  esperasMs: [5000, 15000], // antes del 2.º y del 3.er intento (espera creciente)
  timeoutLlamadaMs: 90000,
  presupuestoTotalMs: 150000,
  margenMinimoMs: 12000, // no se arranca un intento con menos tiempo que este
}
let sobreescritos = {} // solo pruebas

function enteroEnv(nombre) {
  const n = Number.parseInt(process.env[nombre], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}
function configuracion() {
  return {
    ...DEFAULTS,
    ...(enteroEnv('GEMINI_VIDEO_TIMEOUT_MS') && { timeoutLlamadaMs: enteroEnv('GEMINI_VIDEO_TIMEOUT_MS') }),
    ...(enteroEnv('GEMINI_VIDEO_PRESUPUESTO_MS') && { presupuestoTotalMs: enteroEnv('GEMINI_VIDEO_PRESUPUESTO_MS') }),
    modelo: process.env.GEMINI_VIDEO_MODELO || MODELO_POR_OMISION,
    ...sobreescritos,
  }
}

const MAX_SEGMENTOS = 400
const MAX_TEXTO_SEGMENTO = 700
const TOKENS_VIDEO_POR_SEG = 90 // observado: 88–91 tokens de video por segundo
const CARACTERES_POR_PREGUNTA = 40 // contenido mínimo que respalda una pregunta
const MIN_CARACTERES_SEGMENTO_UTIL = 20

class ErrorExtraccion extends Error {
  // `transitorio`: la causa es del servicio, no del video — vale reintentar más tarde.
  constructor(codigo, mensaje, { transitorio = false, detalle = null } = {}) {
    super(mensaje)
    this.name = 'ErrorExtraccion'
    this.codigo = codigo
    this.transitorio = transitorio
    this.detalle = detalle
  }
}

const PREFIJO = 'No fue posible leer el contenido del video.'
const MENSAJES = {
  GEMINI_NO_CONFIGURADO: 'La lectura de videos no está disponible en este momento. Avisa al administrador.',
  GEMINI_AUTENTICACION: 'La lectura de videos no está disponible en este momento. Avisa al administrador.',
  URL_INVALIDA: 'La URL no es un enlace válido de YouTube.',
  VIDEO_INACCESIBLE: `${PREFIJO} El video debe ser público (no privado ni «no listado») y estar disponible.`,
  SOLICITUD_RECHAZADA: `${PREFIJO} No se pudo procesar este video.`,
  CONTENIDO_BLOQUEADO: `${PREFIJO} El contenido del video no se pudo procesar.`,
  RESPUESTA_INVALIDA: `${PREFIJO} No se obtuvo un resultado utilizable; intenta de nuevo.`,
  CONTENIDO_INSUFICIENTE: `${PREFIJO} El video no tiene suficiente contenido para formular preguntas.`,
  EXTRACCION_NO_DISPONIBLE: 'El servicio que lee los videos está saturado en este momento. Intenta de nuevo en unos minutos.',
  EXTRACCION_TIEMPO_AGOTADO: 'La lectura del video tardó demasiado. Intenta de nuevo; un video más corto suele ayudar.',
}
const crearError = (codigo, opciones) => new ErrorExtraccion(codigo, MENSAJES[codigo] || PREFIJO, opciones)

// ── Credencial ─────────────────────────────────────────────────────────────
function leerClave() {
  const clave = String(process.env.GEMINI_API_KEY || '').trim()
  // Solo forma: ASCII imprimible sin espacios y de longitud razonable. Una clave
  // válida pero revocada pasa esto y Google responde 401/403/400: camino correcto.
  if (!/^[\x21-\x7E]{20,}$/.test(clave)) {
    logger.error(`GEMINI_API_KEY ${clave ? `tiene un formato inválido (${clave.length} caracteres)` : 'no está definida'}: la extracción de video no puede operar.`)
    throw crearError('GEMINI_NO_CONFIGURADO')
  }
  return clave
}

// Cualquier cosa que parezca una clave/token larga se tacha antes de registrar.
const sinSecretos = (s) => String(s || '').replace(/[A-Za-z0-9_.~-]{24,}/g, '[…]').replace(/\s+/g, ' ').slice(0, 200)

// ── Formato de tiempo ──────────────────────────────────────────────────────
function formatearMinuto(seg) {
  const s = Math.max(0, Math.floor(Number(seg) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

// «12:34» → 754 · «1:02:05» → 3725 · «754» → 754. Cualquier otra cosa → null.
function leerTiempo(texto) {
  const t = String(texto || '').trim()
  if (/^\d{1,6}$/.test(t)) return Number(t) || null
  const m = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/.exec(t)
  if (!m) return null
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

// ── Prompt de extracción ───────────────────────────────────────────────────
// Gemini no genera preguntas ni evalúa: solo describe el contenido por tramos.
const PROMPT_EXTRACCION =
  'Analiza este video de YouTube y extrae su contenido para que otra persona pueda formular preguntas de ' +
  'comprensión SIN verlo. Escribe en español, aunque el video esté en otro idioma.\n\n' +
  'Responde EXACTAMENTE con este formato, sin texto adicional:\n' +
  'IDIOMA: <código del idioma hablado, por ejemplo es o en; «ninguno» si no hay habla>\n' +
  'HABLA: <si | no>\n' +
  'DURACION: <duración total del video en m:ss o h:mm:ss>\n' +
  '[m:ss] <contenido de ese tramo>\n' +
  '[m:ss] <contenido del siguiente tramo>\n' +
  '…\n\n' +
  'Reglas:\n' +
  '- Una línea por tramo de 20 a 45 segundos, que cubra TODO el video en orden. Usa [h:mm:ss] si pasa de una hora.\n' +
  '- En cada línea escribe, en 1 a 3 oraciones, lo concreto de ese tramo: ideas, definiciones, datos, cifras, nombres, ' +
  'ejemplos y explicaciones que se dicen o se muestran. Sé específico, no genérico.\n' +
  '- Si hay habla, recoge lo que se explica, no solo lo visual. Si no hay habla, describe lo que ocurre y dilo con HABLA: no.\n' +
  '- Omite los tramos sin contenido relevante (música, créditos). No inventes nada que no aparezca en el video.\n' +
  '- NO escribas preguntas, evaluaciones ni opiniones.'

// ── Lectura de la respuesta de Gemini ──────────────────────────────────────
// Línea de segmento: «[00:12] texto», «[1:02:05] texto», «[00:12-00:40] texto»
// (también con viñeta o negritas). Lo que no tiene marca se une al segmento anterior.
const RE_SEGMENTO = /^\s*(?:[-*•]\s*)?\[\s*((?:\d{1,2}:)?\d{1,3}:\d{2})\s*(?:[-–—]\s*(?:\d{1,2}:)?\d{1,3}:\d{2}\s*)?\]\s*[-–—:.]?\s*(.*)$/
const RE_ENCABEZADO = /^\s*(IDIOMA|HABLA|DURACI[OÓ]N)\s*:\s*(.+?)\s*$/i

function parsearRespuesta(texto) {
  const salida = { segmentos: [], idioma: null, habla: null, duracionDeclaradaSeg: null }
  for (const cruda of String(texto || '').split(/\r?\n/)) {
    const linea = cruda.replace(/\*\*/g, '').replace(/^#+\s*/, '')
    if (!linea.trim()) continue
    const seg = RE_SEGMENTO.exec(linea)
    if (seg) {
      const inicio = leerTiempo(seg[1])
      const contenido = seg[2].replace(/\s+/g, ' ').trim()
      if (inicio !== null && contenido) salida.segmentos.push({ inicioSeg: inicio, texto: contenido.slice(0, MAX_TEXTO_SEGMENTO) })
      continue
    }
    const enc = RE_ENCABEZADO.exec(linea)
    if (enc && salida.segmentos.length === 0) {
      const clave = enc[1].toUpperCase()
      if (clave === 'IDIOMA') salida.idioma = /ninguno/i.test(enc[2]) ? null : enc[2].toLowerCase().slice(0, 12)
      else if (clave === 'HABLA') salida.habla = /^s[ií]/i.test(enc[2]) ? true : /^no/i.test(enc[2]) ? false : null
      else salida.duracionDeclaradaSeg = leerTiempo(enc[2].replace(/[^\d:]/g, ''))
      continue
    }
    // Continuación de la línea anterior (Gemini a veces parte el renglón).
    const ult = salida.segmentos[salida.segmentos.length - 1]
    if (ult && !/^[\W_]*$/.test(linea)) {
      ult.texto = `${ult.texto} ${linea.replace(/\s+/g, ' ').trim()}`.slice(0, MAX_TEXTO_SEGMENTO)
    }
  }
  // En orden de tiempo; dos con la misma marca se funden en uno.
  salida.segmentos.sort((a, b) => a.inicioSeg - b.inicioSeg)
  const unicos = []
  for (const s of salida.segmentos) {
    const prev = unicos[unicos.length - 1]
    if (prev && prev.inicioSeg === s.inicioSeg) prev.texto = `${prev.texto} ${s.texto}`.slice(0, MAX_TEXTO_SEGMENTO)
    else unicos.push({ ...s })
  }
  salida.segmentos = unicos.slice(0, MAX_SEGMENTOS)
  return salida
}

// Gemini no devuelve la duración como dato: se pide en el texto y se contrasta con
// los tokens de video que cobró la API (~90 por segundo). `confiable` solo si las
// dos fuentes concuerdan (±10 %). La última marca solo sirve de duración cuando no
// hay otra fuente: una marca más allá del final NO alarga el video, se descarta.
function resolverDuracion({ declaradaSeg, tokensVideo, ultimaMarcaSeg }) {
  const porTokens = tokensVideo > 0 ? Math.round(tokensVideo / TOKENS_VIDEO_POR_SEG) : null
  let r
  if (declaradaSeg > 0 && porTokens && Math.abs(declaradaSeg - porTokens) <= porTokens * 0.1) {
    r = { duracionSeg: declaradaSeg, duracionFuente: 'declarada_por_gemini', duracionConfiable: true }
  } else if (porTokens) {
    r = { duracionSeg: porTokens, duracionFuente: 'estimada_por_tokens', duracionConfiable: false }
  } else if (declaradaSeg > 0) {
    r = { duracionSeg: declaradaSeg, duracionFuente: 'declarada_por_gemini', duracionConfiable: false }
  } else {
    r = { duracionSeg: ultimaMarcaSeg, duracionFuente: 'ultima_marca', duracionConfiable: false }
  }
  return { ...r, duracionSeg: Math.max(1, Math.round(r.duracionSeg)) }
}

function textoConTiempos(segmentos) {
  return segmentos.map((s) => `[${formatearMinuto(s.inicioSeg)}] ${s.texto}`).join('\n')
}

// Del texto de Gemini al contrato de salida. Lanza RESPUESTA_INVALIDA (transitoria:
// una nueva pasada puede salir bien) si no hay ni un segmento con marca de tiempo.
function construirContenido({ texto, uso, videoId, modelo, intentos, ms }) {
  const p = parsearRespuesta(texto)
  if (p.segmentos.length === 0) throw crearError('RESPUESTA_INVALIDA', { transitorio: true, detalle: { motivo: 'sin_segmentos_con_marca' } })

  const ultimaBruta = p.segmentos[p.segmentos.length - 1].inicioSeg
  const dur = resolverDuracion({ declaradaSeg: p.duracionDeclaradaSeg, tokensVideo: uso.tokensVideo, ultimaMarcaSeg: ultimaBruta })
  // Una marca más allá del final del video no es una marca real: se descarta (no se «corrige»).
  const dentro = p.segmentos.filter((s) => s.inicioSeg <= dur.duracionSeg + 5)
  const descartados = p.segmentos.length - dentro.length
  if (dentro.length === 0) throw crearError('RESPUESTA_INVALIDA', { transitorio: true, detalle: { motivo: 'marcas_fuera_de_rango' } })

  const primera = dentro[0].inicioSeg
  const ultima = dentro[dentro.length - 1].inicioSeg
  dur.duracionSeg = Math.max(dur.duracionSeg, ultima) // una marca válida no cae después del final
  return {
    videoId,
    fuente: 'gemini',
    modelo,
    titulo: null, // Gemini no entrega el título como dato
    idioma: p.idioma,
    habla: p.habla,
    duracionSeg: dur.duracionSeg,
    duracionFuente: dur.duracionFuente,
    duracionConfiable: dur.duracionConfiable,
    segmentos: dentro,
    texto: textoConTiempos(dentro),
    caracteres: dentro.reduce((n, s) => n + s.texto.length, 0),
    cobertura: {
      primeraMarcaSeg: primera,
      ultimaMarcaSeg: ultima,
      proporcion: dur.duracionSeg > 0 ? Math.min(1, Math.round(((ultima - primera) / dur.duracionSeg) * 100) / 100) : 0,
    },
    descartados,
    uso: { ...uso, intentos, ms },
  }
}

// ¿Alcanza el contenido para N preguntas? Mide segmentos, densidad y cobertura
// temporal — nunca un mínimo fijo de caracteres. Devuelve también cuántas
// preguntas SÍ respalda, para poder decirle al docente qué pedir.
function evaluarSuficiencia(contenido, preguntas) {
  const n = Math.max(1, Number(preguntas) || 1)
  const utiles = (contenido?.segmentos || []).filter((s) => s.texto.length >= MIN_CARACTERES_SEGMENTO_UTIL)
  const caracteres = utiles.reduce((a, s) => a + s.texto.length, 0)
  const porSegmentos = utiles.length * 2 // un segmento respalda, como mucho, 2 preguntas
  const porDensidad = Math.floor(caracteres / CARACTERES_POR_PREGUNTA)
  const maximoPreguntas = Math.min(porSegmentos, porDensidad, 20)
  const dur = contenido?.duracionSeg || 0
  const exigeCobertura = n >= 3 && dur >= 60
  const coberturaOk = !exigeCobertura || (contenido?.cobertura?.proporcion ?? 0) >= 0.4
  let motivo = null
  if (maximoPreguntas < n) motivo = porSegmentos < porDensidad ? 'POCOS_SEGMENTOS' : 'POCO_CONTENIDO'
  else if (!coberturaOk) motivo = 'COBERTURA_BAJA'
  return {
    suficiente: motivo === null,
    motivo,
    preguntasSolicitadas: n,
    maximoPreguntas,
    metricas: { segmentosUtiles: utiles.length, caracteres, coberturaProporcion: contenido?.cobertura?.proporcion ?? 0 },
  }
}

function exigirSuficiencia(contenido, preguntas) {
  const ev = evaluarSuficiencia(contenido, preguntas)
  if (ev.suficiente) return ev
  const n = ev.preguntasSolicitadas
  let mensaje
  if (ev.motivo === 'COBERTURA_BAJA') {
    mensaje = `${PREFIJO} Solo se pudo leer una parte del video; intenta de nuevo o usa otro video.`
  } else if (ev.maximoPreguntas >= 1) {
    mensaje = `${PREFIJO} Este video solo aporta contenido para unas ${ev.maximoPreguntas} ${ev.maximoPreguntas === 1 ? 'pregunta' : 'preguntas'} y pediste ${n}; pide menos preguntas.`
  } else {
    mensaje = MENSAJES.CONTENIDO_INSUFICIENTE
  }
  throw new ErrorExtraccion('CONTENIDO_INSUFICIENTE', mensaje, { detalle: ev })
}

// ── Clasificación de errores HTTP de Gemini ────────────────────────────────
// Las heurísticas de texto (clave / modelo / video) se basan en cómo responde la
// API en general; el texto exacto de un video privado o «no listado» aún no se ha
// observado de verdad. Ante la duda, un 4xx es PERMANENTE y no se reintenta.
function clasificarHttp(status, mensajeApi) {
  const m = String(mensajeApi || '')
  const detalle = { status }
  if ([429, 500, 502, 503, 504].includes(status)) return crearError('EXTRACCION_NO_DISPONIBLE', { transitorio: true, detalle })
  // 401 = clave; 402 = créditos prepagados de Gemini agotados (fallo de cuenta, no del video).
  if (status === 401 || status === 402) return crearError('GEMINI_AUTENTICACION', { detalle })
  if (/api[ _-]?key/i.test(m)) return crearError('GEMINI_AUTENTICACION', { detalle })
  if (/\bmodel\b/i.test(m) && !/video|youtube/i.test(m)) return crearError('SOLICITUD_RECHAZADA', { detalle })
  if (/youtube|video|url|private|unlisted|privad/i.test(m)) return crearError('VIDEO_INACCESIBLE', { detalle })
  if (status === 403) return crearError('GEMINI_AUTENTICACION', { detalle })
  return crearError('SOLICITUD_RECHAZADA', { detalle })
}

const FIN_BLOQUEADO = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'])

// Un intento contra Gemini. Devuelve { texto, uso } o lanza ErrorExtraccion.
async function unaLlamada({ clave, modelo, videoUrl, timeoutMs }) {
  // El límite de tiempo es un setTimeout normal (AbortSignal.timeout usa un temporizador que
  // no mantiene vivo el proceso) y cubre la petición Y la lectura del cuerpo de la respuesta.
  const ac = new AbortController()
  const temporizador = setTimeout(() => ac.abort(Object.assign(new Error('tiempo de espera agotado'), { name: 'TimeoutError' })), timeoutMs)
  let resp
  let cuerpo
  try {
    resp = await globalThis.fetch(`${URL_BASE}/${modelo}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': clave },
      body: JSON.stringify({
        contents: [{ parts: [{ fileData: { fileUri: videoUrl } }, { text: PROMPT_EXTRACCION }] }],
        generationConfig: { temperature: 0.2 },
      }),
      signal: ac.signal,
    })
    try { cuerpo = await resp.json() } catch (e) { if (ac.signal.aborted) throw e; cuerpo = null }
  } catch (e) {
    const tiempo = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    throw crearError(tiempo ? 'EXTRACCION_TIEMPO_AGOTADO' : 'EXTRACCION_NO_DISPONIBLE', {
      transitorio: true, detalle: { causa: tiempo ? 'timeout' : 'red', nombre: String(e?.name || '').slice(0, 40) },
    })
  } finally {
    clearTimeout(temporizador)
  }

  if (!resp.ok) throw clasificarHttp(resp.status, cuerpo?.error?.message)
  if (!cuerpo) throw crearError('RESPUESTA_INVALIDA', { transitorio: true, detalle: { motivo: 'json_ilegible' } })

  if (cuerpo.promptFeedback?.blockReason) throw crearError('CONTENIDO_BLOQUEADO', { detalle: { motivo: String(cuerpo.promptFeedback.blockReason).slice(0, 40) } })
  const cand = cuerpo.candidates?.[0]
  if (FIN_BLOQUEADO.has(cand?.finishReason)) throw crearError('CONTENIDO_BLOQUEADO', { detalle: { motivo: cand.finishReason } })
  const texto = (cand?.content?.parts || []).map((p) => p?.text || '').join('').trim()
  if (!texto) throw crearError('RESPUESTA_INVALIDA', { transitorio: true, detalle: { motivo: 'vacia', finishReason: cand?.finishReason || null } })

  const u = cuerpo.usageMetadata || {}
  const tokensVideo = (u.promptTokensDetails || []).filter((d) => d?.modality === 'VIDEO').reduce((n, d) => n + (Number(d.tokenCount) || 0), 0)
  return {
    texto,
    uso: {
      tokensEntrada: u.promptTokenCount ?? null,
      tokensVideo,
      tokensSalida: u.candidatesTokenCount ?? null,
      tokensPensamiento: u.thoughtsTokenCount ?? 0,
    },
  }
}

// ── Punto de entrada ───────────────────────────────────────────────────────
// `opciones.dormir` / `opciones.ahora` existen para las pruebas (sin esperas reales).
async function extraerContenidoVideo(url, opciones = {}) {
  const videoId = extraerVideoIdYouTube(url)
  if (!videoId) throw crearError('URL_INVALIDA')
  const clave = leerClave() // antes de cualquier red
  const cfg = configuracion()
  const dormir = opciones.dormir || ((ms) => new Promise((r) => setTimeout(r, ms)))
  const ahora = opciones.ahora || Date.now
  const inicio = ahora()
  const videoUrl = urlCanonicaYouTube(videoId)

  let ultimo = null
  let intentos = 0
  for (let intento = 1; intento <= cfg.maxIntentos; intento += 1) {
    const restante = cfg.presupuestoTotalMs - (ahora() - inicio)
    if (restante < cfg.margenMinimoMs) break // sin tiempo para otro intento
    intentos = intento
    const t0 = ahora()
    try {
      const r = await unaLlamada({ clave, modelo: cfg.modelo, videoUrl, timeoutMs: Math.min(cfg.timeoutLlamadaMs, restante) })
      const contenido = construirContenido({ ...r, videoId, modelo: cfg.modelo, intentos, ms: ahora() - inicio })
      logger.info('EXTRACCION_VIDEO_OK', {
        videoId, modelo: cfg.modelo, intento, segmentos: contenido.segmentos.length, caracteres: contenido.caracteres,
        duracionSeg: contenido.duracionSeg, duracionFuente: contenido.duracionFuente, descartados: contenido.descartados,
        tokensEntrada: r.uso.tokensEntrada, tokensSalida: r.uso.tokensSalida, ms: ahora() - inicio,
      })
      return contenido
    } catch (e) {
      const ee = e instanceof ErrorExtraccion ? e : crearError('EXTRACCION_NO_DISPONIBLE', { transitorio: true, detalle: { causa: 'inesperado' } })
      if (!(e instanceof ErrorExtraccion)) logger.error('EXTRACCION_VIDEO inesperado:', sinSecretos(e?.message))
      ultimo = ee
      logger.warn('EXTRACCION_VIDEO_FALLO', { videoId, intento, codigo: ee.codigo, transitorio: ee.transitorio, detalle: ee.detalle, ms: ahora() - t0 })
      if (!ee.transitorio) throw ee // permanente: no se reintenta
      if (intento === cfg.maxIntentos) break
      const espera = cfg.esperasMs[Math.min(intento - 1, cfg.esperasMs.length - 1)]
      if (cfg.presupuestoTotalMs - (ahora() - inicio) - espera < cfg.margenMinimoMs) break
      await dormir(espera)
    }
  }

  // Se agotaron los intentos o el tiempo: sigue siendo una falla del servicio, no del video.
  const codigo = ultimo?.codigo === 'EXTRACCION_TIEMPO_AGOTADO' || !ultimo ? 'EXTRACCION_TIEMPO_AGOTADO'
    : ultimo.codigo === 'RESPUESTA_INVALIDA' ? 'RESPUESTA_INVALIDA' : 'EXTRACCION_NO_DISPONIBLE'
  logger.error('EXTRACCION_VIDEO_AGOTADA', { videoId, intentos, ultimoCodigo: ultimo?.codigo || null })
  throw crearError(codigo, { transitorio: true, detalle: { intentos, ultimoCodigo: ultimo?.codigo || null } })
}

module.exports = {
  extraerContenidoVideo, evaluarSuficiencia, exigirSuficiencia, ErrorExtraccion, formatearMinuto,
  _pruebas: {
    parsearRespuesta, resolverDuracion, clasificarHttp, leerTiempo, textoConTiempos, PROMPT_EXTRACCION, configuracion, DEFAULTS,
    sobreescribir: (o) => { sobreescritos = { ...sobreescritos, ...o } },
    restaurar: () => { sobreescritos = {} },
  },
}
