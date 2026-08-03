import crypto from 'node:crypto'
import { getDb } from '../_lib/firebaseAdmin.js'
import {
  completePayment,
  markPaymentStatus,
  recordRecurringCharge,
  PAYMENT_STATUS,
} from '../_lib/billing.js'

// Vocabulario de Mercado Pago. Solo 'approved' significa que el dinero ya es
// nuestro; el resto o sigue en camino o está muerto.
const ACREDITADO = 'approved'
const MUERTO = ['rejected', 'cancelled', 'refunded', 'charged_back']

// Opcional pero recomendado: MP firma cada notificación con el secreto de la
// configuración del webhook. Con MP_WEBHOOK_SECRET puesto, rechazamos lo que
// no traiga firma válida y un POST falsificado ni siquiera entra al camino de
// confirmación. Sin el secreto tampoco nos pueden engañar —el pago SIEMPRE se
// vuelve a leer de la API de MP con nuestro token privado— pero configurarlo
// es estrictamente mejor.
function firmaValida(req) {
  const secreto = process.env.MP_WEBHOOK_SECRET
  if (!secreto) return true

  const header = req.headers['x-signature']
  const requestId = req.headers['x-request-id'] || ''
  if (!header) return false

  const partes = Object.fromEntries(
    String(header)
      .split(',')
      .map((p) => p.split('=').map((s) => s.trim()))
      .filter((p) => p.length === 2)
  )
  const { ts, v1 } = partes
  if (!ts || !v1) return false

  const dataId = String(req.query?.['data.id'] || req.query?.id || '').toLowerCase()
  const manifiesto = `id:${dataId};request-id:${requestId};ts:${ts};`
  const esperado = crypto.createHmac('sha256', secreto).update(manifiesto).digest('hex')

  const a = Buffer.from(esperado, 'utf8')
  const b = Buffer.from(v1, 'utf8')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Mercado Pago calls this server-to-server after a payment or subscription
// changes state. We never trust the notification body — we re-fetch the
// resource from MP's API with our secret token to confirm what really
// happened. Es lo ÚNICO que puede concluir que un pago de MP se recibió.
export default async function handler(req, res) {
  try {
    const token = process.env.MP_ACCESS_TOKEN
    if (!token) return res.status(500).end()

    if (!firmaValida(req)) {
      // No viene de MP (o el secreto está mal). Se acusa recibo para que nada
      // reintente, pero no se toca ningún pago.
      return res.status(200).end()
    }

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

    const gateway = {
      provider: 'mercadopago',
      mpPaymentId: String(mpPaymentId),
      status: payment.status,
      statusDetail: payment.status_detail || null,
      paymentType: payment.payment_type_id || null,
    }

    if (payment.external_reference) {
      // One-time Checkout Pro payment, started from the app.
      // external_reference es el id del doc de `payments` que creamos al abrir
      // el checkout, así que aquí sí podemos reflejar CUALQUIER desenlace.
      if (payment.status === ACREDITADO) {
        await completePayment(payment.external_reference, gateway, {
          paidAmount: payment.transaction_amount,
        })
      } else if (MUERTO.includes(payment.status)) {
        await markPaymentStatus(payment.external_reference, PAYMENT_STATUS.RECHAZADO, gateway)
      } else {
        // pending / in_process / authorized / in_mediation — MP tiene la orden
        // pero el depósito no se ha acreditado (efectivo sin pagar, tarjeta en
        // revisión, fondos retenidos sin capturar). Se deja constancia; no se
        // activa nada.
        await markPaymentStatus(payment.external_reference, PAYMENT_STATUS.EN_PROCESO, gateway)
      }
    } else if (payment.preapproval_id && payment.status === ACREDITADO) {
      // Automatic recurring charge — MP billed the saved card on its own.
      // Aquí no hay doc previo que actualizar, así que un cobro no acreditado
      // simplemente no genera registro: nada que corregir después.
      await recordRecurringCharge(payment.preapproval_id, gateway)
    }

    return res.status(200).end()
  } catch {
    // Return 500 so MP retries the notification later.
    return res.status(500).end()
  }
}
