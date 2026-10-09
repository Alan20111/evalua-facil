// Video interactivo con IA — propuestas de preguntas y su revisión por el docente.
//
// LA IA PROPONE. EL DOCENTE VALIDA. EVALÚA FÁCIL APLICA.
//
// Lo que genera la IA NO entra a la evaluación: se guarda en
//   activities/{id}/propuestasVideo/{pid}
// y solo pasa a `activities/{id}/preguntas` (+ `clave`) cuando el docente la
// aprueba. Las pendientes y las rechazadas jamás están en `preguntas`, así que
// el motor de calificación, el runner y /api/exam/questions no se enteran de
// que existen. Este archivo es PURO (sin Firebase): decide QUÉ se escribe; la
// escritura vive en propuestasVideoDb.js.
//
// Estados de una propuesta:
//   pendiente ─aprobar→ aprobada   (terminal: ya es una pregunta activa; se edita desde el editor)
//   pendiente ─rechazar→ rechazada ─restaurar→ pendiente
//
// Id de la pregunta activa = id de la propuesta. Por eso aprobar dos veces (doble
// clic, dos pestañas, reintento) escribe sobre el MISMO documento y no duplica.
import { VIDEO_CFG, TIPOS_PREGUNTA_VIDEO, ESTADO_PREGUNTA, timestampValido } from './videoInteractivo.js'

export const ESTADO_PROPUESTA = { PENDIENTE: 'pendiente', APROBADA: 'aprobada', RECHAZADA: 'rechazada' }

export const LIMITES_PROPUESTA = { ENUNCIADO: 500, OPCION: 200, RETRO: 400, OPCIONES_MIN: 2, OPCIONES_MAX: 6 }

const CAMPOS_EDITABLES = ['enunciado', 'opciones', 'respuestaCorrecta', 'timestampSeg', 'retroalimentacion']

const limpiar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const igual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// Id estable de la propuesta: la misma generación recuperada dos veces (reintento
// con la misma idempotencyKey) produce los MISMOS ids y no se duplica.
export function idPropuesta(generacionId, indice) {
  const g = String(generacionId || 'gen').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'gen'
  return `${g}_${String(indice).padStart(2, '0')}`
}

// Pregunta tal como la entrega `generar_preguntas_video` → documento de propuesta.
// No se guardan campos que el docente no necesita ni se duplica el enunciado
// original: las ediciones quedan en `cambios` (solo lo que se movió).
export function propuestaDesdeIA(p, generacionId) {
  return {
    tipo: p.tipo,
    enunciado: limpiar(p.enunciado),
    opciones: p.tipo === 'respuesta_corta' ? null : (Array.isArray(p.opciones) ? p.opciones.map((o) => ({ id: o.id, texto: limpiar(o.texto) })) : null),
    respuestaCorrecta: p.tipo === 'respuesta_corta' ? null : (p.respuestaCorrecta ?? null),
    retroalimentacion: limpiar(p.retroalimentacion) || null,
    timestampSeg: Number.isInteger(p.timestampSeg) ? p.timestampSeg : null,
    estado: ESTADO_PROPUESTA.PENDIENTE,
    origen: 'ia',
    generacionId: String(generacionId || ''),
    editada: false,
    cambios: {},
    preguntaId: null,
  }
}

// Revisa que la propuesta (tal cual está) pueda ser una pregunta activa.
export function validarPropuesta(p, duracionSeg) {
  const errores = []
  if (!TIPOS_PREGUNTA_VIDEO.includes(p?.tipo)) errores.push('El tipo de pregunta no es válido.')
  const enun = limpiar(p?.enunciado)
  if (!enun) errores.push('Escribe el enunciado de la pregunta.')
  else if (enun.length > LIMITES_PROPUESTA.ENUNCIADO) errores.push(`El enunciado no puede pasar de ${LIMITES_PROPUESTA.ENUNCIADO} caracteres.`)
  if (!timestampValido(p?.timestampSeg, duracionSeg)) errores.push('El minuto del video no es válido.')

  if (p?.tipo === 'opcion_multiple') {
    const ops = Array.isArray(p.opciones) ? p.opciones : []
    const textos = ops.map((o) => limpiar(o?.texto))
    if (ops.length < LIMITES_PROPUESTA.OPCIONES_MIN || ops.length > LIMITES_PROPUESTA.OPCIONES_MAX) errores.push(`Las opciones deben ser entre ${LIMITES_PROPUESTA.OPCIONES_MIN} y ${LIMITES_PROPUESTA.OPCIONES_MAX}.`)
    if (textos.some((t) => !t)) errores.push('Ninguna opción puede estar vacía.')
    if (textos.some((t) => t.length > LIMITES_PROPUESTA.OPCION)) errores.push(`Cada opción admite hasta ${LIMITES_PROPUESTA.OPCION} caracteres.`)
    if (new Set(textos.map((t) => t.toLowerCase())).size !== textos.length) errores.push('Hay opciones repetidas.')
    if (!ops.some((o) => o?.id === p.respuestaCorrecta)) errores.push('Marca cuál es la opción correcta.')
  } else if (p?.tipo === 'verdadero_falso') {
    if (p.respuestaCorrecta !== 'v' && p.respuestaCorrecta !== 'f') errores.push('Indica si la respuesta es verdadero o falso.')
  }
  if (limpiar(p?.retroalimentacion).length > LIMITES_PROPUESTA.RETRO) errores.push(`La retroalimentación admite hasta ${LIMITES_PROPUESTA.RETRO} caracteres.`)
  return { ok: errores.length === 0, errores }
}

