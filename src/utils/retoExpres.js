// Reto Exprés — lógica PURA (etapas 0 y 0-bis): ventanas de tiempo, pausas, puntuación, empates, alias,
// modalidades (inscritos / externo no calificable), acceso, cupos, tokens y vista final.
// Especificación completa y decisiones: docs/RETO_EXPRES.md.
//
// Sin Firebase, sin red y sin reloj propio: quien llama pasa la hora (`ahoraMs`) y los datos. El servidor
// (etapas siguientes) la envolverá en transacciones; la pantalla la usará para mostrar los contadores. Así
// las dos aplican exactamente la misma regla.
//
// Tiempo de la competencia (decisión D3):
//   · La sesión guarda solo `inicioMs` y la lista de `pausas` [{ desdeMs, hastaMs }], en milisegundos de
//     RELOJ DEL SERVIDOR. La pregunta en curso, su apertura y su cierre se CALCULAN desde ahí; nadie tiene
//     que «avanzar» la competencia. Por eso el avance automático no depende del proyector: cerrarlo,
//     recargar o perder la conexión no reinicia ni detiene el tiempo.
//   · Cada pregunta ocupa un turno: PREPARACION_MS («Prepárate…», sin contenido) + SU tiempo para responder
//     (`tiempoSeg`, de DURACIONES_RETO_SEG; 4-nov-2026). Al terminar un turno empieza el siguiente. La sesión congela el
//     tiempo de cada pregunta al crearse; una pregunta sin tiempo válido usa el de siempre (20 s).
//   · Una pausa congela ese reloj (en preparación o con la pregunta abierta). Mientras dura, nadie puede
//     responder; al reanudar se conserva el tiempo que faltaba.
//   · Las pausas solo se agregan al final (con `desdeMs` ≥ la hora en que se pide), de modo que el estado en un
//     instante pasado nunca cambia: una respuesta aceptada se puede volver a comprobar después con su `recibidaMs`.
//
// Puntuación (decisiones D4, D6, D7, D9): 1 punto por acierto, sin bono por rapidez. Una pregunta sin
// respuesta (incluidas las anteriores a un ingreso tardío) vale 0. Los empates comparten posición. La
// calificación propuesta usa la misma función de las evaluaciones (`calcularCalificacion`).
//
// Terminación anticipada: el docente puede terminar antes (con confirmación). Solo cuentan las preguntas que se
// abrieron y cerraron completas; la que estaba en turno y las que nunca se abrieron no se califican ni se muestran.
//
// Alias (decisión D5): longitud, caracteres permitidos, unicidad por sesión, roles reservados («Docente») y
// coincidencia con el nombre real de cualquier estudiante de la sesión (también el propio) se resuelven aquí. La detección
// de palabras ofensivas NO vive aquí a propósito: la lista está en functions/moderacionSugerencias.js para que
// no viaje en el paquete de la app. El servidor la inyecta (`esOfensivo`); sin ella el alias se rechaza.
//
// Constantes agrupadas en objetos: el script de sincronización con functions/ solo admite exports de
// función, objeto o arreglo (scripts/sync-functions-shared.mjs).

import { TIPOS_OBJETIVOS, calcularCalificacion } from './evaluacionGrading.js'

export const RETO_CFG = {
  CATEGORIA: 'reto',
  TOTAL_PREGUNTAS: 10, // exactamente 10 (D12)
  PREPARACION_MS: 4000, // mismo margen que Participación en vivo: todos reciben la pregunta antes de que abra
  TIEMPO_RESPUESTA_MS: 20000, // tiempo POR OMISIÓN para responder (20 s): el de una pregunta sin `tiempoSeg` válido
  MAX_PAUSAS: 30, // acota el tamaño del documento de la sesión
  ALIAS_MIN: 3,
  ALIAS_MAX: 20,
  MAX_EXTERNOS: 40, // tope inicial por reto externo (E7); NO es capacidad garantizada hasta pasar la prueba de carga
  TOP_CLASIFICACION: 10, // el celular muestra los puestos 1 a 10 y la posición propia (E9)
  // ¿Se puede marcar un reto de inscritos como calificable? Estuvo apagado hasta la etapa 5 (aplicar calificaciones):
  // sin ella, un reto calificable publicado contaba como 0 para todo el grupo sin forma de corregirlo.
  CALIFICABLE_DISPONIBLE: true,
}

// Tiempo para responder cada pregunta (4-nov-2026): solo estas duraciones, en segundos. El docente elige una por reto
// (la de las preguntas nuevas) y puede cambiarla en cada pregunta.
export const DURACIONES_RETO_SEG = [20, 30, 60, 120, 180, 300]
export const TIEMPO_POR_OMISION_SEG = RETO_CFG.TIEMPO_RESPUESTA_MS / 1000

/** ¿Es una de las duraciones permitidas? */
export function duracionValida(seg) {
  return DURACIONES_RETO_SEG.includes(seg)
}

/** «20 s», «1 min», «2 min 30 s»: cómo se lee una duración. */
export function textoDuracion(seg) {
  if (!Number.isFinite(seg) || seg < 0) return ''
  const m = Math.floor(seg / 60)
  const s = Math.round(seg % 60)
  if (!m) return `${s} s`
  return s ? `${m} min ${s} s` : `${m} min`
}

/** Tiempo para responder la pregunta, en ms. Sin `tiempoSeg` válido, el de siempre (20 s). */
export function tiempoRespuestaMs(pregunta) {
  return duracionValida(pregunta?.tiempoSeg) ? pregunta.tiempoSeg * 1000 : RETO_CFG.TIEMPO_RESPUESTA_MS
}

// Tipos que se califican solos: los mismos objetivos de las evaluaciones (opción múltiple y verdadero/falso).
export const TIPOS_RETO = [...TIPOS_OBJETIVOS]

export const MODOS_IDENTIDAD = { nombre: 'Nombre real', alias: 'Alias' }

// ── Modalidades (E1, E10) ───────────────────────────────────────────────────
// `inscritos`: estudiantes autenticados e inscritos en la asignatura; puede ser calificable.
// `externo`: cualquiera con el QR o el enlace, sin cuenta; NUNCA calificable, siempre con alias.
// La modalidad se fija al crear el reto y no cambia nunca.
export const MODALIDADES_RETO = { inscritos: 'Estudiantes inscritos', externo: 'Externo no calificable' }

/** ¿Es una modalidad conocida? Un valor desconocido NO se interpreta como ninguna de las dos. */
export function modalidadValida(m) {
  return m === 'inscritos' || m === 'externo'
}

/**
 * ¿Puede este reto llegar a calificaciones? Solo un reto de inscritos que el docente marcó como calificable.
 * Externo, modalidad desconocida o ausente: nunca (falla cerrada). `reto` = { modalidad, calificable }.
 */
export function esCalificable(reto) {
  return reto?.modalidad === 'inscritos' && reto?.calificable === true
}

/**
 * Configuración con la que nace un reto. Un reto externo exige: alias, no calificable, sin número ni promedio
 * (`sinCalificacion: true`), oculto para los inscritos (`oculta: true`) y sin publicación programada. No se
 * corrige en silencio: si algo no cuadra, se rechaza. Las reglas de Firestore repetirán esta condición (etapa 1-bis).
 * Devuelve { ok: true, config } o { ok: false, codigo, error }.
 */
export function validarConfiguracionReto({ modalidad, calificable = false, modoIdentidad, sinCalificacion, oculta, publishAt = null } = {}) {
  if (!modalidadValida(modalidad)) return { ok: false, codigo: 'MODALIDAD_INVALIDA', error: 'Elige si el reto es para estudiantes inscritos o externo.' }
  if (modoIdentidad !== 'nombre' && modoIdentidad !== 'alias') return { ok: false, codigo: 'IDENTIDAD_INVALIDA', error: 'Elige nombre real o alias.' }
  if (typeof calificable !== 'boolean') return { ok: false, codigo: 'CALIFICABLE_INVALIDO', error: 'Indica si el reto es calificable.' }
  if (modalidad === 'externo') {
    if (calificable) return { ok: false, codigo: 'EXTERNO_CALIFICABLE', error: 'Un reto externo nunca es calificable.' }
    if (modoIdentidad !== 'alias') return { ok: false, codigo: 'EXTERNO_SIN_ALIAS', error: 'En un reto externo los participantes usan alias.' }
    if (sinCalificacion !== true) return { ok: false, codigo: 'EXTERNO_CON_NOTA', error: 'Un reto externo no lleva número ni cuenta en el promedio.' }
    if (oculta !== true) return { ok: false, codigo: 'EXTERNO_VISIBLE', error: 'Un reto externo no se muestra a los estudiantes inscritos.' }
    if (publishAt != null && publishAt !== '') return { ok: false, codigo: 'EXTERNO_PROGRAMADO', error: 'Un reto externo no se programa para publicarse.' }
  } else if (sinCalificacion !== !calificable) {
    return { ok: false, codigo: 'CALIFICABLE_INCONSISTENTE', error: '«Calificable» y «sin calificación» no coinciden.' }
  }
  return { ok: true, config: { modalidad, calificable, modoIdentidad, sinCalificacion: !calificable } }
}

