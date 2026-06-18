const BASE =
  process.env.PAYPAL_ENV === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com'

export function paypalBase() {
  return BASE
}

export async function getPaypalToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID
  const secret = process.env.PAYPAL_SECRET
  if (!clientId || !secret) {
    const err = new Error('PAYPAL_CLIENT_ID o PAYPAL_SECRET no configurados')
    err.status = 500
    throw err
  }
  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64')
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const data = await res.json()
  if (!res.ok) {
    const err = new Error('No se pudo autenticar con PayPal')
    err.status = 502
    err.detail = data
    throw err
  }
  return data.access_token
}
