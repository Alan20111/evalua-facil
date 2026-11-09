// La Ruleta del Destino — fase 0: lógica PURA de la partida.
//
// Sin Firebase, sin React, sin red y sin reloj ni azar propios: quien llama pasa la hora del servidor (`ahoraMs`),
// la clave de la pregunta abierta (`correcta`) y la fuente de azar (`aleatorio`). Así el servidor (fases siguientes)
// y las pruebas aplican exactamente la misma regla, y una prueba con los mismos datos da siempre el mismo resultado.
//
// Decisiones del Product Owner que aplica este archivo:
//   · Partidas de 5 o 10 preguntas; las de 20 se eliminaron (7-nov-2026).
//   · Banco de cantidad EXACTA (9-nov-2026, decisión definitiva del PO; reemplaza las decisiones 6 y 15): 5 reactivos
//     por pregunta, 25 para partidas de 5 y 50 para partidas de 10, se capture a mano o se genere con IA. Sin rangos:
//     ni menos (no se aprueba) ni más (no se guarda). `tamanoBanco`, `minimoBanco`, `maximoBanco` y
//     `reactivosGeneracionIA` devuelven ese mismo número.
//   · Opción múltiple: 4 opciones y una sola correcta.
//   · 15 s para responder cada pregunta, medidos con el reloj del servidor.
//   · Una pregunta sin respuesta (o respondida fuera de tiempo) es incorrecta.
//   · Calificación = (correctas ÷ total de preguntas) × 10. La rapidez NUNCA cambia la calificación.
//   · Solo modalidad individual (7-nov-2026): sin concurso en vivo ni ranking; la competencia en tiempo real es de
//     Reto Exprés.
//   · Nunca se repite una pregunta dentro de una partida ni se juegan más preguntas de las autorizadas.
//
// Lo que este archivo NO decide (pendiente del Product Owner, ver el informe de la fase 0):
//   · El margen de red sobre los 15 s: `margenMs` existe como opción y vale 0 por omisión.
//
// Formas de responder:
//   · Validaciones: { ok, errores } (o { ok, codigo }).
//   · Transiciones de la partida (girar, responder, vencer): { ok: true, partida, ... } o { ok: false, codigo }.
//     Nunca modifican la partida recibida: devuelven una nueva.
//   · Cálculos con datos inválidos (calificación, sorteo): lanzan RangeError o TypeError.
//
// Constantes agrupadas en objetos, como en src/utils/retoExpres.js.

import { calcularCalificacion } from './evaluacionGrading.js'

export const RULETA_CFG = {
  CATEGORIA: 'ruleta',
  PREGUNTAS_POR_PARTIDA: [5, 10],
  // BANCO (manual o IA), 9-nov-2026: cantidad EXACTA por pregunta de la partida (5→25, 10→50). Sin rangos.
  REACTIVOS_POR_PREGUNTA: 5,
  OPCIONES_POR_REACTIVO: 4,
  // Largos máximos (fase 2): el servidor los exige; la pantalla los usa como maxLength.
  MAX_ENUNCIADO: 500,
  MAX_OPCION: 200,
  MAX_NOMBRE: 120,
  MAX_TEMA: 500,
  TIEMPO_RESPUESTA_MS: 15000,
  CALIFICACION_MAXIMA: 10,
}

export const ESTADOS_PARTIDA = {
  lista: 'lista', // esperando que el participante gire
  pregunta: 'pregunta', // hay una pregunta abierta y corre su tiempo
  terminada: 'terminada', // ya se registraron todas las preguntas autorizadas
}

export const MOTIVOS_RESPUESTA = {
  respondida: 'respondida', // llegó dentro del tiempo
  fuera_de_tiempo: 'fuera_de_tiempo', // llegó después del límite: incorrecta, sin tiempo
  sin_respuesta: 'sin_respuesta', // se venció sin respuesta: incorrecta, sin tiempo
}

// ── Utilidades internas ─────────────────────────────────────────────────────

const esEnteroNoNegativo = (n) => Number.isSafeInteger(n) && n >= 0
const esTextoConContenido = (t) => typeof t === 'string' && t.trim().length > 0

