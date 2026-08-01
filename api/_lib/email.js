// Envío de correo desde el servidor, vía la API de Brevo — mismo proveedor
// que api/send-email.js (que existe para que el CLIENTE mande correos sin
// exponer la clave). El cron ya corre en el servidor, así que llama a Brevo
// directo en vez de dar la vuelta por ese endpoint HTTP.
const REMITENTE = { email: 'soporte@evaluafacil.mx', name: 'Evalúa Fácil' }

export async function enviarCorreo({ to, toName, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) {
    console.warn('[email] BREVO_API_KEY no configurada — correo no enviado a', to)
    return false
  }
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: REMITENTE,
      to: [{ email: to, name: toName || to }],
      subject,
      htmlContent: html,
    }),
  })
  if (!resp.ok) {
    console.warn('[email] Brevo rechazó el envío a', to, resp.status, await resp.text().catch(() => ''))
    return false
  }
  return true
}
