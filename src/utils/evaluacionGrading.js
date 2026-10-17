// Pure scoring logic for Evaluaciones (Cuestionario/Examen). Kept separate from
// any component so the calculation has a single source of truth wherever it's
// needed (student finishing an attempt, teacher reviewing open questions).
//
// Architecture note for a future Premium/AI tier: `preguntas` and
// `bancoReactivos` are already independent documents with an open `tipo`
// enum, so generation/analysis metadata (e.g. `generadoPor`, difficulty
// stats) can be added later without migrating existing data or touching
// this scoring logic.

// Fuente ÚNICA de verdad del cálculo de notas. Cloud Functions la usa a través
// de la copia que genera scripts/sync-functions-shared.mjs (functions/_shared/):
// ya no hay réplicas escritas a mano que puedan divergir.
export const TIPOS_OBJETIVOS = ['opcion_multiple', 'verdadero_falso']

// Question types the teacher must grade by hand: free-text answers and
// document uploads. Single source of truth for "pendiente de revisión".
export const TIPOS_REVISION_MANUAL = ['respuesta_corta', 'subir_archivo']

/**
 * Resolves the points earned for a single pregunta given the student's
 * respuesta. Objective types (opción múltiple, verdadero/falso) are scored
 * by comparing the selected option to `respuestaCorrecta`. `respuesta_corta`
 * is never auto-scored — it returns `null` (pending teacher review).
 */
export function calcularPuntosPregunta(pregunta, respuesta) {
  if (!TIPOS_OBJETIVOS.includes(pregunta.tipo)) return null
  const correcta = respuesta?.opcionSeleccionada != null && respuesta.opcionSeleccionada === pregunta.respuestaCorrecta
  return correcta ? (pregunta.ponderacion || 0) : 0
}

/**
 * @param {Array<{id: string, ponderacion: number}>} preguntas
 * @param {Record<string, {puntosObtenidos: number|null}>} respuestasPorPregunta keyed by pregunta id
 * @param {number} maxCalif scale to normalize to (activity's maxCalif, default 10)
 * @returns {number} calificación rounded to 1 decimal — pending (null) points count as 0 for now
 */
export function calcularCalificacion(preguntas, respuestasPorPregunta, maxCalif = 10) {
  const totalPonderacion = preguntas.reduce((sum, p) => sum + (p.ponderacion || 0), 0)
  if (totalPonderacion === 0) return 0
  const obtenida = preguntas.reduce((sum, p) => sum + (respuestasPorPregunta[p.id]?.puntosObtenidos ?? 0), 0)
  return Math.round((obtenida / totalPonderacion) * maxCalif * 10) / 10
}

/**
 * True if any manually-graded pregunta (respuesta corta / subir documento) in
 * this attempt is still missing a manually-assigned score — drives the
 * "Finalizado" vs "Calificado" status and the pending-review badge in the
 * teacher view.
 */
export function resolverPendienteRevision(preguntas, respuestasPorPregunta) {
  return preguntas.some((p) => TIPOS_REVISION_MANUAL.includes(p.tipo) && (respuestasPorPregunta[p.id]?.puntosObtenidos ?? null) == null)
}

/**
 * Resolves the calificación to keep when a new attempt finishes, given the
 * activity's `conservar` policy ('primero' | 'ultimo' | 'mejor' | 'promedio').
 */
export function resolverCalificacionFinal(intentosPrevios, calificacionNueva, conservar) {
  if (intentosPrevios.length === 0) return calificacionNueva
  const previas = intentosPrevios.map((i) => i.calificacion)
  switch (conservar) {
    case 'primero':
      return previas[0]
    case 'promedio':
      return Math.round((([...previas, calificacionNueva].reduce((a, b) => a + b, 0)) / (previas.length + 1)) * 10) / 10
    case 'mejor':
      return Math.max(...previas, calificacionNueva)
    case 'ultimo':
    default:
      return calificacionNueva
  }
}

/** Las cuatro políticas de «Si hay varios intentos, conservar». */
export const POLITICAS_CONSERVACION = ['ultimo', 'mejor', 'primero', 'promedio']

/**
 * La política que `resolverCalificacionFinal` aplica de verdad: un valor
 * ausente o desconocido cae en 'ultimo'. Es lo que se registra como
 * `politicaAplicada`, para que el registro diga lo mismo que hizo el cálculo.
 */
export function politicaEfectiva(conservar) {
  return POLITICAS_CONSERVACION.includes(conservar) ? conservar : 'ultimo'
}

