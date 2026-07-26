import emailjs from '@emailjs/browser'

// Correos de confirmación de las dos acciones delicadas del perfil: cancelar
// la suscripción y eliminar la cuenta. Se mandan por EmailJS igual que el de
// bienvenida (ver welcomeEmail.js): la plantilla del panel es solo
// {{{html_content}}}, así que el correo completo se arma aquí.
//
// El de "cuenta eliminada" se manda ANTES de borrar, no después: una vez que
// se va la cuenta el docente ya está fuera de la sesión y no queda quién lo
// mande desde el navegador.

const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID
const PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY

const SITIO = 'https://evalua-facil.vercel.app'

// Marco visual compartido — mismo encabezado azul y pie que el correo de
// bienvenida, para que los tres se vean de la misma casa.
function armarCorreo({ titulo, cuerpo, accion }) {
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
            Si tú no hiciste este cambio, escríbenos respondiendo a este correo.
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

function parrafo(texto) {
  return `<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.7;">${texto}</p>`
}

function boton(texto, url) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 0;">
  <tr><td align="center">
    <a href="${url}" style="display:inline-block;background:#2563eb;color:#ffffff;
       font-size:15px;font-weight:700;text-decoration:none;padding:15px 40px;
       border-radius:12px;letter-spacing:0.3px;">${texto}</a>
  </td></tr>
</table>`
}

async function enviar(email, html) {
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) return
  await emailjs.send(
    SERVICE_ID,
    TEMPLATE_ID,
    { to_email: email, to_name: email, html_content: html },
    PUBLIC_KEY
  )
}

// Confirmación de cancelación. Lo importante que tiene que quedar claro:
// no se borró nada y puede seguir trabajando hasta la fecha que ya pagó.
export function sendSubscriptionCancelledEmail({ email, accesoHasta, eraTrial }) {
  const cuerpo = [
    parrafo('Cancelamos tu <strong>suscripción mensual</strong> a Evalúa Fácil, tal como lo pediste desde tu perfil.'),
    accesoHasta
      ? parrafo(`Puedes seguir usando tu cuenta con normalidad hasta el <strong>${accesoHasta}</strong>${eraTrial ? ', cuando termina tu período de prueba' : ', el último día que ya tenías cubierto'}. Después de esa fecha ya no se renovará.`)
      : parrafo('Tu suscripción ya no se renovará.'),
    parrafo('<strong>Tus grupos, estudiantes, actividades y calificaciones siguen ahí.</strong> Cancelar no borra nada — si vuelves a activar la suscripción, encuentras todo tal como lo dejaste.'),
  ].join('')

  return enviar(email, armarCorreo({
    titulo: 'Tu suscripción fue cancelada',
    cuerpo,
    accion: boton('Volver a activarla →', SITIO),
  }))
}

// Confirmación de eliminación. Se manda antes de borrar, así que se redacta
// en pasado a propósito: para cuando llegue al buzón, ya no hay cuenta.
export function sendAccountDeletedEmail({ email }) {
  const cuerpo = [
    parrafo('Tu cuenta de <strong>Evalúa Fácil</strong> y toda su información fueron eliminadas de forma definitiva, tal como lo pediste desde tu perfil.'),
    parrafo('Esto incluye tus asignaturas, estudiantes, actividades, calificaciones, asistencias y tu historial de pagos. <strong>No es posible recuperarlos</strong>, ni por nosotros.'),
    parrafo('Si algún día quieres volver, puedes registrarte de nuevo con este mismo correo — sería una cuenta nueva, desde cero.'),
  ].join('')

  return enviar(email, armarCorreo({
    titulo: 'Tu cuenta fue eliminada',
    cuerpo,
    accion: boton('Crear una cuenta nueva →', `${SITIO}/register`),
  }))
}