/** Texto comparable: sin mayúsculas, acentos ni espacios de más. Sirve para detectar opciones o enunciados repetidos. */
export function normalizarTexto(t) {
  return String(t ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim()
}

function limiteRespuestaMs(margenMs) {
  return RULETA_CFG.TIEMPO_RESPUESTA_MS + margenMs
}

function margenDe(opciones) {
  const margen = opciones?.margenMs ?? 0
  return esEnteroNoNegativo(margen) ? margen : null
}

// ── Configuración y banco ───────────────────────────────────────────────────

export function preguntasPorPartidaValida(n) {
  return RULETA_CFG.PREGUNTAS_POR_PARTIDA.includes(n)
}

/** Los tamaños permitidos para los mensajes («5 o 10»), tomados de `RULETA_CFG` para que no se desfasen. */
export const TEXTO_PREGUNTAS_VALIDAS = RULETA_CFG.PREGUNTAS_POR_PARTIDA.join(' o ')

/**
 * Archivos de apoyo para generar el banco con IA (9-nov-2026, decisión 19): de 1 a 3, PDF, DOC o DOCX, hasta 15 MB
 * cada uno. El servidor (functions/ruletaGeneracion.js → RULETA_IA) aplica exactamente los mismos límites.
 */
export const RULETA_ARCHIVOS = Object.freeze({
  MIN: 1,
  MAX: 3,
  MAX_BYTES: 15 * 1024 * 1024,
  EXTENSIONES: Object.freeze(['pdf', 'doc', 'docx']),
  ACCEPT: '.pdf,.doc,.docx',
})

/** Extensión en minúsculas de un nombre de archivo («Tema 1.DOCX» → «docx»); '' si no tiene. */
export function extensionArchivo(nombre) {
  const base = String(nombre || '').split(/[\\/]/).pop()
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i + 1).toLowerCase() : ''
}

/**
 * Revisa los archivos de apoyo elegidos ({ name | nombre, size | tamano }). Con `completa`, exige además el mínimo
 * (al generar); sin ella solo revisa lo que ya se eligió (al ir agregando). { ok } o { ok: false, codigo, mensaje }.
 */
export function validarArchivosRuleta(archivos, { completa = true } = {}) {
  const lista = Array.isArray(archivos) ? archivos : []
  if (lista.length > RULETA_ARCHIVOS.MAX) return { ok: false, codigo: 'demasiados', mensaje: `Puedes adjuntar máximo ${RULETA_ARCHIVOS.MAX} archivos de apoyo.` }
  for (const a of lista) {
    const nombre = a?.name ?? a?.nombre ?? ''
    if (!RULETA_ARCHIVOS.EXTENSIONES.includes(extensionArchivo(nombre))) {
      return { ok: false, codigo: 'formato', mensaje: `«${nombre || 'El archivo'}» no es PDF, DOC ni DOCX.` }
    }
    const tamano = a?.size ?? a?.tamano
    if (Number.isFinite(tamano) && tamano > RULETA_ARCHIVOS.MAX_BYTES) {
      return { ok: false, codigo: 'tamano', mensaje: `«${nombre}» supera el máximo de 15 MB.` }
    }
  }
  if (completa && lista.length < RULETA_ARCHIVOS.MIN) return { ok: false, codigo: 'sin_archivos', mensaje: 'Adjunta al menos 1 archivo de apoyo (PDF, DOC o DOCX).' }
  return { ok: true }
}

/** Reactivos EXACTOS del banco para una partida de `n` preguntas (5→25, 10→50), manual o generado con IA. */
export function tamanoBanco(n) {
  if (!preguntasPorPartidaValida(n)) throw new RangeError(`Preguntas por partida inválidas: ${n}`)
  return n * RULETA_CFG.REACTIVOS_POR_PREGUNTA
}

/** Máximo del banco: el mismo número exacto (`tamanoBanco`). Un reactivo más se rechaza con `banco_lleno`. */
export function maximoBanco(n) {
  return tamanoBanco(n)
}

/** Reactivos EXACTOS que pide una generación con IA: el mismo número exacto del banco (`tamanoBanco`). */
export function reactivosGeneracionIA(n) {
  return tamanoBanco(n)
}

/** Origen del banco: lo fija SOLO el servidor en `ruletaBancos` (las reglas no dejan escribir a ningún cliente). */
export const ORIGENES_BANCO = Object.freeze({ manual: 'manual', ia: 'ia' })

/** Origen efectivo: solo el valor exacto 'ia' cuenta como IA; ausente o cualquier otro, manual. */
export function origenBanco(banco) {
  return banco?.origen === ORIGENES_BANCO.ia ? ORIGENES_BANCO.ia : ORIGENES_BANCO.manual
}

/** Mínimo para aprobar e iniciar: el mismo número exacto para los dos orígenes (`origen` se conserva por compatibilidad). */
// eslint-disable-next-line no-unused-vars
export function minimoBanco(n, origen = ORIGENES_BANCO.manual) {
  return tamanoBanco(n)
}

