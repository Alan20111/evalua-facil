// Video interactivo con IA — del formulario del docente a las propuestas guardadas.
//
// Este archivo es el ORQUESTADOR: decide el orden de los pasos y qué hacer ante cada
// fallo. No importa Firebase; todo lo que toca el exterior llega por `deps` (ver
// `crearDepsFirebase` en CrearVideoInteractivoModal.jsx), así que se prueba entero con
// simuladores. Reglas que sostiene:
//
//   1. Abrir, configurar, validar y revisar NO cobran. Lo único que cobra es
//      `generar_preguntas_video`, y solo tras la confirmación explícita del docente
//      (eso lo garantiza la pantalla: este archivo se llama DESPUÉS de confirmar).
//   2. La clave de idempotencia se crea UNA vez por confirmación y se guarda en la
//      propia actividad (`videoInteractivo.generacion.intento`) ANTES de llamar a la
//      IA. Si la red se cae, el docente cierra la pestaña o falla el guardado, el
//      servidor devuelve el resultado que ya generó con esa misma clave, sin cobrar
//      de nuevo (el ledger lo guarda en `iaConsumos/{clave}.resultado`).
//   3. Los ids de las propuestas salen de esa clave: guardar dos veces el mismo
//      resultado no duplica nada (guardarPropuestasGeneradas se salta las que existen).
//   4. Un fallo que el servidor declara «sin cobro» borra el intento (la clave ya no
//      sirve: quedó reembolsada) y se puede volver a generar con una clave nueva. Un
//      fallo incierto (red, tiempo agotado) CONSERVA el intento: reintentar es seguro.
import {
  VIDEO_CFG, validarDistribucionVideo, extraerVideoIdYouTube, crearVideoInteractivoInicial, costoGeneracionVideo,
} from './videoInteractivo.js'

export const OPERACION_VIDEO = 'generar_preguntas_video'
export const TIMEOUT_GENERACION_MS = 290000
export const MIN_NOMBRE = 3
export const MAX_NOMBRE = 120

const CLASES = { SIN_COBRO: 'sin_cobro', INCIERTO: 'incierto', EN_PROCESO: 'en_proceso', GUARDADO: 'guardado' }
export const CLASE_ERROR = CLASES

export class ErrorGeneracionVideo extends Error {
  constructor(clase, mensaje, { actividadId = null, original = null, codigo = null, intento = null } = {}) {
    super(mensaje)
    this.name = 'ErrorGeneracionVideo'
    this.clase = clase
    this.actividadId = actividadId
    this.original = original
    this.codigo = codigo
    this.intento = intento // para reintentar con la MISMA clave
  }
  // ¿Reintentar con la MISMA clave es seguro y útil?
  get reintentable() { return this.clase !== CLASES.SIN_COBRO }
}

// ── Configuración: lo que el docente captura ───────────────────────────────────────
// `costoPorPregunta` es la tarifa vigente (config/iaTarifas); si no se conoce aún, la
// de VIDEO_CFG (el servidor se niega a operar si no coinciden, ver el precheck).
export function validarConfiguracion({ nombre, url, distribucion }, costoPorPregunta = VIDEO_CFG.CREDITOS_POR_PREGUNTA) {
  const errores = {}
  const n = String(nombre ?? '').trim()
  if (n.length < MIN_NOMBRE) errores.nombre = 'Escribe el nombre de la actividad.'
  else if (n.length > MAX_NOMBRE) errores.nombre = `El nombre admite hasta ${MAX_NOMBRE} caracteres.`
  const videoId = extraerVideoIdYouTube(url)
  if (!videoId) errores.url = 'Pega un enlace de YouTube válido (youtube.com/watch?v=… o youtu.be/…). El video debe ser público o no listado.'
  const dist = validarDistribucionVideo(distribucion)
  if (!dist.ok) errores.distribucion = dist.error
  const total = dist.total
  const creditos = dist.ok ? Math.round(total * costoPorPregunta * 100) / 100 : 0
  return { ok: Object.keys(errores).length === 0, errores, videoId, total, creditos, distribucion: dist.distribucion }
}

// Textos del costo: el docente ve SIEMPRE lo que se va a cobrar y qué pasa si la IA entrega menos.
export function textoCostoGeneracion(total, costoPorPregunta = VIDEO_CFG.CREDITOS_POR_PREGUNTA) {
  const creditos = Math.round(total * costoPorPregunta * 100) / 100
  return `Generar ${total} ${total === 1 ? 'pregunta' : 'preguntas'}: hasta ${creditos} ${creditos === 1 ? 'crédito' : 'créditos'} (${costoPorPregunta} por pregunta). Solo se cobran las preguntas que realmente se entreguen.`
}