/**
 * Nota del intento, estado y nota final tras fijar a mano los puntos de un
 * reactivo. Función pura: recibe los intentos y las respuestas FRESCAS (las que
 * el docente guardó en la misma transacción), no copias de la pantalla, y
 * devuelve el parche completo. Antes esta cuenta vivía dentro de saveGrade y
 * reescribía `intentos[]` con la copia que la pantalla cargó al abrir.
 */
export function aplicarPuntosManuales({ preguntas, respuestas, intentos = [], maxCalif = 10, conservar }) {
  const calificacionIntento = calcularCalificacion(preguntas, respuestas, maxCalif)
  const pendienteRevision = resolverPendienteRevision(preguntas, respuestas)
  const lista = intentos.map((i) => ({ ...i }))
  if (lista.length) lista[lista.length - 1] = { ...lista[lista.length - 1], calificacion: calificacionIntento }
  const previas = lista.slice(0, -1)
  const calificacion = resolverCalificacionFinal(previas, calificacionIntento, conservar)
  return {
    calificacionIntento,
    pendienteRevision,
    intentos: lista,
    calificacion,
    estado: pendienteRevision ? 'entregado' : 'calificado',
    politicaAplicada: politicaEfectiva(conservar),
  }
}

// ── Quién escribió la nota ───────────────────────────────────────────────────
// `submissions.ultimaCalificacionPor` lo escribe quien pone la nota; el historial
// (submissions/{id}/calificacionHistorial) lo copia. Las reglas impiden que el
// estudiante lo escriba.
export const ORIGEN_DOCENTE = 'docente'
export const ORIGEN_SERVIDOR = 'servidor'
export const ORIGEN_IA_RECALIFICAR = 'ia_recalificar'
export const ORIGEN_IA_APLICAR = 'ia_aplicar'

export function origenEsIA(origen) {
  return typeof origen === 'string' && origen.startsWith('ia_')
}

/**
 * ¿La nota actual de la entrega la puso la IA y nadie la tocó después?
 * Con marca (`ultimaCalificacionPor`) decide la marca. Sin marca (notas
 * anteriores a este registro) solo cuenta como de la IA si coincide con lo que
 * la IA aplicó automáticamente (`sugerencia`): ante la duda es del docente.
 */
export function calificacionEsDeIA(sub, sugerencia = null) {
  if (!sub || sub.calificacion == null) return false
  if (typeof sub.ultimaCalificacionPor === 'string') return origenEsIA(sub.ultimaCalificacionPor)
  return sugerencia?.aplicadaAutomaticamente === true &&
    sugerencia?.sugerencia?.calificacionPropuesta === sub.calificacion
}

/**
 * ¿Puede la IA escribir su nota en esta entrega? Por omisión NUNCA reemplaza
 * una calificación del docente: solo escribe sobre una entrega sin nota o sobre
 * una nota que es de la propia IA. Reemplazar la del docente exige
 * `sobrescribirCalificadas: true`, que solo manda el diálogo cuando el docente
 * marca la casilla expresa.
 */
export function decidirAplicacionIA({ sub, sugerencia = null, sobrescribirCalificadas = false }) {
  if (!sub) return { aplicar: false, motivo: 'sin_entrega' }
  if (sub.calificacion == null) return { aplicar: true, motivo: 'sin_calificacion' }
  if (calificacionEsDeIA(sub, sugerencia)) return { aplicar: true, motivo: 'reemplaza_ia' }
  if (sobrescribirCalificadas === true) return { aplicar: true, motivo: 'confirmado_por_docente' }
  return { aplicar: false, motivo: 'ya_calificada_por_docente' }
}

/**
 * Whether a scheduled publication (results OR answers) is currently visible to
 * the student. Single source of truth shared by the teacher config preview and
 * the student views so both agree on timing.
 *
 * @param {string} modo   'nunca' | 'inmediato' | 'ahora' | 'fecha' (legacy: 'manual')
 * @param {string|null} fecha  ISO datetime for `modo === 'fecha'`
 * @param {boolean} flag  the published flag ('ahora'/'manual' are gated by it)
 * @param {string} ahoraISO  current time as ISO, injected so callers control "now"
 */
export function publicacionVisible(modo, fecha, flag, ahoraISO) {
  // 'nunca' gana sobre cualquier otra cosa, incluida una fecha o una bandera
  // que hubieran quedado guardadas de una configuración anterior: si el docente
  // dijo que no se publica, no se publica.
  if (modo === 'nunca') return false
  if (modo === 'inmediato') return true
  if (modo === 'fecha') return !!fecha && ahoraISO >= fecha
  // 'ahora' and legacy 'manual': visible only once the teacher published (flag set).
  return !!flag
}