/** ¿Se permite este cambio de modalidad? Nunca: para cambiar de modalidad se crea otro reto (E10). */
export function cambioModalidadPermitido(anterior, nueva) {
  return modalidadValida(anterior) && anterior === nueva
}

/** Modo de identidad efectivo: en un reto externo, siempre alias (aunque el dato diga otra cosa). */
export function modoIdentidadDe(sesion) {
  if (sesion?.modalidad === 'externo') return 'alias'
  return sesion?.modoIdentidad === 'alias' ? 'alias' : 'nombre'
}

export const ESTADOS_RETO = { espera: 'espera', en_curso: 'en_curso', finalizada: 'finalizada' }

// Lo que puede valer `fase` (derivada; nunca se guarda).
export const FASES_RETO = {
  espera: 'espera', // sala de espera: todavía no empieza
  preparando: 'preparando', // «Prepárate…»: la pregunta aún no se muestra
  abierta: 'abierta', // se puede responder
  pausada: 'pausada', // el docente pausó
  terminada: 'terminada', // ya pasó la última pregunta; falta finalizar (calcular resultados)
  finalizada: 'finalizada', // resultados calculados
}

// Duración de cada turno (preparación + tiempo de esa pregunta) según las preguntas congeladas en la sesión.
function turnosDe(sesion) {
  const preguntas = Array.isArray(sesion?.preguntas) ? sesion.preguntas : []
  return Array.from({ length: totalDe(sesion) }, (_, i) => RETO_CFG.PREPARACION_MS + tiempoRespuestaMs(preguntas[i]))
}

/** En qué turno cae `efectivoMs`: { indice, inicio, turno }. indice = total cuando ya pasó la última pregunta. */
function ubicarTurno(sesion, efectivoMs) {
  const turnos = turnosDe(sesion)
  let inicio = 0
  for (let i = 0; i < turnos.length; i++) {
    if (efectivoMs < inicio + turnos[i]) return { indice: i, inicio, turno: turnos[i] }
    inicio += turnos[i]
  }
  return { indice: turnos.length, inicio, turno: 0 }
}

/** Duración total de la competencia sin pausas, en ms (preparación incluida). */
export function duracionTotalMs(sesion) {
  return turnosDe(sesion).reduce((a, b) => a + b, 0)
}

const esEnteroNoNegativo = (n) => Number.isInteger(n) && n >= 0

function totalDe(sesion) {
  const n = sesion?.totalPreguntas
  return Number.isInteger(n) && n > 0 ? n : RETO_CFG.TOTAL_PREGUNTAS
}

function pausasDe(sesion) {
  return Array.isArray(sesion?.pausas) ? sesion.pausas : []
}

/**
 * ¿La lista de pausas es coherente? Ordenadas, sin traslaparse, ninguna antes del inicio y solo la última
 * puede seguir abierta (`hastaMs: null`). Una lista incoherente haría ambiguo el reloj: el servidor la rechaza.
 */
export function pausasValidas(sesion) {
  const pausas = pausasDe(sesion)
  if (pausas.length > RETO_CFG.MAX_PAUSAS) return false
  if (pausas.length && !esEnteroNoNegativo(sesion?.inicioMs)) return false
  let previa = sesion?.inicioMs ?? 0
  for (let i = 0; i < pausas.length; i++) {
    const { desdeMs, hastaMs } = pausas[i] || {}
    if (!esEnteroNoNegativo(desdeMs) || desdeMs < previa) return false
    const ultima = i === pausas.length - 1
    if (hastaMs == null) {
      if (!ultima) return false
      previa = desdeMs
    } else {
      if (!esEnteroNoNegativo(hastaMs) || hastaMs < desdeMs) return false
      previa = hastaMs
    }
  }
  return true
}

/** ¿Hay una pausa abierta (sin reanudar)? */
export function estaPausada(sesion) {
  const pausas = pausasDe(sesion)
  return pausas.length > 0 && pausas[pausas.length - 1]?.hastaMs == null
}

/** ¿La competencia estaba en pausa en el instante `ahoraMs`? Sirve también para instantes pasados. */
export function pausadaEn(sesion, ahoraMs) {
  return pausasDe(sesion).some((p) => ahoraMs >= p.desdeMs && ahoraMs < (p.hastaMs ?? Infinity))
}

/**
 * Milisegundos de competencia transcurridos en `ahoraMs`, descontando las pausas. 0 antes de iniciar.
 * Solo cuenta lo que pasó entre `inicioMs` y `ahoraMs`: una pausa posterior no cambia el resultado.
 */
export function tiempoEfectivoMs(sesion, ahoraMs) {
  const inicio = sesion?.inicioMs
  if (!esEnteroNoNegativo(inicio) || !Number.isFinite(ahoraMs) || ahoraMs <= inicio) return 0
  let pausado = 0
  for (const p of pausasDe(sesion)) {
    const desde = Math.max(p.desdeMs, inicio)
    const hasta = Math.min(p.hastaMs ?? Infinity, ahoraMs)
    if (hasta > desde) pausado += hasta - desde
  }
  return Math.max(0, ahoraMs - inicio - pausado)
}

/**
 * Hora real (reloj del servidor) en que la competencia alcanzará `efectivoMs`, si no hay más pausas.
 * null si en ese punto hay una pausa abierta (todavía no se sabe cuándo se reanudará).
 */
export function momentoRealMs(sesion, efectivoMs) {
  const inicio = sesion?.inicioMs
  if (!esEnteroNoNegativo(inicio) || !Number.isFinite(efectivoMs)) return null
  let real = inicio + Math.max(0, efectivoMs)
  for (const p of pausasDe(sesion)) {
    if (p.desdeMs >= real) break // empieza cuando ya se alcanzó (o después): no lo mueve
    if (p.hastaMs == null) return null
    real += p.hastaMs - p.desdeMs
  }
  return real
}

/**
 * Estado de la competencia en `ahoraMs`. Única regla para servidor, proyector y celulares.
 * Devuelve { fase, indice, faseAlPausar, restanteMs, faltaParaAbrirMs, abreMs, cierraMs }:
 *   · indice: pregunta en turno (0 a total-1), también durante la pausa; null en espera/terminada/finalizada;
 *   · restanteMs: lo que le queda a la respuesta (abierta, o pausada con la pregunta abierta);
 *   · faltaParaAbrirMs: lo que falta para que abra (preparando, o pausada en preparación);
 *   · abreMs / cierraMs: hora real de apertura y cierre del turno actual (null si está pausada).
 */
export function faseReto(sesion, ahoraMs) {
  const vacio = { indice: null, faseAlPausar: null, restanteMs: null, faltaParaAbrirMs: null, abreMs: null, cierraMs: null }
  if (sesion?.estado === ESTADOS_RETO.finalizada) return { fase: FASES_RETO.finalizada, ...vacio }
  // Terminación anticipada: desde `terminadaMs` ya no corre nada (los instantes anteriores no cambian).
  if (esEnteroNoNegativo(sesion?.terminadaMs) && ahoraMs >= sesion.terminadaMs) return { fase: FASES_RETO.terminada, ...vacio }
  if (sesion?.estado !== ESTADOS_RETO.en_curso || !esEnteroNoNegativo(sesion?.inicioMs)) {
    return { fase: FASES_RETO.espera, ...vacio }
  }
  const total = totalDe(sesion)
  const efectivo = tiempoEfectivoMs(sesion, ahoraMs)
  const { indice, inicio, turno } = ubicarTurno(sesion, efectivo)
  if (indice >= total) return { fase: FASES_RETO.terminada, ...vacio }

  const dentro = efectivo - inicio
  const enPreparacion = dentro < RETO_CFG.PREPARACION_MS
  const pausada = pausadaEn(sesion, ahoraMs)
  const base = {
    indice,
    restanteMs: enPreparacion ? null : turno - dentro,
    faltaParaAbrirMs: enPreparacion ? RETO_CFG.PREPARACION_MS - dentro : null,
  }
  if (pausada) {
    return { fase: FASES_RETO.pausada, faseAlPausar: enPreparacion ? FASES_RETO.preparando : FASES_RETO.abierta, ...base, abreMs: null, cierraMs: null }
  }
  return {
    fase: enPreparacion ? FASES_RETO.preparando : FASES_RETO.abierta,
    faseAlPausar: null,
    ...base,
    abreMs: momentoRealMs(sesion, inicio + RETO_CFG.PREPARACION_MS),
    cierraMs: momentoRealMs(sesion, inicio + turno),
  }
}

