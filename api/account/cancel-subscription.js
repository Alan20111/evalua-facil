import { getDb, admin, verifyRequest } from '../_lib/firebaseAdmin.js'
import { aplicarCors } from '../_lib/cors.js'

// Cancelar la suscripción del propio docente.
//
// Va en el servidor y no en el cliente porque las reglas de Firestore solo le
// permiten al docente mover su suscripción a 'pendiente_pago' (el único
// cambio de estado que necesita para pagar). Dejarle escribir 'cancelada'
// desde el navegador significaría abrirle el campo `status`, y por ahí se
// podría autoasignar 'activa'. Aquí el estado lo decide el servidor.
//
// Cancelar NO es lo mismo que eliminar: no se borra nada y el acceso sigue
// hasta la fecha ya pagada. Solo deja de renovarse.

const CANCELABLES = ['activa', 'trial', 'pendiente_pago']

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return // preflight de la app
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const { uid } = await verifyRequest(req)
    const db = getDb()

    const snap = await db.collection('subscriptions').where('docenteId', '==', uid).get()
    if (snap.empty) {
      return res.status(404).json({ error: 'No encontramos una suscripción tuya.' })
    }

    // La vigente es la última actualizada — mismo criterio que useSubscription
    // en el cliente, para que se cancele exactamente la que el docente está
    // viendo en pantalla.
    const subs = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))
    const sub = subs[0]

    if (sub.status === 'cancelada') {
      return res.status(409).json({ error: 'Tu suscripción ya estaba cancelada.' })
    }
    if (!CANCELABLES.includes(sub.status)) {
      return res.status(409).json({ error: 'Esta suscripción no se puede cancelar.' })
    }

    // Si es una suscripción recurrente de Mercado Pago, hay que cancelar el
    // preapproval allá también — si no, MP le sigue cobrando la tarjeta cada
    // mes aunque aquí la marquemos cancelada.
    if (sub.mpPreapprovalId) {
      const token = process.env.MP_ACCESS_TOKEN
      if (token) {
        await fetch(`https://api.mercadopago.com/preapproval/${sub.mpPreapprovalId}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ status: 'cancelled' }),
        })
      }
    }

    const ahora = admin.firestore.Timestamp.now()
    await db.collection('subscriptions').doc(sub.id).update({
      status: 'cancelada',
      canceladaEn: ahora,
      updatedAt: ahora,
    })

    // Hasta cuándo conserva el acceso NO se calcula aquí: la duración de la
    // prueba vive en utils/subscriptionHelpers.js (effectiveVencimiento) y
    // repetirla en el servidor es garantizar que un día digan cosas
    // distintas. El cliente ya tiene la suscripción cargada y la resuelve con
    // su propia fuente única.
    return res.status(200).json({ ok: true, status: 'cancelada', eraTrial: sub.status === 'trial' })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo cancelar la suscripción.' })
  }
}
