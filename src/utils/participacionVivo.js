// Participación en vivo — reglas PURAS (sin Firebase) compartidas por la pantalla
// y por el servidor (se sincroniza a functions/_shared).
//
// MODELO
//   activities/{id}  = { categoria: 'participacion', sinCalificacion: true|false,
//                        participacion: { proposito, acceso, calificable, preguntas: [...públicas] } }
//   activities/{id}/clave/{preguntaId} = { correcta, esperada, criterios, conceptos }  (solo el docente)
//   activities/{id}/clave/contexto     = { resumen }                                  (solo el docente)
//   vivoSesiones/{codigo}              = estado de UNA sesión en vivo
//   vivoRespuestas/{codigo_pregunta_participante} = una respuesta de un participante
//
// Las respuestas correctas, los criterios y el resumen del material viven en `clave`
// porque el estudiante sí puede descargar el documento de la actividad (api/subject/content).
//
// Constantes agrupadas en objetos: el script de sincronización solo admite exports de
// función, objeto o arreglo.

export const VIVO_CFG = {
  CATEGORIA: 'participacion',
  OP_GENERAR: 'generar_dinamica_vivo', // se cobra POR PREGUNTA entregada
  // Ya NO se cobra: solo es la llave con la que el servidor busca el modelo del análisis en config/iaTarifas.
  OP_ANALISIS: 'activar_analisis_vivo',
  // Tope de respuestas abiertas que la IA analiza por sesión (cuota fija pagada al activar).
  TOPE_ANALISIS: 40,
  // Tope DURO de respuestas abiertas guardadas por sesión: frena a un script que inunde un enlace externo.
  MAX_ABIERTAS_SESION: 3000,
  MIN_CONTEXTO_CARACTERES: 200,
  MIN_PREGUNTAS: 1,
  MAX_PREGUNTAS: 8,
  MIN_OPCIONES: 2,
  MAX_OPCIONES: 5,
  MAX_ENUNCIADO: 300,
  MAX_OPCION: 120,
  MAX_CRITERIOS: 600,
  MAX_ESPERADA: 600,
  MAX_CONCEPTOS: 6,
  MAX_CONCEPTO: 60,
  MAX_RESUMEN_CONTENIDO: 2500,
  MAX_RESPUESTA_BREVE: 60,
  TOTAL_PUNTOS: 10, // las ponderaciones de una dinámica suman EXACTAMENTE esto
  MAX_RESPUESTA_EXTENSA: 500,
  LARGO_CODIGO: 10,
  PREPARACION_MS: 4000, // «La pregunta comienza en…»: todos la reciben antes de que abra, y abre para todos a la vez
  TIEMPO_MIN: 5,
  TIEMPO_MAX: 600,
  AMPLIAR_MAX_SEG: 300,
}

export const PROPOSITOS_VIVO = {
  diagnostico: 'Diagnóstico de conocimientos',
  evaluacion: 'Evaluaciones rápidas',
  encuesta: 'Encuestas',
}

export const TIPOS_PREGUNTA_VIVO = {
  opcion_unica: 'Opción única',
  abierta_breve: 'Respuesta abierta breve',
  abierta_extensa: 'Respuesta abierta extensa',
}

export const ACCESOS_VIVO = { grupo: 'Grupo inscrito', externo: 'Externo (QR o enlace)' }

// Estados de la respuesta respecto a la IA. 'omitida_tope' = llegó después del tope pagado;
// 'sin_analisis' = el docente no activó el análisis (la respuesta se conserva y se muestra igual).
export const ESTADO_IA = {
  RECIBIDA: 'recibida',
  ANALIZANDO: 'analizando',
  ANALIZADA: 'analizada',
  ERROR: 'error',
  OMITIDA_TOPE: 'omitida_tope',
  SIN_ANALISIS: 'sin_analisis',
}

// Paleta para proyectar (legible sobre fondo oscuro).
export const COLORES_VIVO = ['#60a5fa', '#34d399', '#fbbf24', '#c084fc', '#f87171', '#2dd4bf', '#fb923c']

export const NIVELES_VIVO = ['logrado', 'parcial', 'no_logrado']

export function esTipoAbierto(tipo) {
  return tipo === 'abierta_breve' || tipo === 'abierta_extensa'
}

const limpiar = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

// ── Contexto didáctico ─────────────────────────────────────────────────────
// La generación necesita contenido específico: una descripción amplia o un archivo
// legible. El nombre de un tema solo no basta.
export function contextoSuficiente({ texto, cantidadArchivos = 0 }) {
  const largo = limpiar(texto, 20000).length
  if (cantidadArchivos > 0) return { ok: true }
  if (largo >= VIVO_CFG.MIN_CONTEXTO_CARACTERES) return { ok: true }
  return {
    ok: false,
    error: `Describe el contenido con más detalle (al menos ${VIVO_CFG.MIN_CONTEXTO_CARACTERES} caracteres) o adjunta un archivo Word o PDF. No basta con el nombre del tema.`,
  }
}

