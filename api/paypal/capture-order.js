import { verifyRequest } from '../_lib/firebaseAdmin.js'
import { completePayment } from '../_lib/billing.js'
import { getPaypalToken, paypalBase } from '../_lib/paypal.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    await verifyRequest(req)

    const { orderId } = req.body || {}
    if (!orderId) return res.status(400).json({ error: 'Falta orderId' })

    const accessToken = await getPaypalToken()
    const capRes = await fetch(`${paypalBase()}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    const data = await capRes.json()
    if (!capRes.ok) {
      return res.status(502).json({ error: 'No se pudo capturar el pago', detail: data })
    }

    // The paymentId we stored is the custom_id on the purchase unit. Read it
    // from PayPal's own response so the client can't fake which payment it is.
    const unit = data.purchase_units?.[0]
    const paymentId =
      unit?.custom_id || unit?.payments?.captures?.[0]?.custom_id || null

    if (data.status === 'COMPLETED' && paymentId) {
      await completePayment(paymentId, {
        provider: 'paypal',
        orderId,
        status: data.status,
      })
      return res.status(200).json({ ok: true, status: data.status })
    }

    return res.status(200).json({ ok: false, status: data.status })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, detail: err.detail })
  }
}
