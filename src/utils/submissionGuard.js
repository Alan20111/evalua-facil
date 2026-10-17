// Guardián de las escrituras del docente sobre `submissions`.
//
// Caso real (sep-2026): las pantallas del docente leen las entregas una vez y
// actúan sobre ese estado. Como el id de una submission es fijo
// (`{actividadId}_{alumnoId}`, ver submissionId.js), una acción pensada para
// lo que el docente VIO cae sobre lo que hay AHORA: "Anular" borraba la
// entrega que el alumno acababa de subir, y "calificar sin entrega" la
// convertía en sinEntrega:true. firestore.rules ya impide tocar la evidencia
// (docenteRespetaEvidencia), pero no puede saber qué vio el docente — eso es
// lo que resuelve este módulo: cada escritura vuelve a leer el documento
// dentro de una transacción y se detiene si ya no es el que el docente tenía
// en pantalla. Firestore reintenta la transacción si alguien escribe entre la
// lectura y el commit, así que no queda ventana.
//
// Solo depende de `firebase/firestore` y recibe `db` como parámetro: corre
// igual en la app y en las pruebas contra el emulador
// (test/firestore-rules.test.mjs, bloque GUARDIÁN).
import { runTransaction, getDoc, doc, serverTimestamp } from 'firebase/firestore'

// ── Funciones puras ───────────────────────────────────────────────────────────

// Misma definición que tieneEvidencia() en firestore.rules: solo los campos de
// la entrega de ARCHIVO o de ENLACE. Cuestionarios y juegos guardan lo suyo en
// otra parte.
export function tieneEvidencia(sub) {
  return !!sub && (
    sub.archivoURL != null ||
    sub.enlaceURL != null ||
    (Array.isArray(sub.archivos) && sub.archivos.length > 0) ||
    sub.completadoSinArchivo === true
  )
}

// ¿Puede recibir "sin entrega" en una asignación masiva? Sin documento, o un
// documento sin evidencia y sin calificación. Conserva la semántica de hoy
// para cuestionarios y juegos en curso (sin evidencia, sin calificación →
// elegibles) y deja fuera la entrega real sin calificar, que antes se
// sobrescribía y perdía su archivo.
export function elegibleSinEntrega(sub) {
  if (!sub) return true
  return !tieneEvidencia(sub) && sub.calificacion == null
}

function milis(t) {
  if (t == null) return null
  if (typeof t.toMillis === 'function') return t.toMillis()
  if (typeof t.seconds === 'number') return t.seconds * 1000 + Math.floor((t.nanoseconds || 0) / 1e6)
  return String(t)
}

// Huella de "qué entrega es": cambia si llega una entrega nueva o empieza un
// intento nuevo, NO si alguien la califica o comenta (eso no debe detener a
// nadie). `null` = no hay documento.
export function firmaEntrega(sub) {
  if (!sub) return null
  return JSON.stringify([
    milis(sub.fechaEntrega),
    sub.archivoURL ?? null,
    sub.enlaceURL ?? null,
    Array.isArray(sub.archivos) ? sub.archivos.map((a) => a?.url ?? null) : null,
    sub.completadoSinArchivo === true,
    sub.sinEntrega === true,
    sub.estadoEvaluacion ?? null,
    sub.intentoActual ?? null,
    Array.isArray(sub.intentos) ? sub.intentos.length : 0,
    milis(sub.tiempoInicio),
  ])
}

// La operación se detuvo porque el documento ya no es el que el docente vio.
// `motivo`: 'ya-existe' (se iba a crear y ya hay uno) | 'cambio' (la huella
// no coincide) | 'no-existe' (ya no está). `actual` = el documento de hoy
// ({ id, ...data }) o null.
export class EntregaCambio extends Error {
  constructor(motivo, actual) {
    super(motivo === 'ya-existe'
      ? 'Este estudiante ya tiene una entrega'
      : motivo === 'no-existe'
        ? 'Esta entrega ya no existe'
        : 'La entrega cambió desde que la abriste')
    this.name = 'EntregaCambio'
    this.motivo = motivo
    this.actual = actual
  }
}

const conId = (snap) => (snap.exists() ? { id: snap.id, ...snap.data() } : null)

// ── Operaciones protegidas ────────────────────────────────────────────────────

// Crea el documento SOLO si no existe. Devuelve lo que quedó guardado (con la
// fecha real del servidor: si se guardara el `serverTimestamp()` local, la
// siguiente comparación de huella fallaría sin razón).
export async function crearSiNoExiste(db, ref, data) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (snap.exists()) throw new EntregaCambio('ya-existe', conId(snap))
    tx.set(ref, data)
  })
  return conId(await getDoc(ref))
}

function comprobar(snap, visto) {
  if (!snap.exists()) throw new EntregaCambio('no-existe', null)
  const actual = conId(snap)
  if (firmaEntrega(actual) !== firmaEntrega(visto)) throw new EntregaCambio('cambio', actual)
  return actual
}

// Actualiza SOLO si el documento sigue siendo el que el docente vio.
export async function actualizarSiNoCambio(db, ref, visto, patch) {
  await runTransaction(db, async (tx) => {
    comprobar(await tx.get(ref), visto)
    tx.update(ref, patch)
  })
}

