import { getAuth, getDb, verifyRequest } from '../_lib/firebaseAdmin.js'
import { aplicarCors } from '../_lib/cors.js'

// Último acceso de cada docente, para la columna "Días sin accesar" del panel
// de administración.
//
// El dato NO se guarda en Firestore a propósito: Firebase Auth ya lo lleva por
// su cuenta (`metadata.lastSignInTime`). Escribirlo nosotros significaría una
// escritura extra en cada inicio de sesión de cada docente, y aun así
// arrancaría vacío para todas las cuentas que ya existen — mientras que Auth
// tiene el dato desde siempre, para todas.
//
// Solo se puede leer con el Admin SDK (el cliente no tiene forma de consultar
// la metadata de OTRO usuario), de ahí este endpoint.
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

    const uids = Array.isArray(req.body?.uids) ? req.body.uids.filter(Boolean) : []
    if (uids.length === 0) return res.status(200).json({ accesos: {} })

    const auth = getAuth()
    const accesos = {}
    // getUsers acepta 100 identificadores por llamada.
    for (let i = 0; i < uids.length; i += 100) {
      const lote = uids.slice(i, i + 100).map((id) => ({ uid: id }))
      const { users } = await auth.getUsers(lote)
      users.forEach((u) => {
        // Cadena ISO o vacía si nunca ha iniciado sesión (cuenta creada por el
        // administrador, por ejemplo). Los uid que ya no existen en Auth
        // simplemente no vienen en `users`, y quedan fuera del mapa.
        accesos[u.uid] = u.metadata?.lastSignInTime || null
      })
    }
    return res.status(200).json({ accesos })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo consultar el último acceso.' })
  }
}