// Aplica la edición del docente. Devuelve lo que hay que escribir en la propuesta
// (`campos`) o `null` si no cambió nada. El tipo NO se edita (cambiarlo
// invalidaría opciones y clave): para eso se rechaza y se genera otra.
// `cambios` conserva el valor ORIGINAL de la IA de cada campo tocado, solo la
// primera vez: así queda registrado qué propuso la IA sin guardarlo dos veces.
export function aplicarEdicion(propuesta, edicion) {
  if (propuesta?.estado === ESTADO_PROPUESTA.APROBADA) throw new Error('Esta pregunta ya fue aprobada; edítala desde la lista de preguntas de la evaluación.')
  const nuevo = {}
  for (const c of CAMPOS_EDITABLES) if (edicion && c in edicion) nuevo[c] = edicion[c]
  if ('enunciado' in nuevo) nuevo.enunciado = limpiar(nuevo.enunciado)
  if ('retroalimentacion' in nuevo) nuevo.retroalimentacion = limpiar(nuevo.retroalimentacion) || null
  if ('opciones' in nuevo) {
    if (propuesta.tipo !== 'opcion_multiple') delete nuevo.opciones
    else nuevo.opciones = (nuevo.opciones || []).map((o) => ({ id: o.id, texto: limpiar(o.texto) }))
  }
  const campos = {}
  const cambios = { ...(propuesta.cambios || {}) }
  for (const [c, v] of Object.entries(nuevo)) {
    if (igual(v, propuesta[c])) continue
    campos[c] = v
    if (!(c in cambios)) cambios[c] = propuesta[c] ?? null
  }
  if (!Object.keys(campos).length) return null
  // Si quedó igual al original en todo, ya no cuenta como editada.
  const siguen = Object.keys(cambios).filter((c) => !igual(cambios[c], c in campos ? campos[c] : propuesta[c]))
  const finales = Object.fromEntries(siguen.map((c) => [c, cambios[c]]))
  return { campos: { ...campos, cambios: finales, editada: siguen.length > 0 } }
}

export function contarPorEstado(propuestas) {
  const cuenta = { pendiente: 0, aprobada: 0, rechazada: 0 }
  for (const p of propuestas || []) if (p?.estado in cuenta) cuenta[p.estado] += 1
  return cuenta
}

// Orden de revisión: por minuto del video; ante empate, por id (estable).
export function ordenarPropuestas(propuestas) {
  return [...(propuestas || [])].sort((a, b) => (a.timestampSeg ?? 0) - (b.timestampSeg ?? 0) || String(a.id).localeCompare(String(b.id)))
}

// PONDERACIÓN de una propuesta que se aprueba — criterio (8-oct-2026):
//   · Aprobar NUNCA toca las ponderaciones de las preguntas que ya están: el docente
//     pudo fijarlas a mano, y la calificación usa pesos RELATIVOS
//     (obtenida / total × maxCalif, ver calcularCalificacion), así que un total distinto
//     de 10 no altera ninguna nota; el editor solo exige que no pase de 10 y muestra
//     «Repartir 10 pts parejo» cuando el total no es 10.
//   · La nueva recibe una parte pareja de lo que AÚN QUEDA LIBRE de los 10: libre /
//     pendientes (contando la que se aprueba), redondeada hacia abajo. Así aprobar todo lo
//     pendiente nunca rebasa 10, con o sin pesos manuales previos, y rechazar propuestas
//     reparte más puntos a las que sigan (cada aprobación ve cuántas faltan).
//   · Si ya no queda nada libre no se aprueba (igual que agregar un reactivo a mano que
//     excede 10): el docente libera puntos o usa «Repartir parejo».
export const TOPE_PUNTOS = 10
export const PUNTOS_MIN = 0.01
const r2 = (n) => Math.round(n * 100) / 100

