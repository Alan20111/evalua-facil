import { getDb, getAuth } from '../_lib/firebaseAdmin.js'

// Password recovery for a student who FORGOT their password. This cannot be done from the
// browser: student accounts use fake @evalua.local emails (no reset email possible) and a
// client cannot change a password it doesn't know. The Admin SDK can.
//
// Gate: recovery only proceeds if the teacher ENABLED it for that student, i.e. the student
// doc has a non-empty `resetPassword` flag (set by the teacher's "Habilitar recuperación"
// action). After a successful reset the flag is cleared (one-shot).
//
// Requires the env var FIREBASE_SERVICE_ACCOUNT in Vercel (same as the payment endpoints).

function studentEmail(username, escuelaId) {
  return `${String(username).toLowerCase()}.${escuelaId}@evalua.local`
}

async function setAuthPassword(email, newPassword) {
  const auth = getAuth()
  let user = null
  try {
    user = await auth.getUserByEmail(email)
  } catch {
    user = null
  }
  if (user) {
    await auth.updateUser(user.uid, { password: newPassword })
    return user.uid
  }
  const created = await auth.createUser({ email, password: newPassword })
  return created.uid
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const { username, escuelaId, newPassword } = req.body || {}
    if (!username || !newPassword) {
      return res.status(400).json({ error: 'Faltan datos (username y nueva contraseña).' })
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' })
    }

    const db = getDb()
    const snap = await db
      .collection('students')
      .where('username', '==', String(username).toUpperCase())
      .get()
    let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    if (escuelaId) docs = docs.filter((d) => d.escuelaId === escuelaId)
    if (!docs.length) {
      return res.status(404).json({ error: 'No encontramos ese usuario.' })
    }

    // The teacher must have enabled recovery (resetPassword set) on at least one enrollment.
    const enabled = docs.find((d) => d.resetPassword)
    if (!enabled) {
      return res.status(403).json({ error: 'La recuperación de contraseña no está habilitada. Pídele a tu maestro que la habilite.' })
    }

    const email = studentEmail(enabled.username, enabled.escuelaId)
    const uid = await setAuthPassword(email, newPassword)

    // Clear the flag + mark activated on every enrollment of this student (same account).
    const batch = db.batch()
    docs
      .filter((d) => d.username === enabled.username && d.escuelaId === enabled.escuelaId)
      .forEach((d) => batch.update(db.collection('students').doc(d.id), {
        activado: true,
        uid,
        resetPassword: null,
      }))
    await batch.commit()

    return res.status(200).json({ ok: true })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Error al recuperar la contraseña.' })
  }
}
