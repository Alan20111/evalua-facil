import app, { auth } from '../firebase'
import { apiUrl } from './apiBase'
import { nombreBucket } from '../config/miEspacio'

// Cliente de Mi espacio. Todo pasa por /api/student/mi-espacio-*, salvo la
// subida de los bytes, que va directo a Firebase Storage con el permiso
// (reserva) que acaba de dar el servidor. Ver api/_lib/miEspacio.js.

async function llamar(accion, body = {}) {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('Tu sesión terminó. Vuelve a entrar.')
  let res
  try {
    res = await fetch(apiUrl(`/api/student/${accion}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new Error('No hay conexión. Revisa tu internet e inténtalo de nuevo.', { cause: err })
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || 'No se pudo completar. Inténtalo de nuevo.')
  return data
}

// Firebase Storage se carga solo al subir: nadie más en la plataforma lo usa,
// así que no tiene por qué ir en el paquete principal.
let storagePromesa = null
function obtenerStorage() {
  if (!storagePromesa) {
    storagePromesa = import('firebase/storage').then((m) => {
      const storage = m.getStorage(app, `gs://${nombreBucket(app.options.projectId)}`)
      if (import.meta.env.VITE_EMULADORES === '1') m.connectStorageEmulator(storage, '127.0.0.1', 9199)
      return { storage, ref: m.ref, uploadBytesResumable: m.uploadBytesResumable }
    })
  }
  return storagePromesa
}

export const listarMiEspacio = () => llamar('mi-espacio-listar')

export const borrarDeMiEspacio = (fileId) => llamar('mi-espacio-borrar', { fileId })

// Reserva → sube → confirma. `onProgreso` recibe un número de 0 a 1.
export async function subirAMiEspacio(file, onProgreso) {
  const reserva = await llamar('mi-espacio-reservar', { nombre: file.name, tamano: file.size, tipo: file.type })
  try {
    const { storage, ref, uploadBytesResumable } = await obtenerStorage()
    await new Promise((resolve, reject) => {
      const tarea = uploadBytesResumable(ref(storage, reserva.ruta), file, { contentType: reserva.tipo })
      tarea.on('state_changed',
        (s) => onProgreso?.(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0),
        reject,
        resolve)
    })
  } catch (err) {
    // Libera la reserva para que no ocupe cuota. Si esto tampoco llega, la
    // reserva vence sola y se limpia al volver a abrir Mi espacio.
    llamar('mi-espacio-borrar', { fileId: reserva.fileId }).catch(() => {})
    throw new Error('No se pudo subir el archivo. Revisa tu conexión e inténtalo de nuevo.', { cause: err })
  }
  // Si la confirmación no llega, el archivo ya está a salvo: aparece solo la
  // próxima vez que se abra Mi espacio (el servidor lo concilia).
  return llamar('mi-espacio-confirmar', { fileId: reserva.fileId })
}
