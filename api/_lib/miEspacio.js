import { admin } from './firebaseAdmin.js'
import {
  MI_ESPACIO_CUOTA_BYTES, MI_ESPACIO_MAX_RESERVAS, MI_ESPACIO_RESERVA_MS, MI_ESPACIO_ENLACE_MS,
  MI_ESPACIO_MENSAJES, motivoRechazoMiEspacio, tipoMiEspacio, prefijoMiEspacio, rutaMiEspacio,
} from '../../src/config/miEspacio.js'

// Mi espacio — lado del servidor (29-sep-2026). Ver src/config/miEspacio.js.
//
// Quién escribe qué:
//   · miEspacioArchivos/{fileId} — un documento por archivo, con su dueño
//     (`uid`). Nace como `reservado` cuando el estudiante pide subir y pasa a
//     `listo` cuando el archivo ya está en Storage.
//   · miEspacio/{uid} — resumen: bytes usados y número de archivos. Además es
//     el CANDADO de la cuota: toda transacción que cambia archivos de un
//     estudiante lo lee y lo escribe, así que dos transacciones del mismo
//     estudiante nunca se cruzan — la segunda se repite con lo que dejó la
//     primera.
// Los dos solo los escribe este archivo (Admin SDK). Las reglas de Firestore
// no dejan a ningún cliente leerlos ni escribirlos.
//
// Cómo se protege la cuota:
//   1. `reservar` suma, DENTRO de una transacción, los archivos listos más las
//      subidas a medias, y rechaza si el nuevo archivo no cabe. Dos subidas
//      simultáneas que juntas se pasen de 100 MB: una entra y la otra no.
//   2. La regla de Storage (storage.rules) solo deja crear
//      mi-espacio/{uid}/{fileId} si existe esa reserva, es de ese uid, no ha
//      vencido, y el archivo pesa EXACTAMENTE lo reservado y trae el tipo
//      reservado. Sin reserva no se sube nada, ni saltándose la pantalla.
//   3. `confirmar` lee el tamaño REAL del objeto en Storage y con ese queda.
//
// Lo que se sale del camino feliz se arregla en `conciliar`, que corre cada
// vez que el estudiante abre Mi espacio (ver sus comentarios).

const RESUMEN = 'miEspacio'
const ARCHIVOS = 'miEspacioArchivos'

// Margen para no confundir "todavía se está subiendo" con "quedó a medias".
const MARGEN_MS = 10 * 60 * 1000

export class ErrorMiEspacio extends Error {
  constructor(status, mensaje) {
    super(mensaje)
    this.status = status
  }
}

// ¿El error es "el bucket no existe"? Pasa mientras Storage no esté activado
// en el proyecto: no hay nada guardado y no hay nada que borrar.
const esNoEncontrado = (err) => err?.code === 404 || err?.code === '404' || /not ?found|does not exist/i.test(err?.message || '')

// runTransaction con un reintento propio para el choque entre dos
// transacciones del mismo estudiante. El SDK ya reintenta ABORTED, pero el
// emulador de Firestore cierra la transacción perdedora y responde
// INVALID_ARGUMENT "Transaction is invalid or closed", que el SDK no reintenta
// (visto el 29-sep-2026 en la prueba de dos subidas simultáneas). Se reintenta
// SOLO ese caso y ABORTED; cualquier otro error (incluido ErrorMiEspacio, como
// "sin espacio") sale tal cual. Reintentar es seguro: la transacción completa
// vuelve a leer y a decidir.
async function transaccion(db, fn) {
  for (let intento = 1; ; intento++) {
    try {
      return await db.runTransaction(fn)
    } catch (err) {
      const choque = err?.code === 10 || (err?.code === 3 && /invalid or closed/i.test(err.message || ''))
      if (!choque || intento >= 3) throw err
      await new Promise((r) => setTimeout(r, 50 * intento + Math.random() * 100))
    }
  }
}

function ms(valor) {
  if (!valor) return 0
  if (typeof valor.toMillis === 'function') return valor.toMillis()
  if (valor instanceof Date) return valor.getTime()
  return Number(valor) || 0
}