/**
 * Un reactivo de la ruleta: { id, enunciado, opciones: [4 textos], correcta: 0..3 }.
 * Devuelve { ok, errores } con códigos estables.
 */
export function validarReactivo(r) {
  const errores = []
  if (!r || typeof r !== 'object') return { ok: false, errores: ['reactivo_invalido'] }
  if (!esTextoConContenido(r.id)) errores.push('id')
  if (!esTextoConContenido(r.enunciado)) errores.push('enunciado')
  else if (r.enunciado.trim().length > RULETA_CFG.MAX_ENUNCIADO) errores.push('enunciado_largo')
  if (!Array.isArray(r.opciones) || r.opciones.length !== RULETA_CFG.OPCIONES_POR_REACTIVO) {
    errores.push('opciones_cantidad')
  } else {
    if (r.opciones.some((o) => !esTextoConContenido(o))) errores.push('opcion_vacia')
    else if (r.opciones.some((o) => o.trim().length > RULETA_CFG.MAX_OPCION)) errores.push('opcion_larga')
    else if (new Set(r.opciones.map(normalizarTexto)).size !== r.opciones.length) errores.push('opciones_repetidas')
  }
  if (!Number.isInteger(r.correcta) || r.correcta < 0 || r.correcta >= RULETA_CFG.OPCIONES_POR_REACTIVO) {
    errores.push('correcta')
  }
  return { ok: errores.length === 0, errores }
}

/**
 * Revisa un banco para partidas de `preguntasPorPartida` preguntas: debe tener EXACTAMENTE `tamanoBanco` reactivos
 * (5→25, 10→50), sea manual o de IA. Con menos: `banco_incompleto`; con más: `banco_excedido`.
 * `ok` exige además reactivos válidos e ids y enunciados sin repetir.
 * `completo` dice si el banco tiene exactamente esa cantidad, aunque haya otros errores.
 */
export function validarBanco(reactivos, preguntasPorPartida, { origen = ORIGENES_BANCO.manual } = {}) {
  const errores = []
  if (!preguntasPorPartidaValida(preguntasPorPartida)) errores.push('preguntas_por_partida')
  if (!Array.isArray(reactivos)) return { ok: false, errores: [...errores, 'banco_no_lista'], total: 0, requerido: null, completo: false }

  const ids = new Set()
  const enunciados = new Set()
  reactivos.forEach((r, i) => {
    const v = validarReactivo(r)
    if (!v.ok) { errores.push(`reactivo_invalido:${i}`); return }
    if (ids.has(r.id)) errores.push(`id_repetido:${i}`)
    ids.add(r.id)
    const clave = normalizarTexto(r.enunciado)
    if (enunciados.has(clave)) errores.push(`enunciado_repetido:${i}`)
    enunciados.add(clave)
  })

  const requerido = preguntasPorPartidaValida(preguntasPorPartida) ? minimoBanco(preguntasPorPartida, origen) : null
  if (requerido != null && reactivos.length < requerido) errores.push('banco_incompleto')
  if (requerido != null && reactivos.length > maximoBanco(preguntasPorPartida)) errores.push('banco_excedido')
  return {
    ok: errores.length === 0,
    errores,
    total: reactivos.length,
    requerido,
    completo: requerido != null && reactivos.length === requerido,
  }
}

// ── Azar ────────────────────────────────────────────────────────────────────

/**
 * Generador determinista (mulberry32) para pruebas y reproducciones: la misma semilla da siempre la misma
 * secuencia en [0, 1). El servidor usará una fuente criptográfica; esta NO lo es.
 */
export function generadorDeterminista(semilla) {
  if (!Number.isInteger(semilla) || semilla < 0 || semilla > 0xFFFFFFFF) throw new RangeError(`Semilla inválida: ${semilla}`)
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Elige `n` ids distintos del banco, en orden aleatorio (Fisher-Yates parcial). No modifica `ids`.
 * `aleatorio` es obligatorio y debe devolver números en [0, 1).
 */
export function sortearPreguntas(ids, n, aleatorio) {
  if (!preguntasPorPartidaValida(n)) throw new RangeError(`Preguntas por partida inválidas: ${n}`)
  if (!Array.isArray(ids) || ids.some((id) => !esTextoConContenido(id))) throw new TypeError('Ids del banco inválidos')
  if (new Set(ids).size !== ids.length) throw new RangeError('El banco tiene ids repetidos')
  if (ids.length < n) throw new RangeError(`El banco tiene ${ids.length} reactivos y la partida pide ${n}`)
  if (typeof aleatorio !== 'function') throw new TypeError('Falta la fuente de azar')

  const copia = ids.slice()
  for (let i = 0; i < n; i++) {
    const x = aleatorio()
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x >= 1) throw new RangeError(`Valor de azar fuera de [0, 1): ${x}`)
    const j = i + Math.floor(x * (copia.length - i))
    ;[copia[i], copia[j]] = [copia[j], copia[i]]
  }
  return copia.slice(0, n)
}

