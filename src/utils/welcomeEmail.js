import emailjs from '@emailjs/browser'

const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID
const PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY

function buildHtml({ nombre, username, school }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Tu acceso a Evalúa Fácil</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <!-- HEADER -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);border-radius:20px 20px 0 0;padding:36px 32px;text-align:center;">
            <p style="margin:0 0 6px 0;color:#93c5fd;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">Evalúa Fácil</p>
            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:800;line-height:1.2;">
              ¡Bienvenido/a,<br/>${nombre || 'Docente'}!
            </h1>
            <p style="margin:10px 0 0;color:#bfdbfe;font-size:14px;">Tu cuenta de docente está lista</p>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="background:#ffffff;padding:36px 32px;">

            <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.7;">
              Tu cuenta en <strong style="color:#1e40af;">Evalúa Fácil</strong> ha sido creada.
              Guarda este correo — contiene tu nombre de usuario que necesitas para iniciar sesión.
            </p>

            <!-- USERNAME BOX -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td style="background:#eff6ff;border:2px solid #93c5fd;border-radius:16px;padding:28px 24px;text-align:center;">
                  <p style="margin:0 0 10px;color:#3b82f6;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Tu nombre de usuario</p>
                  <p style="margin:0;color:#1e3a8a;font-size:42px;font-weight:900;font-family:Courier New,Courier,monospace;letter-spacing:5px;line-height:1;">
                    ${username}
                  </p>
                  <p style="margin:12px 0 0;color:#64748b;font-size:12px;">Úsalo cada vez que inicies sesión</p>
                </td>
              </tr>
            </table>

            <!-- SCHOOL -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td style="background:#f8fafc;border-left:4px solid #2563eb;border-radius:0 10px 10px 0;padding:14px 18px;">
                  <p style="margin:0 0 3px;color:#94a3b8;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Escuela</p>
                  <p style="margin:0;color:#0f172a;font-size:15px;font-weight:700;">${school}</p>
                </td>
              </tr>
            </table>

            <!-- STEPS -->
            <p style="margin:0 0 16px;color:#1e293b;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Cómo ingresar</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
              <tr>
                <td style="padding:8px 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="width:32px;height:32px;background:#2563eb;border-radius:50%;text-align:center;vertical-align:middle;">
                        <span style="color:#ffffff;font-size:13px;font-weight:800;line-height:32px;">1</span>
                      </td>
                      <td style="padding-left:14px;color:#334155;font-size:14px;line-height:1.5;">
                        Abre <strong style="color:#2563eb;">evalua-facil.vercel.app/docente</strong>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="width:32px;height:32px;background:#2563eb;border-radius:50%;text-align:center;vertical-align:middle;">
                        <span style="color:#ffffff;font-size:13px;font-weight:800;line-height:32px;">2</span>
                      </td>
                      <td style="padding-left:14px;color:#334155;font-size:14px;line-height:1.5;">
                        Escribe tu usuario: <strong style="color:#1e3a8a;font-family:Courier New,monospace;font-size:15px;">${username}</strong>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="width:32px;height:32px;background:#2563eb;border-radius:50%;text-align:center;vertical-align:middle;">
                        <span style="color:#ffffff;font-size:13px;font-weight:800;line-height:32px;">3</span>
                      </td>
                      <td style="padding-left:14px;color:#334155;font-size:14px;line-height:1.5;">
                        Ingresa tu contraseña y empieza a trabajar
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- CTA BUTTON -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr>
                <td align="center">
                  <a href="https://evalua-facil.vercel.app/docente"
                     style="display:inline-block;background:#2563eb;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:12px;letter-spacing:0.3px;">
                    Ir a Evalúa Fácil →
                  </a>
                </td>
              </tr>
            </table>

            <!-- VERIFY NOTICE -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:16px 18px;">
                  <p style="margin:0 0 5px;color:#92400e;font-size:13px;font-weight:700;">📧 Verifica tu cuenta</p>
                  <p style="margin:0;color:#78350f;font-size:13px;line-height:1.6;">
                    También te enviamos un <strong>correo de verificación</strong> separado de Firebase.
                    Confírmalo para proteger tu cuenta — sin verificación no podrás recuperar tu contraseña si la olvidas.
                  </p>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#f8fafc;border-radius:0 0 20px 20px;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
            <p style="margin:0 0 4px;color:#94a3b8;font-size:12px;line-height:1.6;">
              <strong style="color:#64748b;">Evalúa Fácil</strong> · Sistema de gestión de calificaciones SEP
            </p>
            <p style="margin:0;color:#cbd5e1;font-size:11px;">
              Este correo se generó automáticamente al crear tu cuenta.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export async function sendWelcomeEmail({ email, nombre, username, school }) {
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) return
  await emailjs.send(
    SERVICE_ID,
    TEMPLATE_ID,
    {
      to_email: email,
      to_name: nombre || username,
      html_content: buildHtml({ nombre, username, school }),
    },
    PUBLIC_KEY
  )
}
