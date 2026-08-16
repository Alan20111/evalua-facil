import { getDb, verifyRequest } from '../_lib/firebaseAdmin.js'
import { extraerAssets, borrarAssets } from '../_lib/cloudinary.js'
import { aplicarCors } from '../_lib/cors.js'

// Borra UNA fuente del Asistente IA (fuentesAsignatura) y su archivo en
// Cloudinary — mismo motivo que api/subject/delete-resources.js: borrar en
// Cloudinary exige CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET, que nunca viven
// en el cliente. Sin este paso, quitar una fuente solo borraba el documento
// de Firestore y el PDF/Word se quedaba huérfano en Cloudinary para siempre.

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return // preflight de la app
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const { uid } = await verifyRequest(req)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const fuenteId = String(body.fuenteId || '').trim()
    if (!fuenteId) {
      return res.status(400).json({ error: 'Falta fuenteId.' })
    }

    const db = getDb()
    const fuenteRef = db.collection('fuentesAsignatura').doc(fuenteId)
    const fuenteDoc = await fuenteRef.get()
    if (!fuenteDoc.exists) {
      return res.status(200).json({ ok: true, archivos: { total: 0, borrados: 0, noEncontrados: 0, pendientes: [] } })
    }
    // Solo el docente dueño de la fuente puede borrarla — no basta con que
    // sea dueño de la asignatura de otro, ni con estar autenticado.
    if (fuenteDoc.data().docenteId !== uid) {
      return res.status(403).json({ error: 'Esta fuente no es tuya.' })
    }

    const assets = extraerAssets(fuenteDoc.data())
    await fuenteRef.delete()

    const archivos = await borrarAssets(assets, { origen: 'subject/delete-fuente', uid })
    if (archivos.pendientes?.length) {
      console.warn(
        `[borrar-fuente ${fuenteId}] archivo NO borrado de Cloudinary` +
        `${archivos.configurado === false ? ' (faltan CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)' : ''}: ` +
        archivos.pendientes.join(', ')
      )
    }

    return res.status(200).json({ ok: true, archivos })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo borrar la fuente.' })
  }
}