// ── Preguntas ──────────────────────────────────────────────────────────────
// Separa una lista de preguntas «completas» (como las propone la IA o las edita el docente)
// en la parte PÚBLICA (va en la actividad) y la parte PRIVADA (va en `clave/{id}`).
// Devuelve { ok, publicas, claves, errores }.
export function sanearPreguntasVivo(entrada, { exigirCorrecta = false, exigirTotal = false, encuesta = false } = {}) {
  const errores = []
  const lista = Array.isArray(entrada) ? entrada : []
  if (lista.length < VIVO_CFG.MIN_PREGUNTAS) errores.push('Agrega al menos una pregunta.')
  if (lista.length > VIVO_CFG.MAX_PREGUNTAS) errores.push(`Máximo ${VIVO_CFG.MAX_PREGUNTAS} preguntas.`)

  const publicas = []
  const claves = {}
  const ids = new Set()
  lista.slice(0, VIVO_CFG.MAX_PREGUNTAS).forEach((p, i) => {
    const n = i + 1
    const tipo = p?.tipo
    if (!TIPOS_PREGUNTA_VIVO[tipo]) { errores.push(`Pregunta ${n}: tipo no válido.`); return }
    let id = limpiar(p?.id, 20).replace(/[^a-zA-Z0-9_-]/g, '')
    if (!id || ids.has(id)) id = `p${n}`
    while (ids.has(id)) id = `${id}x`
    ids.add(id)
    const enunciado = limpiar(p?.enunciado, VIVO_CFG.MAX_ENUNCIADO)
    if (!enunciado) { errores.push(`Pregunta ${n}: escribe el enunciado.`); return }
    const puntosCrudos = Number(p?.puntos)
    const puntos = Number.isFinite(puntosCrudos) && puntosCrudos >= 0.01 ? Math.round(Math.min(puntosCrudos, VIVO_CFG.TOTAL_PUNTOS) * 100) / 100 : 1

    if (tipo === 'opcion_unica') {
      const opciones = (Array.isArray(p?.opciones) ? p.opciones : [])
        .map((o, j) => ({ id: limpiar(o?.id, 6).replace(/[^a-zA-Z0-9]/g, '') || String.fromCharCode(97 + j), texto: limpiar(o?.texto, VIVO_CFG.MAX_OPCION) }))
        .filter((o) => o.texto)
        .slice(0, VIVO_CFG.MAX_OPCIONES)
      const idsOp = new Set(opciones.map((o) => o.id))
      if (opciones.length < VIVO_CFG.MIN_OPCIONES || idsOp.size !== opciones.length) {
        errores.push(`Pregunta ${n}: necesita de ${VIVO_CFG.MIN_OPCIONES} a ${VIVO_CFG.MAX_OPCIONES} opciones distintas.`)
        return
      }
      const correcta = idsOp.has(p?.correcta) ? p.correcta : null
      if (exigirCorrecta && !encuesta && !correcta) { errores.push(`Pregunta ${n}: marca la opción correcta (la actividad es calificable).`); return }
      // Se guarda lo SOLICITADO (formato breve y nube); la validez (≤ 2 palabras) se aplica al presentar (visualizacionDe).
      const formato = formatoGuardado({ tipo, formato: p?.formato, opciones })
      const visualizacion = formato === 'opcion_breve' && p?.visualizacion === 'nube' ? 'nube' : 'barras'
      publicas.push({ id, tipo, formato, enunciado, opciones, ...(encuesta ? {} : { puntos }), visualizacion, tiempo: tiempoDe(p?.tiempo) })
      claves[id] = encuesta ? {} : { correcta } // una encuesta no tiene respuestas correctas
      return
    }

    const conceptos = (Array.isArray(p?.conceptos) ? p.conceptos : [])
      .map((c) => limpiar(c, VIVO_CFG.MAX_CONCEPTO)).filter(Boolean).slice(0, VIVO_CFG.MAX_CONCEPTOS)
    const criterios = limpiar(p?.criterios, VIVO_CFG.MAX_CRITERIOS)
    const esperada = limpiar(p?.esperada, VIVO_CFG.MAX_ESPERADA)
    if (exigirCorrecta && !encuesta && !criterios && !esperada) {
      errores.push(`Pregunta ${n}: escribe los criterios o la respuesta esperada (la actividad es calificable).`)
      return
    }
    publicas.push({ id, tipo, formato: 'abierta', enunciado, ...(encuesta ? {} : { puntos }), tiempo: tiempoDe(p?.tiempo) })
    claves[id] = encuesta ? {} : { criterios, esperada, conceptos }
  })
  if (exigirTotal && !encuesta && publicas.length && !sumaPuntosExacta(publicas.map((q) => q.puntos))) {
    const suma = publicas.reduce((a, q) => a + Math.round(q.puntos * 100), 0) / 100
    errores.push('Las ponderaciones deben sumar exactamente ' + VIVO_CFG.TOTAL_PUNTOS + ' puntos (ahora suman ' + suma + ').')
  }
  return { ok: errores.length === 0, publicas, claves, errores }
}

