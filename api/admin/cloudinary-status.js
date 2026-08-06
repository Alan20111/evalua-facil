import { getDb, verifyRequest } from '../_lib/firebaseAdmin.js'
import { aplicarCors } from '../_lib/cors.js'

// Diagnóstico de solo lectura: ¿el backend tiene CLOUDINARY_API_KEY y
// CLOUDINARY_API_SECRET? No borra nada ni devuelve los valores, solo si
// están presentes — para comprobar un despliegue sin tocar datos reales.
export default async function handler(req, res) {
  if (aplicarCors(req, res)) return // preflight de la app
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const { uid } = await verifyRequest(req)
    const db = getDb()
    const perfil = await db.collection('users').doc(uid).get()
    if (perfil.data()?.role !== 'admin') {
      return res.status(403).json({ error: 'Solo para administradores' })
    }

    return res.status(200).json({
      configurado: Boolean(process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET),
    })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo consultar la configuración.' })
  }
}
