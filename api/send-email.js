import { aplicarCors } from './_lib/cors.js'
import { verifyRequest } from './_lib/firebaseAdmin.js'

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

  // Este endpoint manda correo con HTML libre desde soporte@evaluafacil.mx, un
  // dominio autenticado con DKIM/DMARC. Sin candado era un RETRANSMISOR
  // ABIERTO: cualquiera en internet podía mandar el correo que quisiera, a
  // quien quisiera, firmado con nuestro dominio — o sea, phishing que pasa
  // todas las comprobaciones de autenticidad, y de paso la reputación del
  // dominio quemada y los envíos legítimos bloqueados.
  //
  // El CORS no protegía nada: es cosa del navegador, y un script lo ignora.
  //
  // Dos candados, porque el primero solo no basta —registrarse es gratis, así
  // que "solo usuarios" seguiría permitiendo phishing—:
  //   1. Hay que venir autenticado.
  //   2. El destinatario tiene que ser TU PROPIO correo. Es la invariante real
  //      de los dos únicos usos (bienvenida y avisos de cuenta, ver
  //      welcomeEmail.js y accountEmails.js): siempre se le escribe al titular.
  // El cron de recordatorios no pasa por aquí — usa _lib/email.js del lado del
  // servidor — así que no le afecta.
  let quien
  try {
    quien = await verifyRequest(req)
  } catch {
    return res.status(401).json({ error: 'No autenticado' })
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
  const { to, subject, html, toName } = body
  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Faltan campos requeridos (to, subject, html)' })
  }
  if (!quien.email || String(to).trim().toLowerCase() !== String(quien.email).trim().toLowerCase()) {
    return res.status(403).json({ error: 'Solo puedes enviarte correo a ti mismo.' })
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
