import { verifyRequest, getDb } from '../_lib/firebaseAdmin.js'
import { aplicarCors } from '../_lib/cors.js'
import { randomBytes } from 'crypto'

// Authenticated endpoint: a teacher enables password recovery for one of their students.
// Returns a one-time recovery token that the teacher must give to the student verbally/by
// message. The token is stored in a PRIVATE Firestore collection (allow read, write: if false)
// that clients cannot access — the recover-password endpoint reads it server-side via Admin SDK.
//
// Security model:
//   1. Caller must present a valid Firebase ID token (verifyRequest).
//   2. Caller must own the subject the student is enrolled in (docenteId check).
//   3. The token is never written to the public `students` collection — only to
//      `studentResetTokens/{studentId}`, which is inaccessible to any client.
//   4. The token is cryptographically random (4 bytes = 8 hex chars), expires in 24 h,
//      and is invalidated (deleted) after one successful use.

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  try {
    const quien = await verifyRequest(req)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const { studentId } = body
    if (!studentId) return res.status(400).json({ error: 'Falta studentId' })

    const db = getDb()

    // Verify the student exists
    const studentDoc = await db.collection('students').doc(studentId).get()
    if (!studentDoc.exists) return res.status(404).json({ error: 'Alumno no encontrado' })
    const studentData = studentDoc.data()

    // Verify caller owns the subject this enrollment belongs to
    const subjectDoc = await db.collection('subjects').doc(studentData.asignaturaId).get()
    if (!subjectDoc.exists) return res.status(404).json({ error: 'Asignatura no encontrada' })
    if (subjectDoc.data().docenteId !== quien.uid) {
      return res.status(403).json({ error: 'No tienes permiso para este alumno' })
    }

    // Cryptographically secure 8-char token (4 random bytes → 8 uppercase hex chars)
    const token = randomBytes(4).toString('hex').toUpperCase()
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000 // 24 hours

    // Store token in private collection (Admin SDK only — Firestore rule: allow read, write: if false)
    await db.collection('studentResetTokens').doc(studentId).set({
      token,
      expiresAt,
      docenteId: quien.uid,
      createdAt: Date.now(),
    })

    // Update the visible flag on the student doc so the recover UI can tell the student
    // that recovery is enabled. The token itself is NOT stored here.
    await db.collection('students').doc(studentId).update({ resetPassword: true })

    // Token is returned only to the authenticated teacher in this HTTP response.
    // It never touches the public students collection.
    return res.status(200).json({ ok: true, token })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Error al habilitar la recuperación' })
  }
}
