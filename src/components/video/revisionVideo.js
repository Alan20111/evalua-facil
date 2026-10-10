// Video interactivo · revisión del docente — lógica PURA (sin React ni Firebase).
//
// LA IA PROPONE. EL DOCENTE REVISA, CORRIGE, PRUEBA, APRUEBA O DESCARTA.
// Nada de lo que hay aquí verifica que una pregunta sea correcta: solo ordena lo que el docente
// ve y decide, valida los tiempos y arma lo que reproduce la vista previa. Una pregunta
// «aprobada» significa «el docente la aprobó», nunca «el sistema la comprobó».
//
// Vive en components/video y NO en utils/: un cambio en src/utils/** dispara el despliegue
// automático de las Cloud Functions (deploy-functions.yml) y esto es solo interfaz.
//
// Esta carpeta de módulos (revisionVideo, VideoInteractivoPantalla, VistaPreviaDocenteVideo) no
// importa Firebase, ni fetch, ni los servicios de escritura: la vista previa no tiene por dónde
// escribir. Lo comprueba una prueba que recorre sus importaciones (test/unidad.test.mjs).
import { formatearMinuto, parsearMinuto } from '../../utils/propuestasVideo'

// Segundos antes de la pregunta desde los que arranca «probar desde aquí».
export const PRE_SEG = 8
// En la vista previa no hay límite de «lo visto»: el docente navega libremente. Es un número
// enorme, no Infinity, para que las cuentas de la lógica temporal (comparaciones) sigan sirviendo.
export const LIBRE_SEG = 1e9
export const PASOS_TIEMPO = [-5, -1, 1, 5]
// Si falta menos que esto para el final, la pregunta aparece al terminar el video.
export const AVISO_FINAL_SEG = 2

// El globo `data-tooltip` (CSS global) sale centrado sobre el control; en los pegados a un borde de la ventana se saldría de la
// pantalla. Estas clases solo mueven el globo (en táctil no existe: el CSS global no lo genera) y no cambian el control.
export const GLOBO_DESDE_IZQ = '[&::after]:!left-0 [&::after]:![transform:none]'
export const GLOBO_HASTA_DER = '[&::after]:!left-auto [&::after]:!right-0 [&::after]:![transform:none]'

export const ESTADO_REVISION = { PENDIENTE: 'pendiente', APROBADA: 'aprobada', DESCARTADA: 'descartada' }

const ESTADO_DE_PROPUESTA = { pendiente: ESTADO_REVISION.PENDIENTE, aprobada: ESTADO_REVISION.APROBADA, rechazada: ESTADO_REVISION.DESCARTADA }

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)

// Segundo dentro de [0, duración]. Sin duración conocida solo se garantiza que no sea negativo.
export function clampSeg(seg, duracionSeg) {
  const s = Math.max(0, num(seg) ?? 0)
  const d = num(duracionSeg)
  return d && d > 0 ? Math.min(s, d) : s
}

// Mueve el tiempo ±N segundos sin salirse del video. Devuelve siempre un entero válido.
export function ajustarTiempo(seg, delta, duracionSeg) {
  const base = Number.isInteger(seg) ? seg : 0
  const d = num(duracionSeg)
  const tope = d && d > 0 ? Math.floor(d) : Infinity
  return Math.min(Math.max(0, Math.round(base + delta)), tope)
}

// «mm:ss» (o «h:mm:ss», o segundos sueltos) → segundos; null si no se entiende.
export function interpretarTiempo(texto) {
  return parsearMinuto(texto)
}
export { formatearMinuto }

// Valida el momento de aparición. `error` impide guardar; `aviso` solo advierte.
export function validarTiempo(seg, duracionSeg) {
  if (!Number.isInteger(seg)) return { ok: false, error: 'Escribe el minuto como m:ss (por ejemplo 2:35).', aviso: null }
  if (seg < 0) return { ok: false, error: 'El minuto no puede ser negativo.', aviso: null }
  const d = num(duracionSeg)
  if (d && d > 0 && seg > Math.floor(d)) return { ok: false, error: `El video dura ${formatearMinuto(Math.floor(d))}: el minuto no puede ser posterior.`, aviso: null }
  let aviso = null
  if (d && d > 0 && seg >= Math.floor(d) - AVISO_FINAL_SEG) aviso = 'Está al final del video: la pregunta aparecerá cuando el video termine.'
  else if (seg === 0) aviso = 'Está al inicio: la pregunta aparecerá antes de que el video avance.'
  return { ok: true, error: null, aviso }
}