export function ponderacionParaAprobada({ activas, pendientes }) {
  const usado = r2((activas || []).reduce((s, a) => s + (parseFloat(a?.ponderacion) || 0), 0))
  const restante = r2(Math.max(0, TOPE_PUNTOS - usado))
  const faltan = Math.max(1, Number.isInteger(pendientes) ? pendientes : 1)
  const ponderacion = r2(Math.floor((restante / faltan) * 100) / 100)
  return { ponderacion, restante, faltan }
}

// Todo lo que hay que escribir, en UN lote, para aprobar una propuesta:
//   · la pregunta activa (mismo id que la propuesta) + su clave,
//   · la marca `aprobada` en la propuesta.
// No cambia ninguna otra pregunta. `activas` son las preguntas que YA están en la
// evaluación; `pendientes` cuántas propuestas siguen pendientes (contando esta). Si la
// propuesta ya estaba aprobada devuelve `{ yaAprobada: true }` y no hay nada que escribir.
export function planAprobacion({ propuesta, activas, pendientes = 1, duracionSeg }) {
  if (!propuesta?.id) throw new Error('Falta la propuesta.')
  if (propuesta.estado === ESTADO_PROPUESTA.APROBADA) return { yaAprobada: true }
  if (propuesta.estado === ESTADO_PROPUESTA.RECHAZADA) throw new Error('Esta pregunta está rechazada. Restáurala antes de aprobarla.')
  const v = validarPropuesta(propuesta, duracionSeg)
  if (!v.ok) throw new Error(v.errores[0])

  const otras = (activas || []).filter((a) => a.id !== propuesta.id)
  const pond = ponderacionParaAprobada({ activas: otras, pendientes })
  if (pond.ponderacion < PUNTOS_MIN) {
    throw new Error('Ya usaste los 10 puntos de la evaluación. Libera puntos en otras preguntas o usa «Repartir 10 pts parejo» y vuelve a aprobar.')
  }
  const maxOrden = otras.reduce((m, a) => Math.max(m, Number.isFinite(a.orden) ? a.orden : -1), -1)

  const base = {
    tipo: propuesta.tipo,
    enunciado: limpiar(propuesta.enunciado),
    ponderacion: pond.ponderacion,
    retroalimentacion: limpiar(propuesta.retroalimentacion) || null,
    imagenUrl: null,
    orden: maxOrden + 1,
    origenBancoId: null,
    timestampSeg: propuesta.timestampSeg,
    estado: ESTADO_PREGUNTA.APROBADA,
    origen: 'ia',
    propuestaId: propuesta.id,
  }
  let pregunta
  if (propuesta.tipo === 'opcion_multiple') {
    pregunta = { ...base, opciones: propuesta.opciones.map((o) => ({ id: o.id, texto: limpiar(o.texto) })), respuestaCorrecta: propuesta.respuestaCorrecta }
  } else if (propuesta.tipo === 'verdadero_falso') {
    pregunta = { ...base, opciones: [{ id: 'v', texto: 'Verdadero' }, { id: 'f', texto: 'Falso' }], respuestaCorrecta: propuesta.respuestaCorrecta }
  } else {
    pregunta = { ...base, opciones: null, respuestaCorrecta: null, respuestaEsperada: null }
  }
  return { yaAprobada: false, preguntaId: propuesta.id, pregunta, total: otras.length + 1 }
}

// ¿Cabe otra pregunta en el video? (el límite es el mismo que al generar)
export function cabeOtraPregunta(activas) {
  return (activas || []).length < VIDEO_CFG.MAX_PREGUNTAS
}

// «1:05», «01:05», «1:02:03» o «65» (segundos) → segundos enteros; null si no se entiende.
export function parsearMinuto(texto) {
  const t = String(texto ?? '').trim()
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return null
  const partes = t.split(':').map(Number)
  if (partes.length > 1 && partes.slice(1).some((n) => n > 59)) return null
  return partes.reduce((acc, n) => acc * 60 + n, 0)
}

export function formatearMinuto(seg) {
  if (!Number.isInteger(seg) || seg < 0) return '—'
  const h = Math.floor(seg / 3600)
  const m = Math.floor((seg % 3600) / 60)
  const s = seg % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}
