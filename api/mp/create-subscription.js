import { verifyRequest, getDb } from '../_lib/firebaseAdmin.js'
import { startSubscription } from '../_lib/billing.js'
import { aplicarCors } from '../_lib/cors.js'

const APP_URL = process.env.APP_URL || 'https://evalua-facil.vercel.app'

// Creates a Mercado Pago recurring subscription (preapproval) instead of a
// one-time preference. The teacher authorizes once on MP's hosted page and
// MP charges the same card automatically every month, notifying us via
// api/mp/webhook.js — no cron or manual renewal needed.
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

    const { planId, escuelaId, schoolName } = req.body || {}
    if (!planId) return res.status(400).json({ error: 'Falta planId' })

    const { subscriptionId, plan } = await startSubscription({
      uid,
      planId,
      escuelaId,
      schoolName,
    })

    // Candado de seguridad — NUNCA confiar solo en que el cliente elija bien
    // el endpoint. Esta ruta solo sabe domiciliar cobros MENSUALES: el
    // `auto_recurring` de abajo tiene `frequency_type: 'months'` fijo,
    // porque la API de Mercado Pago no confirma soportar 'years' como
    // unidad. Si un plan que no es mensual llegara aquí — un bug de ruteo en
    // el cliente, un bundle viejo en caché, o alguien llamando a esta API
    // directamente saltándose la UI — sin este corte se domiciliaría el
    // precio ANUAL cobrándolo cada MES: un sobrecobro real de hasta 12x que
    // nadie debe poder disparar por accidente.
    if (plan.periodicidad !== 'mensual') {
      return res.status(400).json({ error: 'Este plan no admite domiciliación automática por Mercado Pago — usa un pago único.' })
    }

    const preapprovalBody = {
      reason: plan.nombre || 'Suscripción Evalúa Fácil',
      payer_email: decoded.email,
      // `sid` en vez de `pid`: la domiciliación no crea un doc de pago por
      // adelantado (el primer cobro llega después por webhook), así que la
      // pantalla de resultado vigila la suscripción hasta verla activa.
      back_url: `${APP_URL}/pago-resultado?sid=${subscriptionId}&status=success`,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: Number(plan.precio) || 0,
        currency_id: 'MXN',
      },
      status: 'pending',
    }

    const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preapprovalBody),
    })

    const data = await mpRes.json()
    if (!mpRes.ok) {
      return res.status(502).json({ error: 'Error de Mercado Pago', detail: data })
    }

    // `mpPlanId` (no `planId`): domiciliarse todavía no es un cobro, así que
    // no debe encender "planId presente = pago YA aprobado" (ver
    // startSubscription arriba). recordRecurringCharge en billing.js lo usa
    // solo para resolver el plan del PRIMER cobro — de ahí en adelante ya
    // usa el `planId` real que esa misma función deja en la suscripción.
    await getDb().collection('subscriptions').doc(subscriptionId).update({
      mpPreapprovalId: data.id,
      mpPlanId: planId,
    })

    return res.status(200).json({
      subscriptionId,
      preapprovalId: data.id,
      init_point: data.init_point,
    })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message })
  }
}