// ── Evidencia ───────────────────────────────────────────────────────────────────────────
// La evidencia es OPCIONAL: hoy las propuestas guardadas no traen el tramo del que salió cada
// pregunta (eso lo calcula el servidor y todavía no lo conserva). Si algún día se guarda, se
// espera en `propuesta.respaldo` con esta forma —cualquier otra cosa se ignora—:
//   { inicioSeg, finSeg, resumen, cita, verificacion }   verificacion: 'verificado' | 'reubicado' | 'no_verificable'
// Sin ella NO se inventa nada: se avisa que no hay evidencia y que el docente debe comprobarlo.
// El resumen de un tramo lo escribió una IA: puede omitir o deformar lo que dice el video.
export function leerEvidencia(respaldo) {
  if (!respaldo || typeof respaldo !== 'object') return null
  const inicio = Number.isFinite(respaldo.inicioSeg) ? respaldo.inicioSeg : null
  const fin = Number.isFinite(respaldo.finSeg) ? respaldo.finSeg : null
  const resumen = typeof respaldo.resumen === 'string' ? respaldo.resumen.trim().slice(0, 400) : ''
  const cita = typeof respaldo.cita === 'string' ? respaldo.cita.trim().slice(0, 300) : ''
  if (inicio === null && fin === null && !resumen && !cita) return null
  const verificacion = ['verificado', 'reubicado', 'no_verificable'].includes(respaldo.verificacion) ? respaldo.verificacion : null
  return { inicioSeg: inicio, finSeg: fin, resumen, cita, verificacion }
}

// Advertencias sobre el momento elegido frente a la evidencia (si la hay).
export function advertenciasDeTiempo(item) {
  const adv = []
  const ev = leerEvidencia(item?.respaldo)
  if (!ev) {
    adv.push('No hay evidencia guardada de qué parte del video salió esta pregunta ni de si la explicación ya había terminado en este minuto. Compruébalo viendo el video.')
    return adv
  }
  if (ev.verificacion === 'no_verificable') adv.push('El sistema no pudo respaldar esta pregunta con el contenido del video. Revísala con cuidado o descártala.')
  if (ev.finSeg !== null && Number.isInteger(item.timestampSeg) && item.timestampSeg < ev.finSeg) {
    adv.push(`El minuto elegido (${formatearMinuto(item.timestampSeg)}) es anterior al final del tramo de donde salió (${formatearMinuto(Math.floor(ev.finSeg))}): la explicación podría no haber terminado.`)
  }
  if (ev.finSeg === null) adv.push('No se sabe dónde termina la explicación en la que se basa esta pregunta.')
  return adv
}

// ¿Hay que pedir una confirmación expresa antes de aprobar? Solo si el sistema marcó la pregunta como
// no respaldada. Aprobar nunca convierte una pregunta en «verificada».
export function requiereConfirmacion(item) {
  return leerEvidencia(item?.respaldo)?.verificacion === 'no_verificable'
}

// ── Elementos de revisión ────────────────────────────────────────────────────────────────
// Une las propuestas de la IA con las preguntas que ya están en la evaluación (las aprobadas) en una
// sola lista. `borradores` guarda lo que el docente cambió y todavía NO guardó: se sobrepone a lo
// guardado sin tocarlo.
//   propuestas   activities/{id}/propuestasVideo
//   activas      activities/{id}/preguntas (con su clave: respuestaCorrecta)
//   activasListas  false mientras el editor aún está leyendo las preguntas de la evaluación (no se puede saber si una aprobada
//                  sigue en ella)
export function construirItems({ propuestas = [], activas = [], borradores = {}, activasListas = true }) {
  const porId = new Map(activas.map((a) => [a.id, a]))
  const usadas = new Set()
  const items = []
  for (const p of propuestas) {
    let estado = ESTADO_DE_PROPUESTA[p.estado] || ESTADO_REVISION.PENDIENTE
    const activa = estado === ESTADO_REVISION.APROBADA ? porId.get(p.preguntaId || p.id) : null
    // Aprobada, pero el docente la ELIMINÓ después desde la lista de preguntas del editor (eso no toca su propuesta): ya no está en
    // la evaluación, no se publica y no se reproduce. Las reglas de Firestore no permiten reabrir una propuesta aprobada, así que
    // solo se informa; para volver a usarla se agrega a mano.
    const fuera = estado === ESTADO_REVISION.APROBADA && !activa && activasListas
    if (fuera) estado = ESTADO_REVISION.DESCARTADA
    if (activa) usadas.add(activa.id)
    const fuente = activa || p
    const sugeridoSeg = p.cambios && 'timestampSeg' in p.cambios ? p.cambios.timestampSeg : p.timestampSeg
    items.push(base({
      id: p.id, origen: 'ia', propuestaId: p.id, estado, fuente,
      editada: !!p.editada, sugeridoSeg: Number.isInteger(sugeridoSeg) ? sugeridoSeg : null, respaldo: p.respaldo || null, fuera,
    }))
  }
  // Preguntas de la evaluación sin propuesta (creadas a mano, o de antes): también se publican.
  for (const a of activas) {
    if (usadas.has(a.id) || propuestas.some((p) => p.id === a.id || p.preguntaId === a.id)) continue
    items.push(base({ id: a.id, origen: 'manual', propuestaId: null, estado: ESTADO_REVISION.APROBADA, fuente: a, editada: false, sugeridoSeg: null, respaldo: null }))
  }
  return items
    .map((it) => aplicarBorrador(it, borradores[it.id]))
    .sort((a, b) => (a.timestampSeg ?? Infinity) - (b.timestampSeg ?? Infinity) || String(a.id).localeCompare(String(b.id)))
}

