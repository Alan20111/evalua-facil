import emailjs from '@emailjs/browser'

const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID
const PUBLIC_KEY  = import.meta.env.VITE_EMAILJS_PUBLIC_KEY

function buildHtml({ username, school }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Bienvenido a Evalúa Fácil</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="background-color:#f1f5f9;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="max-width:520px;">

      <!-- HEADER -->
      <tr>
        <td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);
                   border-radius:16px 16px 0 0;padding:40px 32px 32px;text-align:center;">
          <!-- Logo EF -->
          <table role="presentation" cellpadding="0" cellspacing="0"
                 style="margin:0 auto 20px;">
            <tr>
              <td style="width:64px;height:64px;background:rgba(255,255,255,0.15);
                         border-radius:18px;text-align:center;vertical-align:middle;">
                <span style="color:#ffffff;font-size:24px;font-weight:900;
                             font-family:Arial,sans-serif;line-height:64px;letter-spacing:-1px;">EF</span>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 8px;color:#bfdbfe;font-size:12px;font-weight:700;
                    letter-spacing:3px;text-transform:uppercase;">Evalúa Fácil</p>
          <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:800;line-height:1.3;">
            Bienvenido/a a<br/>Evalúa Fácil
          </h1>
        </td>
      </tr>

      <!-- BODY -->
      <tr>
        <td style="background:#ffffff;padding:36px 32px;">

          <p style="margin:0 0 8px;color:#1e293b;font-size:17px;font-weight:700;">
            Hola, ${username}
          </p>
          <p style="margin:0 0 28px;color:#475569;font-size:15px;line-height:1.7;">
            Gracias por registrarte en <strong style="color:#1e40af;">Evalúa Fácil</strong>,
            el sistema de gestión de calificaciones para docentes SEP.
          </p>

          <!-- USERNAME BOX -->
          <p style="margin:0 0 10px;color:#64748b;font-size:12px;font-weight:700;
                    text-transform:uppercase;letter-spacing:1.5px;">Tu nombre de usuario</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="margin-bottom:32px;">
            <tr>
              <td style="background:#eff6ff;border:2px solid #93c5fd;
                         border-radius:14px;padding:24px;text-align:center;">
                <p style="margin:0;color:#1e3a8a;font-size:36px;font-weight:900;
                           font-family:'Courier New',Courier,monospace;letter-spacing:4px;line-height:1;">
                  ${username}
                </p>
                <p style="margin:10px 0 0;color:#64748b;font-size:12px;">
                  Escuela: <strong>${school}</strong>
                </p>
              </td>
            </tr>
          </table>

          <!-- CTA BUTTON -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="margin-bottom:28px;">
            <tr>
              <td align="center">
                <a href="https://evalua-facil.vercel.app"
                   style="display:inline-block;background:#2563eb;color:#ffffff;
                          font-size:15px;font-weight:700;text-decoration:none;
                          padding:15px 40px;border-radius:12px;letter-spacing:0.3px;">
                  Verificar correo electrónico →
                </a>
              </td>
            </tr>
          </table>

          <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;line-height:1.6;">
            Si tienes problemas con el botón, visita<br/>
            <a href="https://evalua-facil.vercel.app"
               style="color:#2563eb;text-decoration:none;">evalua-facil.vercel.app</a>
          </p>

        </td>
      </tr>

      <!-- FOOTER -->
      <tr>
        <td style="background:#f8fafc;border-radius:0 0 16px 16px;
                   padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="margin:0 0 4px;color:#64748b;font-size:12px;font-weight:600;">
            Evalúa Fácil
          </p>
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

export async function sendWelcomeEmail({ email, username, school }) {
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) return
  await emailjs.send(
    SERVICE_ID,
    TEMPLATE_ID,
    {
      to_email: email,
      to_name: username,
      html_content: buildHtml({ username, school }),
    },
    PUBLIC_KEY
  )
}