// ── Documento de la actividad ─────────────────────────────────────────────────────────
// Misma forma que crea CrearEvaluacionIAModal (nace OCULTA: el docente revisa y publica
// desde el editor) + la capa de video. `extra` agrega los campos que ponen quienes
// llaman (createdAt con serverTimestamp, valores por omisión de la evaluación…).
export function documentoActividadVideo({ nombre, url, categoria = 'cuestionario', parcial, orden, asignaturaId, docenteId, intento, evaluacion, extra = {} }) {
  const video = crearVideoInteractivoInicial(url)
  if (!video) throw new Error('URL de YouTube no válida')
  return {
    nombre: String(nombre).trim(),
    categoria,
    tipo: 'evaluacion',
    modalidad: VIDEO_CFG.MODALIDAD,
    videoInteractivo: { ...video, generacion: { ...video.generacion, estado: 'generando', intento } },
    instrucciones: '',
    archivosAdjuntos: [],
    fechaLimite: null,
    recibirTarde: false,
    oculta: true,
    publishAt: null,
    publishedAt: null,
    maxCalif: 10,
    notificarDocente: false,
    evaluacion,
    parcial, orden, asignaturaId, docenteId,
    ...extra,
  }
}

export function nuevoIntento({ clave, url, distribucion, asignaturaId, ahora = new Date() }) {
  return { idempotencyKey: clave, url, distribucion, asignaturaId, solicitadoEn: ahora.toISOString() }
}

// ── Clasificación de errores ───────────────────────────────────────────────────────────
// Todo error con `codigo` del servidor, o con el mensaje «No se descontaron créditos»,
// ocurrió ANTES de reservar o fue reembolsado. Los de red/tiempo no dicen nada: no se sabe
// si el servidor llegó a ejecutar, así que se conserva la clave.
const SDK_SIN_COBRO = ['functions/invalid-argument', 'functions/permission-denied', 'functions/not-found', 'functions/unauthenticated', 'functions/failed-precondition', 'functions/resource-exhausted']

export function clasificarErrorGeneracion(err) {
  const sdk = String(err?.codigoSDK || '')
  if (err?.estadoPrevio === 'reservado' || sdk === 'functions/aborted') return CLASES.EN_PROCESO
  if (err?.estadoPrevio) return CLASES.SIN_COBRO
  if (err?.codigo) return CLASES.SIN_COBRO
  if (/no se descontaron cr[eé]ditos/i.test(String(err?.message || ''))) return CLASES.SIN_COBRO
  if (SDK_SIN_COBRO.includes(sdk)) return CLASES.SIN_COBRO
  return CLASES.INCIERTO
}

export function mensajeParaClase(clase, err) {
  switch (clase) {
    case CLASES.SIN_COBRO:
      if (err?.estadoPrevio) return 'La generación anterior no se completó y no se cobró nada. Puedes generar de nuevo.'
      return String(err?.message || 'No se pudo generar las preguntas. No se descontaron créditos.')
    case CLASES.EN_PROCESO:
      return 'La generación sigue en proceso. Espera unos segundos y toca «Reintentar»: no se cobrará dos veces.'
    case CLASES.GUARDADO:
      return 'Las preguntas se generaron pero no se pudieron guardar. Toca «Reintentar»: se recuperan sin volver a cobrar.'
    default:
      return 'No pudimos confirmar si la generación terminó. Toca «Reintentar»: si ya terminó se recupera sin volver a cobrar.'
  }
}

