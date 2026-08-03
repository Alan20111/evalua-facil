import { verifyRequest } from '../_lib/firebaseAdmin.js'
import { startPayment, completePayment, markPaymentStatus, PAYMENT_STATUS } from '../_lib/billing.js'
import { aplicarCors } from '../_lib/cors.js'

const ACREDITADO = 'approved'
const MUERTO = ['rejected', 'cancelled']

// Cobra el plan anual DIRECTO contra la API de Pagos de Mercado Pago, con el
// token de tarjeta que generó el Card Payment Brick en el propio checkout —
// nada de preferencia ni redirección (Checkout Pro): pedido explícito de que
// el pago no saque al docente de la app ni del sitio.
//
// El webhook (api/mp/webhook.js) también recibe esta misma notificación y
// llama a completePayment/markPaymentStatus otra vez — es idempotente, así
// que confirmar aquí Y ahí no duplica nada.
export default async function handler(req, res) {
  if (aplicarCors(req, res)) return // preflight de la app
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const token = process.env.MP_ACCESS_TOKEN
    if (!token) return res.status(500).json({ error: 'MP_ACCESS_TOKEN no configurado' })

    const decoded = await verifyRequest(req)
    const uid = decoded.uid

    const { planId, escuelaId, schoolName, token: cardToken, payment_method_id, issuer_id, installments, payer } =
      req.body || {}
    if (!planId) return res.status(400).json({ error: 'Falta planId' })
    if (!cardToken || !payment_method_id) {
      return res.status(400).json({ error: 'Falta información de la tarjeta' })
    }

    const { paymentId, plan } = await startPayment({
      uid,
      planId,
      escuelaId,
      schoolName,
      metodo: 'mercadopago',
    })

    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // Mismo paymentId en cada reintento de red del cliente ⇒ mismo cargo,
        // nunca dos cobros por la misma compra.
        'X-Idempotency-Key': paymentId,
      },
      body: JSON.stringify({
        transaction_amount: Number(plan.precio) || 0,
        token: cardToken,
        description: plan.nombre || 'Suscripción Evalúa Fácil',
        installments: Number(installments) || 1,
        payment_method_id,
        issuer_id,
        payer: { email: payer?.email || decoded.email, identification: payer?.identification },
        external_reference: paymentId,
        metadata: { paymentId, uid },
      }),
    })

    const data = await mpRes.json()
    if (!mpRes.ok) {
      await markPaymentStatus(paymentId, PAYMENT_STATUS.RECHAZADO, { provider: 'mercadopago', error: data })
      return res.status(502).json({
        error: data.message || 'Mercado Pago rechazó el pago',
        status: 'rejected',
        detail: data.cause?.[0]?.description,
      })
    }

    const gateway = {
      provider: 'mercadopago',
      mpPaymentId: String(data.id),
      status: data.status,
      statusDetail: data.status_detail || null,
      paymentType: data.payment_type_id || null,
    }

    if (data.status === ACREDITADO) {
      await completePayment(paymentId, gateway, { paidAmount: data.transaction_amount })
    } else if (MUERTO.includes(data.status)) {
      await markPaymentStatus(paymentId, PAYMENT_STATUS.RECHAZADO, gateway)
    } else {
      // pending / in_process / authorized — MP tiene la orden pero el
      // depósito no se ha acreditado todavía (tarjeta en revisión del
      // banco). El webhook la confirma después.
      await markPaymentStatus(paymentId, PAYMENT_STATUS.EN_PROCESO, gateway)
    }

    return res.status(200).json({ paymentId, status: data.status, detail: data.status_detail })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message })
  }
}
