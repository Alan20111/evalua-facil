// Guardado de las respuestas de un intento — con la certeza de qué quedó guardado.
//
// El problema que resuelve: la pantalla marcaba una pregunta como respondida
// ANTES de saber si el servidor la había guardado. Si el guardado fallaba (red,
// o las reglas lo rechazaban por el plazo) solo salía un aviso breve; la
// pregunta seguía contando como contestada, el estudiante entregaba creyendo
// que todo estaba guardado, y el servidor —que califica lo PERSISTIDO— veía una
// respuesta en blanco.
//
// Lo que garantiza este módulo:
//   · las escrituras de una MISMA pregunta salen en orden y la última intención
//     del estudiante es la que queda (una escritura lenta no pisa a una nueva);
//   · cada pregunta tiene su estado —guardando / guardada / error— y «no se pudo
//     guardar» es distinto de «sin responder»;
//   · un fallo se reintenta solo (poco) y a mano (botón) con la MISMA operación,
//     que es idempotente: reintentar no duplica nada;
//   · antes de enviar se LEE del servidor lo que quedó y se compara con lo que el
//     estudiante marcó (verificar), y se re-guarda lo que falte (restaurar);
//   · cada escritura lleva el número de intento, para que las reglas rechacen una
//     escritura tardía de un intento anterior.
//
// No depende de React. `db` entra por parámetro y la escritura es inyectable,
// así que corre igual en la app y en las pruebas contra el emulador.
import { collection, doc, getDocsFromServer, serverTimestamp, setDoc } from 'firebase/firestore'

export const ESTADO_GUARDADO = { GUARDANDO: 'guardando', GUARDADA: 'guardada', ERROR: 'error' }

const conValor = (v) => v !== null && v !== undefined && v !== ''

// Lo que debería quedar PERSISTIDO para una pregunta contestada, según su tipo.
// Devuelve null si la pregunta está en blanco (no hay nada que verificar). Misma
// lectura que evaluacionRespondida.estaRespondida.
export function valorEsperado(pregunta, respuesta, otraTexto) {
  if (!pregunta) return null
  if (pregunta.tipo === 'respuesta_corta') {
    return typeof respuesta === 'string' && respuesta.trim() !== '' ? { textoRespuesta: respuesta } : null
  }
  if (pregunta.tipo === 'subir_archivo') {
    return typeof respuesta?.archivoURL === 'string' && respuesta.archivoURL !== '' ? { archivoURL: respuesta.archivoURL } : null
  }
  if (!conValor(respuesta)) return null
  const elegida = pregunta.opciones?.find((o) => o.id === respuesta)
  if (elegida?.esOtra) {
    return typeof otraTexto === 'string' && otraTexto.trim() !== ''
      ? { opcionSeleccionada: respuesta, otraTexto }
      : null
  }
  return { opcionSeleccionada: respuesta }
}

// { preguntaId: valorEsperado } solo de las preguntas contestadas.
export function esperadasDe(preguntas, respuestas, otraTextos) {
  const salida = {}
  preguntas.forEach((p) => {
    const v = valorEsperado(p, respuestas?.[p.id], otraTextos?.[p.id])
    if (v) salida[p.id] = v
  })
  return salida
}

// Compara lo que debería haber con lo persistido. `persistidas` = { id: datos }.
//   · faltantes: debería haber algo y no hay documento, o ese campo está vacío;
//   · distintas: hay algo pero no es lo que el estudiante marcó.
// Un documento persistido que el estudiante dejó en blanco NO se reclama aquí.
export function compararRespuestas(esperadas, persistidas) {
  const faltantes = []
  const distintas = []
  Object.entries(esperadas).forEach(([id, esperado]) => {
    const real = persistidas[id]
    Object.entries(esperado).forEach(([campo, valor]) => {
      if (!real || !conValor(real[campo])) { if (!faltantes.includes(id)) faltantes.push(id); return }
      if (real[campo] !== valor && !distintas.includes(id)) distintas.push(id)
    })
  })
  return { ok: faltantes.length === 0 && distintas.length === 0, faltantes, distintas }
}