// ── Códigos y claves de participante ───────────────────────────────────────
const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // sin 0/O/1/I/L

export function generarCodigoVivo(aleatorio) {
  let out = ''
  for (let i = 0; i < VIVO_CFG.LARGO_CODIGO; i++) {
    out += ALFABETO_CODIGO[Math.floor(aleatorio() * ALFABETO_CODIGO.length)]
  }
  return out
}

export function codigoVivoValido(c) {
  return typeof c === 'string' && new RegExp(`^[${ALFABETO_CODIGO}]{${VIVO_CFG.LARGO_CODIGO}}$`).test(c)
}

// Identificador aleatorio que el navegador de un participante externo guarda para no
// responder dos veces. No es una identidad: no apunta a ninguna cuenta.
export function claveParticipanteValida(k) {
  return typeof k === 'string' && /^[a-z0-9]{16,40}$/.test(k)
}

export function idRespuestaVivo(codigo, preguntaId, participanteKey) {
  return `${codigo}_${preguntaId}_${participanteKey}`
}

// ── Visualización de resultados ─────────────────────────────────────────
// Solo la opción única admite elegir: barras (por omisión) o nube (solo con opciones de una o dos palabras). En la nube cada OPCIÓN completa es una unidad (nunca se
// separan sus palabras) y su tamaño sigue la cantidad de elecciones. Las respuestas escritas (breves o extensas) SIEMPRE
// se presentan como tarjetas con el texto original: jamás nube ni barras.
export const VISUALIZACIONES_OPCION = { barras: 'Barras', nube: 'Nube de palabras' }

// La nube se permite SOLO si TODAS las opciones tienen una o dos palabras (cada opción es una unidad que no se separa).
const NUBE_MAX_PALABRAS_OPCION = 2
export function nubePermitida(opciones) {
  const lista = Array.isArray(opciones) ? opciones : []
  return lista.length >= 2 && lista.every((o) => {
    const palabras = String(o?.texto ?? '').trim().split(/\s+/).filter(Boolean).length
    return palabras >= 1 && palabras <= NUBE_MAX_PALABRAS_OPCION
  })
}

// ── Formatos de pregunta (lo que elige el docente al configurar la dinámica) ──
// Son una capa sobre los tipos guardados: opcion/opcion_breve/cierto_falso → tipo opcion_unica; abierta → abierta_extensa
// (abierta_breve solo existe en lo ya guardado). Participantes, reglas y calificación siguen usando el tipo.
export const FORMATOS_VIVO = {
  opcion: 'Opción múltiple',
  opcion_breve: 'Opción múltiple breve',
  cierto_falso: 'Cierto/Falso',
  abierta: 'Respuesta abierta',
}

export function esCiertoFalso(opciones) {
  const t = (Array.isArray(opciones) ? opciones : []).map((o) => normalizarTermino(o?.texto)).sort()
  return t.length === 2 && t[0] === 'cierto' && t[1] === 'falso'
}

// Formato EFECTIVO: el guardado si es compatible con las opciones; si no (o si falta, como en lo ya existente), se infiere.
export function formatoDe(pregunta) {
  if (pregunta?.tipo !== 'opcion_unica') return 'abierta'
  const f = pregunta.formato
  const opciones = pregunta.opciones
  if (f === 'opcion') return 'opcion'
  if (f === 'cierto_falso' && esCiertoFalso(opciones)) return 'cierto_falso'
  if (f === 'opcion_breve' && nubePermitida(opciones)) return 'opcion_breve'
  if (esCiertoFalso(opciones)) return 'cierto_falso'
  return nubePermitida(opciones) ? 'opcion_breve' : 'opcion'
}

// Formato GUARDADO: conserva lo solicitado. Una pregunta pedida como «opción múltiple breve» sigue siéndolo aunque hoy alguna opción
// supere las dos palabras (la presentación la muestra en barras y el editor avisa); al acortarlas, la nube se activa sola.
export function formatoGuardado(pregunta) {
  if (pregunta?.tipo !== 'opcion_unica') return 'abierta'
  return pregunta.formato === 'opcion_breve' ? 'opcion_breve' : formatoDe(pregunta)
}

// Cuántas preguntas de cada formato. Debe sumar exactamente el total pedido.
export function validarDistribucion(distribucion, total) {
  const d = distribucion && typeof distribucion === 'object' ? distribucion : {}
  const claves = Object.keys(FORMATOS_VIVO)
  if (Object.keys(d).some((k) => !claves.includes(k))) return { ok: false, suma: 0, error: 'La distribución tiene un tipo de pregunta no válido.' }
  let suma = 0
  for (const k of claves) {
    const n = d[k] ?? 0
    if (!Number.isInteger(n) || n < 0) return { ok: false, suma: 0, error: 'Las cantidades por tipo deben ser números enteros, de 0 en adelante.' }
    suma += n
  }
  if (suma !== total) {
    const error = suma < total
      ? 'Faltan ' + (total - suma) + ' por asignar: los tipos suman ' + suma + ' de ' + total + ' preguntas.'
      : 'Sobran ' + (suma - total) + ': los tipos suman ' + suma + ' y pediste ' + total + ' preguntas.'
    return { ok: false, suma, error }
  }
  return { ok: true, suma, error: '' }
}

