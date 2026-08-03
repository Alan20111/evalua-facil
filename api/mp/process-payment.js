import { verifyRequest } from '../_lib/firebaseAdmin.js'
import { startPayment, completePayment, markPaymentStatus, PAYMENT_STATUS } from '../_lib/billing.js'
import { aplicarCors } from '../_lib/cors.js'

const APP_URL = process.env.APP_URL || 'https://evalua-facil.vercel.app'
const ACREDITADO = 'approved'
const MUERTO = ['rejected', 'cancelled']

// Vercel Hobby limita a 12 Funciones Serverless por deploy — ver
// [[project_vercel_rate_limit]]. Por eso este archivo atiende DOS modos en
// vez de sumar un api/mp/create-preference.js aparte:
//   - `mode: 'card'` (default): cobra DIRECTO contra la API de Pagos con el
//     token del Card Payment Brick — nada de preferencia ni redirección.
//   - `mode: 'wallet'`: crea una preferencia de Checkout Pro para que el
//     Wallet Brick del cliente muestre el botón "Pagar con tu cuenta de
//     Mercado Pago" — ese sí necesita que MP redirija a su login (dentro de
//     la misma pestaña/WebView, nunca a un navegador externo), porque pagar
//     con el saldo de una cuenta MP no se puede tokenizar como una tarjeta.
//
// El webhook (api/mp/webhook.js) también recibe la notificación del cobro
// (en ambos modos) y llama a completePayment/markPaymentStatus otra vez —
// es idempotente, así que confirmar aquí Y ahí no duplica nada.
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

    const {
      planId,
      escuelaId,
      schoolName,
      mode,
      token: cardToken,
      payment_method_id,
      issuer_id,
      installments,
      payer,
    } = req.body || {}
    if (!planId) return res.status(400).json({ error: 'Falta planId' })

    if (mode === 'wallet') {
      return await crearPreferenciaWallet(res, { token, uid, planId, escuelaId, schoolName })
    }

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

// Candado de seguridad — el mismo que ya tenía api/mp/create-subscription.js
// para su propio caso: pagar con la cuenta de Mercado Pago es un pago único
// (Checkout Pro), nunca domiciliación, así que solo el plan anual (el único
// pago único que existe hoy) puede pedir una preferencia. Un plan mensual
// aquí sería un bug de ruteo del cliente — no un sobrecobro como en
// create-subscription.js, pero igual hay que cortarlo en vez de dejar que
// Mercado Pago decida qué hacer con un plan que no le corresponde a este modo.
async function crearPreferenciaWallet(res, { token, uid, planId, escuelaId, schoolName }) {
  const { paymentId, plan } = await startPayment({ uid, planId, escuelaId, schoolName, metodo: 'mercadopago' })

  if (plan.periodicidad === 'mensual') {
    await markPaymentStatus(paymentId, PAYMENT_STATUS.RECHAZADO, { provider: 'mercadopago', error: 'wallet_no_admite_mensual' })
    return res.status(400).json({ error: 'Este plan no admite pago con cuenta de Mercado Pago — usa tarjeta.' })
  }

  const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [
        {
          title: plan.nombre || 'Suscripción Evalúa Fácil',
          quantity: 1,
          unit_price: Number(plan.precio) || 0,
          currency_id: 'MXN',
        },
      ],
      external_reference: paymentId,
      back_urls: {
        success: `${APP_URL}/pago-resultado?pid=${paymentId}&status=success`,
        failure: `${APP_URL}/pago-resultado?pid=${paymentId}&status=failure`,
        pending: `${APP_URL}/pago-resultado?pid=${paymentId}&status=pending`,
      },
      // 'all' (no solo 'approved'): que regrese solo a la app también si el
      // pago quedó rechazado o pendiente — pedido explícito de que el
      // docente nunca se quede varado en la página de Mercado Pago.
      auto_return: 'all',
      notification_url: `${APP_URL}/api/mp/webhook`,
      metadata: { paymentId, uid },
    }),
  })

  const data = await mpRes.json()
  if (!mpRes.ok) {
    await markPaymentStatus(paymentId, PAYMENT_STATUS.RECHAZADO, { provider: 'mercadopago', error: data })
    return res.status(502).json({ error: 'Error de Mercado Pago', detail: data })
  }

  return res.status(200).json({ paymentId, preferenceId: data.id })
}
