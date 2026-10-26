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
import { ordenarPreguntasVideo, preguntaPendiente } from '../../utils/videoProgreso'

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
// Para botones que cambian de lugar al acomodarse en una fila (la alineación fija no sirve): el globo se angosta (el texto baja a
// 2-3 líneas) y, centrado, cabe aunque el botón quede pegado a un borde.
export const GLOBO_ANGOSTO = '[&::after]:!max-w-[130px]'

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

export const MENSAJE_SIN_UBICAR = 'Para aprobarla, primero arrastra su punto a la línea de tiempo.'

// Valida el momento de aparición. `error` impide guardar; `aviso` solo advierte.
export function validarTiempo(seg, duracionSeg) {
  // Sin momento solo puede estar una propuesta de la versión anterior: se ubica arrastrando su punto (nunca escribiendo).
  if (!Number.isInteger(seg)) return { ok: false, error: MENSAJE_SIN_UBICAR, aviso: null }
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

// Aviso sobre el momento elegido frente a la evidencia: solo si el DOCENTE movió la pregunta antes de que termine el fragmento
// que la respalda. No se le pide comprobar nada: las preguntas nuevas ya llegan validadas (contenido, respuesta y momento).
export function advertenciasDeTiempo(item) {
  const ev = leerEvidencia(item?.respaldo)
  if (!ev || ev.finSeg === null || !Number.isInteger(item?.timestampSeg) || item.timestampSeg >= ev.finSeg) return []
  return [`El momento elegido (${formatearMinuto(item.timestampSeg)}) es anterior al final del fragmento de donde salió (${formatearMinuto(Math.floor(ev.finSeg))}): la explicación podría no haber terminado.`]
}

// ¿La propuesta es de la versión anterior del generador (sin la validación automática actual)? Se reconoce al leerla: las
// nuevas traen `versionValidacion`. No se reescribe ningún dato.
export const esDeVersionAnterior = (p) => !Number.isInteger(p?.versionValidacion)

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
      anterior: esDeVersionAnterior(p),
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

function base({ id, origen, propuestaId, estado, fuente, editada, sugeridoSeg, respaldo, fuera = false, anterior = false }) {
  return {
    id, origen, propuestaId, estado, editada, sugeridoSeg, respaldo, fueraDeLaEvaluacion: fuera, anterior,
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

// ── Puntos de la línea de tiempo y preguntas sin minuto ──────────────────────────────────
// Solo ordenan lo que el docente ve: no cambian tiempos, estados ni nada que se guarde.

// Los puntos que dibuja la línea de tiempo de la revisión (minuto entero dentro del video), agrupados por segundo: varias
// preguntas en el mismo segundo son UN punto con su cantidad (antes se encimaban y parecía que faltaban). `excluirId` es la
// pregunta abierta, que va como bolita blanca y no como punto.
export function agruparPorSegundo(items, { duracionSeg, excluirId = null } = {}) {
  const d = num(duracionSeg)
  const tope = d && d > 0 ? Math.floor(d) : Infinity
  const grupos = new Map()
  for (const it of items || []) {
    if (!it || it.id === excluirId || !Number.isInteger(it.timestampSeg) || it.timestampSeg > tope) continue
    if (!grupos.has(it.timestampSeg)) grupos.set(it.timestampSeg, [])
    grupos.get(it.timestampSeg).push(it)
  }
  return [...grupos.entries()].sort((a, b) => a[0] - b[0]).map(([seg, lista]) => ({ seg, items: lista }))
}

// Color de un punto agrupado: si hay alguna pendiente se ve como pendiente (es lo que falta revisar); si no, aprobada.
export function estadoDeGrupo(lista) {
  for (const e of [ESTADO_REVISION.PENDIENTE, ESTADO_REVISION.APROBADA, ESTADO_REVISION.DESCARTADA]) {
    if ((lista || []).some((it) => it?.estado === e)) return e
  }
  return ESTADO_REVISION.PENDIENTE
}

// Las OTRAS preguntas que caen en el mismo segundo que la pregunta abierta (`seg`): quedan debajo de la bolita blanca.
export function mismoSegundo(items, itemId, seg) {
  if (!Number.isInteger(seg)) return []
  return (items || []).filter((o) => o && o.id !== itemId && o.timestampSeg === seg)
}

// Preguntas que todavía no tienen minuto (la IA no pudo fijarlo): no aparecen en la línea de tiempo y no se pueden aprobar
// hasta que el docente lo elija. Las descartadas no cuentan: no se publican.
export function preguntasSinMinuto(items) {
  return (items || []).filter((it) => it && it.estado !== ESTADO_REVISION.DESCARTADA && !Number.isInteger(it.timestampSeg))
}

const TIPO_CORTO = { verdadero_falso: 'Verdadero/falso', opcion_multiple: 'Opción múltiple', respuesta_corta: 'Respuesta abierta' }

// Texto corto de un acceso directo a una pregunta: tipo · estado — inicio del enunciado.
export function etiquetaPregunta(it, max = 60) {
  const texto = String(it?.enunciado || '').replace(/\s+/g, ' ').trim()
  const corto = texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto
  const estado = Object.values(ESTADO_REVISION).includes(it?.estado) ? it.estado : ESTADO_REVISION.PENDIENTE
  return `${TIPO_CORTO[it?.tipo] || 'Pregunta'} · ${estado}${corto ? ` — ${corto}` : ''}`
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

// ¿En qué pregunta debe detenerse el video de la REVISIÓN? Es EXACTAMENTE la regla del estudiante (videoProgreso): el mismo orden
// (`ordenarPreguntasVideo`) y la misma condición de activación (`preguntaPendiente`: la primera pregunta sin pasar cuyo segundo ya
// llegó), con el mismo adelanto (ADELANTO_PREGUNTA_SEG); aquí no hay tolerancia propia. Lo único del docente es qué cuenta como
// «ya pasada» (en el estudiante es «respondida»): las anteriores al punto desde el que se reproduce (`base`) y las que ya se
// detuvieron (`pasadas`, ids).
//   items        preguntas con el borrador aplicado (las descartadas no se publican: no detienen el video)
//   duracionSeg  largo del video (sin él no se puede ordenar: no hay parada)
//   pos          segundo actual del reproductor
//   devuelve la pregunta (con su `timestampSeg` ya acotado al video) o null
export function paradaDePregunta({ items, duracionSeg, pos, base = 0, pasadas = new Set() }) {
  if (!(duracionSeg > 0)) return null
  const candidatas = (items || []).filter((o) => o.estado !== ESTADO_REVISION.DESCARTADA && Number.isInteger(o.timestampSeg))
  const ordenadas = ordenarPreguntasVideo(candidatas, duracionSeg)
  return preguntaPendiente(ordenadas, (p) => pasadas.has(p.id) || p.timestampSeg < base, pos)
}

// ¿Esta pregunta YA NO debe detener el video en la pasada actual? Es el predicado que recibe `tick` / `antesDeReproducir` del
// estudiante (donde «respondida» las excluía siempre). En navegación SECUENCIAL no cambia: una respondida se salta. En navegación
// LIBRE («puede cambiar sus respuestas») una respondida solo se salta si ya se activó en esta pasada (`pasadas`: ids) o queda antes
// del punto desde el que se reproduce (`base`); así, al retroceder y reproducir su tramo, vuelve a aparecer, y no se repite mientras
// el video está detenido en su segundo ni al responder y continuar. Una SIN responder nunca se salta (sigue bloqueando el video).
//   p            pregunta ({ id, timestampSeg })
//   libre        navegación libre
//   respondida   ¿ya tiene respuesta? (estaRespondida)
export function yaSuperadaAlReproducir(p, { libre, respondida, pasadas, base }) {
  if (!respondida) return false
  if (!libre) return true
  return pasadas.has(p.id) || p.timestampSeg < base
}
