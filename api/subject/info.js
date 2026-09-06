// F-11 (2026-09-07): endpoint público para el flujo de activación QR.
//
// La colección `subjects` pasó de `allow read: if true` a
// `allow read: if request.auth != null`. El único flujo que necesitaba
// leer subjects sin sesión es la pantalla de activación (/activate/:code),
// donde el alumno todavía no tiene cuenta. Este endpoint reemplaza esa
// lectura directa con Admin SDK, devolviendo únicamente los campos
// necesarios para mostrar la pantalla de bienvenida.
//
// IMPORTANTE: el campo `accessCode` NUNCA se devuelve — enviarlo sería
// autoderrota; el código ya llegó como parámetro de ruta al cliente.
// Tampoco se expone `docenteId` (UID privado del docente).
//
// Hobby plan: esta es la función #12 (límite es 12). No agregar más archivos
// sueltos en api/ sin primero consolidar en un dispatcher [action].js.

import { getDb } from '../_lib/firebaseAdmin.js'
import { aplicarCors } from '../_lib/cors.js'

// Campos mínimos para la pantalla de activación. Sin accessCode ni docenteId.
const PUBLIC_FIELDS = ['nombre', 'grupo', 'ciclo', 'fechaInicio', 'fechaFin']

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
  } catch {
    return res.status(400).json({ error: 'Body inválido.' })
  }

  const { subjectCode } = body
  if (!subjectCode || typeof subjectCode !== 'string' || !String(subjectCode).trim()) {
    return res.status(400).json({ error: 'Falta el código de asignatura.' })
  }

  const code = String(subjectCode).trim()

  try {
    const db = getDb()
    const snap = await db.collection('subjects').where('accessCode', '==', code).get()

    if (snap.empty) {
      // Mismo mensaje genérico que el cliente mostraba antes — no revelamos
      // si el código existe o no para no facilitar la enumeración.
      return res.status(404).json({ error: 'No encontramos ninguna asignatura con ese código de acceso. Revisa el código con tu maestro.' })
    }

    const docSnap = snap.docs[0]
    const data = docSnap.data()

    const subject = { id: docSnap.id }
    PUBLIC_FIELDS.forEach((k) => { if (k in data) subject[k] = data[k] })

    return res.status(200).json({ ok: true, subject })
  } catch {
    return res.status(500).json({ error: 'No pudimos cargar la asignatura. Revisa tu conexión e intenta de nuevo.' })
  }
}