/** ¿Todos los ids del orden siguen existiendo en el banco? (por si el docente lo editó después de sortear). */
export function ordenPerteneceAlBanco(orden, idsBanco) {
  if (!Array.isArray(orden) || !Array.isArray(idsBanco)) return false
  const banco = new Set(idsBanco)
  return orden.every((id) => banco.has(id))
}

// ── Partida ─────────────────────────────────────────────────────────────────

/** Nueva partida a partir de un orden ya sorteado. */
export function crearPartida({ orden, preguntasPorPartida } = {}) {
  if (!preguntasPorPartidaValida(preguntasPorPartida)) return { ok: false, codigo: 'preguntas_por_partida' }
  if (!Array.isArray(orden) || orden.length !== preguntasPorPartida) return { ok: false, codigo: 'orden_tamano' }
  if (orden.some((id) => !esTextoConContenido(id))) return { ok: false, codigo: 'orden_id_invalido' }
  if (new Set(orden).size !== orden.length) return { ok: false, codigo: 'orden_repetido' }
  return {
    ok: true,
    partida: {
      preguntasPorPartida,
      orden: orden.slice(),
      indice: 0,
      estado: ESTADOS_PARTIDA.lista,
      abierta: null,
      respuestas: [],
    },
  }
}

function respuestaValida(r, i, partida) {
  if (!r || typeof r !== 'object') return false
  if (r.indice !== i || r.reactivoId !== partida.orden[i]) return false
  if (!Object.values(MOTIVOS_RESPUESTA).includes(r.motivo)) return false
  if (typeof r.correcta !== 'boolean') return false
  if (r.motivo === MOTIVOS_RESPUESTA.respondida) {
    return Number.isInteger(r.opcion) && r.opcion >= 0 && r.opcion < RULETA_CFG.OPCIONES_POR_REACTIVO &&
      esEnteroNoNegativo(r.tiempoMs) && r.tiempoMs <= RULETA_CFG.TIEMPO_RESPUESTA_MS
  }
  // Sin respuesta o fuera de tiempo: siempre incorrecta y sin tiempo.
  return r.correcta === false && r.tiempoMs === null
}

/**
 * Invariantes de una partida (por ejemplo, al leerla de la base de datos): orden sin repetidos y del tamaño
 * autorizado, una respuesta por pregunta ya jugada y en su orden, estado coherente con el avance.
 */
export function validarPartida(p) {
  if (!p || typeof p !== 'object') return { ok: false, codigo: 'partida_invalida' }
  const base = crearPartida({ orden: p.orden, preguntasPorPartida: p.preguntasPorPartida })
  if (!base.ok) return base
  const n = p.preguntasPorPartida
  if (!Number.isInteger(p.indice) || p.indice < 0 || p.indice > n) return { ok: false, codigo: 'indice_invalido' }
  if (!Array.isArray(p.respuestas) || p.respuestas.length !== p.indice) return { ok: false, codigo: 'respuestas_invalidas' }
  if (!p.respuestas.every((r, i) => respuestaValida(r, i, p))) return { ok: false, codigo: 'respuestas_invalidas' }

  if (p.estado === ESTADOS_PARTIDA.terminada) {
    if (p.indice !== n || p.abierta !== null) return { ok: false, codigo: 'estado_invalido' }
  } else if (p.estado === ESTADOS_PARTIDA.lista) {
    if (p.indice >= n || p.abierta !== null) return { ok: false, codigo: 'estado_invalido' }
  } else if (p.estado === ESTADOS_PARTIDA.pregunta) {
    const a = p.abierta
    if (p.indice >= n || !a || a.indice !== p.indice || a.reactivoId !== p.orden[p.indice] || !esEnteroNoNegativo(a.abiertaMs)) {
      return { ok: false, codigo: 'estado_invalido' }
    }
  } else {
    return { ok: false, codigo: 'estado_invalido' }
  }
  return { ok: true }
}

function registrar(partida, respuesta) {
  const indice = partida.indice + 1
  return {
    ...partida,
    orden: partida.orden.slice(),
    respuestas: [...partida.respuestas, respuesta],
    indice,
    abierta: null,
    estado: indice >= partida.preguntasPorPartida ? ESTADOS_PARTIDA.terminada : ESTADOS_PARTIDA.lista,
  }
}

