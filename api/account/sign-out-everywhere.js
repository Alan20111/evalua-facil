import { getAuth, verifyRequest } from '../_lib/firebaseAdmin.js'

// "Cerrar sesión en todos los dispositivos" — sirve para docente y estudiante.
//
// Cerrar sesión en el navegador solo borra la sesión de ESE navegador. Si el
// estudiante entró desde una computadora del plantel y se le olvidó salir, esa
// sesión sigue viva días. revokeRefreshTokens invalida todas de un golpe: los
// demás dispositivos dejan de poder renovar su token y quedan fuera.
//
// El propio dispositivo desde el que se pide también queda fuera — el cliente
// cierra sesión enseguida, para que no se quede en un limbo con un token que
// ya no se puede renovar.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const { uid } = await verifyRequest(req)
    await getAuth().revokeRefreshTokens(uid)
    return res.status(200).json({ ok: true })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudieron cerrar las sesiones.' })
  }
}