// Resumen a partir de los documentos (ya con el cambio aplicado en memoria).
function resumenDe(uid, datos) {
  const listos = datos.filter((d) => d.estado === 'listo')
  return {
    uid,
    usadoBytes: listos.reduce((s, d) => s + (Number(d.tamano) || 0), 0),
    archivos: listos.length,
    actualizado: admin.firestore.FieldValue.serverTimestamp(),
  }
}

// Lee (dentro de la transacción) el candado y todos los documentos del
// estudiante. Todas las lecturas antes que cualquier escritura.
async function leerTodo(tx, db, uid) {
  const resumenRef = db.collection(RESUMEN).doc(uid)
  const [, snap] = await Promise.all([
    tx.get(resumenRef),
    tx.get(db.collection(ARCHIVOS).where('uid', '==', uid)),
  ])
  return { resumenRef, docs: snap.docs }
}

function limpiarNombre(nombre) {
  // Solo el nombre, sin rutas ni caracteres de control; es texto que se
  // muestra y se usa al descargar.
  const base = String(nombre || '').split(/[\\/]/).pop()
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180)
}

// ── Reservar ────────────────────────────────────────────────────────────────
export async function reservar(db, uid, { nombre, tamano, tipo }, escuelaId = null) {
  const limpio = limpiarNombre(nombre)
  const bytes = Number(tamano)
  if (!limpio || !Number.isSafeInteger(bytes)) throw new ErrorMiEspacio(400, 'Datos del archivo incompletos.')
  const tipoFinal = tipoMiEspacio({ name: limpio, type: String(tipo || '') })
  // La cuota se revisa abajo, dentro de la transacción; aquí solo tipo/tamaño.
  const motivo = motivoRechazoMiEspacio({ name: limpio, type: String(tipo || ''), size: bytes }, 0)
  if (motivo) throw new ErrorMiEspacio(motivo === MI_ESPACIO_MENSAJES.tipo ? 415 : 413, motivo)

  const ref = db.collection(ARCHIVOS).doc()
  const ruta = rutaMiEspacio(uid, ref.id)
  const venceEn = admin.firestore.Timestamp.fromMillis(Date.now() + MI_ESPACIO_RESERVA_MS)

  await transaccion(db, async (tx) => {
    const { resumenRef, docs } = await leerTodo(tx, db, uid)
    const datos = docs.map((d) => d.data())
    const ocupado = datos.reduce((s, d) => s + (Number(d.tamano) || 0), 0) // listos + reservados
    const reservas = datos.filter((d) => d.estado === 'reservado').length
    if (reservas >= MI_ESPACIO_MAX_RESERVAS) throw new ErrorMiEspacio(429, MI_ESPACIO_MENSAJES.muchasSubidas)
    if (ocupado + bytes > MI_ESPACIO_CUOTA_BYTES) throw new ErrorMiEspacio(409, MI_ESPACIO_MENSAJES.sinEspacio)

    tx.set(ref, {
      uid,
      escuelaId: escuelaId || null, // informativo; no es parte de la identidad
      nombre: limpio,
      tamano: bytes,
      tipo: tipoFinal,
      ruta,
      estado: 'reservado',
      creado: admin.firestore.FieldValue.serverTimestamp(),
      venceEn,
    })
    // Escribir el resumen es lo que hace de candado (ver arriba).
    tx.set(resumenRef, resumenDe(uid, datos), { merge: true })
  })

  return { fileId: ref.id, ruta, tipo: tipoFinal }
}

// ── Confirmar ───────────────────────────────────────────────────────────────
// Pasa una reserva a `listo` con el tamaño real que tiene en Storage.
async function promover(db, uid, fileId, tamanoReal) {
  const ref = db.collection(ARCHIVOS).doc(fileId)
  await transaccion(db, async (tx) => {
    const { resumenRef, docs } = await leerTodo(tx, db, uid)
    const actual = docs.find((d) => d.id === fileId)
    if (!actual) throw new ErrorMiEspacio(404, 'Ese archivo ya no existe.')
    const datos = docs.map((d) => (d.id === fileId
      ? { ...d.data(), estado: 'listo', tamano: tamanoReal }
      : d.data()))
    tx.update(ref, {
      estado: 'listo',
      tamano: tamanoReal,
      confirmado: admin.firestore.FieldValue.serverTimestamp(),
      venceEn: admin.firestore.FieldValue.delete(),
    })
    tx.set(resumenRef, resumenDe(uid, datos), { merge: true })
  })
}