// Lo que se escribe para devolver una pregunta a lo que el estudiante marcó.
export function camposDeValorEsperado(pregunta, esperado) {
  if (pregunta.tipo === 'respuesta_corta') return { textoRespuesta: esperado.textoRespuesta, opcionSeleccionada: null }
  if (pregunta.tipo === 'subir_archivo') return { archivoURL: esperado.archivoURL, opcionSeleccionada: null, textoRespuesta: null }
  return { opcionSeleccionada: esperado.opcionSeleccionada, textoRespuesta: null, otraTexto: esperado.otraTexto ?? null }
}

// Un solo envío a la vez: una segunda llamada mientras la primera corre recibe LA
// MISMA promesa (no abre otro envío). Al terminar queda libre, para poder
// reintentar tras un fallo.
export function crearEnvioUnico(fn) {
  let enCurso = null
  return (...args) => {
    if (enCurso) return enCurso
    enCurso = Promise.resolve().then(() => fn(...args)).finally(() => { enCurso = null })
    return enCurso
  }
}

const ESPERA_REINTENTOS_MS = [1500, 4000]

export function crearGuardador({
  db, submissionId, intento = null, escribir = setDoc, ahora = serverTimestamp,
  onCambio = () => {}, esperar = (ms) => new Promise((r) => setTimeout(r, ms)),
  esperasReintento = ESPERA_REINTENTOS_MS,
}) {
  const deseado = {}   // lo último que el estudiante quiere en cada pregunta
  const version = {}   // contador de intenciones por pregunta
  const escrita = {}   // versión que ya quedó guardada
  const estado = {}
  const errores = {}
  const cola = {}      // cadena de escrituras por pregunta (en orden)
  const automaticos = {}

  const refDe = (id) => doc(db, 'submissions', submissionId, 'respuestas', id)
  const avisar = () => onCambio({ ...estado })
  const marcar = (id, e) => { estado[id] = e; avisar() }

  async function escribirUltimo(id) {
    const v = version[id]
    if (escrita[id] === v) return
    try {
      await escribir(refDe(id), { ...deseado[id], ...(intento != null ? { intento } : {}), respondidaEn: ahora() }, { merge: true })
      escrita[id] = v
      delete errores[id]
      if (version[id] === v) { automaticos[id] = 0; marcar(id, ESTADO_GUARDADO.GUARDADA) }
    } catch (err) {
      errores[id] = err
      if (version[id] === v) marcar(id, ESTADO_GUARDADO.ERROR)
    }
  }

  function encolar(id) {
    cola[id] = (cola[id] || Promise.resolve()).then(() => escribirUltimo(id))
    return cola[id]
  }

  // Tras un fallo: reintenta solo, pocas veces. Si nada funciona la pregunta se
  // queda en «error» y el botón de reintentar la vuelve a intentar a mano.
  async function reintentoAutomatico(id) {
    const n = automaticos[id] || 0
    if (n >= esperasReintento.length || estado[id] !== ESTADO_GUARDADO.ERROR) return
    automaticos[id] = n + 1
    await esperar(esperasReintento[n])
    if (estado[id] !== ESTADO_GUARDADO.ERROR) return
    marcar(id, ESTADO_GUARDADO.GUARDANDO)
    await encolar(id)
    if (estado[id] === ESTADO_GUARDADO.ERROR) await reintentoAutomatico(id)
  }

  function guardar(id, campos) {
    deseado[id] = { ...deseado[id], ...campos }
    version[id] = (version[id] || 0) + 1
    marcar(id, ESTADO_GUARDADO.GUARDANDO)
    const p = encolar(id).then(() => (estado[id] === ESTADO_GUARDADO.ERROR ? reintentoAutomatico(id) : undefined))
    return p.then(() => estado[id] === ESTADO_GUARDADO.GUARDADA)
  }

  async function esperarTodo() {
    let previo
    do {
      previo = Object.values(cola)
      await Promise.all(previo)
    } while (Object.values(cola).length !== previo.length || Object.values(cola).some((p, i) => p !== previo[i]))
  }

  // Reintento a mano: la última intención de cada pregunta con error.
  async function reintentarTodo() {
    const ids = Object.keys(estado).filter((id) => estado[id] === ESTADO_GUARDADO.ERROR)
    ids.forEach((id) => { automaticos[id] = 0; marcar(id, ESTADO_GUARDADO.GUARDANDO) })
    await Promise.all(ids.map((id) => encolar(id)))
    return Object.keys(estado).filter((id) => estado[id] === ESTADO_GUARDADO.ERROR)
  }

  async function leerPersistidas() {
    const snap = await getDocsFromServer(collection(db, 'submissions', submissionId, 'respuestas'))
    const salida = {}
    snap.docs.forEach((d) => { salida[d.id] = d.data() })
    return salida
  }

  // Lee del SERVIDOR y compara con lo que el estudiante marcó.
  async function verificar(esperadas) {
    const persistidas = await leerPersistidas()
    return { ...compararRespuestas(esperadas, persistidas), persistidas }
  }

  // Vuelve a escribir lo que falta o difiere (con el valor que el estudiante marcó).
  async function restaurar(preguntas, esperadas, ids) {
    const porId = Object.fromEntries(preguntas.map((p) => [p.id, p]))
    await Promise.all(ids.filter((id) => esperadas[id] && porId[id]).map((id) => guardar(id, camposDeValorEsperado(porId[id], esperadas[id]))))
  }

  return {
    guardar, esperarTodo, reintentarTodo, verificar, restaurar,
    estados: () => ({ ...estado }),
    deseadoActual: () => JSON.parse(JSON.stringify(deseado)),
    pendientes: () => Object.keys(estado).filter((id) => estado[id] !== ESTADO_GUARDADO.GUARDADA),
    conError: () => Object.keys(estado).filter((id) => estado[id] === ESTADO_GUARDADO.ERROR),
    ultimoError: (id) => errores[id] || null,
  }
}

