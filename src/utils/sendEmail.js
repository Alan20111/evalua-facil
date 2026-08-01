import { apiUrl } from './apiBase'

// Envía un correo transaccional llamando al endpoint /api/send-email, que a su
// vez lo manda por la API de Brevo desde soporte@evaluafacil.mx (ver
// api/send-email.js). Reemplaza el envío directo por EmailJS: ahora el correo
// sale del servidor y la clave vive solo en Vercel.
//
// Best-effort: si algo falla, NO lanza — devuelve false y el flujo que lo
// llamó (registro, cancelación, borrado) sigue sin romperse, igual que antes.
export async function sendEmail({ to, subject, html, toName }) {
  try {
    const res = await fetch(apiUrl('/api/send-email'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html, toName }),
    })
    return res.ok
  } catch {
    return false
  }
}
