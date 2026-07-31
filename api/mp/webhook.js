import { getDb } from '../_lib/firebaseAdmin.js'
import { completePayment, recordRecurringCharge } from '../_lib/billing.js'

// Mercado Pago calls this server-to-server after a payment or subscription
// changes state. We never trust the notification body — we re-fetch the
// resource from MP's API with our secret token to confirm what really
// happened.
export default async function handler(req, res) {
  try {
    const token = process.env.MP_ACCESS_TOKEN
    if (!token) return res.status(500).end()

    const q = req.query || {}
    const body = req.body || {}
    const type = q.type || q.topic || body.type

    if (type === 'preapproval') {
      const preapprovalId = q['data.id'] || q.id || body?.data?.id
      if (!preapprovalId) return res.status(200).end()

      const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!mpRes.ok) return res.status(500).end() // transient — let MP retry

      const preapproval = await mpRes.json()
      if (preapproval.status === 'cancelled') {
        const db = getDb()
        const subsSnap = await db
          .collection('subscriptions')
          .where('mpPreapprovalId', '==', preapprovalId)
          .limit(1)
          .get()
        if (!subsSnap.empty) {
          await subsSnap.docs[0].ref.update({ status: 'cancelada' })
        }
      }
      return res.status(200).end()
    }

    // MP sends the payment id in different shapes depending on the event.
    const mpPaymentId =
      q['data.id'] || q.id || body?.data?.id || (type === 'payment' ? body.id : null)

    if (type !== 'payment' || !mpPaymentId) {
      // Not an event we care about — acknowledge so MP stops retrying.
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

    if (payment.status !== 'approved') return res.status(200).end()

    if (payment.external_reference) {
      // One-time Checkout Pro payment, started from the app.
      await completePayment(payment.external_reference, {
        provider: 'mercadopago',
        mpPaymentId: String(mpPaymentId),
        status: payment.status,
      })
    } else if (payment.preapproval_id) {
      // Automatic recurring charge — MP billed the saved card on its own.
      await recordRecurringCharge(payment.preapproval_id, {
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