// Distribución inicial razonable para n preguntas (el docente la ajusta).
export function distribucionInicial(n) {
  const abierta = n >= 4 ? 1 : 0
  const cierto_falso = n >= 3 ? 1 : 0
  return { opcion: n - abierta - cierto_falso, opcion_breve: 0, cierto_falso, abierta }
}

// Reparto parejo entre los cuatro formatos.
export function distribucionEquilibrada(n) {
  const claves = Object.keys(FORMATOS_VIVO)
  const base = Math.floor(n / claves.length)
  const resto = n - base * claves.length
  return Object.fromEntries(claves.map((k, i) => [k, base + (i < resto ? 1 : 0)]))
}

// Visualización EFECTIVA. Solo el formato «opción múltiple breve» admite nube (y solo con opciones de una o dos palabras);
// una configuración guardada incompatible —o de otro formato— se trata como barras. Las respuestas escritas son tarjetas.
export function visualizacionDe(pregunta) {
  if (pregunta?.tipo !== 'opcion_unica') return 'tarjetas'
  return pregunta.visualizacion === 'nube' && formatoDe(pregunta) === 'opcion_breve' && nubePermitida(pregunta.opciones) ? 'nube' : 'barras'
}

// ── Ponderaciones: SIEMPRE suman exactamente VIVO_CFG.TOTAL_PUNTOS ─────────────────
// Todo se calcula en centésimas (enteros): nunca hay error de decimales y la suma es exacta.
const aCentesimas = (x) => Math.round(Number(x) * 100)
const deCentesimas = (c) => c / 100

export function sumaPuntosExacta(puntos) {
  const suma = (puntos || []).reduce((a, p) => a + aCentesimas(p), 0)
  return suma === VIVO_CFG.TOTAL_PUNTOS * 100
}

/** Reparte el total entre n preguntas de la forma más pareja: 3 → 3.34, 3.33, 3.33. */
export function repartirPuntos(n) {
  if (!(n > 0)) return []
  const total = VIVO_CFG.TOTAL_PUNTOS * 100
  const base = Math.floor(total / n)
  const resto = total - base * n
  return Array.from({ length: n }, (_, i) => deCentesimas(base + (i < resto ? 1 : 0)))
}

/**
 * Cambia la ponderación de una pregunta y ajusta las demás para conservar el total. Las preguntas «fijadas» (que el
 * docente ya editó a mano) no se mueven; las libres se reparten el resto en proporción a lo que valían.
 * indice = null → solo reequilibra (p. ej. al quitar una pregunta).
 * Devuelve { puntos, limitado, sinMargen }: limitado = el valor se acotó al máximo posible; sinMargen = no hay otra
 * pregunta libre que absorba el cambio (no se aplica).
 */
