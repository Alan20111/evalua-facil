// Despachador único de los endpoints del alumno.
//
// Vercel trata este archivo como UNA sola función serverless (ruta dinámica):
// /api/student/{action} llega con req.query.action = '{action}'.
//
// Están juntos por una razón concreta: el plan Hobby admite 12 funciones por
// despliegue y el proyecto llegó a 13, así que TODOS los despliegues de
// producción empezaron a fallar después de compilar correctamente. Mismo
// motivo y misma solución que api/admin/[action].js (ver daa3991).
//
// Al añadir un endpoint nuevo, agrégalo aquí como una acción más en vez de
// crear otro archivo.


// ── /api/student/delete ────────────────────────────────────────────
// Eliminar la cuenta de un estudiante — solo si ya no está inscrito en
// ninguna asignatura.
//
// La condición no es un tecnicismo, es de fondo: las calificaciones, entregas
// y asistencias de un estudiante inscrito NO son suyas, son el registro
// académico de su maestro. Si el estudiante pudiera borrarlas, cualquiera con
// un mal parcial se borraría antes del cierre y le abriría un hueco a la
// lista del docente. Mientras tenga clases, la baja la decide el maestro
// (que ya tiene su acción "Eliminar estudiante"); esta cuenta solo se puede
// eliminar cuando ya no le queda ninguna, o sea cuando ya no hay registro
// académico de por medio.
//
// La comprobación se repite aquí aunque el cliente ya la haya hecho: un POST
// suelto a este endpoint no puede saltarse la regla.

import { aplicarCors } from '../_lib/cors.js'
import { borrarAssets, extraerAssets } from '../_lib/cloudinary.js'
import { getAuth, getDb, verifyRequest } from '../_lib/firebaseAdmin.js'
import { randomBytes } from 'crypto'

const PALABRA_CONFIRMACION = 'ELIMINAR'

async function handleDelete(req, res) {
  if (aplicarCors(req, res)) return // preflight de la app
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const { uid } = await verifyRequest(req)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    if (String(body.confirmacion || '').trim().toUpperCase() !== PALABRA_CONFIRMACION) {
      return res.status(400).json({ error: 'Falta la confirmación.' })
    }

    const db = getDb()
    const auth = getAuth()

    const inscripciones = await db.collection('students').where('uid', '==', uid).get()
    if (!inscripciones.empty) {
      return res.status(409).json({
        error: 'Todavía estás inscrito en una asignatura. Pídele a tu maestro que te dé de baja.',
        inscripciones: inscripciones.size,
      })
    }

    // Sin inscripciones no queda de dónde leer la foto, así que el cliente
    // manda la que traía en pantalla; se comprueba que sea de Cloudinary
    // antes de intentar nada con ella.
    const assets = new Map()
    if (body.photoURL) extraerAssets({ url: body.photoURL }, assets)

    // Estado personal: notificaciones + aviso-estado + agenda propia (R13).
    // Con alumnoId se resuelven sin índice compuesto.
    // avisoLecturas se omite a propósito: son registros de auditoría inmutables.
    const [bitacora, guardados, ocultos, eventos] = await Promise.all([
      db.collection('notificationLog').where('uid', '==', uid).get(),
      db.collection('avisoGuardados').where('alumnoId', '==', uid).get(),
      db.collection('avisoOcultos').where('alumnoId', '==', uid).get(),
      db.collection('studentEvents').where('alumnoId', '==', uid).get(),
    ])

    const refs = [db.collection('notificationSettings').doc(uid)]
    bitacora.docs.forEach((d) => refs.push(d.ref))
    guardados.docs.forEach((d) => refs.push(d.ref))
    ocultos.docs.forEach((d) => refs.push(d.ref))
    eventos.docs.forEach((d) => refs.push(d.ref))

    const batch = db.batch()
    refs.forEach((r) => batch.delete(r))
    await batch.commit()

    const archivos = await borrarAssets(assets, { origen: 'student/delete', uid })
    if (archivos.pendientes?.length) {
      console.warn(
        `[eliminar-alumno ${uid}] ${archivos.pendientes.length} archivos NO borrados de Cloudinary` +
        `${archivos.configurado === false ? ' (faltan CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)' : ''}: ` +
        archivos.pendientes.join(', ')
      )
    }

    // Al final, igual que en el borrado del docente: mientras la cuenta de
    // Auth exista, un fallo a media limpieza lo deja reintentando y no fuera.
    await auth.deleteUser(uid)

    return res.status(200).json({ ok: true, documentosEliminados: refs.length, archivos })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo eliminar la cuenta.' })
  }
}

// ── /api/student/enable-recovery ───────────────────────────────────
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

async function handleEnableRecovery(req, res) {
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

// ── /api/student/recover-password ──────────────────────────────────
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
  } catch (e) {
    // Only "no existe" means we should create it; any other error must surface.
    if (e.code !== 'auth/user-not-found') throw e
  }
  if (user) {
    await auth.updateUser(user.uid, { password: newPassword })
    return user.uid
  }
  const created = await auth.createUser({ email, password: newPassword })
  return created.uid
}