/**
 * GIRAR: abre la siguiente pregunta del orden sorteado. Solo se puede con la partida «lista»: no hay giro con una
 * pregunta abierta ni después de la última, así que nunca se juegan más preguntas de las autorizadas.
 */
export function girar(partida, ahoraMs) {
  const v = validarPartida(partida)
  if (!v.ok) return v
  if (!esEnteroNoNegativo(ahoraMs)) return { ok: false, codigo: 'hora_invalida' }
  if (partida.estado === ESTADOS_PARTIDA.terminada) return { ok: false, codigo: 'partida_terminada' }
  if (partida.estado === ESTADOS_PARTIDA.pregunta) return { ok: false, codigo: 'pregunta_abierta' }
  const reactivoId = partida.orden[partida.indice]
  return {
    ok: true,
    reactivoId,
    indice: partida.indice,
    partida: {
      ...partida,
      orden: partida.orden.slice(),
      respuestas: partida.respuestas.slice(),
      estado: ESTADOS_PARTIDA.pregunta,
      abierta: { indice: partida.indice, reactivoId, abiertaMs: ahoraMs },
    },
  }
}

/**
 * Respuesta a la pregunta abierta. `indice` debe ser el de la pregunta abierta (una respuesta repetida o atrasada
 * llega con otro índice y se rechaza). `correcta` es la clave de esa pregunta, que solo conoce el servidor.
 * Dentro de 15 s (+ `margenMs`): cuenta su acierto y su tiempo (tope 15 s). Después: incorrecta y sin tiempo.
 */
export function responder(partida, { indice, opcion, ahoraMs, correcta } = {}, opciones = {}) {
  const v = validarPartida(partida)
  if (!v.ok) return v
  const margenMs = margenDe(opciones)
  if (margenMs == null) return { ok: false, codigo: 'margen_invalido' }
  if (partida.estado === ESTADOS_PARTIDA.terminada) return { ok: false, codigo: 'partida_terminada' }
  if (partida.estado !== ESTADOS_PARTIDA.pregunta) return { ok: false, codigo: 'sin_pregunta_abierta' }
  if (indice !== partida.abierta.indice) return { ok: false, codigo: 'indice_distinto' }
  if (!Number.isInteger(opcion) || opcion < 0 || opcion >= RULETA_CFG.OPCIONES_POR_REACTIVO) return { ok: false, codigo: 'opcion_invalida' }
  if (!Number.isInteger(correcta) || correcta < 0 || correcta >= RULETA_CFG.OPCIONES_POR_REACTIVO) return { ok: false, codigo: 'clave_invalida' }
  if (!esEnteroNoNegativo(ahoraMs)) return { ok: false, codigo: 'hora_invalida' }

  const transcurrido = ahoraMs - partida.abierta.abiertaMs
  if (transcurrido < 0) return { ok: false, codigo: 'hora_anterior_apertura' }

  const base = { indice: partida.abierta.indice, reactivoId: partida.abierta.reactivoId, opcion }
  const respuesta = transcurrido <= limiteRespuestaMs(margenMs)
    ? { ...base, motivo: MOTIVOS_RESPUESTA.respondida, correcta: opcion === correcta, tiempoMs: Math.min(transcurrido, RULETA_CFG.TIEMPO_RESPUESTA_MS) }
    : { ...base, motivo: MOTIVOS_RESPUESTA.fuera_de_tiempo, correcta: false, tiempoMs: null }
  return { ok: true, respuesta, partida: registrar(partida, respuesta) }
}

/**
 * Si la pregunta abierta ya pasó su límite, la registra como «sin respuesta» (incorrecta) y la partida queda lista
 * para el siguiente giro. Si no hay pregunta abierta o aún hay tiempo, devuelve la misma partida con `vencida: false`.
 */
export function vencerPregunta(partida, ahoraMs, opciones = {}) {
  const v = validarPartida(partida)
  if (!v.ok) return v
  const margenMs = margenDe(opciones)
  if (margenMs == null) return { ok: false, codigo: 'margen_invalido' }
  if (!esEnteroNoNegativo(ahoraMs)) return { ok: false, codigo: 'hora_invalida' }
  if (partida.estado !== ESTADOS_PARTIDA.pregunta) return { ok: true, vencida: false, partida }
  if (ahoraMs - partida.abierta.abiertaMs <= limiteRespuestaMs(margenMs)) return { ok: true, vencida: false, partida }
  const respuesta = {
    indice: partida.abierta.indice, reactivoId: partida.abierta.reactivoId, opcion: null,
    motivo: MOTIVOS_RESPUESTA.sin_respuesta, correcta: false, tiempoMs: null,
  }
  return { ok: true, vencida: true, respuesta, partida: registrar(partida, respuesta) }
}

