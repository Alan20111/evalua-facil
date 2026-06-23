const https = require('https')

const PROJECT_ID = 'evalua-facil-app'

const HTML_BODY = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

      <!-- HEADER -->
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
          <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:800;line-height:1.3;">Activa tu cuenta</h1>
        </td>
      </tr>

      <!-- BODY -->
      <tr>
        <td style="background:#ffffff;padding:36px 32px;">
          <p style="margin:0 0 6px;color:#1e293b;font-size:16px;">Hola,</p>
          <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">
            Tu nombre de usuario en <strong style="color:#1e40af;">Evalúa Fácil</strong> es:
          </p>

          <!-- USERNAME BOX -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr>
              <td style="background:#eff6ff;border:2px solid #93c5fd;border-radius:12px;padding:20px;text-align:center;">
                <strong style="color:#1e3a8a;font-size:28px;font-family:'Courier New',Courier,monospace;letter-spacing:4px;">%DISPLAY_NAME%</strong>
              </td>
            </tr>
          </table>

          <!-- BUTTON -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td align="center">
                <a href="%LINK%"
                   style="display:inline-block;background:#2563eb;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:12px;letter-spacing:0.3px;">
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

      <!-- FOOTER -->
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

async function getAccessToken() {
  try {
    const { getGlobalDefaultAccount } = require('/opt/homebrew/lib/node_modules/firebase-tools/lib/auth.js')
    const account = await getGlobalDefaultAccount()
    if (!account?.tokens?.access_token) throw new Error('No access token found')
    return account.tokens.access_token
  } catch (err) {
    console.error('No se pudo obtener el token de firebase-tools:', err.message)
    process.exit(1)
  }
}

function apiRequest(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined
    const options = {
      hostname: 'identitytoolkit.googleapis.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    }
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr)
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, body: data }) }
      })
    })
    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

async function main() {
  console.log('Obteniendo token de firebase-tools...')
  const token = await getAccessToken()
  console.log('✓ Token obtenido')

  const updateMask = [
    'notification.sendEmail.verifyEmail.subject',
    'notification.sendEmail.verifyEmail.body',
    'notification.sendEmail.verifyEmail.bodyFormat',
    'notification.sendEmail.verifyEmail.senderDisplayName',
  ].join(',')

  const urlPath = `/admin/v2/projects/${PROJECT_ID}/config?updateMask=${encodeURIComponent(updateMask)}`

  console.log('Actualizando template de verificación de correo...')
  const res = await apiRequest('PATCH', urlPath, token, {
    notification: {
      sendEmail: {
        verifyEmail: {
          subject: 'Bienvenido/a a Evalúa Fácil — activa tu cuenta',
          senderDisplayName: 'Evalúa Fácil',
          bodyFormat: 'HTML',
          body: HTML_BODY,
        }
      }
    }
  })

  if (res.status === 200) {
    console.log('✅ Template de correo actualizado correctamente!')
    console.log('Los correos de verificación ahora usarán el diseño personalizado.')
  } else {
    console.log(`❌ Error ${res.status}:`)
    console.log(JSON.stringify(res.body, null, 2))
  }
}

main().catch(err => { console.error(err); process.exit(1) })
