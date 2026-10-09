// Video interactivo con IA — base de la modalidad (etapa 1).
//
// DECISIÓN DE ARQUITECTURA: «video_interactivo» NO es un `tipo` nuevo de
// actividad. Es una MODALIDAD de una evaluación existente:
//
//   activities/{id} = {
//     tipo: 'evaluacion',            ← el motor de cuestionarios la sigue viendo igual
//     categoria: 'cuestionario'|'examen',
//     modalidad: 'video_interactivo',← único discriminador
//     videoInteractivo: { ... },     ← capa de video (ver crearVideoInteractivoInicial)
//     evaluacion: { ...config },     ← la config de siempre (intentos, tiempo, publicación…)
//   }
//   activities/{id}/preguntas/{pid}  ← las mismas preguntas de siempre, con campos
//                                      opcionales extra (timestampSeg, estado, origen)
//
// Así runner, calificación, intentos, publicación, resultados, gráficas,
// descargas, copiado de asignatura, reglas y créditos siguen funcionando sin
// tocarse. Este archivo es PURO (sin Firebase) y se sincroniza a
// functions/_shared para que cliente y servidor usen las mismas reglas y el
// mismo costo.

// Constantes agrupadas en un objeto: el script de sincronización a
// functions/_shared solo admite exports de función, objeto o arreglo.
//   · 2 créditos por pregunta generada (decisión de producto). Editar, aprobar,
//     rechazar, publicar y contestar no cobran.
export const VIDEO_CFG = {
  MODALIDAD: 'video_interactivo',
  CREDITOS_POR_PREGUNTA: 2,
  MIN_PREGUNTAS: 1,
  MAX_PREGUNTAS: 20,
}

// Los tipos son los que YA existen en el motor: la «respuesta abierta» del
// producto es `respuesta_corta` (texto libre, calificación manual del docente).
export const TIPOS_PREGUNTA_VIDEO = ['verdadero_falso', 'opcion_multiple', 'respuesta_corta']

// Estado de una pregunta dentro de la actividad. Una pregunta SIN `estado`
// (todas las de cuestionarios/exámenes existentes) cuenta como aprobada: el
// motor actual no se entera de que esto existe.
export const ESTADO_PREGUNTA = { PROPUESTA: 'propuesta', APROBADA: 'aprobada', RECHAZADA: 'rechazada' }

// Clave de la distribución que elige el docente → tipo de pregunta del motor.
export const TIPO_POR_CLAVE_DISTRIBUCION = { vf: 'verdadero_falso', om: 'opcion_multiple', abiertas: 'respuesta_corta' }

// Estado de la GENERACIÓN (datos de IA, separados de los datos permanentes del video).
export const ESTADO_GENERACION = { COMPLETA: 'completa', INCOMPLETA: 'incompleta' }

// { vf:4, om:4, abiertas:2 } → { verdadero_falso:4, opcion_multiple:4, respuesta_corta:2 }
export function conteoPorTipo(dist) {
  const out = {}
  for (const [clave, tipo] of Object.entries(TIPO_POR_CLAVE_DISTRIBUCION)) out[tipo] = Number.isInteger(dist?.[clave]) ? dist[clave] : 0
  return out
}

export function esVideoInteractivo(activity) {
  return activity?.tipo === 'evaluacion' && activity?.modalidad === VIDEO_CFG.MODALIDAD
}

// Extrae el id de 11 caracteres de una URL de YouTube. Lista cerrada de hosts
// (nada de «cualquier URL que contenga youtube»). Devuelve null si no es válida.
const ID_YT = /^[A-Za-z0-9_-]{11}$/
const HOSTS_YT = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'])
export function extraerVideoIdYouTube(url) {
  let u
  try { u = new URL(String(url || '').trim()) } catch { return null }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  let id = null
  if (host === 'youtu.be') {
    id = u.pathname.split('/')[1] || null
  } else if (HOSTS_YT.has(host)) {
    const partes = u.pathname.split('/').filter(Boolean)
    if (partes[0] === 'watch') id = u.searchParams.get('v')
    else if (['embed', 'shorts', 'live', 'v'].includes(partes[0])) id = partes[1] || null
  }
  return id && ID_YT.test(id) ? id : null
}

export function urlCanonicaYouTube(videoId) {
  return ID_YT.test(String(videoId || '')) ? `https://www.youtube.com/watch?v=${videoId}` : null
}

// Valida la distribución pedida por el docente: { vf, om, abiertas }.
// Devuelve { ok, total, creditos, distribucion, error }. Enteros ≥ 0, total
// dentro de [MIN, MAX]. El costo SIEMPRE sale del total real, nunca de un
// número que mande el cliente.
export function validarDistribucionVideo(dist) {
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : null)
  const vf = n(dist?.vf)
  const om = n(dist?.om)
  const abiertas = n(dist?.abiertas)
  if (vf === null || om === null || abiertas === null) {
    return { ok: false, total: 0, creditos: 0, distribucion: null, error: 'Indica cuántas preguntas de cada tipo (números enteros, 0 o más).' }
  }
  const total = vf + om + abiertas
  if (total < VIDEO_CFG.MIN_PREGUNTAS) return { ok: false, total, creditos: 0, distribucion: null, error: `Pide al menos ${VIDEO_CFG.MIN_PREGUNTAS} pregunta.` }
  if (total > VIDEO_CFG.MAX_PREGUNTAS) return { ok: false, total, creditos: 0, distribucion: null, error: `El máximo es ${VIDEO_CFG.MAX_PREGUNTAS} preguntas por generación.` }
  return { ok: true, total, creditos: costoGeneracionVideo(total), distribucion: { vf, om, abiertas }, error: null }
}

export function costoGeneracionVideo(numPreguntas) {
  const n = Number.isInteger(numPreguntas) && numPreguntas > 0 ? numPreguntas : 0
  return n * VIDEO_CFG.CREDITOS_POR_PREGUNTA
}

// Un timestamp es un entero de segundos dentro del video. Si ya se conoce la
// duración, no puede rebasarla.
export function timestampValido(seg, duracionSeg) {
  if (!Number.isInteger(seg) || seg < 0) return false
  if (Number.isInteger(duracionSeg) && duracionSeg > 0 && seg > duracionSeg) return false
  return true
}

// Preguntas que forman parte de la actividad: las aprobadas y las que no
// tienen estado (legado). Las propuestas y rechazadas NUNCA se publican.
export function preguntasAprobadas(preguntas) {
  return (preguntas || []).filter((p) => !p?.estado || p.estado === ESTADO_PREGUNTA.APROBADA)
}

// Estructura inicial de la capa de video. La generación y el reproductor se
// llenan en etapas posteriores; aquí solo el contrato de datos. NO se guarda
// ningún archivo de video: únicamente la URL de YouTube y su id.
export function crearVideoInteractivoInicial(url) {
  const videoId = extraerVideoIdYouTube(url)
  if (!videoId) return null
  return {
    proveedor: 'youtube',
    videoId,
    url: urlCanonicaYouTube(videoId),
    duracionSeg: null,
    generacion: { estado: 'pendiente', preguntasGeneradas: 0, creditosCobrados: 0 },
    // Etapas posteriores. Se declaran ya para fijar el contrato:
    permitirSaltar: false,
    porcentajeMinimoVisto: null,
  }
}