/** Milisegundos que le quedan a la pregunta abierta (0 si ya venció; null si no hay pregunta abierta). */
export function tiempoRestanteMs(partida, ahoraMs) {
  if (!partida?.abierta || !esEnteroNoNegativo(ahoraMs)) return null
  return Math.max(0, RULETA_CFG.TIEMPO_RESPUESTA_MS - (ahoraMs - partida.abierta.abiertaMs))
}

// ── Calificación y resultados ───────────────────────────────────────────────

/**
 * (correctas ÷ total) × 10, con el mismo cálculo y redondeo de las evaluaciones (`calcularCalificacion`,
 * src/utils/evaluacionGrading.js): cada pregunta vale lo mismo. No recibe tiempos: la rapidez no la cambia.
 */
export function calificacionRuleta(correctas, total) {
  if (!preguntasPorPartidaValida(total)) throw new RangeError(`Total de preguntas inválido: ${total}`)
  if (!Number.isInteger(correctas) || correctas < 0 || correctas > total) throw new RangeError(`Correctas inválidas: ${correctas}`)
  const preguntas = Array.from({ length: total }, (_, i) => ({ id: `p${i}`, ponderacion: 1 }))
  const respuestas = Object.fromEntries(preguntas.map((p, i) => [p.id, { puntosObtenidos: i < correctas ? 1 : 0 }]))
  return calcularCalificacion(preguntas, respuestas, RULETA_CFG.CALIFICACION_MAXIMA)
}

/**
 * Resumen de una partida. Las preguntas aún no jugadas cuentan como incorrectas en la calificación (se divide entre
 * el total autorizado, no entre las jugadas). `tiempoCorrectasMs` suma solo las respuestas correctas.
 */