/** ¿Se acepta en `ahoraMs` una respuesta a la pregunta `indice`? Solo con esa pregunta abierta y sin pausa. */
export function aceptaRespuesta(sesion, indice, ahoraMs) {
  const f = faseReto(sesion, ahoraMs)
  return f.fase === FASES_RETO.abierta && f.indice === indice
}

// ── Transiciones del docente ────────────────────────────────────────────────
// Devuelven { ok, patch } (patch = campos a guardar; null = nada que cambiar) o { ok: false, codigo, error }.
// Repetir una acción ya aplicada (dos pestañas, doble clic) no es un error: devuelve patch null.

export function iniciarReto(sesion, ahoraMs) {
  if (esEnteroNoNegativo(sesion?.terminadaMs)) return { ok: false, codigo: 'NO_EN_ESPERA', error: 'Esta competencia ya terminó.' }
  if (sesion?.estado === ESTADOS_RETO.en_curso) return { ok: true, patch: null }
  if (sesion?.estado !== ESTADOS_RETO.espera) return { ok: false, codigo: 'NO_EN_ESPERA', error: 'Esta competencia ya terminó.' }
  if (!esEnteroNoNegativo(ahoraMs)) return { ok: false, codigo: 'HORA_INVALIDA', error: 'Hora del servidor no válida.' }
  return { ok: true, patch: { estado: ESTADOS_RETO.en_curso, inicioMs: ahoraMs, pausas: [] } }
}

export function pausarReto(sesion, ahoraMs) {
  if (estaPausada(sesion)) return { ok: true, patch: null }
  const pausas = pausasDe(sesion)
  // La hora no puede ser anterior a lo ya registrado (inicio o fin de la última pausa): las pausas solo se agregan al final.
  const previa = pausas.length ? pausas[pausas.length - 1].hastaMs : sesion?.inicioMs
  if (!esEnteroNoNegativo(ahoraMs) || (esEnteroNoNegativo(previa) && ahoraMs < previa)) {
    return { ok: false, codigo: 'HORA_INVALIDA', error: 'Hora del servidor no válida.' }
  }
  const f = faseReto(sesion, ahoraMs)
  if (f.fase !== FASES_RETO.preparando && f.fase !== FASES_RETO.abierta) {
    return { ok: false, codigo: 'NO_PAUSABLE', error: 'Solo se puede pausar mientras la competencia está en curso.' }
  }
  if (pausas.length >= RETO_CFG.MAX_PAUSAS) return { ok: false, codigo: 'MAX_PAUSAS', error: `Se alcanzó el máximo de ${RETO_CFG.MAX_PAUSAS} pausas.` }
  return { ok: true, patch: { pausas: [...pausas, { desdeMs: ahoraMs, hastaMs: null }] } }
}

export function reanudarReto(sesion, ahoraMs) {
  if (sesion?.estado !== ESTADOS_RETO.en_curso) return { ok: false, codigo: 'NO_EN_CURSO', error: 'La competencia no está en curso.' }
  if (!estaPausada(sesion)) return { ok: true, patch: null }
  const pausas = pausasDe(sesion)
  const ultima = pausas[pausas.length - 1]
  if (!esEnteroNoNegativo(ahoraMs) || ahoraMs < ultima.desdeMs) return { ok: false, codigo: 'HORA_INVALIDA', error: 'Hora del servidor no válida.' }
  return { ok: true, patch: { pausas: [...pausas.slice(0, -1), { desdeMs: ultima.desdeMs, hastaMs: ahoraMs }] } }
}

/**
 * Terminación anticipada (decidida por el docente, con confirmación explícita). Guarda la hora del servidor en
 * `terminadaMs`; si estaba en pausa, la pausa se cierra en ese mismo instante. Desde ahí no se acepta nada.
 * La pregunta que estaba en turno (abierta, en preparación o pausada) NO cuenta como realizada.
 * Si la competencia ya terminó (sola o antes), no cambia nada.
 */
export function terminarReto(sesion, ahoraMs, { confirmado = false } = {}) {
  if (esEnteroNoNegativo(sesion?.terminadaMs) || sesion?.estado === ESTADOS_RETO.finalizada) return { ok: true, patch: null }
  if (confirmado !== true) return { ok: false, codigo: 'SIN_CONFIRMACION', error: 'Confirma que quieres terminar la competencia.' }
  if (!esEnteroNoNegativo(ahoraMs)) return { ok: false, codigo: 'HORA_INVALIDA', error: 'Hora del servidor no válida.' }
  if (sesion?.estado === ESTADOS_RETO.espera) return { ok: true, patch: { terminadaMs: ahoraMs } } // nunca empezó
  if (sesion?.estado !== ESTADOS_RETO.en_curso) return { ok: false, codigo: 'NO_EN_CURSO', error: 'La competencia no está en curso.' }
  const pausas = pausasDe(sesion)
  const ultima = pausas[pausas.length - 1]
  const previa = ultima ? (ultima.hastaMs ?? ultima.desdeMs) : sesion.inicioMs
  if (ahoraMs < previa) return { ok: false, codigo: 'HORA_INVALIDA', error: 'Hora del servidor no válida.' }
  if (faseReto(sesion, ahoraMs).fase === FASES_RETO.terminada) return { ok: true, patch: null } // ya pasó la última pregunta
  const patch = { terminadaMs: ahoraMs }
  if (estaPausada(sesion)) patch.pausas = [...pausas.slice(0, -1), { desdeMs: ultima.desdeMs, hastaMs: ahoraMs }]
  return { ok: true, patch }
}

/** ¿Ya se pueden calcular los resultados? Cuando pasó la última pregunta o el docente terminó antes. */
export function puedeFinalizar(sesion, ahoraMs) {
  return faseReto(sesion, ahoraMs).fase === FASES_RETO.terminada
}

/**
 * Preguntas REALIZADAS: las que se abrieron y cerraron completas. Sin terminación anticipada, todas.
 * Con ella, solo las que cerraron antes de `terminadaMs`; la que estaba en turno no cuenta. 0 si nunca empezó.
 */
export function preguntasRealizadas(sesion) {
  const total = totalDe(sesion)
  if (!esEnteroNoNegativo(sesion?.inicioMs)) return 0
  if (!esEnteroNoNegativo(sesion?.terminadaMs)) return total
  return Math.min(total, ubicarTurno(sesion, tiempoEfectivoMs(sesion, sesion.terminadaMs)).indice)
}

/** Índice de la pregunta que estaba ABIERTA (o pausada ya abierta) cuando el docente terminó; null si ninguna. */
export function preguntaInterrumpida(sesion) {
  if (!esEnteroNoNegativo(sesion?.inicioMs) || !esEnteroNoNegativo(sesion?.terminadaMs)) return null
  const { indice, inicio } = ubicarTurno(sesion, tiempoEfectivoMs(sesion, sesion.terminadaMs))
  if (indice >= totalDe(sesion)) return null
  const dentro = tiempoEfectivoMs(sesion, sesion.terminadaMs) - inicio
  return dentro >= RETO_CFG.PREPARACION_MS ? indice : null
}

// ── Participantes ───────────────────────────────────────────────────────────

// ── Acceso (E5, E6) ─────────────────────────────────────────────────────────
// `accesoAbierto` decide si entran participantes NUEVOS, en las dos modalidades. Cerrarlo no saca a nadie: quien
// ya está dentro puede reconectarse y seguir. Ausente = cerrado (falla cerrada): el docente lo abre al mostrar el QR.
// Es independiente de pausar y de terminar.

export function abrirAcceso(sesion, ahoraMs) {
  const fase = faseReto(sesion, ahoraMs).fase
  if (fase === FASES_RETO.terminada || fase === FASES_RETO.finalizada) return { ok: false, codigo: 'TERMINADA', error: 'Esta competencia ya terminó.' }
  return { ok: true, patch: sesion?.accesoAbierto === true ? null : { accesoAbierto: true } }
}

