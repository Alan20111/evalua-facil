import { getDb, getAuth, verifyRequest } from '../_lib/firebaseAdmin.js'
import { extraerAssets, borrarAssets } from '../_lib/cloudinary.js'
import { aplicarCors } from '../_lib/cors.js'

// Eliminar la cuenta de un estudiante — solo si ya no está inscrito en
// ninguna asignatura.
//
// La condición no es un tecnicismo, es de fondo: las calificaciones, entregas
// y asistencias de un estudiante inscrito NO son suyas, son el registro
// académico de su maestro. Si el estudiante pudiera borrarlas, cualquiera con
// un mal parcial se borraría antes del cierre y le abriría un hueco a la
// lista del docente. Mientras tenga clases, la baja la decide el maestro
// (que ya tiene su acción "Eliminar estudiante"); esta cuenta solo se puede
// eliminar cuando ya no le queda ninguna, o sea cuando ya no hay registro
// académico de por medio.
//
// La comprobación se repite aquí aunque el cliente ya la haya hecho: un POST
// suelto a este endpoint no puede saltarse la regla.

const PALABRA_CONFIRMACION = 'ELIMINAR'

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return // preflight de la app
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const { uid } = await verifyRequest(req)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    if (String(body.confirmacion || '').trim().toUpperCase() !== PALABRA_CONFIRMACION) {
      return res.status(400).json({ error: 'Falta la confirmación.' })
    }

    const db = getDb()
    const auth = getAuth()

    const inscripciones = await db.collection('students').where('uid', '==', uid).get()
    if (!inscripciones.empty) {
      return res.status(409).json({
        error: 'Todavía estás inscrito en una asignatura. Pídele a tu maestro que te dé de baja.',
        inscripciones: inscripciones.size,
      })
    }

    // Sin inscripciones no queda de dónde leer la foto, así que el cliente
    // manda la que traía en pantalla; se comprueba que sea de Cloudinary
    // antes de intentar nada con ella.
    const assets = new Map()
    if (body.photoURL) extraerAssets({ url: body.photoURL }, assets)

    const refs = [db.collection('notificationSettings').doc(uid)]
    const bitacora = await db.collection('notificationLog').where('uid', '==', uid).get()
    bitacora.docs.forEach((d) => refs.push(d.ref))

    const batch = db.batch()
    refs.forEach((r) => batch.delete(r))
    await batch.commit()

    const archivos = await borrarAssets(assets, { origen: 'student/delete', uid })
    if (archivos.pendientes?.length) {
      console.warn(
        `[eliminar-alumno ${uid}] ${archivos.pendientes.length} archivos NO borrados de Cloudinary` +
        `${archivos.configurado === false ? ' (faltan CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)' : ''}: ` +
        archivos.pendientes.join(', ')
      )
    }

    // Al final, igual que en el borrado del docente: mientras la cuenta de
    // Auth exista, un fallo a media limpieza lo deja reintentando y no fuera.
    await auth.deleteUser(uid)

    return res.status(200).json({ ok: true, documentosEliminados: refs.length, archivos })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo eliminar la cuenta.' })
  }
}
