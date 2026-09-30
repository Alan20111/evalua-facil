// Mi espacio — almacenamiento personal del estudiante (29-sep-2026).
//
// Único lugar donde viven los números y los textos de Mi espacio. Lo importan
// la pantalla (src/pages/student/MiEspacio.jsx), su cliente
// (src/utils/miEspacio.js) y el servidor (api/_lib/miEspacio.js): la cuota que
// se le muestra al estudiante y la que el servidor hace cumplir son la MISMA
// constante, no dos copias que se puedan desalinear.
//
// Mi espacio NO tiene nada que ver con las evidencias de las actividades:
// estas viven en Cloudinary (evalua-facil/submissions) y no cuentan aquí. Mi
// espacio vive en Firebase Storage, con su propia ruta y su propia cuota.

import { ALL_FILES_KEY, FILE_TYPE_BASE_OPTIONS, isFileAllowed, resolveFileTypes } from './fileTypes.js'

const MB = 1024 * 1024

// Cuota lógica por estudiante. No se reserva nada físicamente: es el tope de
// la suma de sus archivos.
export const MI_ESPACIO_CUOTA_BYTES = 100 * MB

// Tope por archivo.
export const MI_ESPACIO_MAX_ARCHIVO_BYTES = 25 * MB

// Cuánto vale el permiso de subida que da el servidor. Después de esto la
// regla de Storage ya no deja subir con él, y la reserva se libera la próxima
// vez que el estudiante abra Mi espacio.
export const MI_ESPACIO_RESERVA_MS = 60 * 60 * 1000

// Cuántas subidas puede tener a medias un estudiante a la vez. Evita que un
// cliente abra reservas sin fin; en la pantalla se sube de una en una.
export const MI_ESPACIO_MAX_RESERVAS = 5

// Vigencia de los enlaces de descarga que firma el servidor. La pantalla
// vuelve a pedir la lista antes de que caduquen.
export const MI_ESPACIO_ENLACE_MS = 60 * 60 * 1000

// Carpeta de Storage. Todo lo de un estudiante cuelga de su uid de Firebase
// Auth: mi-espacio/{uid}/{fileId}. Ni la escuela ni la inscripción forman
// parte de la ruta — un estudiante tiene una inscripción por asignatura, pero
// una sola cuenta, y Mi espacio es de la cuenta.
export const MI_ESPACIO_CARPETA = 'mi-espacio'
export const prefijoMiEspacio = (uid) => `${MI_ESPACIO_CARPETA}/${uid}/`
export const rutaMiEspacio = (uid, fileId) => `${prefijoMiEspacio(uid)}${fileId}`

// Bucket de Firebase Storage del proyecto. Los buckets que Firebase crea
// desde oct-2024 se llaman {projectId}.firebasestorage.app.
export const nombreBucket = (projectId) => `${projectId}.firebasestorage.app`

// Tipos permitidos: los mismos que ya maneja la plataforma para las entregas
// (FILE_TYPE_BASE_OPTIONS, modo "todos"): JPG, PNG, PDF, Word, PowerPoint,
// Excel, ZIP y RAR. Sin audio ni video.
export const MI_ESPACIO_TIPOS = ALL_FILES_KEY
export const MI_ESPACIO_ACCEPT = resolveFileTypes(MI_ESPACIO_TIPOS).accept

export const MI_ESPACIO_MENSAJES = {
  sinEspacio: 'No hay suficiente espacio en Mi espacio. Elimina algún archivo para poder subir otro.',
  muyGrande: 'Ese archivo pesa más de 25 MB. Sube uno más ligero.',
  tipo: 'Ese tipo de archivo no se puede guardar. Puedes subir fotos (JPG, PNG), PDF, Word, PowerPoint, Excel, ZIP o RAR.',
  vacio: 'Ese archivo está vacío.',
  muchasSubidas: 'Espera a que terminen tus otras subidas.',
  noDisponible: 'Mi espacio no está disponible por ahora. Inténtalo más tarde.',
  noSubido: 'El archivo no terminó de subir. Inténtalo de nuevo.',
}

const extension = (nombre) => {
  const partes = String(nombre || '').split('.')
  return partes.length > 1 ? partes.pop().toLowerCase() : ''
}

// Tipo MIME con el que se guarda el archivo, o null si no se permite.
//
// Exige las dos cosas: extensión permitida (es lo que decide con qué programa
// se abre al descargarlo) y que isFileAllowed lo acepte. Si el navegador no
// trae el tipo, o trae uno raro (pasa con los RAR), se usa el tipo canónico de
// su extensión, así el servidor y la regla de Storage comparan contra un valor
// que no depende del teléfono.
export function tipoMiEspacio({ name, type }) {
  const { mimes, exts } = resolveFileTypes(MI_ESPACIO_TIPOS)
  const ext = extension(name)
  if (!exts.includes(ext) || !isFileAllowed({ name, type }, MI_ESPACIO_TIPOS)) return null
  if (type && mimes.includes(type)) return type
  return FILE_TYPE_BASE_OPTIONS.find((o) => o.exts.includes(ext))?.mimes[0] ?? null
}

// Motivo por el que un archivo no se puede subir, o null si se puede. La
// pantalla lo usa para avisar antes de subir; el servidor lo vuelve a
// comprobar (y además cuenta las subidas en curso, que la pantalla no ve).
export function motivoRechazoMiEspacio({ name, type, size }, usadoBytes = 0) {
  if (!tipoMiEspacio({ name, type })) return MI_ESPACIO_MENSAJES.tipo
  if (!(size > 0)) return MI_ESPACIO_MENSAJES.vacio
  if (size > MI_ESPACIO_MAX_ARCHIVO_BYTES) return MI_ESPACIO_MENSAJES.muyGrande
  if (usadoBytes + size > MI_ESPACIO_CUOTA_BYTES) return MI_ESPACIO_MENSAJES.sinEspacio
  return null
}