export function cerrarAcceso(sesion) {
  return { ok: true, patch: sesion?.accesoAbierto === true ? { accesoAbierto: false } : null }
}

// ── Cupos de un reto externo (E7, R3, R4) ───────────────────────────────────
// El servidor guarda en `retoCupos/{codigo}` un contador `ocupados` y lo sube DENTRO de la misma transacción
// que crea al participante: así dos entradas simultáneas no pueden superar el tope. El contador nunca baja:
// un expulsado conserva su lugar (R3) y nadie puede ocuparlo. No hay función para liberar cupos a propósito.

/** Siguiente valor del contador al reservar un lugar, o CUPO_LLENO. `cupo` = el documento leído (o null). */
export function reservarCupo(cupo) {
  const ocupados = cupo?.ocupados ?? 0
  if (!esEnteroNoNegativo(ocupados)) return { ok: false, codigo: 'CUPO_INVALIDO', error: 'No se pudo reservar tu lugar. Inténtalo de nuevo.' }
  if (ocupados >= RETO_CFG.MAX_EXTERNOS) return { ok: false, codigo: 'CUPO_LLENO', error: 'Este reto ya alcanzó el máximo de participantes.' }
  return { ok: true, patch: { ocupados: ocupados + 1 } }
}

/**
 * ¿Puede entrar (o volver a entrar) a la sesión?
 *   · expulsado: nunca vuelve a la misma sesión (en externo: ese token);
 *   · competencia terminada: no admite a nadie;
 *   · ya está dentro (`participante` existe): puede reconectarse aunque el acceso esté cerrado;
 *   · nuevo: solo con el acceso abierto; en un reto externo, además, con lugar libre (`cupo` leído en la transacción).
 *     `cupo`: el documento de cupos, o null si todavía no existe (primer participante). Sin pasarlo (undefined), un
 *     externo nuevo se rechaza: el servidor no puede saltarse la lectura del contador.
 * Se puede entrar en la sala de espera y con la competencia en curso (ingreso tardío: lo anterior vale 0).
 * Devuelve { ok: true, nuevo, cupoPatch } (cupoPatch solo para un externo nuevo) o { ok: false, codigo, error }.
 */
export function puedeUnirse(sesion, participante, ahoraMs, { cupo } = {}) {
  if (participante?.expulsado === true) return { ok: false, codigo: 'EXPULSADO', error: 'El docente te retiró de esta competencia.' }
  const fase = faseReto(sesion, ahoraMs).fase
  if (fase === FASES_RETO.terminada || fase === FASES_RETO.finalizada) return { ok: false, codigo: 'TERMINADA', error: 'Esta competencia ya terminó.' }
  if (participante?.id) return { ok: true, nuevo: false, cupoPatch: null }
  if (!modalidadValida(sesion?.modalidad)) return { ok: false, codigo: 'MODALIDAD_INVALIDA', error: 'Esta competencia no está bien configurada.' }
  if (sesion.accesoAbierto !== true) return { ok: false, codigo: 'ACCESO_CERRADO', error: 'El acceso a esta competencia está cerrado.' }
  if (sesion.modalidad === 'externo') {
    if (cupo === undefined) return { ok: false, codigo: 'CUPO_SIN_LEER', error: 'No se pudo reservar tu lugar. Inténtalo de nuevo.' }
    const r = reservarCupo(cupo)
    if (!r.ok) return r
    return { ok: true, nuevo: true, cupoPatch: r.patch }
  }
  return { ok: true, nuevo: true, cupoPatch: null }
}

// ── Token del participante externo (E3) ─────────────────────────────────────
// Al entrar, el servidor genera un secreto de 256 bits (64 caracteres hexadecimales), se lo entrega UNA vez y el
// navegador lo guarda. El servidor guarda solo su huella SHA-256 (`tokenHash`, también 64 hex), y de ella sale el
// id del participante: con el token se le encuentra sin consultas, y sin el token nadie puede actuar por él.
// Perder el navegador = perder el token = entrar como participante nuevo (limitación aceptada, se avisa en pantalla).

const HEX_64 = /^[0-9a-f]{64}$/

/** ¿Tiene forma de token (o de huella) válido? */
export function formatoTokenValido(t) {
  return typeof t === 'string' && HEX_64.test(t)
}

/**
 * Id del participante en `retoParticipantes`. Inscrito: `{codigo}_{inscripción}`. Externo: `{codigo}_x{40 hex de
 * la huella}`. Un externo nunca lleva inscripción y un inscrito nunca lleva token. null si los datos no cuadran.
 */
export function idParticipante({ codigo, modalidad, alumnoId = null, tokenHash = null }) {
  if (typeof codigo !== 'string' || !codigo) return null
  if (modalidad === 'inscritos') {
    if (tokenHash != null || typeof alumnoId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(alumnoId)) return null
    return `${codigo}_${alumnoId}`
  }
  if (modalidad === 'externo') {
    if (alumnoId != null || !formatoTokenValido(tokenHash)) return null
    return `${codigo}_x${tokenHash.slice(0, 40)}`
  }
  return null
}

/**
 * Registro de un participante, según su modalidad. El externo SOLO lleva alias y la huella del token: ni
 * inscripción, ni nombre real, ni ninguna identidad académica.
 */
export function registroParticipante({ codigo, modalidad, docenteId, alias = null, alumnoId = null, nombre = null, tokenHash = null, unidoMs }) {
  const id = idParticipante({ codigo, modalidad, alumnoId, tokenHash })
  if (!id || typeof docenteId !== 'string' || !docenteId || !esEnteroNoNegativo(unidoMs)) return null
  if (modalidad === 'externo') {
    if (typeof alias !== 'string' || !alias) return null
    return { id, sesionId: codigo, docenteId, modalidad, alias, tokenHash, unidoMs, expulsado: false }
  }
  return { id, sesionId: codigo, docenteId, modalidad, alumnoId, nombre: nombre ?? null, alias: alias ?? null, unidoMs, expulsado: false }
}

/** Expulsar: queda bloqueado para siempre en la sesión; su lugar NO se libera (R3). */
export function expulsarParticipante(participante, ahoraMs) {
  if (!participante?.id) return { ok: false, codigo: 'NO_PARTICIPANTE', error: 'Ese participante no existe.' }
  if (participante.expulsado === true) return { ok: true, patch: null }
  return { ok: true, patch: { expulsado: true, expulsadoMs: ahoraMs } }
}

/** ¿Este participante puede responder ahora la pregunta `indice`? */
export function puedeResponder(sesion, participante, indice, ahoraMs) {
  if (!participante?.id) return { ok: false, codigo: 'NO_PARTICIPANTE', error: 'Primero entra a la competencia.' }
  if (participante.expulsado === true) return { ok: false, codigo: 'EXPULSADO', error: 'El docente te retiró de esta competencia.' }
  if (Number.isFinite(participante.unidoMs) && ahoraMs < participante.unidoMs) return { ok: false, codigo: 'NO_UNIDO', error: 'Primero entra a la competencia.' }
  const f = faseReto(sesion, ahoraMs)
  if (f.fase === FASES_RETO.pausada) return { ok: false, codigo: 'PAUSADA', error: 'La competencia está en pausa.' }
  if (!aceptaRespuesta(sesion, indice, ahoraMs)) return { ok: false, codigo: 'FUERA_DE_TIEMPO', error: 'Esa pregunta ya no está abierta.' }
  return { ok: true }
}

// ── Puntuación ──────────────────────────────────────────────────────────────

/** Valor de la clave de una pregunta, o null si falta (sin clave no se puede calificar). */
function claveDe(claves, preguntaId) {
  const c = claves?.[preguntaId]
  const v = c && typeof c === 'object' ? c.respuestaCorrecta : c
  return typeof v === 'string' && v !== '' ? v : null
}

/** Misma comparación que las evaluaciones (calcularPuntosPregunta): la opción elegida contra la clave. */
export function esAcierto(pregunta, claveValor, opcionSeleccionada) {
  if (!TIPOS_RETO.includes(pregunta?.tipo)) return false
  return opcionSeleccionada != null && claveValor != null && opcionSeleccionada === claveValor
}

/** Nombre que ve el grupo. En modo alias, NUNCA el nombre real (aunque falte el alias). */
export function nombreVisible(participante, modo) {
  if (modo === 'alias') return typeof participante?.alias === 'string' && participante.alias ? participante.alias : 'Participante'
  return typeof participante?.nombre === 'string' && participante.nombre ? participante.nombre : 'Participante'
}