async function handleRecoverPassword(req, res) {
  if (aplicarCors(req, res)) return // preflight de la app
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    // Vercel usually parses JSON bodies, but be defensive if it arrives as a string.
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const { username, escuelaId, newPassword, resetToken } = body
    if (!username || !String(username).trim() || !newPassword || !resetToken) {
      return res.status(400).json({ error: 'Faltan datos (usuario, código de recuperación y nueva contraseña).' })
    }
    // escuelaId is required so a username can never be resolved across schools.
    if (!escuelaId) {
      return res.status(400).json({ error: 'Falta la escuela del alumno.' })
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' })
    }

    const db = getDb()
    // Search both lowercase (new format) and UPPERCASE (legacy 4-char codes).
    // The old code only queried .toUpperCase(), which silently missed every
    // new-format username stored in lowercase ("munoz.enrique" ≠ "MUNOZ.ENRIQUE").
    const raw = String(username).trim()
    const variants = [...new Set([raw.toLowerCase(), raw.toUpperCase()])]
    const snaps = await Promise.all(
      variants.map((u) => db.collection('students').where('username', '==', u).get())
    )
    const seenIds = new Set()
    const docs = snaps
      .flatMap((s) => s.docs)
      .filter((d) => { if (seenIds.has(d.id)) return false; seenIds.add(d.id); return true })
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((d) => d.escuelaId === escuelaId)
    if (!docs.length) {
      return res.status(404).json({ error: 'No encontramos ese usuario.' })
    }

    // The teacher must have enabled recovery (resetPassword set) on at least one enrollment.
    const enabled = docs.find((d) => d.resetPassword)
    if (!enabled) {
      return res.status(403).json({ error: 'La recuperación de contraseña no está habilitada. Pídele a tu maestro que la habilite.' })
    }

    // Validate the one-time token against the private collection (inaccessible to clients).
    // This prevents unauthenticated attackers from taking over accounts even when
    // the public `students` collection exposes the resetPassword flag.
    const tokenDoc = await db.collection('studentResetTokens').doc(enabled.id).get()
    if (!tokenDoc.exists) {
      return res.status(403).json({ error: 'Código de recuperación no válido. Pídele a tu maestro que genere uno nuevo.' })
    }
    const tokenData = tokenDoc.data()
    if (tokenData.token !== String(resetToken).toUpperCase().trim()) {
      return res.status(403).json({ error: 'Código de recuperación incorrecto.' })
    }
    if (tokenData.expiresAt < Date.now()) {
      return res.status(403).json({ error: 'El código de recuperación expiró (válido 24 h). Pídele a tu maestro que genere uno nuevo.' })
    }

    // Aquí había una guarda que rechazaba a los estudiantes con correo
    // verificado, porque su email de Auth había dejado de ser el
    // @evalua.local y este flujo habría bifurcado la cuenta en dos. Se fue con
    // la función del correo de recuperación: el email de Auth de un estudiante
    // ya nunca cambia, así que esta —la recuperación que habilita su maestro—
    // es la única, y vale para todos sin excepción.
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

    // Invalidate the one-time token so it cannot be reused.
    // This runs after the password change succeeds — a failure here is non-critical
    // (the token expires in 24 h regardless) but logged for observability.
    try {
      await db.collection('studentResetTokens').doc(enabled.id).delete()
    } catch (deleteErr) {
      console.error('[recover-password] no se pudo limpiar studentResetTokens:', deleteErr.message)
    }

    return res.status(200).json({ ok: true })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Error al recuperar la contraseña.' })
  }
}

// ── /api/student/remove-photo ──────────────────────────────────────
// "Sin foto" — el estudiante quita la foto que subió.
//
// Limpiar el campo `photoURL` de sus inscripciones lo podría hacer el propio
// navegador (las reglas se lo permiten sobre su propio registro), pero eso
// solo la quitaría de la vista: el archivo seguiría vivo en Cloudinary y
// accesible por su URL para quien la tuviera. Y borrar en Cloudinary necesita
// secreto, que no puede estar en el cliente. Por eso las dos cosas pasan aquí:
// que ya no esté en ningún lado es justo lo que se pidió.

async function handleRemovePhoto(req, res) {
  if (aplicarCors(req, res)) return // preflight de la app
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const { uid } = await verifyRequest(req)
    const db = getDb()

    const snap = await db.collection('students').where('uid', '==', uid).get()
    if (snap.empty) {
      return res.status(404).json({ error: 'No encontramos tu inscripción.' })
    }

    // La foto vive repetida en cada inscripción del estudiante (una por
    // asignatura), así que se recolectan todas: normalmente es el mismo
    // archivo, pero si quedó una URL vieja en alguna, también se va.
    const assets = new Map()
    snap.docs.forEach((d) => {
      const url = d.data().photoURL
      if (url) extraerAssets({ url }, assets)
    })

    const batch = db.batch()
    snap.docs.forEach((d) => batch.update(d.ref, { photoURL: null }))
    await batch.commit()

    const archivos = await borrarAssets(assets, { origen: 'student/remove-photo', uid })
    if (archivos.pendientes?.length) {
      console.warn(
        `[quitar-foto ${uid}] ${archivos.pendientes.length} archivos NO borrados de Cloudinary` +
        `${archivos.configurado === false ? ' (faltan CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)' : ''}: ` +
        archivos.pendientes.join(', ')
      )
    }

    return res.status(200).json({ ok: true, inscripciones: snap.size, archivos })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo quitar la foto.' })
  }
}

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return
  const { action } = req.query
  try {
    if (action === 'delete') return await handleDelete(req, res)
    if (action === 'enable-recovery') return await handleEnableRecovery(req, res)
    if (action === 'recover-password') return await handleRecoverPassword(req, res)
    if (action === 'remove-photo') return await handleRemovePhoto(req, res)
    return res.status(404).json({ error: 'Acción no encontrada.' })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Error interno.' })
  }
}