export function redistribuirPuntos(puntos, indice, nuevo, fijadas = []) {
  const total = VIVO_CFG.TOTAL_PUNTOS * 100
  const actual = (puntos || []).map(aCentesimas)
  const fija = new Set(fijadas)
  const libres = actual.map((_, i) => i).filter((i) => i !== indice && !fija.has(i))
  const sumaFijas = actual.reduce((a, c, i) => (i !== indice && fija.has(i) ? a + c : a), 0)
  let valor = indice == null ? 0 : aCentesimas(nuevo)
  let limitado = false
  if (indice != null) {
    if (!libres.length) return { puntos: (puntos || []).map(Number), limitado: false, sinMargen: true }
    const maximo = total - sumaFijas - libres.length
    if (!(valor >= 1)) { valor = 1; limitado = true }
    if (valor > maximo) { valor = maximo; limitado = true }
  }
  const resto = total - sumaFijas - (indice == null ? 0 : valor)
  if (!libres.length) return { puntos: actual.map(deCentesimas), limitado, sinMargen: false }
  // Cada libre recibe al menos 0.01; lo demás se reparte proporcionalmente (mayor resto fraccionario primero).
  const extra = resto - libres.length
  const pesos = libres.map((i) => Math.max(1, actual[i]))
  const sumaPesos = pesos.reduce((a, b) => a + b, 0)
  const partes = pesos.map((w) => (extra * w) / sumaPesos)
  const piso = partes.map(Math.floor)
  let falta = extra - piso.reduce((a, b) => a + b, 0)
  const orden = partes.map((p, k) => [p - Math.floor(p), k]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (const [, k] of orden) { if (falta <= 0) break; piso[k] += 1; falta -= 1 }
  const salida = [...actual]
  if (indice != null) salida[indice] = valor
  libres.forEach((i, k) => { salida[i] = 1 + piso[k] })
  return { puntos: salida.map(deCentesimas), limitado, sinMargen: false }
}

// ── Propósitos de la participación ──────────────────────────────────────────
// diagnostico → identificar saberes y dificultades, sin exigir calificación.
// evaluacion  → respuestas correctas y evaluación del desempeño (comportamiento original de «comprensión»).
// encuesta    → opiniones y preferencias: sin respuestas correctas, sin ponderaciones ni calificaciones.
// Lo guardado antes de existir los tres sigue funcionando: previos → diagnostico, comprension → evaluacion.
export const PROPOSITOS_ANTIGUOS = { previos: 'diagnostico', comprension: 'evaluacion' }

export function propositoDe(proposito) {
  if (proposito in PROPOSITOS_VIVO) return proposito
  return PROPOSITOS_ANTIGUOS[proposito] || 'diagnostico'
}

export const esEncuesta = (proposito) => propositoDe(proposito) === 'encuesta'

// ── Tiempo por pregunta ─────────────────────────────────────────────────────
// Cada pregunta guarda `tiempo`: segundos para responder, o null = modo manual (sin límite; el docente la cierra).
export const TIEMPOS_PREDETERMINADOS = { opcion_breve: 15, opcion: 30, cierto_falso: 15, abierta: 60 }

export function tiempoDe(valor) {
  if (valor === null || valor === undefined || valor === '') return null
  const n = Number(valor)
  return Number.isInteger(n) && n >= VIVO_CFG.TIEMPO_MIN && n <= VIVO_CFG.TIEMPO_MAX ? n : null
}

// Tiempos por formato pedidos al generar: cada valor es un entero de segundos o null (manual).
export function validarTiempos(tiempos) {
  if (tiempos === undefined || tiempos === null) return { ok: true, valor: null, error: '' }
  if (typeof tiempos !== 'object') return { ok: false, valor: null, error: 'La configuración de tiempos no es válida.' }
  const valor = {}
  for (const formato of Object.keys(FORMATOS_VIVO)) {
    const t = tiempos[formato]
    if (t === undefined || t === null) { valor[formato] = null; continue }
    if (!Number.isInteger(t) || t < VIVO_CFG.TIEMPO_MIN || t > VIVO_CFG.TIEMPO_MAX) {
      return { ok: false, valor: null, error: 'El tiempo de «' + FORMATOS_VIVO[formato] + '» debe estar entre ' + VIVO_CFG.TIEMPO_MIN + ' y ' + VIVO_CFG.TIEMPO_MAX + ' segundos, o en modo manual.' }
    }
    valor[formato] = t
  }
  return { ok: true, valor, error: '' }
}

// ── Ventana de respuesta (la decide SIEMPRE el servidor) ─────────────────────
// La sesión guarda, para la pregunta en curso: abreMs (inicio), cierraMs (límite; null = manual) y cerradaMs (cierre
// anticipado: manual o al avanzar). Todo en milisegundos de RELOJ DEL SERVIDOR. Proyector, celulares y servidor aplican
// esta misma función; los clientes solo corrigen su reloj con el desfase medido contra el servidor.
// Sesiones anteriores (sin abreMs): manda el booleano `aceptando`, como antes.
export function estadoPreguntaVivo(sesion, ahoraMs) {
  if (!sesion) return 'espera'
  if (sesion.estado === 'finalizada') return 'finalizada'
  if (!(sesion.preguntaIndex >= 0)) return 'espera'
  if (sesion.abreMs == null) return sesion.aceptando === true ? 'abierta' : 'cerrada'
  if (sesion.cerradaMs != null && ahoraMs >= sesion.cerradaMs) return 'cerrada'
  if (ahoraMs < sesion.abreMs) return 'preparando'
  if (sesion.cierraMs != null && ahoraMs >= sesion.cierraMs) return 'cerrada'
  return 'abierta'
}

/** Milisegundos que le quedan a una pregunta abierta con tiempo; null si es manual o no está abierta. */
export function restanteVivoMs(sesion, ahoraMs) {
  if (estadoPreguntaVivo(sesion, ahoraMs) !== 'abierta' || sesion.cierraMs == null) return null
  return Math.max(0, sesion.cierraMs - ahoraMs)
}

/** Milisegundos que faltan para que abra la pregunta (solo en «preparando»). */
export function faltaParaAbrirVivoMs(sesion, ahoraMs) {
  return estadoPreguntaVivo(sesion, ahoraMs) === 'preparando' ? Math.max(0, sesion.abreMs - ahoraMs) : null
}

/** Desfase del reloj local respecto al del servidor: la muestra de menor viaje (RTT) es la más fiel. */
export function mejorDesfase(muestras) {
  const validas = (muestras || []).filter((m) => Number.isFinite(m?.desfase) && Number.isFinite(m?.rtt) && m.rtt >= 0)
  if (!validas.length) return 0
  return validas.reduce((a, b) => (b.rtt < a.rtt ? b : a)).desfase
}

/** Una muestra: el servidor contestó `ahoraServidor` en algún punto entre t0 y t1 (hora local). */
export function muestraDeDesfase(t0, t1, ahoraServidor) {
  return { desfase: ahoraServidor - (t0 + t1) / 2, rtt: t1 - t0 }
}

// ── Texto de la respuesta ──────────────────────────────────────────────────
export function sanearTextoRespuesta(texto, tipo) {
  const max = tipo === 'abierta_breve' ? VIVO_CFG.MAX_RESPUESTA_BREVE : VIVO_CFG.MAX_RESPUESTA_EXTENSA
  return String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

// ── Palabras vacías (solo para medir variedad) ───────────────────────────────────────────────────────
const STOP = new Set((
  'a al algo ante con como cual cuando de del desde donde e el ella ellas ello ellos en entre era eran es esa esas ese eso esos esta estan estas este esto estos fue ha han hay la las le les lo los mas me mi muy ni no nos o os para pero por porque que se si sin sobre son su sus te tiene tu un una uno unas unos y ya yo'
).split(' '))

// Minúsculas, sin acentos (conserva la ñ), sin signos.
export function normalizarTermino(t) {
  return String(t ?? '')
    .toLowerCase()
    .replace(/ñ/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(//g, 'ñ')
    .replace(/[^a-z0-9ñ]/g, '')
}

// Cantidad de términos distintos (palabras sueltas, sin vacías) que aparecen en las respuestas. NO se dibuja: solo mide
// si las respuestas breves tienen suficiente variedad para interpretarlas (umbral del diagnóstico).
export function terminosDistintos(textos) {
  const vistos = new Set()
  for (const texto of textos || []) {
    for (const crudo of String(texto ?? '').split(/\s+/)) {
      const clave = normalizarTermino(crudo)
      if (clave.length >= 3 && !STOP.has(clave)) vistos.add(clave)
    }
  }
  return vistos.size
}

// ── Resultados ─────────────────────────────────────────────────────────────
// Las respuestas son documentos de `vivoRespuestas`: { preguntaId, opcion, texto, estadoIA, evaluacion, ... }.
export function contarOpciones(respuestas, pregunta) {
  const cuentas = {}
  ;(pregunta?.opciones || []).forEach((o) => { cuentas[o.id] = 0 })
  let total = 0
  for (const r of respuestas || []) {
    if (r.preguntaId !== pregunta?.id || !(r.opcion in cuentas)) continue
    cuentas[r.opcion] += 1
    total += 1
  }
  return { cuentas, total }
}

// Recibidas / analizadas / pendientes + tendencias, SOLO con lo que de verdad llegó.
export function resumenAbiertas(respuestas, pregunta) {
  const propias = (respuestas || []).filter((r) => r.preguntaId === pregunta?.id)
  const estados = { recibidas: propias.length, analizadas: 0, analizando: 0, pendientes: 0, fallidas: 0, omitidas: 0, sinAnalisis: 0 }
  const niveles = { logrado: 0, parcial: 0, no_logrado: 0 }
  const conceptos = new Map()
  const errores = new Map()
  for (const r of propias) {
    switch (r.estadoIA) {
      case ESTADO_IA.ANALIZADA: estados.analizadas += 1; break
      case ESTADO_IA.ANALIZANDO: estados.analizando += 1; break
      case ESTADO_IA.ERROR: estados.fallidas += 1; break
      case ESTADO_IA.OMITIDA_TOPE: estados.omitidas += 1; break
      case ESTADO_IA.SIN_ANALISIS: estados.sinAnalisis += 1; break
      default: estados.pendientes += 1
    }
    const ev = r.estadoIA === ESTADO_IA.ANALIZADA ? r.evaluacion : null
    if (!ev) continue
    if (niveles[ev.nivel] != null) niveles[ev.nivel] += 1
    ;(ev.conceptos || []).forEach((c) => conceptos.set(c, (conceptos.get(c) || 0) + 1))
    ;(ev.errores || []).forEach((c) => errores.set(c, (errores.get(c) || 0) + 1))
  }
  const top = (m) => [...m.entries()].map(([texto, n]) => ({ texto, n })).sort((a, b) => b.n - a.n || a.texto.localeCompare(b.texto))
  return { ...estados, niveles, conceptos: top(conceptos), errores: top(errores) }
}

// ── Calificación propuesta ─────────────────────────────────────────────────
// Puntos de UNA respuesta: opción única contra la clave; abierta según el puntaje (0 a 1) que
// propuso la IA. null = todavía no se puede puntuar (sin analizar).
export function puntosDeRespuesta(respuesta, pregunta, clave) {
  if (!pregunta) return null
  if (pregunta.tipo === 'opcion_unica') {
    if (!clave?.correcta) return null
    return respuesta.opcion === clave.correcta ? pregunta.puntos : 0
  }
  if (respuesta.estadoIA === ESTADO_IA.ANALIZADA && typeof respuesta.evaluacion?.puntaje === 'number') {
    const p = Math.min(1, Math.max(0, respuesta.evaluacion.puntaje))
    return Math.round(p * pregunta.puntos * 100) / 100
  }
  return null
}

// Propuesta para un estudiante: suma de puntos / puntos posibles × maxCalif. Una pregunta sin
// responder vale 0. Si alguna respuesta aún no se puede puntuar, `completa` es false y se
// cuenta en `sinEvaluar`: la propuesta se muestra, pero la pantalla lo avisa antes de aplicar.
export function calificacionPropuestaVivo({ preguntas, claves, respuestas, maxCalif = 10, ventanas = null }) {
  let posibles = 0
  let obtenidos = 0
  let sinEvaluar = 0
  let sinRespuesta = 0
  for (const p of preguntas || []) {
    const r = (respuestas || []).find((x) => x.preguntaId === p.id)
    // Pregunta con ventana de tiempo registrada y sin respuesta de este estudiante: «sin respuesta». NO se califica como
    // incorrecta (no entra a lo posible); queda señalada para que el docente decida.
    if (!r && ventanas?.[p.id]) { sinRespuesta += 1; continue }
    posibles += p.puntos
    if (!r) continue
    const pts = puntosDeRespuesta(r, p, claves?.[p.id])
    if (pts == null) sinEvaluar += 1
    else obtenidos += pts
  }
  if (!(posibles > 0)) return { calificacion: null, completa: false, sinEvaluar, sinRespuesta }
  const crudo = (obtenidos / posibles) * maxCalif
  return { calificacion: Math.round(crudo * 10) / 10, completa: sinEvaluar === 0 && sinRespuesta === 0, sinEvaluar, sinRespuesta }
}

// ── Diagnóstico pedagógico (informes) ──────────────────────────────────────
// El diagnóstico NO es otra visualización de los resultados: interpreta (confusiones, ideas, qué reforzar, siguiente
// paso). Se genera por pregunta y al final, con umbrales mínimos de datos, límites de llamadas e idempotencia por
// huella. NO pasa por el libro de créditos: la cuota de 10 créditos se paga una sola vez al activar el análisis.
export const UMBRALES_DIAGNOSTICO = { opcion_unica: 5, abierta_breve: 8, abierta_extensa: 8, terminosBreve: 4 }
// Máximo de generaciones por documento: 1 al cerrar + 1 al finalizar (solo si llegaron datos nuevos) + 1 manual.
export const LIMITES_INFORME = { POR_PREGUNTA: 3, FINAL: 2 }
export const TIPOS_SIGUIENTE_PASO = ['reexplicar', 'aclarar', 'actividad']

export function confianzaDe(n) {
  return n >= 25 ? 'alta' : n >= 10 ? 'media' : 'baja'
}

function fnv(texto) {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(16)
}

/** Huella de lo que se usó para un diagnóstico: igual huella = nada nuevo = no se vuelve a llamar al modelo. */
export function huellaDe(respuestas) {
  return fnv((respuestas || []).map((r) => `${r.id}:${r.estadoIA ?? ''}:${r.opcion ?? ''}`).sort().join('|'))
}

/** Respuestas de una pregunta que cuentan para su diagnóstico (abiertas: solo las ya evaluadas). */
export function respuestasDiagnosticables(pregunta, respuestas, { encuesta = false } = {}) {
  const propias = (respuestas || []).filter((r) => r.preguntaId === pregunta?.id)
  if (pregunta?.tipo === 'opcion_unica') return propias.filter((r) => (pregunta.opciones || []).some((o) => o.id === r.opcion))
  if (encuesta) return propias.filter((r) => typeof r.texto === 'string' && r.texto.trim()) // sin evaluación: cuenta lo recibido
  return propias.filter((r) => r.estadoIA === ESTADO_IA.ANALIZADA)
}

/** ¿Hay datos para diagnosticar al grupo en esta pregunta? Nunca con una muestra que no lo permita. */
export function puedeDiagnosticar(pregunta, respuestas, opciones = {}) {
  const usables = respuestasDiagnosticables(pregunta, respuestas, opciones)
  const n = usables.length
  const minimo = UMBRALES_DIAGNOSTICO[pregunta?.tipo] ?? 8
  if (n < minimo) {
    return { ok: false, n, minimo, confianza: confianzaDe(n), motivo: `Con ${n} ${n === 1 ? 'respuesta' : 'respuestas'} no alcanza para diagnosticar al grupo (mínimo ${minimo}).` }
  }
  if (pregunta.tipo === 'abierta_breve') {
    const terminos = terminosDistintos(usables.map((r) => r.texto))
    if (terminos < UMBRALES_DIAGNOSTICO.terminosBreve) {
      return { ok: false, n, minimo, confianza: confianzaDe(n), motivo: `Las respuestas repiten muy pocas palabras distintas (${terminos}): no hay familias de ideas que interpretar.` }
    }
  }
  return { ok: true, n, minimo, confianza: confianzaDe(n), motivo: '' }
}

/** Cobertura de los conceptos esperados en palabras breves: se calcula con código (gratis), sin IA. */
export function coberturaConceptos(textos, conceptos) {
  const palabras = (textos || []).map((t) => new Set(String(t ?? '').split(/\s+/).map(normalizarTermino).filter(Boolean)))
  return (conceptos || []).map((concepto) => {
    const partes = String(concepto).split(/\s+/).map(normalizarTermino).filter(Boolean)
    const n = partes.length ? palabras.filter((set) => partes.every((p) => set.has(p))).length : 0
    return { concepto, n, aparece: n > 0 }
  })
}

const recorta = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const lista = (v, max) => (Array.isArray(v) ? v : []).slice(0, max)

function idsCitados(v, validos) {
  const out = []
  for (const id of lista(v, 60)) if (typeof id === 'string' && validos.has(id) && !out.includes(id)) out.push(id)
  return out
}

function pasoSiguiente(v) {
  const texto = recorta(v?.texto, 240)
  return texto ? { tipo: TIPOS_SIGUIENTE_PASO.includes(v?.tipo) ? v.tipo : 'aclarar', texto } : null
}

/**
 * Valida lo que devuelve el modelo para UNA pregunta. Las afirmaciones sobre respuestas deben citar ids que existen
 * (si no, se descartan) y los conteos los pone el código, no el modelo. Devuelve null si no hay diagnóstico utilizable.
 * ctx: { tipo, idsValidos:Set, opcionesValidas:Set, conteoOpciones:{id:n}, n }
 */
export function sanearInforme(crudo, ctx) {
  if (!crudo || typeof crudo !== 'object') return null
  const diagnostico = recorta(crudo.diagnostico, 400)
  const siguientePaso = pasoSiguiente(crudo.siguientePaso)
  if (!diagnostico || !siguientePaso) return null
  const conIds = (items) => lista(items, 4).map((i) => {
    const ids = idsCitados(i?.ids, ctx.idsValidos || new Set())
    return { texto: recorta(i?.texto, 140), ids, n: ids.length }
  }).filter((i) => i.texto && i.ids.length)
  const informe = {
    tipo: ctx.tipo,
    diagnostico,
    refuerzo: lista(crudo.refuerzo, 4).map((x) => recorta(x, 100)).filter(Boolean),
    siguientePaso,
    limitaciones: recorta(crudo.limitaciones, 200),
    confianza: confianzaDe(ctx.n || 0),
  }
  if (ctx.tipo === 'opcion_unica') {
    informe.confusiones = lista(crudo.confusiones, 4)
      .filter((c) => (ctx.opcionesValidas || new Set()).has(c?.opcion) && (ctx.conteoOpciones?.[c.opcion] || 0) > 0)
      .map((c) => ({ opcion: c.opcion, texto: recorta(c.texto, 160), n: ctx.conteoOpciones[c.opcion] }))
      .filter((c) => c.texto)
  } else {
    informe.ideas = conIds(crudo.ideas)
    informe.confusiones = conIds(crudo.confusiones)
  }
  return informe
}

/** Valida el informe FINAL de la sesión (síntesis de los informes por pregunta). */
export function sanearInformeFinal(crudo) {
  if (!crudo || typeof crudo !== 'object') return null
  const sintesis = recorta(crudo.sintesis, 500)
  const siguientePaso = pasoSiguiente(crudo.siguientePaso)
  if (!sintesis || !siguientePaso) return null
  return {
    sintesis,
    comprende: lista(crudo.comprende, 3).map((x) => recorta(x, 120)).filter(Boolean),
    noComprende: lista(crudo.noComprende, 3).map((x) => recorta(x, 120)).filter(Boolean),
    siguientePaso,
    actividadBreve: recorta(crudo.actividadBreve, 240),
    limitaciones: recorta(crudo.limitaciones, 200),
  }
}

// ── Validación de la evaluación que devuelve la IA ─────────────────────────
export function sanearEvaluacionIA(crudo, conceptosPermitidos = []) {
  if (!crudo || typeof crudo !== 'object') return null
  if (!NIVELES_VIVO.includes(crudo.nivel)) return null
  const puntajeCrudo = Number(crudo.puntaje)
  if (!Number.isFinite(puntajeCrudo)) return null
  const permitidos = new Map(conceptosPermitidos.map((c) => [normalizarTermino(c), c]))
  const conceptos = []
  for (const c of Array.isArray(crudo.conceptos) ? crudo.conceptos : []) {
    const orig = permitidos.get(normalizarTermino(c))
    if (orig && !conceptos.includes(orig)) conceptos.push(orig)
  }
  const errores = (Array.isArray(crudo.errores) ? crudo.errores : [])
    .map((e) => limpiar(e, 60)).filter(Boolean).slice(0, 3)
  return {
    nivel: crudo.nivel,
    puntaje: Math.round(Math.min(1, Math.max(0, puntajeCrudo)) * 100) / 100,
    conceptos,
    errores,
    evidencia: limpiar(crudo.evidencia, 100),
  }
}
