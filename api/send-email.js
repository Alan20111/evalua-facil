import { aplicarCors } from './_lib/cors.js'

// Envía un correo transaccional por la API de Brevo, siempre desde
// soporte@evaluafacil.mx (dominio autenticado con DKIM/DMARC en Brevo).
//
// Reemplaza a EmailJS: el envío ocurre EN EL SERVIDOR, así que la clave
// (BREVO_API_KEY) vive solo en las variables de entorno de Vercel y nunca se
// expone al cliente. La app (WebView) también lo llama, por eso el CORS.
//
// Requiere en Vercel: BREVO_API_KEY  (Settings → Environment Variables)
//
// Body JSON: { to, subject, html, toName? }
// Best-effort desde el cliente: si esto falla no debe romper el registro ni
// las demás acciones que lo invocan.

const REMITENTE = { email: 'soporte@evaluafacil.mx', name: 'Evalúa Fácil' }

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Falta BREVO_API_KEY en el servidor' })

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
  const { to, subject, html, toName } = body
  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Faltan campos requeridos (to, subject, html)' })
  }

  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: REMITENTE,
        to: [{ email: to, name: toName || to }],
        subject,
        htmlContent: html,
      }),
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      return res.status(502).json({ error: 'Brevo rechazó el envío', detail })
    }
    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
