import { verifyRequest } from '../_lib/firebaseAdmin.js'
import { startPayment } from '../_lib/billing.js'
import { getPaypalToken, paypalBase } from '../_lib/paypal.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const decoded = await verifyRequest(req)
    const uid = decoded.uid

    const { planId, escuelaId, schoolName } = req.body || {}
    if (!planId) return res.status(400).json({ error: 'Falta planId' })

    const { paymentId, plan } = await startPayment({
      uid,
      planId,
      escuelaId,
      schoolName,
      metodo: 'paypal',
    })

    const accessToken = await getPaypalToken()
    const orderRes = await fetch(`${paypalBase()}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            custom_id: paymentId,
            description: plan.nombre || 'Suscripción Evalúa Fácil',
            amount: {
              currency_code: 'MXN',
              value: (Number(plan.precio) || 0).toFixed(2),
            },
          },
        ],
      }),
    })

    const data = await orderRes.json()
    if (!orderRes.ok) {
      return res.status(502).json({ error: 'Error de PayPal', detail: data })
    }

    return res.status(200).json({ orderId: data.id, paymentId })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, detail: err.detail })
  }
}