// ── Generar en una actividad que ya existe ────────────────────────────────────────────
// `intento` = { idempotencyKey, url, distribucion, asignaturaId }. Sirve igual para la
// primera vez, para reintentar y para recuperar al reabrir la actividad: con la misma
// clave el servidor no cobra dos veces.
export async function generarEnActividad(deps, actividadId, intento) {
  const dist = validarDistribucionVideo(intento?.distribucion)
  if (!dist.ok || !extraerVideoIdYouTube(intento?.url) || !intento?.idempotencyKey || !intento?.asignaturaId) {
    throw new ErrorGeneracionVideo(CLASES.SIN_COBRO, 'Los datos de la generación no son válidos.', { actividadId, intento })
  }
  const params = { asignaturaId: intento.asignaturaId, url: intento.url, distribucion: dist.distribucion }

  let data
  try {
    data = await deps.ejecutar(OPERACION_VIDEO, params, dist.total, { timeoutMs: TIMEOUT_GENERACION_MS, idempotencyKey: intento.idempotencyKey })
  } catch (err) {
    const clase = clasificarErrorGeneracion(err)
    if (clase === CLASES.SIN_COBRO) {
      // La clave quedó reembolsada: ya no sirve para recuperar nada. Se limpia para que el
      // docente pueda volver a intentarlo con una nueva.
      await deps.actualizarActividad(actividadId, { 'videoInteractivo.generacion.estado': 'fallida', 'videoInteractivo.generacion.intento': null }).catch(() => {})
    }
    throw new ErrorGeneracionVideo(clase, mensajeParaClase(clase, err), { actividadId, original: err, codigo: err?.codigo || null, intento })
  }

  const res = data?.resultado
  const preguntas = Array.isArray(res?.preguntas) ? res.preguntas : []
  if (!preguntas.length) {
    // El servidor cobró (o recuperó) algo que aquí no se puede leer: no se pierde, se reintenta.
    throw new ErrorGeneracionVideo(CLASES.INCIERTO, mensajeParaClase(CLASES.INCIERTO), { actividadId, intento })
  }

  let nuevas
  try {
    nuevas = await deps.guardarPropuestas(actividadId, preguntas, intento.idempotencyKey)
  } catch (err) {
    throw new ErrorGeneracionVideo(CLASES.GUARDADO, mensajeParaClase(CLASES.GUARDADO), { actividadId, original: err, intento })
  }

  const g = res.generacion || {}
  const estado = g.estado === 'incompleta' ? 'incompleta' : 'completa'
  // Cierra el intento: ya no hay nada que recuperar. Si ESTE paso falla las propuestas ya
  // están guardadas; el aviso de «generación pendiente» se resuelve solo la próxima vez
  // (recuperar guarda 0 nuevas y vuelve a intentar cerrar).
  await deps.actualizarActividad(actividadId, {
    'videoInteractivo.duracionSeg': res.videoInteractivo?.duracionSeg ?? null,
    'videoInteractivo.generacion': {
      estado,
      preguntasGeneradas: preguntas.length,
      creditosCobrados: Number.isFinite(data.creditosReales) ? data.creditosReales : (Number.isFinite(g.creditosConsumidos) ? g.creditosConsumidos : null),
      faltantes: Number.isInteger(g.faltantes) ? g.faltantes : 0,
      modeloIA: g.modeloIA || null,
      fechaGeneracion: g.fechaGeneracion || null,
      distribucionPedida: dist.distribucion,
    },
  }).catch(() => {})

  return {
    actividadId, nuevas, entregadas: preguntas.length, pedidas: dist.total, estado,
    creditos: Number.isFinite(data.creditosReales) ? data.creditosReales : null,
    recuperada: !!data.repetida,
  }
}

// ── Crear la actividad y generar ────────────────────────────────────────────────────────
// Se llama SOLO después de que el docente confirmó el costo. Crea la actividad (oculta)
// con el intento ya guardado y luego genera. Si la generación falla la actividad se queda
// (como en CrearEvaluacionIAModal): el error trae su `actividadId` para reintentar sobre ella.
export async function crearYGenerar(deps, cfg) {
  const v = validarConfiguracion(cfg)
  if (!v.ok) throw new ErrorGeneracionVideo(CLASES.SIN_COBRO, Object.values(v.errores)[0])
  const intento = nuevoIntento({ clave: deps.nuevaClave(), url: cfg.url, distribucion: v.distribucion, asignaturaId: cfg.asignaturaId })
  let actividadId
  try {
    actividadId = await deps.crearActividad(documentoActividadVideo({ ...cfg, intento, extra: deps.extraActividad?.() || {} }))
  } catch (err) {
    // Aún no se llamó a la IA: no hay nada que cobrar ni que recuperar.
    throw new ErrorGeneracionVideo(CLASES.SIN_COBRO, 'No se pudo crear la actividad. No se cobró nada; intenta de nuevo.', { original: err })
  }
  return generarEnActividad(deps, actividadId, intento)
}

// Reintento tras un fallo SIN cobro: misma actividad, clave NUEVA (la anterior quedó reembolsada).
export async function reintentarConClaveNueva(deps, actividadId, cfg) {
  const v = validarConfiguracion(cfg)
  if (!v.ok) throw new ErrorGeneracionVideo(CLASES.SIN_COBRO, Object.values(v.errores)[0], { actividadId })
  const intento = nuevoIntento({ clave: deps.nuevaClave(), url: cfg.url, distribucion: v.distribucion, asignaturaId: cfg.asignaturaId })
  await deps.actualizarActividad(actividadId, { 'videoInteractivo.generacion.estado': 'generando', 'videoInteractivo.generacion.intento': intento })
  return generarEnActividad(deps, actividadId, intento)
}

// ¿Hay una generación a medias en esta actividad? (para el aviso del editor)
export function intentoPendiente(actividad) {
  const i = actividad?.videoInteractivo?.generacion?.intento
  return i?.idempotencyKey && i?.url && i?.distribucion && i?.asignaturaId ? i : null
}

export { costoGeneracionVideo }