export async function confirmar(db, bucket, uid, fileId) {
  const snap = await db.collection(ARCHIVOS).doc(String(fileId || '')).get()
  if (!snap.exists || snap.data().uid !== uid) throw new ErrorMiEspacio(404, 'Ese archivo ya no existe.')
  const d = snap.data()
  if (d.estado === 'listo') return { fileId: snap.id }

  const archivo = bucket.file(d.ruta)
  const [existe] = await archivo.exists()
  if (!existe) throw new ErrorMiEspacio(409, MI_ESPACIO_MENSAJES.noSubido)
  const [meta] = await archivo.getMetadata()
  const real = Number(meta.size)
  // La regla de Storage exige tamaño == reservado; si aun así no cuadra, el
  // archivo no se queda (no hay forma de que haya pasado por la regla).
  if (real !== Number(d.tamano)) {
    await borrar(db, bucket, uid, snap.id)
    throw new ErrorMiEspacio(409, MI_ESPACIO_MENSAJES.noSubido)
  }
  await promover(db, uid, snap.id, real)
  return { fileId: snap.id }
}

// ── Borrar ──────────────────────────────────────────────────────────────────
// Primero el objeto, después el documento: si Storage falla, el documento se
// queda y el estudiante puede reintentar; nunca queda un archivo sin dueño
// visible. Si el objeto ya no existía, se limpia el documento igual.
export async function borrar(db, bucket, uid, fileId) {
  const ref = db.collection(ARCHIVOS).doc(String(fileId || ''))
  const snap = await ref.get()
  if (!snap.exists) return { ok: true }
  // Un archivo ajeno responde igual que uno inexistente: no se confirma que
  // exista algo con ese id.
  if (snap.data().uid !== uid) throw new ErrorMiEspacio(404, 'Ese archivo ya no existe.')

  try {
    await bucket.file(snap.data().ruta).delete()
  } catch (err) {
    if (!esNoEncontrado(err)) throw err
  }

  await transaccion(db, async (tx) => {
    const { resumenRef, docs } = await leerTodo(tx, db, uid)
    const datos = docs.filter((d) => d.id !== ref.id).map((d) => d.data())
    if (docs.some((d) => d.id === ref.id)) tx.delete(ref)
    tx.set(resumenRef, resumenDe(uid, datos), { merge: true })
  })
  return { ok: true }
}