function base({ id, origen, propuestaId, estado, fuente, editada, sugeridoSeg, respaldo, fuera = false }) {
  return {
    id, origen, propuestaId, estado, editada, sugeridoSeg, respaldo, fueraDeLaEvaluacion: fuera,
    tipo: fuente.tipo,
    enunciado: fuente.enunciado || '',
    opciones: Array.isArray(fuente.opciones) ? fuente.opciones.map((o) => ({ ...o })) : null,
    respuestaCorrecta: fuente.respuestaCorrecta ?? null,
    retroalimentacion: fuente.retroalimentacion || '',
    timestampSeg: Number.isInteger(fuente.timestampSeg) ? fuente.timestampSeg : null,
    sinGuardar: false,
    guardado: null,
  }
}

const CAMPOS_BORRADOR = ['enunciado', 'opciones', 'respuestaCorrecta', 'retroalimentacion', 'timestampSeg']

// Lo guardado queda en `guardado`; el borrador (si lo hay y difiere) se aplica encima.
export function aplicarBorrador(item, borrador) {
  const guardado = {}
  for (const c of CAMPOS_BORRADOR) guardado[c] = item[c]
  if (!borrador) return { ...item, guardado }
  const cambios = {}
  for (const c of CAMPOS_BORRADOR) {
    if (c in borrador && JSON.stringify(borrador[c]) !== JSON.stringify(item[c])) cambios[c] = borrador[c]
  }
  const sinGuardar = Object.keys(cambios).length > 0
  return { ...item, ...cambios, sinGuardar, guardado }
}

export function contarPorEstadoRevision(items) {
  const cuenta = { pendiente: 0, aprobada: 0, descartada: 0 }
  for (const it of items || []) if (it?.estado in cuenta) cuenta[it.estado] += 1
  return cuenta
}

// ── Vista previa ─────────────────────────────────────────────────────────────────────────
// Lo que reproduce la vista previa: aprobadas y pendientes (marcadas), nunca las descartadas.
// Usa lo que el docente ve en pantalla, guardado o no, y no lee nada de Firestore.
export function preguntasVistaPrevia(items) {
  return (items || [])
    .filter((it) => it.estado !== ESTADO_REVISION.DESCARTADA)
    .map((it, i) => ({
      id: it.id,
      tipo: it.tipo,
      enunciado: it.enunciado,
      opciones: it.tipo === 'verdadero_falso'
        ? [{ id: 'v', texto: 'Verdadero' }, { id: 'f', texto: 'Falso' }]
        : (it.opciones || []).map((o) => ({ id: o.id, texto: o.texto })),
      imagenUrl: null,
      timestampSeg: it.timestampSeg,
      orden: i,
      revision: it.estado, // 'pendiente' → la pantalla lo rotula como «no publicada»
    }))
}

// Al saltar a `seg` en la vista previa, las preguntas desde ahí en adelante se vuelven a probar:
// se borran las respuestas de prueba de esas (las anteriores no se tocan).
export function limpiarRespuestasDesde(respuestas, otraTextos, items, seg) {
  const idsDesde = new Set((items || []).filter((it) => !Number.isInteger(it.timestampSeg) || it.timestampSeg >= seg - 0.05).map((it) => it.id))
  const filtra = (o) => Object.fromEntries(Object.entries(o || {}).filter(([id]) => !idsDesde.has(id)))
  return { respuestas: filtra(respuestas), otraTextos: filtra(otraTextos) }
}

