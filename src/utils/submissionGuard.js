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
import { runTransaction, getDoc } from 'firebase/firestore'

// ── Funciones puras ───────────────────────────────────────────────────────────

// Misma definición que tieneEvidencia() en firestore.rules: solo los campos de
// la entrega de ARCHIVO. Cuestionarios y juegos guardan lo suyo en otra parte.
export function tieneEvidencia(sub) {
  return !!sub && (
    sub.archivoURL != null ||
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

// Borra SOLO si el documento sigue siendo el que el docente vio. `extras`
// (p. ej. las `respuestas` de un cuestionario) se borran en la misma
// transacción: todo o nada.
export async function borrarSiNoCambio(db, ref, visto, { extras = [] } = {}) {
  await runTransaction(db, async (tx) => {
    comprobar(await tx.get(ref), visto)
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
