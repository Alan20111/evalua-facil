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
  OP_GENERAR: 'generar_dinamica_vivo',
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
  MAX_RESPUESTA_EXTENSA: 500,
  LARGO_CODIGO: 10,
}

export const PROPOSITOS_VIVO = {
  previos: 'Comprobar conocimientos previos',
  comprension: 'Comprensión durante la clase',
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
export function sanearPreguntasVivo(entrada, { exigirCorrecta = false } = {}) {
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
    const puntos = Number.isFinite(puntosCrudos) && puntosCrudos > 0 ? Math.round(Math.min(puntosCrudos, 100) * 100) / 100 : 1

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
      if (exigirCorrecta && !correcta) { errores.push(`Pregunta ${n}: marca la opción correcta (la actividad es calificable).`); return }
      publicas.push({ id, tipo, enunciado, opciones, puntos })
      claves[id] = { correcta }
      return
    }

    const conceptos = (Array.isArray(p?.conceptos) ? p.conceptos : [])
      .map((c) => limpiar(c, VIVO_CFG.MAX_CONCEPTO)).filter(Boolean).slice(0, VIVO_CFG.MAX_CONCEPTOS)
    const criterios = limpiar(p?.criterios, VIVO_CFG.MAX_CRITERIOS)
    const esperada = limpiar(p?.esperada, VIVO_CFG.MAX_ESPERADA)
    if (exigirCorrecta && !criterios && !esperada) {
      errores.push(`Pregunta ${n}: escribe los criterios o la respuesta esperada (la actividad es calificable).`)
      return
    }
    publicas.push({ id, tipo, enunciado, puntos })
    claves[id] = { criterios, esperada, conceptos }
  })
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

// ── Texto de la respuesta ──────────────────────────────────────────────────
export function sanearTextoRespuesta(texto, tipo) {
  const max = tipo === 'abierta_breve' ? VIVO_CFG.MAX_RESPUESTA_BREVE : VIVO_CFG.MAX_RESPUESTA_EXTENSA
  return String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

// ── Nube de palabras ───────────────────────────────────────────────────────
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

// Frecuencia REAL: cuántas respuestas contienen cada término (un término repetido dentro
// de la misma respuesta cuenta una vez). Se conserva la forma escrita más frecuente.
export function frecuenciasNube(textos) {
  const mapa = new Map()
  for (const texto of textos || []) {
    const vistos = new Set()
    for (const crudo of String(texto ?? '').split(/\s+/)) {
      const clave = normalizarTermino(crudo)
      if (clave.length < 3 || STOP.has(clave) || vistos.has(clave)) continue
      vistos.add(clave)
      const forma = crudo.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase()
      const e = mapa.get(clave) || { clave, n: 0, formas: new Map() }
      e.n += 1
      e.formas.set(forma, (e.formas.get(forma) || 0) + 1)
      mapa.set(clave, e)
    }
  }
  return [...mapa.values()]
    .map((e) => ({ clave: e.clave, n: e.n, texto: [...e.formas.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.n - a.n || a.clave.localeCompare(b.clave))
}

// Distribuye las palabras en una espiral desde el centro sin que se encimen.
// Tamaño proporcional a la frecuencia. Determinista (misma entrada, mismo dibujo).
// Devuelve { colocadas: [{clave,texto,n,x,y,w,h,tamano}], omitidas }.
export function disponerNube(items, ancho, alto, { tamanoMin = 18, tamanoMax = 72, maximo = 60 } = {}) {
  const lista = (items || []).slice(0, maximo)
  if (!lista.length || !(ancho > 0) || !(alto > 0)) return { colocadas: [], omitidas: 0 }
  const nMax = lista[0].n
  const nMin = lista[lista.length - 1].n
  const colocadas = []
  let omitidas = 0
  const choca = (a) => colocadas.some((b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)

  for (const it of lista) {
    let factor = nMax === nMin ? 1 : (it.n - nMin) / (nMax - nMin)
    let tamano = Math.round(tamanoMin + (tamanoMax - tamanoMin) * Math.sqrt(factor))
    let puesta = null
    for (let intento = 0; intento < 4 && !puesta; intento++) {
      const w = Math.ceil(it.texto.length * tamano * 0.58) + 12
      const h = Math.ceil(tamano * 1.2) + 6
      for (let k = 0; k < 900; k++) {
        const ang = k * 0.35
        const r = 2 + k * 0.9
        const cx = ancho / 2 + Math.cos(ang) * r * 1.6
        const cy = alto / 2 + Math.sin(ang) * r
        const caja = { x: cx - w / 2, y: cy - h / 2, w, h }
        if (caja.x < 0 || caja.y < 0 || caja.x + w > ancho || caja.y + h > alto) continue
        if (choca(caja)) continue
        puesta = { clave: it.clave, texto: it.texto, n: it.n, tamano, ...caja }
        break
      }
      if (!puesta) tamano = Math.max(12, Math.round(tamano * 0.8))
    }
    if (puesta) colocadas.push(puesta)
    else omitidas += 1
  }
  return { colocadas, omitidas }
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
export function calificacionPropuestaVivo({ preguntas, claves, respuestas, maxCalif = 10 }) {
  let posibles = 0
  let obtenidos = 0
  let sinEvaluar = 0
  for (const p of preguntas || []) {
    posibles += p.puntos
    const r = (respuestas || []).find((x) => x.preguntaId === p.id)
    if (!r) continue
    const pts = puntosDeRespuesta(r, p, claves?.[p.id])
    if (pts == null) sinEvaluar += 1
    else obtenidos += pts
  }
  if (!(posibles > 0)) return { calificacion: null, completa: false, sinEvaluar }
  const crudo = (obtenidos / posibles) * maxCalif
  return { calificacion: Math.round(crudo * 10) / 10, completa: sinEvaluar === 0, sinEvaluar }
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
