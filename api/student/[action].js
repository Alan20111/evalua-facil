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

// ── /api/student/reset-student-password ────────────────────────────
// El docente restablece la contrasena de uno de sus alumnos.
// Lee la contraseña de reset que se generó UNA SOLA VEZ al crear al alumno
// y la aplica de nuevo en Firebase Auth — sin generar ninguna nueva.
// El alumno entra con su contraseña de reset y el sistema lo lleva a elegir
// una contraseña personal (activado: false es la señal).
//
// Seguridad:
//   1. Requiere ID token válido del docente (verifyRequest).
//   2. Verifica que el docente sea dueño de la asignatura donde está inscrito.
//   3. Si resetPassword es null (alumno legacy anterior al sistema), devuelve
//      error 400 — NO genera una contraseña nueva en ese caso.

function studentEmail(username, escuelaId) {
  return `${String(username).toLowerCase()}.${escuelaId}@evalua.local`
}

async function handleResetStudentPassword(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' })
  try {
    const quien = await verifyRequest(req)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const { studentId } = body
    if (!studentId) return res.status(400).json({ error: 'Falta studentId' })

    const db = getDb()
    const fbAuth = getAuth()

    const studentDoc = await db.collection('students').doc(studentId).get()
    if (!studentDoc.exists) return res.status(404).json({ error: 'Alumno no encontrado' })
    const studentData = studentDoc.data()

    const subjectDoc = await db.collection('subjects').doc(studentData.asignaturaId).get()
    if (!subjectDoc.exists) return res.status(404).json({ error: 'Asignatura no encontrada' })
    if (subjectDoc.data().docenteId !== quien.uid) {
      return res.status(403).json({ error: 'No tienes permiso para este alumno' })
    }

    const { resetPassword } = studentData
    if (!resetPassword) {
      return res.status(400).json({
        error: 'Este alumno no tiene contraseña de reset. Fue creado antes de que se implementara este sistema.',
      })
    }

    const email = studentEmail(studentData.username, studentData.escuelaId)
    try {
      const authUser = await fbAuth.getUserByEmail(email)
      await fbAuth.updateUser(authUser.uid, { password: resetPassword })
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e
      return res.status(400).json({ error: 'El alumno aún no ha activado su cuenta.' })
    }

    const raw = String(studentData.username).trim()
    const variants = [...new Set([raw.toLowerCase(), raw.toUpperCase()])]
    const snaps = await Promise.all(
      variants.map((u) => db.collection('students')
        .where('username', '==', u)
        .where('escuelaId', '==', studentData.escuelaId)
        .get())
    )
    const seenIds = new Set()
    const allDocs = snaps.flatMap((s) => s.docs)
      .filter((d) => { if (seenIds.has(d.id)) return false; seenIds.add(d.id); return true })

    const batch = db.batch()
    allDocs.forEach((d) => batch.update(d.ref, { activado: false }))
    await batch.commit()

    return res.status(200).json({ ok: true })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Error al restablecer la contrasena.' })
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

// ── /api/student/lookup ────────────────────────────────────────────
// Endpoint público (pre-autenticación) para los flujos de activación y login.
// NO requiere token porque se llama antes de que el alumno tenga cuenta.
// Solo devuelve los campos mínimos necesarios; nunca expone uid ni metadata.
//
// Modo activación: { subjectCode, username } → student + alreadyHasAccount
// Modo login/recuperación: { username } → students[]

const SAFE_FIELDS = ['username', 'escuelaId', 'activado', 'nombre', 'apellidoPaterno', 'apellidoMaterno']

function pickSafeFields(data) {
  const obj = {}
  SAFE_FIELDS.forEach((k) => { if (k in data) obj[k] = data[k] })
  // resetPassword como booleano — el valor real nunca sale al cliente.
  obj.resetPassword = !!data.resetPassword
  // cuentaExiste indica si el alumno ya tiene cuenta en Firebase Auth
  // (uid presente). Login.jsx lo usa para distinguir primer acceso vs. reset.
  obj.cuentaExiste = !!data.uid
  return obj
}

async function handleLookup(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
  } catch {
    return res.status(400).json({ error: 'Body inválido.' })
  }
  const { subjectCode, username } = body
  if (!username || typeof username !== 'string' || !username.trim() || username.length > 60) {
    return res.status(400).json({ error: 'Falta o es inválido el username.' })
  }
  const u = String(username).trim()
  const variants = [...new Set([u.toLowerCase(), u.toUpperCase()])]
  const db = getDb()

  // Activation mode: subjectCode + username
  if (subjectCode !== undefined && subjectCode !== null) {
    if (typeof subjectCode !== 'string' || !subjectCode.trim() || subjectCode.length > 20) {
      return res.status(400).json({ error: 'Código de asignatura inválido.' })
    }
    const code = String(subjectCode).trim().toUpperCase()
    const subSnap = await db.collection('subjects').where('accessCode', '==', code).limit(1).get()
    if (subSnap.empty) return res.status(404).json({ error: 'Asignatura no encontrada.' })
    const subjectId = subSnap.docs[0].id
    const snaps = await Promise.all(
      variants.map((v) => db.collection('students')
        .where('asignaturaId', '==', subjectId)
        .where('username', '==', v)
        .limit(1).get())
    )
    const seenIds = new Set()
    const unique = snaps.flatMap((s) => s.docs)
      .filter((d) => { if (seenIds.has(d.id)) return false; seenIds.add(d.id); return true })
    if (unique.length === 0) return res.status(404).json({ error: 'Usuario no encontrado en esta asignatura.' })
    const raw = unique[0].data()
    const studentId = unique[0].id
    // ¿Ya tiene cuenta? `activado` de ESTA inscripción puede ser false aunque la
    // cuenta exista en otra asignatura de la misma escuela. Se consultan todas
    // las inscripciones del alumno (mismo username + escuela) para saberlo.
    let alreadyHasAccount = raw.activado === true || !!raw.uid
    if (!alreadyHasAccount && raw.escuelaId) {
      const crossVariants = [...new Set([raw.username?.toLowerCase(), raw.username?.toUpperCase()].filter(Boolean))]
      const crossSnaps = await Promise.all(
        crossVariants.map((v) => db.collection('students')
          .where('username', '==', v)
          .where('escuelaId', '==', raw.escuelaId)
          .get())
      )
      const seenIds2 = new Set()
      const allEnrollments = crossSnaps.flatMap((s) => s.docs)
        .filter((d) => { if (seenIds2.has(d.id)) return false; seenIds2.add(d.id); return true })
      alreadyHasAccount = allEnrollments.some((d) => {
        const s = d.data()
        return s.activado === true || !!s.uid
      })
    }
    return res.status(200).json({
      ok: true,
      student: { id: studentId, ...pickSafeFields(raw) },
      alreadyHasAccount,
    })
  }

  // Login mode: username only (global search across all schools)
  const snaps = await Promise.all(
    variants.map((v) => db.collection('students').where('username', '==', v).get())
  )
  const seenIds = new Set()
  const docs = snaps.flatMap((s) => s.docs)
    .filter((d) => { if (seenIds.has(d.id)) return false; seenIds.add(d.id); return true })
  const students = docs.map((d) => ({ id: d.id, ...pickSafeFields(d.data()) }))
  return res.status(200).json({ ok: true, students })
}

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return
  const { action } = req.query
  try {
    if (action === 'lookup') return await handleLookup(req, res)
    if (action === 'delete') return await handleDelete(req, res)
    if (action === 'reset-student-password') return await handleResetStudentPassword(req, res)
    if (action === 'remove-photo') return await handleRemovePhoto(req, res)
    return res.status(404).json({ error: 'Acción no encontrada.' })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Error interno.' })
  }
}