// Fija a mano los puntos de UN reactivo y recalcula la entrega, todo en una sola
// transacción. Antes saveGrade escribía la respuesta y luego la entrega en dos
// pasos, y reescribía `intentos[]` con la copia que la pantalla cargó al abrir
// la revisión: si el estudiante cerraba un intento nuevo en ese lapso, el
// arreglo del docente lo borraba. Ahora:
//   · la entrega y TODAS las respuestas del intento se releen dentro de la
//     transacción, y el parche se calcula desde lo que hay AHORA;
//   · si la entrega ya no es la que el docente tenía en pantalla (intento nuevo,
//     otra entrega) se detiene con EntregaCambio y no escribe nada;
//   · los puntos de la respuesta y el parche de la entrega van juntos: o los dos
//     o ninguno.
// `calcular(actual, respuestas)` recibe la entrega y las respuestas FRESCAS
// ({ preguntaId: datos }, ya con los puntos nuevos) y devuelve el parche.
export async function guardarPuntosManuales(db, ref, visto, { respuestaRef, respuestaPatch, respuestasRefs, calcular }) {
  return runTransaction(db, async (tx) => {
    const actual = comprobar(await tx.get(ref), visto)
    const lecturas = await Promise.all(respuestasRefs.map((r) => tx.get(r)))
    const respuestas = {}
    respuestasRefs.forEach((r, i) => { if (lecturas[i].exists()) respuestas[r.id] = lecturas[i].data() })
    respuestas[respuestaRef.id] = { ...(respuestas[respuestaRef.id] || {}), ...respuestaPatch }
    const patch = calcular(actual, respuestas)
    tx.set(respuestaRef, respuestaPatch, { merge: true })
    tx.update(ref, patch)
    return { patch, respuestas }
  })
}

// Datos de la traza cuando es el DOCENTE quien anula una entrega. Queda en
// `entregasAnuladas` —la misma colección donde el estudiante deja la suya— con
// lo necesario para reconstruir lo ocurrido: qué nota y qué estado tenía, sus
// intentos, quién la anuló y cuándo (la fecha la pone el servidor; las reglas la
// comparan con `request.time`). Los campos que no existen en esa entrega no se
// escriben (Firestore no acepta `undefined`).
const CAMPOS_TRAZA_DOCENTE = [
  'estadoEvaluacion', 'intentoActual', 'intentos', 'pendienteRevision', 'politicaAplicada',
  'ultimaCalificacionPor', 'sinEntrega', 'motivoSinEntrega', 'comentario', 'rubricaEval',
  'respuestasJuego', 'tiempoSegundos', 'archivoURL', 'nombreArchivo', 'archivos', 'enlaceURL',
  'completadoSinArchivo',
]

export function datosTrazaAnulacionDocente(actual, { actividadId, alumnoId, uid }) {
  const traza = {
    actividadId,
    alumnoId,
    submissionId: actual.id,
    anuladaPor: 'docente',
    anuladoPorUid: uid,
    fechaAnulacion: serverTimestamp(),
    fechaEntrega: actual.fechaEntrega ?? null,
    tarde: actual.tarde === true,
    estadoAnterior: actual.estado ?? null,
    calificacionAnterior: actual.calificacion ?? null,
  }
  CAMPOS_TRAZA_DOCENTE.forEach((k) => { if (actual[k] !== undefined) traza[k] = actual[k] })
  return traza
}

// Borra SOLO si el documento sigue siendo el que el docente vio. `extras`
// (p. ej. las `respuestas` de un cuestionario) se borran en la misma
// transacción: todo o nada.
//
// `traza` = { ref, construir(actual) }: si viene, la traza se crea en ESA misma
// transacción —con una copia de las `extras` (las respuestas) bajo
// `{traza}/respuestas`— así que la entrega nunca se borra sin dejar registro, y
// si la traza no se puede escribir (reglas, red) no se borra nada.
export async function borrarSiNoCambio(db, ref, visto, { extras = [], traza = null } = {}) {
  await runTransaction(db, async (tx) => {
    const actual = comprobar(await tx.get(ref), visto)
    if (traza) {
      const copias = await Promise.all(extras.map((r) => tx.get(r)))
      tx.set(traza.ref, traza.construir(actual))
      copias.forEach((s, i) => { if (s.exists()) tx.set(doc(traza.ref, 'respuestas', extras[i].id), s.data()) })
    }
    extras.forEach((r) => tx.delete(r))
    tx.delete(ref)
  })
}

// "Sin entrega" en bloque (asignación masiva, cierre de parcial). Cada bloque
// es una transacción que lee a todos y escribe SOLO a los que `esElegible`
// acepta con el documento de ese momento — con el mismo `set` (sin merge) y
// el mismo contenido que se usaba antes. Si alguien entrega a mitad,
// Firestore reintenta y el reintento lo excluye.
// items: [{ ref, alumnoId, data }]
export async function sinEntregaEnLote(db, items, esElegible, { tamano = 400 } = {}) {
  const escritos = []
  const omitidos = []
  for (let i = 0; i < items.length; i += tamano) {
    const bloque = items.slice(i, i + tamano)
    const resultado = await runTransaction(db, async (tx) => {
      const snaps = await Promise.all(bloque.map((it) => tx.get(it.ref)))
      const w = []
      const o = []
      bloque.forEach((it, k) => {
        const actual = conId(snaps[k])
        if (esElegible(actual)) {
          tx.set(it.ref, it.data)
          w.push(it.alumnoId)
        } else {
          o.push({ alumnoId: it.alumnoId, motivo: tieneEvidencia(actual) ? 'entregado' : 'con-registro', actual })
        }
      })
      return { w, o }
    })
    escritos.push(...resultado.w)
    omitidos.push(...resultado.o)
  }
  return { escritos, omitidos }
}
