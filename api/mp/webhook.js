import { completePayment } from '../_lib/billing.js'

// Mercado Pago calls this server-to-server after a payment changes state.
// We never trust the notification body — we re-fetch the payment from MP's
// API with our secret token to confirm it was really approved.
export default async function handler(req, res) {
  try {
    const token = process.env.MP_ACCESS_TOKEN
    if (!token) return res.status(500).end()

    // MP sends the payment id in different shapes depending on the event.
    const q = req.query || {}
    const body = req.body || {}
    const type = q.type || q.topic || body.type
    const mpPaymentId =
      q['data.id'] || q.id || body?.data?.id || (type === 'payment' ? body.id : null)

    if (type !== 'payment' || !mpPaymentId) {
      // Not a payment event we care about — acknowledge so MP stops retrying.
      return res.status(200).end()
    }

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!mpRes.ok) {
      // Transient — let MP retry.
      return res.status(500).end()
    }
    const payment = await mpRes.json()

    if (payment.status === 'approved' && payment.external_reference) {
      await completePayment(payment.external_reference, {
        provider: 'mercadopago',
        mpPaymentId: String(mpPaymentId),
        status: payment.status,
      })
    }

    return res.status(200).end()
  } catch {
    // Return 500 so MP retries the notification later.
    return res.status(500).end()
  }
}
