import emailjs from '@emailjs/browser'

const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID
const PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY

function buildHtml(username) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

      <tr>
        <td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);border-radius:16px 16px 0 0;padding:36px 32px 28px;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
            <tr>
              <td style="width:60px;height:60px;background:rgba(255,255,255,0.15);border-radius:16px;text-align:center;vertical-align:middle;">
                <span style="color:#ffffff;font-size:22px;font-weight:900;font-family:Arial,sans-serif;line-height:60px;letter-spacing:-1px;">EF</span>
              </td>
            </tr>
          </table>
          <p style="margin:0;color:#bfdbfe;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">Evalúa Fácil</p>
          <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:800;">Activa tu cuenta</h1>
        </td>
      </tr>

      <tr>
        <td style="background:#ffffff;padding:36px 32px;">
          <p style="margin:0 0 6px;color:#1e293b;font-size:16px;">Hola,</p>
          <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">
            Tu nombre de usuario en <strong style="color:#1e40af;">Evalúa Fácil</strong> es:
          </p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr>
              <td style="background:#eff6ff;border:2px solid #93c5fd;border-radius:12px;padding:20px;text-align:center;">
                <strong style="color:#1e3a8a;font-size:28px;font-family:'Courier New',Courier,monospace;letter-spacing:4px;">${username}</strong>
              </td>
            </tr>
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td align="center">
                <a href="https://evalua-facil.vercel.app/dashboard"
                   style="display:inline-block;background:#2563eb;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:12px;">
                  Activar cuenta
                </a>
              </td>
            </tr>
          </table>

          <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;line-height:1.6;">
            Gracias por unirte a Evalúa Fácil.<br/>
            Si no creaste esta cuenta, puedes ignorar este correo.
          </p>
        </td>
      </tr>

      <tr>
        <td style="background:#f8fafc;border-radius:0 0 16px 16px;padding:16px 32px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:11px;">
            Sistema de gestión de calificaciones SEP · México
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
}

export async function sendVerificationEmail({ email, username }) {
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) return
  await emailjs.send(
    SERVICE_ID,
    TEMPLATE_ID,
    { to_email: email, to_name: username, html_content: buildHtml(username) },
    PUBLIC_KEY
  )
}