// ── Respaldo local ──────────────────────────────────────────────────────────
// Copia de lo que el estudiante marcó, en su dispositivo, hasta que el servidor
// lo confirma. Si se cierra la pestaña o se cae la red a media evaluación, al
// reabrir se recupera lo que no llegó. Sin localStorage (modo privado, cuota)
// no hace nada: es una red de seguridad, no una dependencia.
const clave = (submissionId, intento) => `ef:resp:${submissionId}:${intento ?? 1}`

export function guardarRespaldo(submissionId, intento, deseado) {
  try { localStorage.setItem(clave(submissionId, intento), JSON.stringify({ ts: Date.now(), respuestas: deseado })) } catch { /* sin respaldo */ }
}
export function leerRespaldo(submissionId, intento) {
  try {
    const crudo = localStorage.getItem(clave(submissionId, intento))
    return crudo ? JSON.parse(crudo) : null
  } catch { return null }
}
export function borrarRespaldo(submissionId, intento) {
  try { localStorage.removeItem(clave(submissionId, intento)) } catch { /* nada */ }
}

// Qué preguntas tienen contenido en el respaldo y NO en el servidor (o en blanco).
// `desde` (ms) descarta respaldos anteriores al inicio de ESTE intento.
export function respuestasPorRecuperar(respaldo, persistidas, desde = 0) {
  if (!respaldo || !respaldo.respuestas || (respaldo.ts || 0) < desde) return {}
  const salida = {}
  Object.entries(respaldo.respuestas).forEach(([id, campos]) => {
    const real = persistidas[id]
    ;['opcionSeleccionada', 'textoRespuesta', 'archivoURL'].forEach((campo) => {
      if (conValor(campos?.[campo]) && !(real && conValor(real[campo]))) salida[id] = campos
    })
  })
  return salida
}