const comparadorNombre = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

/**
 * Posiciones con empates compartidos (D6): mismos aciertos = misma posición, y la siguiente salta
 * (1, 1, 3). Dentro de un empate el orden de la lista es alfabético por el nombre visible y, al final, por id;
 * eso solo ordena la lista: NO desempata ni usa la rapidez.
 * `filas`: [{ participanteId, nombreVisible, aciertos }]. Devuelve una copia ordenada con `posicion`.
 */
export function asignarPosiciones(filas) {
  const ordenadas = [...(filas || [])].sort((a, b) =>
    (b.aciertos - a.aciertos) ||
    comparadorNombre.compare(a.nombreVisible || '', b.nombreVisible || '') ||
    String(a.participanteId).localeCompare(String(b.participanteId)))
  let posicion = 0
  return ordenadas.map((f, i) => {
    if (i === 0 || f.aciertos !== ordenadas[i - 1].aciertos) posicion = i + 1
    return { ...f, posicion }
  })
}

/**
 * Resultados de una sesión, calculados SIEMPRE desde cero a partir de las respuestas guardadas (no de
 * contadores acumulados): dos cálculos con los mismos datos dan lo mismo.
 *
 * Entrada:
 *   sesion        { estado, inicioMs, pausas, terminadaMs, totalPreguntas, modoIdentidad }
 *   preguntas     [{ id, tipo }] en el orden de la competencia (exactamente TOTAL_PREGUNTAS)
 *   claves        { [preguntaId]: { respuestaCorrecta } } (copia congelada al iniciar)
 *   participantes [{ id, nombre, alias, expulsado, unidoMs }]
 *   respuestas    [{ id, participanteId, preguntaId, opcionSeleccionada, recibidaMs }]
 *
 * Solo cuentan las preguntas REALIZADAS (ver preguntasRealizadas). Con terminación anticipada, la pregunta que
 * estaba en turno y las que nunca se abrieron no se califican ni aparecen en el detalle (así no se revela su
 * contenido ni su clave); sus respuestas no se borran de ningún lado: solo se cuentan en `descartadas.noRealizada`.
 *
 * Una respuesta se DESCARTA (y se cuenta) si: es de un participante o pregunta que no existe, es de una pregunta
 * no realizada, repite una pregunta ya contestada por esa persona (vale la primera que llegó), o su `recibidaMs`
 * no cae en la ventana abierta de su pregunta o es anterior al ingreso del participante. Las de un expulsado se
 * conservan en su detalle, pero él no entra en la clasificación.
 *
 * Devuelve { ok: true, realizadas, interrumpida, sinResultados, clasificacion, expulsados, detalle, descartadas }
 * o { ok: false, codigo, error }. Con `realizadas` = 0 (se terminó antes de la primera pregunta) `sinResultados`
 * es true y no hay clasificación ni detalle.
 */
export function calcularResultadosReto({ sesion, preguntas, claves, participantes, respuestas }) {
  const lista = Array.isArray(preguntas) ? preguntas : []
  if (lista.length !== RETO_CFG.TOTAL_PREGUNTAS) {
    return { ok: false, codigo: 'TOTAL_INVALIDO', error: `La competencia debe tener exactamente ${RETO_CFG.TOTAL_PREGUNTAS} preguntas.` }
  }
  const indicePorId = new Map()
  for (let i = 0; i < lista.length; i++) {
    const p = lista[i]
    if (!p?.id || indicePorId.has(p.id)) return { ok: false, codigo: 'PREGUNTA_INVALIDA', error: `La pregunta ${i + 1} no tiene un identificador único.` }
    if (!TIPOS_RETO.includes(p.tipo)) return { ok: false, codigo: 'TIPO_NO_COMPATIBLE', error: `La pregunta ${i + 1} no se puede calificar automáticamente.` }
    if (claveDe(claves, p.id) == null) return { ok: false, codigo: 'SIN_CLAVE', error: `La pregunta ${i + 1} no tiene respuesta correcta.` }
    indicePorId.set(p.id, i)
  }
  // Las ventanas se comprueban con la línea de tiempo de la sesión aunque ya esté finalizada.
  const terminadaSinEmpezar = !esEnteroNoNegativo(sesion?.inicioMs) && esEnteroNoNegativo(sesion?.terminadaMs)
  if ((!esEnteroNoNegativo(sesion?.inicioMs) && !terminadaSinEmpezar) || !pausasValidas(sesion) ||
    (esEnteroNoNegativo(sesion?.terminadaMs) && esEnteroNoNegativo(sesion?.inicioMs) && sesion.terminadaMs < sesion.inicioMs)) {
    return { ok: false, codigo: 'SESION_INVALIDA', error: 'La sesión no tiene un registro de tiempo válido.' }
  }
  const sesionCalculo = { ...sesion, estado: ESTADOS_RETO.en_curso, totalPreguntas: lista.length }
  const realizadas = preguntasRealizadas(sesionCalculo)
  const interrumpidaIdx = preguntaInterrumpida(sesionCalculo)
  const interrumpida = interrumpidaIdx == null ? null : lista[interrumpidaIdx].id
  const contadas = lista.slice(0, realizadas)

  const porParticipante = new Map()
  for (const pa of Array.isArray(participantes) ? participantes : []) {
    if (pa?.id && !porParticipante.has(pa.id)) porParticipante.set(pa.id, pa)
  }

  const descartadas = { desconocidas: 0, noRealizada: 0, duplicadas: 0, fueraDeTiempo: 0 }
  // Por participante y pregunta: la PRIMERA respuesta válida que llegó (empate de hora: id menor).
  const elegidas = new Map()
  const ordenLlegada = [...(Array.isArray(respuestas) ? respuestas : [])].sort((a, b) =>
    ((a?.recibidaMs ?? Infinity) - (b?.recibidaMs ?? Infinity)) || String(a?.id).localeCompare(String(b?.id)))
  for (const r of ordenLlegada) {
    const pa = porParticipante.get(r?.participanteId)
    const idx = indicePorId.get(r?.preguntaId)
    if (!pa || idx == null) { descartadas.desconocidas++; continue }
    if (idx >= realizadas) { descartadas.noRealizada++; continue }
    const llave = `${r.participanteId}\u0000${r.preguntaId}`
    if (elegidas.has(llave)) { descartadas.duplicadas++; continue }
    const enVentana = Number.isFinite(r.recibidaMs) && aceptaRespuesta(sesionCalculo, idx, r.recibidaMs) &&
      !(Number.isFinite(pa.unidoMs) && r.recibidaMs < pa.unidoMs)
    if (!enVentana) { descartadas.fueraDeTiempo++; continue }
    elegidas.set(llave, r)
  }

  // Se terminó antes de la primera pregunta: sin clasificación ni detalle (el registro de la sesión se conserva).
  if (realizadas === 0) {
    return { ok: true, realizadas, interrumpida, sinResultados: true, clasificacion: [], expulsados: [], detalle: {}, descartadas }
  }

  const modo = modoIdentidadDe(sesion)
  const detalle = {}
  const filas = []
  const expulsados = []
  for (const [id, pa] of porParticipante) {
    let aciertos = 0
    let respondidas = 0
    detalle[id] = contadas.map((p) => {
      const r = elegidas.get(`${id}\u0000${p.id}`)
      const correcta = claveDe(claves, p.id)
      const opcion = r ? (r.opcionSeleccionada ?? null) : null
      if (r) respondidas++
      const acerto = esAcierto(p, correcta, opcion)
      if (acerto) aciertos++
      return { preguntaId: p.id, opcionSeleccionada: opcion, respuestaCorrecta: correcta, acerto }
    })
    const fila = { participanteId: id, nombreVisible: nombreVisible(pa, modo), aciertos, respondidas }
    if (pa.expulsado === true) expulsados.push(fila)
    else filas.push(fila)
  }
  return { ok: true, realizadas, interrumpida, sinResultados: false, clasificacion: asignarPosiciones(filas), expulsados, detalle, descartadas }
}

/**
 * Calificación propuesta (D7): aciertos / preguntas realizadas × calificación máxima, con el mismo redondeo de
 * las evaluaciones (un decimal). Con las 10 preguntas es aciertos / 10 × máxima; con terminación anticipada se
 * mantiene la proporción sobre las realizadas. Sin preguntas realizadas no hay calificación (null).
 * Es solo una PROPUESTA: aplicarla a `submissions` lo decide el docente.
 */