export function resumenPartida(partida) {
  const v = validarPartida(partida)
  if (!v.ok) throw new RangeError(`Partida inválida: ${v.codigo}`)
  const total = partida.preguntasPorPartida
  const correctas = partida.respuestas.filter((r) => r.correcta).length
  const tiempoCorrectasMs = partida.respuestas.filter((r) => r.correcta).reduce((s, r) => s + r.tiempoMs, 0)
  return {
    total,
    jugadas: partida.respuestas.length,
    correctas,
    incorrectas: total - correctas,
    sinRespuesta: partida.respuestas.filter((r) => r.motivo !== MOTIVOS_RESPUESTA.respondida).length,
    tiempoCorrectasMs,
    terminada: partida.estado === ESTADOS_PARTIDA.terminada,
    calificacion: calificacionRuleta(correctas, total),
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Fase 2: la actividad y su banco (docs/RULETA_DESTINO.md). Mismas reglas en la pantalla y en el servidor
// (api/_lib/ruletaBanco.js); quien decide es el servidor. El banco vive en `ruletaReactivos` (un documento por
// reactivo) y su estado en `ruletaBancos/{actividadId}`: total, huellas de los enunciados (para no repetir) y
// aprobación. Solo el servidor escribe ambos (R1, F2-1).
// ═════════════════════════════════════════════════════════════════════════════

// Única modalidad (7-nov-2026): cada estudiante juega por su cuenta y puede continuar después.
export const MODALIDADES_RULETA = { individual: 'Individual' }
export const ACCESOS_RULETA = { interno: 'Interno', externo: 'Externo' }

/** Mensajes para el docente de los códigos de validación de un reactivo. */
export const MOTIVOS_REACTIVO = {
  enunciado: 'Escribe el enunciado.',
  enunciado_largo: `El enunciado puede tener como máximo ${RULETA_CFG.MAX_ENUNCIADO} caracteres.`,
  opciones_cantidad: 'Cada reactivo lleva exactamente 4 opciones.',
  opcion_vacia: 'Escribe las 4 opciones.',
  opcion_larga: `Cada opción puede tener como máximo ${RULETA_CFG.MAX_OPCION} caracteres.`,
  opciones_repetidas: 'Dos opciones dicen lo mismo.',
  correcta: 'Marca la respuesta correcta.',
}

/**
 * Datos con los que nace una ruleta (desde el navegador; las reglas de la fase 1 vuelven a exigir su forma). Siempre
 * oculta (F2-9). El tema va FUERA del mapa `ruleta` (F2-7): las reglas solo admiten ahí modalidad, acceso y
 * preguntas. La modalidad es siempre individual; si se pide otra, se rechaza. Una ruleta externa nace sin calificación (R5).
 */
export function datosNuevaRuleta({ nombre, tema, modalidad = 'individual', acceso, preguntasPorPartida, parcial, orden, asignaturaId, docenteId } = {}) {
  const n = String(nombre ?? '').trim()
  const t = String(tema ?? '').trim()
  if (!n) return { ok: false, codigo: 'nombre', error: 'Escribe el nombre de la actividad.' }
  if (n.length > RULETA_CFG.MAX_NOMBRE) return { ok: false, codigo: 'nombre_largo', error: `El nombre puede tener como máximo ${RULETA_CFG.MAX_NOMBRE} caracteres.` }
  if (!t) return { ok: false, codigo: 'tema', error: 'Escribe el tema o contenido que quieres evaluar.' }
  if (t.length > RULETA_CFG.MAX_TEMA) return { ok: false, codigo: 'tema_largo', error: `El tema puede tener como máximo ${RULETA_CFG.MAX_TEMA} caracteres.` }
  if (!(modalidad in MODALIDADES_RULETA)) return { ok: false, codigo: 'modalidad', error: 'Elige la modalidad.' }
  if (!(acceso in ACCESOS_RULETA)) return { ok: false, codigo: 'acceso', error: 'Elige el acceso.' }
  if (!preguntasPorPartidaValida(preguntasPorPartida)) return { ok: false, codigo: 'preguntas', error: `Elige ${TEXTO_PREGUNTAS_VALIDAS} preguntas por partida.` }
  if (!esTextoConContenido(asignaturaId) || !esTextoConContenido(docenteId)) return { ok: false, codigo: 'asignatura', error: 'Falta la asignatura.' }
  if (!Number.isInteger(parcial) || parcial < 1) return { ok: false, codigo: 'parcial', error: 'Falta el parcial.' }
  const externa = acceso === 'externo'
  return {
    ok: true,
    datos: {
      nombre: n, tema: t, categoria: RULETA_CFG.CATEGORIA, tipo: 'archivo', parcial, orden: Number.isInteger(orden) ? orden : 1,
      asignaturaId, docenteId, maxCalif: RULETA_CFG.CALIFICACION_MAXIMA,
      oculta: true, publishAt: null, publishedAt: null, sinCalificacion: externa,
      ruleta: { modalidad, acceso, preguntasPorPartida },
    },
  }
}

/** Avance del banco para la pantalla: «20 de 25 reactivos. Faltan 5.» La cantidad es exacta (5→25, 10→50). */
export function avanceBanco(total, n, origen = ORIGENES_BANCO.manual) {
  if (!esEnteroNoNegativo(total)) throw new RangeError(`Total inválido: ${total}`)
  const minimo = minimoBanco(n, origen)
  const maximo = maximoBanco(n)
  const faltan = Math.max(0, minimo - total)
  const sobran = Math.max(0, total - maximo)
  const completo = faltan === 0 && sobran === 0
  let mensaje
  if (sobran) mensaje = `Sobran ${sobran}: el banco lleva exactamente ${maximo}.`
  else if (faltan) mensaje = `Faltan ${faltan}.`
  else mensaje = 'Banco completo. Puedes aprobarlo.'
  return { total, minimo, maximo, faltan, sobran, completo, lleno: total >= maximo, conteo: `${total} de ${minimo} reactivos.`, mensaje }
}

/** Reactivo tal como lo guarda el servidor: textos sin espacios de más y la correcta como entero. */
export function normalizarReactivo(r) {
  const limpiar = (t) => (typeof t === 'string' ? t.trim().replace(/\s+/g, ' ') : t)
  return {
    enunciado: limpiar(r?.enunciado),
    opciones: Array.isArray(r?.opciones) ? r.opciones.map(limpiar) : r?.opciones,
    correcta: r?.correcta,
  }
}

/** Estado de un banco que todavía no tiene reactivos: nace manual (solo la generación con IA, fase 3, lo hará 'ia'). */
export function bancoVacio() {
  return { total: 0, huellas: {}, aprobado: false, version: 0, origen: ORIGENES_BANCO.manual }
}

function bancoValido(b) {
  return b && esEnteroNoNegativo(b.total) && b.huellas && typeof b.huellas === 'object' && !Array.isArray(b.huellas) &&
    esEnteroNoNegativo(b.version ?? 0)
}

/**
 * Guardar un reactivo (nuevo o editado) en el estado del banco. `huella` identifica el enunciado normalizado (la
 * calcula el servidor); `huellaAnterior` es la del reactivo antes de editarlo. Rechaza un enunciado que ya tiene otro
 * reactivo (`duplicado`) y un reactivo nuevo con el banco lleno (`banco_lleno`). Siempre retira la aprobación (F2-5).
 */
export function guardarEnBanco(banco, { id, huella, huellaAnterior = null, nuevo }, n) {
  if (!bancoValido(banco)) return { ok: false, codigo: 'banco_invalido' }
  if (!preguntasPorPartidaValida(n)) return { ok: false, codigo: 'preguntas_por_partida' }
  if (!esTextoConContenido(id) || !esTextoConContenido(huella)) return { ok: false, codigo: 'datos_invalidos' }
  const duenoHuella = banco.huellas[huella]
  if (duenoHuella && duenoHuella !== id) return { ok: false, codigo: 'duplicado' }
  if (nuevo && banco.total >= maximoBanco(n)) return { ok: false, codigo: 'banco_lleno' }
  const huellas = { ...banco.huellas }
  if (!nuevo && huellaAnterior && huellaAnterior !== huella && huellas[huellaAnterior] === id) delete huellas[huellaAnterior]
  huellas[huella] = id
  return {
    ok: true,
    banco: { ...banco, huellas, total: banco.total + (nuevo ? 1 : 0), aprobado: false, version: (banco.version ?? 0) + 1 },
  }
}

/**
 * Quitar un reactivo del estado del banco. Siempre retira la aprobación (F2-5). Conserva el origen mientras quede al
 * menos un reactivo; el banco que se queda en 0 vuelve a `manual` (7-nov-2026).
 */
export function quitarDeBanco(banco, { id, huella }) {
  if (!bancoValido(banco)) return { ok: false, codigo: 'banco_invalido' }
  if (!esTextoConContenido(id)) return { ok: false, codigo: 'datos_invalidos' }
  const huellas = { ...banco.huellas }
  if (huella && huellas[huella] === id) delete huellas[huella]
  const total = Math.max(0, banco.total - 1)
  return {
    ok: true,
    banco: {
      ...banco, huellas, total, aprobado: false, version: (banco.version ?? 0) + 1,
      ...(total === 0 ? { origen: ORIGENES_BANCO.manual } : {}),
    },
  }
}

/**
 * ¿Se puede aprobar? Exige el banco completo y sin errores (`validarBanco`: la cantidad exacta, reactivos
 * válidos, sin enunciados ni ids repetidos) y que el estado guardado coincida con los reactivos reales. Editar,
 * agregar o borrar no cambia el origen (guardarEnBanco y quitarDeBanco lo conservan), salvo borrar el último reactivo:
 * el banco vacío vuelve a `manual`.
 */
export function evaluarAprobacion(banco, reactivos, n) {
  if (!bancoValido(banco)) return { ok: false, codigo: 'banco_invalido', errores: [] }
  const v = validarBanco(reactivos, n, { origen: origenBanco(banco) })
  if (!v.ok) return { ok: false, codigo: v.errores.includes('banco_incompleto') ? 'banco_incompleto' : v.errores.includes('banco_excedido') ? 'banco_excedido' : 'banco_con_errores', errores: v.errores }
  if (banco.total !== reactivos.length) return { ok: false, codigo: 'banco_desfasado', errores: [] }
  return { ok: true, banco: { ...banco, aprobado: true } }
}

/**
 * Cambiar las preguntas por partida (R6, F2-6): solo sin partidas (`preguntasCongeladas`), a 5 o 10, distinto del
 * actual y con un banco que no pase de la cantidad exacta del NUEVO tamaño (9-nov-2026): de 5 a 10 siempre se puede
 * (después se completa a 50); de 10 a 5, solo con 25 reactivos o menos. El servidor retira la aprobación al cambiar.
 */
export function puedeCambiarPreguntas({ ruleta, total, nuevo, origen = ORIGENES_BANCO.manual } = {}) {
  if (!ruleta || typeof ruleta !== 'object') return { ok: false, codigo: 'actividad_invalida' }
  if (ruleta.preguntasCongeladas === true) return { ok: false, codigo: 'congeladas' }
  if (!preguntasPorPartidaValida(nuevo)) return { ok: false, codigo: 'preguntas_por_partida' }
  if (nuevo === ruleta.preguntasPorPartida) return { ok: false, codigo: 'sin_cambio' }
  if (!esEnteroNoNegativo(total)) return { ok: false, codigo: 'banco_invalido' }
  void origen
  if (total > maximoBanco(nuevo)) return { ok: false, codigo: 'banco_excedido' }
  return { ok: true }
}