// Segundo desde el que arranca «probar» una pregunta.
export function inicioDePrueba(timestampSeg, duracionSeg) {
  return clampSeg((Number.isInteger(timestampSeg) ? timestampSeg : 0) - PRE_SEG, duracionSeg)
}

// ¿Coincide la respuesta de prueba con la que la IA propone? Solo para el panel del docente.
export function compararConPropuesta(item, respuesta) {
  if (!item || item.tipo === 'respuesta_corta') return { aplica: false }
  if (respuesta === undefined || respuesta === null || respuesta === '') return { aplica: true, respondida: false }
  return { aplica: true, respondida: true, coincide: respuesta === item.respuestaCorrecta }
}

// ── Navegación de la ventana de revisión (una pregunta a la vez) ───────────────────────────────────────────
// La lista se ORDENA UNA SOLA VEZ, con los momentos ya guardados (`guardado`): si se ordenara con el borrador, al arrastrar el
// marcador la pregunta cambiaría de lugar y «Pregunta 3 de 8» saltaría a otra. Los ids quedan fijos mientras la ventana está abierta.
export const FILTRO_REVISION = { ACTIVAS: 'activas', PENDIENTES: 'pendientes', DESCARTADAS: 'descartadas' }

export function ordenRevision(items) {
  const t = (it) => (Number.isInteger(it.guardado?.timestampSeg) ? it.guardado.timestampSeg : Infinity)
  return [...(items || [])].sort((a, b) => t(a) - t(b) || String(a.id).localeCompare(String(b.id))).map((it) => it.id)
}

// «Todas» = lo que se revisa o ya está aprobado (sin las descartadas, que tienen su propio filtro).
export function coincideFiltro(item, filtro) {
  if (!item) return false
  if (filtro === FILTRO_REVISION.PENDIENTES) return item.estado === ESTADO_REVISION.PENDIENTE
  if (filtro === FILTRO_REVISION.DESCARTADAS) return item.estado === ESTADO_REVISION.DESCARTADA
  return item.estado !== ESTADO_REVISION.DESCARTADA
}

// Ids visibles con el filtro, en orden. La pregunta actual siempre se incluye: si el docente la aprueba estando en «Pendientes»,
// no desaparece de golpe de la ventana.
export function visiblesRevision(orden, porId, filtro, actualId) {
  return (orden || []).filter((id) => id === actualId || coincideFiltro(porId[id], filtro))
}

// Siguiente (delta 1) o anterior (delta −1) que cumpla el filtro; null si no hay.
export function moverId(orden, porId, filtro, actualId, delta) {
  const lista = orden || []
  let i = lista.indexOf(actualId)
  if (i === -1) return null
  for (i += delta; i >= 0 && i < lista.length; i += delta) if (coincideFiltro(porId[lista[i]], filtro)) return lista[i]
  return null
}

// Con qué pregunta abre la ventana: la primera pendiente; si no hay, la primera que se revise.
export function primeraParaRevisar(orden, porId, filtro = FILTRO_REVISION.ACTIVAS) {
  const lista = orden || []
  return lista.find((id) => porId[id]?.estado === ESTADO_REVISION.PENDIENTE)
    ?? lista.find((id) => coincideFiltro(porId[id], filtro))
    ?? lista[0] ?? null
}

export const contarSinGuardar = (items) => (items || []).filter((it) => it.sinGuardar).length

// ── Escape en la ventana de revisión ──────────────────────────────────────────────────────────────────────
// Qué hace la ventana de revisión cuando se pulsa Escape. Con la vista previa docente abierta ENCIMA, Escape es de la vista previa
// (que se cierra por su cuenta): la ventana no hace nada, ni se cierra ni muestra detrás el aviso de cambios sin guardar.
// Con la vista previa cerrada: aviso abierto → se cierra el aviso; con cambios sin guardar → pide confirmación; sin cambios → se cierra.
//   devuelve 'nada' | 'cerrar-aviso' | 'pedir-confirmacion' | 'cerrar'
export function accionEscape({ vistaPreviaAbierta = false, cerrando = false, sinGuardar = 0 } = {}) {
  if (vistaPreviaAbierta) return 'nada'
  if (cerrando) return 'cerrar-aviso'
  return sinGuardar > 0 ? 'pedir-confirmacion' : 'cerrar'
}
