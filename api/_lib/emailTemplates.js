// Mismo marco visual que src/utils/accountEmails.js (header azul, footer),
// duplicado aquí a propósito: api/ corre en funciones serverless separadas
// del bundle de Vite y no puede importar de src/. Si cambia el diseño de un
// lado, cambiarlo también del otro.

const SITIO = 'https://evalua-facil.vercel.app'

export function armarCorreo({ titulo, cuerpo, accion }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${titulo}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="background-color:#f1f5f9;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

      <tr>
        <td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);
                   border-radius:16px 16px 0 0;padding:40px 32px 32px;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px;">
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
          <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:800;line-height:1.3;">${titulo}</h1>
        </td>
      </tr>

      <tr>
        <td style="background:#ffffff;padding:36px 32px;">
          ${cuerpo}
          ${accion || ''}
          <p style="margin:28px 0 0;color:#94a3b8;font-size:12px;text-align:center;line-height:1.6;">
            Si tienes dudas, escríbenos respondiendo a este correo.
          </p>
        </td>
      </tr>

      <tr>
        <td style="background:#f8fafc;border-radius:0 0 16px 16px;
                   padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="margin:0 0 4px;color:#64748b;font-size:12px;font-weight:600;">Evalúa Fácil</p>
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

export function parrafo(texto) {
  return `<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.7;">${texto}</p>`
}

export function boton(texto, url = SITIO) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 0;">
  <tr><td align="center">
    <a href="${url}" style="display:inline-block;background:#2563eb;color:#ffffff;
       font-size:15px;font-weight:700;text-decoration:none;padding:15px 40px;
       border-radius:12px;letter-spacing:0.3px;">${texto}</a>
  </td></tr>
</table>`
}

export { SITIO }
