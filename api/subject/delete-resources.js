import { getDb, verifyRequest } from '../_lib/firebaseAdmin.js'
import { extraerAssets, borrarAssets } from '../_lib/cloudinary.js'
import { aplicarCors } from '../_lib/cors.js'

// Borra los `resources` y `materials` de UNA asignatura, y sus archivos en
// Cloudinary — el paso que le faltaba a deleteSubjectCascade.js (A12 H1).
//
// El resto de la cascada (activities, students, attendance, submissions,
// horarioBloques) sigue borrándose en el cliente: esas colecciones no suben
// nada a Cloudinary por sí mismas, así que el navegador ya las deja limpias
// del todo con solo borrar el documento. `resources`/`materials` sí guardan
// archivos (url / archivos[]), y borrar en Cloudinary exige
// CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET, que nunca viven en el cliente
// (mismo motivo que api/student/remove-photo.js) — de ahí que este paso, y
// solo este, tenga que pasar por el servidor.
//
// Se llama ANTES de que el cliente borre el resto de la asignatura: solo
// aquí se puede leer resources/materials para sacar sus URLs antes de que
// desaparezcan.

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return // preflight de la app
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const { uid } = await verifyRequest(req)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const subjectId = String(body.subjectId || '').trim()
    if (!subjectId) {
      return res.status(400).json({ error: 'Falta subjectId.' })
    }

    const db = getDb()

    // La asignatura tiene que ser de quien pide el borrado — un docente no
    // puede vaciar Cloudinary de la asignatura de otro con un POST directo.
    const subjectDoc = await db.collection('subjects').doc(subjectId).get()
    if (!subjectDoc.exists || subjectDoc.data().docenteId !== uid) {
      return res.status(403).json({ error: 'Esta asignatura no es tuya.' })
    }

    const [recursos, materiales] = await Promise.all([
      db.collection('resources').where('asignaturaId', '==', subjectId).get(),
      db.collection('materials').where('asignaturaId', '==', subjectId).get(),
    ])

    const assets = new Map()
    recursos.docs.forEach((d) => extraerAssets(d.data(), assets))
    materiales.docs.forEach((d) => extraerAssets(d.data(), assets))

    const batch = db.batch()
    recursos.docs.forEach((d) => batch.delete(d.ref))
    materiales.docs.forEach((d) => batch.delete(d.ref))
    if (recursos.size || materiales.size) await batch.commit()

    const archivos = await borrarAssets(assets, { origen: 'subject/delete-resources', uid })
    if (archivos.pendientes?.length) {
      console.warn(
        `[borrar-asignatura ${subjectId}] ${archivos.pendientes.length} archivos NO borrados de Cloudinary` +
        `${archivos.configurado === false ? ' (faltan CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)' : ''}: ` +
        archivos.pendientes.join(', ')
      )
    }

    return res.status(200).json({
      ok: true, recursos: recursos.size, materiales: materiales.size, archivos,
    })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudieron borrar los recursos.' })
  }
}