export function calificacionReto(aciertos, maxCalif = 10, realizadas = RETO_CFG.TOTAL_PREGUNTAS) {
  const total = realizadas
  if (!Number.isInteger(total) || total < 1 || total > RETO_CFG.TOTAL_PREGUNTAS) return null
  if (!Number.isInteger(aciertos) || aciertos < 0 || aciertos > total) return null
  if (!(Number.isFinite(maxCalif) && maxCalif > 0)) return null
  const preguntas = Array.from({ length: total }, (_, i) => ({ id: String(i), ponderacion: 1 }))
  const respuestas = Object.fromEntries(preguntas.map((p, i) => [p.id, { puntosObtenidos: i < aciertos ? 1 : 0 }]))
  return calcularCalificacion(preguntas, respuestas, maxCalif)
}

/**
 * Calificación propuesta de UN reto, con el candado de modalidad: un reto externo (o uno sin modalidad válida, o
 * de inscritos no calificable) nunca produce calificación, sean cuales sean los aciertos. `reto` = { modalidad, calificable }.
 */
export function calificacionPropuestaReto(reto, { aciertos, maxCalif = 10, realizadas = RETO_CFG.TOTAL_PREGUNTAS } = {}) {
  if (!esCalificable(reto)) return null
  return calificacionReto(aciertos, maxCalif, realizadas)
}

/**
 * Etapa 5 · notas propuestas de UNA sesión terminada, una por estudiante inscrito que participó (D7). Solo en un reto
 * de inscritos marcado calificable (lo que tenga la actividad al aplicar) y con clasificación. Nunca para un reto
 * externo, de práctica o sin preguntas realizadas, ni para los retirados por el docente. Quien no participó no
 * aparece: queda sin nota, como en cualquier actividad.
 *   · `reto` = actividad.reto ({ modalidad, calificable }); `resultados` = el registro definitivo (retoResultados);
 *   · `participantes` = los de la sesión, con su `alumnoId` (inscripción en `students`).
 * Devuelve [{ alumnoId, participanteId, aciertos, realizadas, calificacion }].
 */
export function propuestasCalificacionReto({ reto, maxCalif = 10, resultados, participantes = [] } = {}) {
  if (!esCalificable(reto) || !resultados || resultados.sinResultados || resultados.modalidad === 'externo') return []
  const realizadas = Number(resultados.realizadas)
  const porId = new Map(participantes.map((p) => [p.id, p]))
  const vistos = new Set()
  const salida = []
  for (const f of resultados.clasificacion || []) {
    const p = porId.get(f.participanteId)
    if (!p || p.expulsado === true || typeof p.alumnoId !== 'string' || !p.alumnoId || vistos.has(p.alumnoId)) continue
    const calificacion = calificacionPropuestaReto(reto, { aciertos: f.aciertos, maxCalif, realizadas })
    if (calificacion == null) continue
    vistos.add(p.alumnoId)
    salida.push({ alumnoId: p.alumnoId, participanteId: f.participanteId, aciertos: f.aciertos, realizadas, calificacion })
  }
  return salida
}

// ── Lo que ve cada participante al final (D9, E9, E11) ──────────────────────

/**
 * Vista de resultados para el celular de UN participante:
 *   · `top`: los puestos 1 a TOP_CLASIFICACION (con empates puede haber más de 10 filas: nadie empatado en un
 *     puesto visible se queda fuera); cada fila solo lleva posición, nombre visible y aciertos, nunca ids;
 *   · `propia`: su posición y aciertos aunque quede fuera del top; null si fue expulsado o no participó;
 *   · `correccion`: solo en un reto de inscritos (su respuesta, la correcta y si acertó, de las preguntas
 *     realizadas). En un reto externo NUNCA se incluye (E11): no se revelan las claves.
 * `resultados` = lo que devuelve calcularResultadosReto (con nombres visibles ya según la modalidad).
 */
export function vistaResultadosParticipante(resultados, participanteId, { modalidad } = {}) {
  const base = { realizadas: resultados?.realizadas ?? 0, top: [], propia: null }
  if (!resultados?.ok || resultados.sinResultados) return base
  const fila = (f) => ({ posicion: f.posicion, nombreVisible: f.nombreVisible, aciertos: f.aciertos })
  const clasificacion = Array.isArray(resultados.clasificacion) ? resultados.clasificacion : []
  const top = clasificacion.filter((f) => f.posicion <= RETO_CFG.TOP_CLASIFICACION).map(fila)
  const mia = clasificacion.find((f) => f.participanteId === participanteId)
  const vista = { ...base, top, propia: mia ? fila(mia) : null }
  if (modalidad === 'inscritos' && mia && Array.isArray(resultados.detalle?.[participanteId])) {
    vista.correccion = resultados.detalle[participanteId].map((d) => ({ ...d }))
  }
  return vista
}

// ── Conservación de los datos ──────────────────────────────────────────────
// Nada se borra solo (decisión del 3-nov-2026, reemplaza E8, R1 y R2): alias, respuestas, participantes y resultados
// de las DOS modalidades se conservan hasta que el docente borre el reto o la sesión, igual que en Participación en
// vivo. No hay barrido programado ni caducidad.
//
// La competencia SOLO termina cuando el docente lo decide o cuando concluye normalmente la última pregunta. Nada la
// termina por inactividad: una pausa dura hasta que el docente reanude o termine, y una desconexión del docente o
// del proyector no la finaliza ni la reinicia. Los resultados se calculan en la primera consulta al servidor después
// de terminar (puedeFinalizar).

// ── Alias ───────────────────────────────────────────────────────────────────