/**
 * Reparte 10 puntos entre `n` preguntas en partes iguales (2 decimales),
 * ajustando la última fracción de centavo para que la suma dé EXACTO 10 —
 * redondear cada una por separado sin esto puede dejar el total en 9.99 o
 * 10.01. Función pura (sin Firestore) para que EvaluacionEditor.jsx y
 * EvaluacionManager.jsx compartan el mismo cálculo del botón "Repartir
 * parejo" en vez de reimplementarlo cada quien por su lado.
 * @param {number} n número de preguntas
 * @returns {number[]} un valor de ponderación por pregunta, en el mismo orden
 */
export function repartirPonderacionParejo(n) {
  if (!n || n <= 0) return []
  const base = Math.floor((10 / n) * 100) / 100
  const values = Array(n).fill(base)
  let centavosFaltantes = Math.round((10 - base * n) * 100)
  for (let i = n - 1; i >= 0 && centavosFaltantes > 0; i--) {
    values[i] = parseFloat((values[i] + 0.01).toFixed(2))
    centavosFaltantes--
  }
  return values
}

/**
 * Estado de UN estudiante en una evaluación, con el vocabulario correcto: un
 * cuestionario "se realiza o no", y solo se habla de calificar cuando hay
 * reactivos que el docente debe revisar a mano (`hasManual`). Lo comparten la
 * lista de Entregas y las exportaciones (Excel), para que la columna ESTADO
 * del archivo diga lo mismo que la pantalla.
 *
 * Una entrega finalizada que todavía no tiene nota (el servidor aún no la
 * calificó) NO es "Calificado": queda "Por calificar". Un instrumento "Sin
 * calificación" nunca lleva nota, así que ahí la ausencia es lo normal
 * (`sinNota`).
 */
export function estadoEvaluacionLabel(sub, hasManual, sinNota = false) {
  if (!sub) return 'No iniciado'
  if (sub.estadoEvaluacion === 'en_progreso') return 'En proceso'
  if (sub.pendienteRevision) return 'Por calificar'
  if (!sinNota && sub.estadoEvaluacion === 'finalizado' && !Number.isFinite(sub.calificacion)) return 'Por calificar'
  return hasManual ? 'Calificado' : 'Realizado'
}

/**
 * ¿La nota de esta entrega es PROVISIONAL? Hay nota (la parte objetiva ya está
 * calculada) pero todavía quedan reactivos que el docente debe calificar a mano
 * (`pendienteRevision`): lo que falta cuenta como 0 por ahora, así que el número
 * puede subir y NO es la nota definitiva.
 */
export function esCalificacionProvisional(sub) {
  return Number.isFinite(sub?.calificacion) && sub?.pendienteRevision === true
}

export const ETIQUETA_PROVISIONAL = 'provisional, por calificar'
export const NOTA_PIE_PROVISIONAL = '* Calificación provisional: la evaluación tiene reactivos por calificar a mano; el valor puede cambiar.'

/**
 * Texto de la calificación de una entrega ("8/10"), o «Por calificar» cuando
 * todavía no hay nota. Un 0 es una nota real y se muestra como "0/10"; jamás
 * se imprime "null" ni "undefined".
 *
 * Una nota provisional NUNCA se presenta como definitiva: lleva «provisional,
 * por calificar» al lado ("8/10 · provisional, por calificar"). Con
 * `{ corto: true }` (renglones angostos) solo «provisional».
 */
export function textoCalificacionEntrega(sub, maxCalif = 10, { corto = false } = {}) {
  if (!Number.isFinite(sub?.calificacion)) return 'Por calificar'
  const base = `${sub.calificacion}/${maxCalif || 10}`
  if (!esCalificacionProvisional(sub)) return base
  return `${base} · ${corto ? 'provisional' : ETIQUETA_PROVISIONAL}`
}

/**
 * Group stats for the teacher view (average, max, min, pass/fail %).
 * `calificaciones` is an array of finished attempts' final scores.
 */
export function calcularEstadisticasGrupo(calificaciones, maxCalif = 10) {
  if (calificaciones.length === 0) {
    return { promedio: 0, maxima: 0, minima: 0, porcentajeAprobados: 0, porcentajeReprobados: 0 }
  }
  const aprobatorio = maxCalif * 0.6
  const aprobados = calificaciones.filter((c) => c >= aprobatorio).length
  const suma = calificaciones.reduce((a, b) => a + b, 0)
  return {
    promedio: Math.round((suma / calificaciones.length) * 10) / 10,
    maxima: Math.max(...calificaciones),
    minima: Math.min(...calificaciones),
    porcentajeAprobados: Math.round((aprobados / calificaciones.length) * 100),
    porcentajeReprobados: Math.round(((calificaciones.length - aprobados) / calificaciones.length) * 100),
  }
}
