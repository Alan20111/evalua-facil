import { verifyRequest } from '../_lib/firebaseAdmin.js'
import { completePayment } from '../_lib/billing.js'
import { getPaypalToken, paypalBase } from '../_lib/paypal.js'
import { aplicarCors } from '../_lib/cors.js'

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return // preflight de la app
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

    // Solo una orden CAPTURADA significa que el dinero ya es nuestro. Todo lo
    // demás (CREATED, APPROVED sin capturar, PENDING) se reporta como
    // "todavía no pagado" para no anunciarle al docente un cobro que no ocurrió.
    if (data.status === 'COMPLETED' && paymentId) {
      const captura = unit?.payments?.captures?.[0]
      const resultado = await completePayment(
        paymentId,
        { provider: 'paypal', orderId, status: data.status, captureId: captura?.id || null },
        { paidAmount: captura?.amount?.value }
      )
      return res.status(200).json({ ok: resultado.completed, status: data.status, paymentId })
    }

    return res.status(200).json({ ok: false, status: data.status, paymentId })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, detail: err.detail })
  }
}