/** Alias tal como se mostrará: sin espacios a los lados y con los espacios internos reducidos a uno. */
export function normalizarAlias(texto) {
  return String(texto ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
}

/**
 * Llave para la unicidad dentro de una sesión: sin mayúsculas, acentos, espacios ni signos (la ñ se
 * conserva). «Ana-Luz», «ana luz» y «ANALUZ» son el mismo alias.
 */
export function claveAlias(texto) {
  return normalizarAlias(texto)
    .toLowerCase()
    // La ñ se aparta con un carácter de uso privado para que NFD no le quite la tilde (igual que la moderación).
    .replace(/ñ/g, '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(//g, 'ñ')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Formas del alias que se revisan con el detector de palabras ofensivas. El detector compara por palabra
 * completa (para no marcar «computadora»), así que un alias pegado como «ElGrosero», «el_grosero» o
 * «grosero123» se separa en palabras antes de revisarlo.
 */
export function variantesAlias(alias) {
  const base = normalizarAlias(alias)
  const separado = base.replace(/[-_.]+/g, ' ')
  const camel = separado.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
  const letrasNumeros = camel.replace(/(\p{L})(\p{N})/gu, '$1 $2').replace(/(\p{N})(\p{L})/gu, '$1 $2')
  return [...new Set([base, separado, camel, letrasNumeros])]
}

const ALIAS_PERMITIDO = /^[\p{L}\p{N} ._-]+$/u

// Palabras que suplantan un rol (ya normalizadas con claveNombre). Bloquean el alias si aparecen como PALABRA
// («Profe Juan», «ElDocente», «Admin7»), no como parte de otra («Profeta» o «Sistemático» sí se permiten).
export const ALIAS_RESERVADOS = [
  'docente', 'docentes', 'maestro', 'maestra', 'maestros', 'maestras', 'profesor', 'profesora', 'profesores', 'profesoras',
  'profe', 'profes', 'admin', 'administrador', 'administradora', 'director', 'directora', 'coordinador', 'coordinadora',
  'moderador', 'moderadora', 'soporte', 'sistema', 'evalua',
]
// Frases reservadas: bloquean el alias si aparecen en cualquier parte (ya sin espacios ni signos).
export const ALIAS_FRASES_RESERVADAS = ['evaluafacil']

/** Llave para comparar con nombres: como claveAlias, y además la ñ cuenta como n («Peña» = «Pena»). */
export function claveNombre(texto) {
  return claveAlias(texto).replace(/ñ/g, 'n')
}

const palabrasDe = (texto) => normalizarAlias(texto).split(' ').map(claveNombre).filter(Boolean)

/**
 * Formas del nombre real de un estudiante que un alias NO puede tener (decisión 5): el nombre completo (en los dos
 * órdenes) y el nombre con cualquiera de los apellidos. «Nombre» es el campo completo («Evelyn Guadalupe») o
 * cualquiera de sus nombres de pila; el nombre de pila SOLO no se bloquea. Todo con claveNombre (sin mayúsculas,
 * acentos, espacios ni signos). Acepta { nombre, apellidoPaterno, apellidoMaterno } o el nombre completo en texto.
 */
export function formasNombreReal(persona) {
  const formas = new Set()
  if (typeof persona === 'string') {
    if (palabrasDe(persona).length >= 2) formas.add(claveNombre(persona))
    return formas
  }
  const completo = claveNombre(persona?.nombre)
  const deNombre = [...new Set([completo, ...palabrasDe(persona?.nombre).filter((p) => p.length >= 2)])].filter(Boolean)
  const apellidos = [persona?.apellidoPaterno, persona?.apellidoMaterno].map(claveNombre).filter(Boolean)
  for (const n of deNombre) {
    for (const ap of apellidos) { formas.add(n + ap); formas.add(ap + n) }
    if (apellidos.length === 2) { formas.add(n + apellidos.join('')); formas.add(apellidos.join('') + n) }
  }
  // Sin apellidos registrados: solo el nombre completo, si tiene más de una palabra (un nombre de pila solo no).
  if (!apellidos.length && palabrasDe(persona?.nombre).length >= 2) formas.add(completo)
  return formas
}

/** ¿El alias contiene un rol reservado? */
function esReservado(alias) {
  const palabras = new Set(variantesAlias(alias).flatMap(palabrasDe))
  if (ALIAS_RESERVADOS.some((r) => palabras.has(r))) return true
  const compacto = claveNombre(alias)
  return ALIAS_FRASES_RESERVADAS.some((f) => compacto.includes(f))
}

/** ¿El alias coincide con el nombre real de alguna persona de la lista? (también con números añadidos: «Ana Pérez 2») */
function suplantaNombre(alias, nombresProtegidos) {
  const compacto = claveNombre(alias)
  const sinNumeros = compacto.replace(/\p{N}/gu, '')
  return nombresProtegidos.some((persona) => {
    const formas = formasNombreReal(persona)
    return formas.has(compacto) || (sinNumeros && formas.has(sinNumeros))
  })
}

/**
 * Valida un alias (lo escriba el estudiante o lo cambie el docente). La valida el SERVIDOR; la pantalla solo
 * puede repetirla para avisar antes.
 * `ocupados`: llaves (claveAlias) ya tomadas en la sesión — al renombrar, sin la del propio participante.
 * `esOfensivo(texto) → boolean`: detector del servidor. OBLIGATORIO: sin él se rechaza (falla cerrada).
 * `nombresProtegidos`: nombres reales de los estudiantes de la sesión, INCLUIDO el propio (decisión 4).
 *   OBLIGATORIO (puede ser una lista vacía): sin él se rechaza (falla cerrada).
 * Devuelve { ok: true, alias, clave } o { ok: false, codigo, error }. El error nunca repite la palabra hallada
 * ni dice a qué persona se parece.
 */
export function validarAlias(texto, { ocupados = [], esOfensivo, nombresProtegidos } = {}) {
  const alias = normalizarAlias(texto)
  const largo = [...alias].length
  if (largo < RETO_CFG.ALIAS_MIN || largo > RETO_CFG.ALIAS_MAX) {
    return { ok: false, codigo: 'LONGITUD', error: `El alias debe tener de ${RETO_CFG.ALIAS_MIN} a ${RETO_CFG.ALIAS_MAX} caracteres.` }
  }
  if (!ALIAS_PERMITIDO.test(alias)) {
    return { ok: false, codigo: 'CARACTERES', error: 'Usa solo letras, números, espacios, punto, guion o guion bajo.' }
  }
  const clave = claveAlias(alias)
  if (!/\p{L}/u.test(clave) || [...clave].length < RETO_CFG.ALIAS_MIN) {
    return { ok: false, codigo: 'SIN_LETRAS', error: `El alias debe tener al menos ${RETO_CFG.ALIAS_MIN} letras o números, con al menos una letra.` }
  }
  if (typeof esOfensivo !== 'function' || !Array.isArray(nombresProtegidos)) {
    return { ok: false, codigo: 'SIN_MODERACION', error: 'No se pudo revisar el alias. Inténtalo de nuevo.' }
  }
  if (variantesAlias(alias).some((v) => esOfensivo(v) === true)) {
    return { ok: false, codigo: 'OFENSIVO', error: 'Ese alias no está permitido. Elige otro.' }
  }
  if (esReservado(alias)) {
    return { ok: false, codigo: 'RESERVADO', error: 'Ese alias parece el de un docente o del sistema. Elige otro.' }
  }
  if (suplantaNombre(alias, nombresProtegidos)) {
    return { ok: false, codigo: 'SUPLANTACION', error: 'El alias no puede ser el nombre real de una persona. Elige otro.' }
  }
  const tomadas = ocupados instanceof Set ? ocupados : new Set(Array.isArray(ocupados) ? ocupados : [])
  if (tomadas.has(clave)) {
    return { ok: false, codigo: 'OCUPADO', error: 'Ese alias ya lo usa otro participante. Elige otro.' }
  }
  return { ok: true, alias, clave }
}

// ── Preguntas del reto (etapa 2: crear y editar) ────────────────────────────
// Un reto guarda sus preguntas como un cuestionario: `activities/{id}/preguntas` (lo público) y
// `activities/{id}/clave` (la respuesta correcta), separadas por src/utils/evaluacionClave.js. Aquí solo se
// arma y se valida lo que se guarda; nada de esto escribe en Firestore.
//   · opción múltiple: opciones [{ id, texto }] y respuestaCorrecta = id de la correcta;
//   · verdadero/falso: opciones [{ id: 'v' }, { id: 'f' }] y respuestaCorrecta = 'v' | 'f'.
// Sin imágenes (S3) ni opción «Otra» (texto libre: no se califica sola).

export const RETO_LIMITES = { MAX_ENUNCIADO: 500, MAX_OPCION: 300, ENUNCIADO_RECOMENDADO: 200, MIN_OPCIONES: 2, MAX_OPCIONES: 6 }

const OPCIONES_VF = [{ id: 'v', texto: 'Verdadero' }, { id: 'f', texto: 'Falso' }]

const texto = (v, max) => String(v ?? '').trim().slice(0, max)

/** Id de opción con el mismo formato que el editor de evaluaciones (`o` + tiempo + azar). */
export function nuevoIdOpcion(ahoraMs = Date.now(), azar = Math.random) {
  return `o${Math.floor(ahoraMs).toString(36)}${azar().toString(36).slice(2, 7)}`
}

/**
 * ¿Se puede usar este reactivo (del banco, de un cuestionario o examen, o ya del reto) en Reto Exprés?
 * Devuelve { ok: true } o { ok: false, motivo }. Motivos: tipo, imagen, enunciado, opciones, otra, clave.
 * `r` = { tipo, enunciado, opciones, respuestaCorrecta, imagenUrl }.
 */
export function reactivoCompatibleReto(r) {
  if (!TIPOS_RETO.includes(r?.tipo)) return { ok: false, motivo: 'tipo' }
  if (r.imagenUrl) return { ok: false, motivo: 'imagen' }
  if (!texto(r.enunciado, RETO_LIMITES.MAX_ENUNCIADO)) return { ok: false, motivo: 'enunciado' }
  if (r.tipo === 'verdadero_falso') {
    return r.respuestaCorrecta === 'v' || r.respuestaCorrecta === 'f' ? { ok: true } : { ok: false, motivo: 'clave' }
  }
  const opciones = Array.isArray(r.opciones) ? r.opciones : []
  if (opciones.some((o) => o?.esOtra === true)) return { ok: false, motivo: 'otra' }
  const validas = opciones.filter((o) => o?.id && texto(o.texto, RETO_LIMITES.MAX_OPCION))
  const ids = new Set(validas.map((o) => o.id))
  if (validas.length < RETO_LIMITES.MIN_OPCIONES || validas.length > RETO_LIMITES.MAX_OPCIONES || ids.size !== validas.length) {
    return { ok: false, motivo: 'opciones' }
  }
  return ids.has(r.respuestaCorrecta) ? { ok: true } : { ok: false, motivo: 'clave' }
}

/** Texto para el docente de por qué un reactivo no se puede usar en el reto. */
export const MOTIVOS_INCOMPATIBLE = {
  tipo: 'Solo opción múltiple y verdadero/falso',
  imagen: 'Tiene imagen',
  enunciado: 'No tiene enunciado',
  opciones: 'Necesita de 2 a 6 opciones distintas con texto',
  otra: 'Tiene la opción «Otra»',
  clave: 'No tiene respuesta correcta',
}

/**
 * Copia de un reactivo existente (banco, cuestionario o examen) como pregunta del reto. Copia solo el contenido:
 * nunca enlaza ni modifica el original (D10). null si no es compatible. `orden` = posición en el reto.
 * Devuelve los datos para crearPreguntasEnLote (que separa la clave).
 */
export function preguntaRetoDesdeReactivo(r, { orden, origenBancoId = null, tiempoSeg } = {}) {
  if (!reactivoCompatibleReto(r).ok) return null
  const base = {
    tipo: r.tipo, enunciado: texto(r.enunciado, RETO_LIMITES.MAX_ENUNCIADO), ponderacion: 1,
    retroalimentacion: null, imagenUrl: null, orden: Number.isInteger(orden) ? orden : 0, origenBancoId,
    // Tiempo para responder: el que se pida (el del reto o el elegido en el editor); si no es válido, el de siempre.
    tiempoSeg: duracionValida(tiempoSeg) ? tiempoSeg : TIEMPO_POR_OMISION_SEG,
  }
  if (r.tipo === 'verdadero_falso') return { ...base, opciones: OPCIONES_VF.map((o) => ({ ...o })), respuestaCorrecta: r.respuestaCorrecta }
  const opciones = r.opciones
    .filter((o) => o?.id && texto(o.texto, RETO_LIMITES.MAX_OPCION))
    .map((o) => ({ id: String(o.id), texto: texto(o.texto, RETO_LIMITES.MAX_OPCION), esOtra: false }))
  return { ...base, opciones, respuestaCorrecta: String(r.respuestaCorrecta) }
}

/**
 * Pregunta del reto a partir de un elemento de la propuesta de la IA, ya revisado en ReactivosIAReview
 * ({ tipo, enunciado, opciones: [texto×4], correcta: índice | 'v' | 'f' }). Mismo armado que el editor de
 * evaluaciones. null si no queda una pregunta válida para el reto.
 */
export function preguntaRetoDesdePropuestaIA(item, { orden, nuevoId = nuevoIdOpcion, tiempoSeg } = {}) {
  if (item?.tipo === 'verdadero_falso') {
    return preguntaRetoDesdeReactivo({ tipo: 'verdadero_falso', enunciado: item.enunciado, respuestaCorrecta: item.correcta === 'f' ? 'f' : 'v' }, { orden, tiempoSeg })
  }
  if (item?.tipo !== 'opcion_multiple') return null
  const textos = (Array.isArray(item.opciones) ? item.opciones : []).map((t) => texto(t, RETO_LIMITES.MAX_OPCION))
  const conTexto = textos.map((t, i) => ({ t, i })).filter((x) => x.t)
  const opciones = conTexto.map((x) => ({ id: nuevoId(), texto: x.t }))
  const idx = conTexto.findIndex((x) => x.i === item.correcta)
  if (idx < 0) return null // la correcta quedó sin texto: el docente debe corregirla
  return preguntaRetoDesdeReactivo({ tipo: 'opcion_multiple', enunciado: item.enunciado, opciones, respuestaCorrecta: opciones[idx].id }, { orden, tiempoSeg })
}

/**
 * Estado de las preguntas del reto (D12): exactamente TOTAL_PREGUNTAS, todas compatibles. `preguntas` = las del
 * reto ya con su `respuestaCorrecta` (cargarPreguntasConClave). Devuelve { total, faltan, sobran, incompatibles,
 * completo } — `completo` es la condición para poder iniciar.
 */
export function estadoPreguntasReto(preguntas) {
  const lista = Array.isArray(preguntas) ? preguntas : []
  const total = lista.length
  const incompatibles = lista.filter((p) => !reactivoCompatibleReto(p).ok).length
  const faltan = Math.max(0, RETO_CFG.TOTAL_PREGUNTAS - total)
  const sobran = Math.max(0, total - RETO_CFG.TOTAL_PREGUNTAS)
  return { total, faltan, sobran, incompatibles, completo: total === RETO_CFG.TOTAL_PREGUNTAS && incompatibles === 0 }
}

/**
 * Documento con el que nace un reto (`activities`). Valida la configuración con validarConfiguracionReto (las
 * reglas de Firestore exigen lo mismo). Nace en borrador (oculto); en inscritos, «Calificable» apagado salvo que el
 * docente lo encienda (S6); un externo nunca es calificable. Siempre pertenece a un parcial (S5).
 * Devuelve { ok: true, datos } o { ok: false, codigo, error }. `createdAt` lo pone quien escribe.
 */
export function datosNuevoReto({ nombre, modalidad, modoIdentidad, calificable = false, parcial, orden, asignaturaId, docenteId }) {
  const nom = texto(nombre, 120)
  if (!nom) return { ok: false, codigo: 'SIN_NOMBRE', error: 'Escribe el nombre del reto.' }
  if (!Number.isInteger(parcial) || parcial < 1) return { ok: false, codigo: 'SIN_PARCIAL', error: 'Elige el parcial del reto.' }
  if (typeof asignaturaId !== 'string' || !asignaturaId || typeof docenteId !== 'string' || !docenteId) {
    return { ok: false, codigo: 'SIN_ASIGNATURA', error: 'No se encontró la asignatura.' }
  }
  const externo = modalidad === 'externo'
  const conf = validarConfiguracionReto({
    modalidad, calificable: externo ? false : calificable === true, modoIdentidad: externo ? 'alias' : modoIdentidad,
    sinCalificacion: externo ? true : calificable !== true, oculta: true, publishAt: null,
  })
  if (!conf.ok) return conf
  return {
    ok: true,
    datos: {
      nombre: nom, categoria: RETO_CFG.CATEGORIA, instrucciones: '',
      oculta: true, publishAt: null, publishedAt: null, maxCalif: 10, notificarDocente: false,
      sinCalificacion: conf.config.sinCalificacion,
      parcial, orden: Number.isInteger(orden) && orden > 0 ? orden : 1, asignaturaId, docenteId,
      // tiempoSeg: el tiempo con el que nacen las preguntas de este reto (cada una puede cambiarlo).
      reto: { modalidad: conf.config.modalidad, modoIdentidad: conf.config.modoIdentidad, calificable: conf.config.calificable, tiempoSeg: TIEMPO_POR_OMISION_SEG },
    },
  }
}

/**
 * Cambios permitidos al editar los datos de un reto: nombre, instrucciones, identidad (solo inscritos) y
 * calificable (solo inscritos). La modalidad nunca. Devuelve { ok: true, patch } o { ok: false, codigo, error }.
 */
export function cambiosDatosReto(reto, { nombre, instrucciones, modoIdentidad, calificable, tiempoSeg } = {}) {
  const modalidad = reto?.reto?.modalidad
  if (!modalidadValida(modalidad)) return { ok: false, codigo: 'MODALIDAD_INVALIDA', error: 'Este reto no está bien configurado.' }
  const patch = {}
  if (nombre !== undefined) {
    const nom = texto(nombre, 120)
    if (!nom) return { ok: false, codigo: 'SIN_NOMBRE', error: 'Escribe el nombre del reto.' }
    patch.nombre = nom
  }
  if (instrucciones !== undefined) patch.instrucciones = texto(instrucciones, 1000)
  // Tiempo por omisión del reto (las dos modalidades): el de las preguntas que se agreguen desde ahora.
  if (tiempoSeg !== undefined) {
    if (!duracionValida(tiempoSeg)) return { ok: false, codigo: 'TIEMPO_INVALIDO', error: 'Elige un tiempo de la lista.' }
    patch['reto.tiempoSeg'] = tiempoSeg
  }
  if (modalidad === 'externo') {
    if ((modoIdentidad !== undefined && modoIdentidad !== 'alias') || calificable === true) {
      return { ok: false, codigo: 'EXTERNO_FIJO', error: 'Un reto externo siempre usa alias y nunca es calificable.' }
    }
    return { ok: true, patch }
  }
  if (modoIdentidad !== undefined) {
    if (modoIdentidad !== 'nombre' && modoIdentidad !== 'alias') return { ok: false, codigo: 'IDENTIDAD_INVALIDA', error: 'Elige nombre real o alias.' }
    patch['reto.modoIdentidad'] = modoIdentidad
  }
  if (calificable !== undefined) {
    if (typeof calificable !== 'boolean') return { ok: false, codigo: 'CALIFICABLE_INVALIDO', error: 'Indica si el reto es calificable.' }
    patch['reto.calificable'] = calificable
    patch.sinCalificacion = !calificable
  }
  return { ok: true, patch }
}
