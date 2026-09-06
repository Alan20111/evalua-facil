import { verifyRequest, getDb } from '../_lib/firebaseAdmin.js'
import { aplicarCors } from '../_lib/cors.js'

// Authenticated endpoint: returns evaluación questions to:
//   • the teacher who owns the activity (for editor, review, export)
//   • a student who has an active submission (en_progreso OR finalizado)
//   • any authenticated user for juego activities (words are not secret)
//
// Never returns the `clave/` subcollection (correct answers).
// Students must go through this endpoint — Firestore rules now block direct reads.
export default async function handler(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  try {
    const quien = await verifyRequest(req)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const { activityId } = body
    if (!activityId) return res.status(400).json({ error: 'Falta activityId' })

    const db = getDb()

    const actDoc = await db.collection('activities').doc(activityId).get()
    if (!actDoc.exists) return res.status(404).json({ error: 'Actividad no encontrada' })
    const actData = actDoc.data()

    // Juego activities (crucigrama, sopa de letras): words are not secret, allow any authed user
    if (actData.categoria === 'juego') {
      const preguntasSnap = await db.collection('activities').doc(activityId).collection('preguntas').get()
      const questions = preguntasSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      return res.status(200).json({ ok: true, questions })
    }

    // Check if caller is a teacher (has users/{uid} doc with role: 'docente')
    const userDoc = await db.collection('users').doc(quien.uid).get()
    const isDocente = userDoc.exists && userDoc.data().role === 'docente'

    if (isDocente) {
      if (actData.docenteId !== quien.uid) {
        return res.status(403).json({ error: 'No tienes permiso para esta actividad' })
      }
    } else {
      // Student path: verify enrollment in subject + active submission
      const subjectId = actData.asignaturaId
      const studentSnap = await db.collection('students')
        .where('uid', '==', quien.uid)
        .where('asignaturaId', '==', subjectId)
        .get()

      if (studentSnap.empty) {
        return res.status(403).json({ error: 'No estás inscrito en esta asignatura' })
      }

      const studentId = studentSnap.docs[0].id
      const submissionId = `${activityId}_${studentId}`

      const submissionDoc = await db.collection('submissions').doc(submissionId).get()
      if (!submissionDoc.exists) {
        return res.status(403).json({ error: 'No tienes un intento activo para esta evaluación' })
      }

      const estado = submissionDoc.data().estadoEvaluacion
      if (estado !== 'en_progreso' && estado !== 'finalizado') {
        return res.status(403).json({ error: 'No tienes un intento activo para esta evaluación' })
      }
    }

    const preguntasSnap = await db.collection('activities').doc(activityId).collection('preguntas').get()
    const questions = preguntasSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))

    return res.status(200).json({ ok: true, questions })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Error al obtener las preguntas' })
  }
}
