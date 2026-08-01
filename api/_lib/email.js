// Envío de correo desde el servidor, vía la API REST de EmailJS. Distinto de
// src/utils/*Email.js (que usan @emailjs/browser con la PUBLIC_KEY, porque el
// navegador prueba el origen): aquí no hay navegador ni Origin, así que
// EmailJS exige la llave PRIVADA como accessToken. Ver EMAILJS_PRIVATE_KEY en
// .env.example — sin ella el envío se salta en silencio, igual que el resto
// de los correos del proyecto (best-effort, nunca rompe el flujo que llama).
const SERVICE_ID = process.env.VITE_EMAILJS_SERVICE_ID
const TEMPLATE_ID = process.env.VITE_EMAILJS_TEMPLATE_ID
const PUBLIC_KEY = process.env.VITE_EMAILJS_PUBLIC_KEY
const PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY

export async function enviarCorreo({ email, html }) {
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY || !PRIVATE_KEY) {
    console.warn('[email] EMAILJS_PRIVATE_KEY (u otra credencial de EmailJS) no configurada — correo no enviado a', email)
    return false
  }
  const resp = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: SERVICE_ID,
      template_id: TEMPLATE_ID,
      user_id: PUBLIC_KEY,
      accessToken: PRIVATE_KEY,
      template_params: { to_email: email, to_name: email, html_content: html },
    }),
  })
  if (!resp.ok) {
    console.warn('[email] EmailJS rechazó el envío a', email, resp.status, await resp.text().catch(() => ''))
    return false
  }
  return true
}