// ── Conciliar ───────────────────────────────────────────────────────────────
// Pone de acuerdo los documentos con lo que de verdad hay en Storage:
//   · reserva cuyo archivo YA está en Storage → `listo` (la subida terminó
//     pero la confirmación no llegó: se cerró la pestaña, se cayó la red).
//   · reserva vencida sin archivo → se borra (subida abandonada o fallida).
//   · `listo` cuyo archivo ya no está → se borra el documento (metadata sin
//     archivo). Solo si se confirmó hace rato, para no pisar una confirmación
//     que ocurrió mientras se listaba Storage.
//   · archivo sin documento y con más de MARGEN_MS → se borra el objeto
//     (archivo sin metadata: no cuenta en la cuota, así que no puede quedarse).
// Todos los cambios a documentos van en UNA transacción sobre el candado.
// `ahora` existe para las pruebas (simular que pasó el tiempo); en producción
// siempre es el reloj real.
export async function conciliar(db, bucket, uid, ahora = Date.now()) {
  const inicio = ahora
  let objetos
  try {
    ;[objetos] = await bucket.getFiles({ prefix: prefijoMiEspacio(uid) })
  } catch (err) {
    if (esNoEncontrado(err)) throw new ErrorMiEspacio(503, MI_ESPACIO_MENSAJES.noDisponible)
    throw err
  }
  const enStorage = new Map(objetos.map((f) => [f.name, {
    tamano: Number(f.metadata?.size) || 0,
    creado: Date.parse(f.metadata?.timeCreated || '') || 0,
  }]))

  const huerfanos = []
  await transaccion(db, async (tx) => {
    huerfanos.length = 0
    const { resumenRef, docs } = await leerTodo(tx, db, uid)
    const rutasConDoc = new Set(docs.map((d) => d.data().ruta))
    const quedan = []
    for (const d of docs) {
      const x = d.data()
      const obj = enStorage.get(x.ruta)
      if (x.estado === 'reservado') {
        if (obj && obj.tamano === Number(x.tamano)) {
          tx.update(d.ref, {
            estado: 'listo',
            tamano: obj.tamano,
            confirmado: admin.firestore.FieldValue.serverTimestamp(),
            venceEn: admin.firestore.FieldValue.delete(),
          })
          quedan.push({ ...x, estado: 'listo', tamano: obj.tamano })
        } else if (!obj && ms(x.venceEn) + MARGEN_MS < inicio) {
          tx.delete(d.ref)
        } else {
          quedan.push(x)
        }
      } else if (!obj && ms(x.confirmado) + MARGEN_MS < inicio) {
        tx.delete(d.ref)
      } else {
        quedan.push(x)
      }
    }
    for (const [nombre, obj] of enStorage) {
      if (!rutasConDoc.has(nombre) && obj.creado + MARGEN_MS < inicio) huerfanos.push(nombre)
    }
    tx.set(resumenRef, resumenDe(uid, quedan), { merge: true })
  })

  await Promise.all(huerfanos.map((n) => bucket.file(n).delete().catch((err) => {
    if (!esNoEncontrado(err)) console.warn(`[mi-espacio ${uid}] no se pudo borrar el objeto huérfano ${n}: ${err.message}`)
  })))
}

// ── Listar ──────────────────────────────────────────────────────────────────
function disposicion(nombre) {
  const ascii = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]|["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`
}

export async function listar(db, bucket, uid, ahora = Date.now()) {
  await conciliar(db, bucket, uid, ahora)
  const snap = await db.collection(ARCHIVOS).where('uid', '==', uid).get()
  const listos = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => d.estado === 'listo')
    .sort((a, b) => ms(b.creado) - ms(a.creado))

  const expira = Date.now() + MI_ESPACIO_ENLACE_MS
  const archivos = await Promise.all(listos.map(async (d) => {
    const [url] = await bucket.file(d.ruta).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expira,
      responseDisposition: disposicion(d.nombre),
    })
    return { id: d.id, nombre: d.nombre, tamano: d.tamano, tipo: d.tipo, creado: ms(d.creado), url }
  }))
  return {
    archivos,
    usadoBytes: archivos.reduce((s, a) => s + a.tamano, 0),
    cuotaBytes: MI_ESPACIO_CUOTA_BYTES,
  }
}

// ── Borrar todo (cuenta eliminada) ──────────────────────────────────────────
// Lo llaman los tres caminos que borran la cuenta de Auth de un estudiante:
// api/student/[action].js (handleDelete), api/account/delete.js y
// api/admin/[action].js (borrarAlumnosHuerfanos). Lanza si Storage falla, para
// que el borrado de la cuenta se detenga ANTES de borrar el Auth y se pueda
// reintentar — mismo criterio que el resto de esos endpoints.
export async function borrarTodo(db, bucket, uid) {
  try {
    await bucket.deleteFiles({ prefix: prefijoMiEspacio(uid) })
  } catch (err) {
    if (!esNoEncontrado(err)) throw err
  }
  const snap = await db.collection(ARCHIVOS).where('uid', '==', uid).get()
  const refs = [...snap.docs.map((d) => d.ref), db.collection(RESUMEN).doc(uid)]
  for (let i = 0; i < refs.length; i += 400) {
    const lote = db.batch()
    refs.slice(i, i + 400).forEach((r) => lote.delete(r))
    await lote.commit()
  }
  return { documentos: snap.size }
}
