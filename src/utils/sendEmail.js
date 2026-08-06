import { apiUrl } from './apiBase'
import { auth } from '../firebase'

// Envía un correo transaccional llamando al endpoint /api/send-email, que a su
// vez lo manda por la API de Brevo desde soporte@evaluafacil.mx (ver
// api/send-email.js). Reemplaza el envío directo por EmailJS: ahora el correo
// sale del servidor y la clave vive solo en Vercel.
//
// Best-effort: si algo falla, NO lanza — devuelve false y el flujo que lo
// llamó (registro, cancelación, borrado) sigue sin romperse, igual que antes.
// El endpoint exige sesión y que el destinatario sea el correo del propio
// titular (ver api/send-email.js): sin eso era un retransmisor abierto con el
// que cualquiera podía mandar phishing firmado con nuestro dominio. Todos los
// usos de este archivo ocurren con la sesión ya iniciada —bienvenida al
// registrarse, avisos de la propia cuenta— así que el token siempre existe.
export async function sendEmail({ to, subject, html, toName }) {
  try {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return false
    const res = await fetch(apiUrl('/api/send-email'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, subject, html, toName }),
    })
    return res.ok
  } catch {
    return false
  }
}
