import { verifyRequest } from '../_lib/firebaseAdmin.js'
import { startPayment } from '../_lib/billing.js'

const APP_URL = process.env.APP_URL || 'https://evalua-facil.vercel.app'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const token = process.env.MP_ACCESS_TOKEN
    if (!token) return res.status(500).json({ error: 'MP_ACCESS_TOKEN no configurado' })

    const decoded = await verifyRequest(req)
    const uid = decoded.uid

    const { planId, escuelaId, schoolName } = req.body || {}
    if (!planId) return res.status(400).json({ error: 'Falta planId' })

    const { paymentId, plan } = await startPayment({
      uid,
      planId,
      escuelaId,
      schoolName,
      metodo: 'mercadopago',
    })

    const prefBody = {
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
        success: `${APP_URL}/pago-resultado?status=success`,
        failure: `${APP_URL}/pago-resultado?status=failure`,
        pending: `${APP_URL}/pago-resultado?status=pending`,
      },
      auto_return: 'approved',
      notification_url: `${APP_URL}/api/mp/webhook`,
      metadata: { paymentId, uid },
    }

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(prefBody),
    })

    const data = await mpRes.json()
    if (!mpRes.ok) {
      return res.status(502).json({ error: 'Error de Mercado Pago', detail: data })
    }

    return res.status(200).json({
      paymentId,
      preferenceId: data.id,
      init_point: data.init_point,
    })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message })
  }
}
