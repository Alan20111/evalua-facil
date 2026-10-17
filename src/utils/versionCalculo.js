// Con qué versión de la evaluación se calculó cada intento.
//
// Una nota guardada es el resultado de una CUENTA hecha con los reactivos, sus
// puntos y su clave de ESE momento. Si el docente edita después un reactivo, un
// peso o la clave, la evaluación vigente ya no es la que produjo esa nota —pero
// la nota no tenía forma de decirlo—, y cualquier recálculo con lo vigente
// reescribía el pasado sin que nadie lo notara.
//
// Este módulo es puro (sin Firebase) y vive en src/utils para que el servidor
// —que toma la fotografía del intento— y la pantalla del docente —que recalcula
// a mano— usen LA MISMA lectura. scripts/sync-functions-shared.mjs lo copia a
// functions/_shared/.

// Hash de texto de 53 bits (cyrb53): sin dependencias, igual en navegador y en
// Node. No es criptográfico: es una huella para comparar versiones.
function huella(texto) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < texto.length; i++) {
    const ch = texto.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/**
 * Huella de la evaluación tal como se calificó: cada reactivo con su tipo, sus
 * puntos y su respuesta correcta, más la escala. Cambia si se edita cualquiera
 * de esas cosas; no cambia por el orden en que lleguen los reactivos.
 */
export function firmaEvaluacion(preguntas, maxCalif = 10) {
  const filas = (preguntas || [])
    .map((p) => [p.id, p.tipo ?? null, p.ponderacion ?? 0, p.respuestaCorrecta ?? null])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return huella(JSON.stringify({ filas, maxCalif }))
}

/** { id: { tipo, ponderacion } } — lo mínimo para volver a hacer la cuenta. */
export function estructuraDePreguntas(preguntas) {
  const salida = {}
  ;(preguntas || []).forEach((p) => {
    salida[p.id] = { tipo: p.tipo ?? null, ponderacion: p.ponderacion || 0 }
  })
  return salida
}

/**
 * Los reactivos CON LOS QUE se calificó un intento, para recalcularlo.
 * `snapshot` es el documento `intentosRespuestas/{n}`. Si trae `estructura`
 * (intentos nuevos), manda ella: tipo y puntos de aquel día, aunque hoy el
 * reactivo valga otra cosa o ya no exista. Sin `estructura` (intentos anteriores
 * a este registro) no hay otra fuente que lo vigente.
 *
 * Devuelve { preguntas, desdeSnapshot }. Con snapshot, `preguntas` trae solo lo
 * que formaba parte del intento.
 */
export function preguntasDelIntento(snapshot, vigentes = []) {
  const estructura = snapshot?.estructura
  if (!estructura || typeof estructura !== 'object') return { preguntas: vigentes, desdeSnapshot: false }
  const porId = {}
  vigentes.forEach((p) => { porId[p.id] = p })
  const preguntas = Object.keys(estructura).map((id) => ({
    ...(porId[id] || { id }),
    id,
    tipo: estructura[id].tipo,
    ponderacion: estructura[id].ponderacion,
  }))
  return { preguntas, desdeSnapshot: true }
}

const tieneValor = (v) => v !== null && v !== undefined && (typeof v !== 'string' || v.trim() !== '')

/**
 * Lo que el estudiante DECLARÓ haber contestado (`respuestasDeclaradas`, que su
 * pantalla manda al entregar) contra lo que quedó guardado. Devuelve los ids
 * declarados que no tienen nada guardado: la señal de que una respuesta se
 * perdió en el camino. Sin declaración (clientes anteriores) no hay nada que
 * comparar: devuelve [].
 */
export function respuestasDeclaradasSinGuardar(declaradas, respuestasGuardadas) {
  if (!Array.isArray(declaradas)) return []
  return declaradas.filter((id) => {
    const r = respuestasGuardadas?.[id]
    return !(r && (tieneValor(r.opcionSeleccionada) || tieneValor(r.textoRespuesta) || tieneValor(r.archivoURL)))
  }).sort()
}

/**
 * ¿Cambió la evaluación mientras este intento estaba en curso? `cambios` son los
 * documentos del historial de reactivos (cada uno con `registradoEnMs`); un
 * cambio entre el inicio del intento y su cierre significa que el estudiante
 * pudo ver una versión y ser calificado con otra. Devuelve los ids afectados.
 */
export function reactivosCambiadosDuranteIntento(cambios, inicioMs, finMs) {
  if (!Number.isFinite(inicioMs) || !Number.isFinite(finMs)) return []
  const ids = new Set()
  ;(cambios || []).forEach((c) => {
    const t = c?.registradoEnMs
    if (Number.isFinite(t) && t >= inicioMs && t <= finMs && c.preguntaId) ids.add(c.preguntaId)
  })
  return [...ids].sort()
}

/**
 * La política de intentos con la que recalcular una nota que ya existe: la que
 * produjo esa nota (`politicaAplicada`), no la que la actividad tenga HOY.
 * Cambiar «conservar» en la actividad no reescribe notas ya puestas; solo las
 * entregas anteriores a este registro (sin `politicaAplicada`) usan la vigente.
 */
export function politicaDeLaNota(entrega, conservarVigente) {
  return entrega?.politicaAplicada || conservarVigente
}

/** Dos valores JSON-equivalentes (el historial no archiva escrituras sin cambio). */
export function sonIguales(a, b) {
  return JSON.stringify(ordenado(a)) === JSON.stringify(ordenado(b))
}

function ordenado(v) {
  if (Array.isArray(v)) return v.map(ordenado)
  if (v && typeof v === 'object' && typeof v.toMillis !== 'function') {
    const salida = {}
    Object.keys(v).sort().forEach((k) => { salida[k] = ordenado(v[k]) })
    return salida
  }
  return v
}
