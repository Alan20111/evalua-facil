// Despachador único de los endpoints de asignatura.
//
// Vercel trata este archivo como UNA sola función serverless (ruta dinámica):
// /api/subject/{action} llega con req.query.action = '{action}'.
//
// Están juntos porque el plan Hobby admite 12 funciones por despliegue.
// Al añadir un endpoint nuevo, agrégalo aquí como una acción más en vez de
// crear otro archivo suelto.
//
// ┌─────────────────────────────────┬───────┬─────────────────────────────┐
// │ Acción                          │ Auth  │ Descripción                 │
// ├─────────────────────────────────┼───────┼─────────────────────────────┤
// │ info                            │ No    │ Datos públicos de asignatura │
// │ delete-fuente                   │ Sí    │ Borra fuente de IA          │
// │ delete-planeacion-archivo       │ Sí    │ Borra archivo de planeación │
// │ delete-resources                │ Sí    │ Borra recursos/materiales   │
// └─────────────────────────────────┴───────┴─────────────────────────────┘

import { getDb, admin, verifyRequest } from '../_lib/firebaseAdmin.js'
import { extraerAssets, borrarAssets } from '../_lib/cloudinary.js'
import { aplicarCors } from '../_lib/cors.js'

// ── /api/subject/info ──────────────────────────────────────────────────────
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

const PUBLIC_FIELDS = ['nombre', 'grupo', 'ciclo', 'fechaInicio', 'fechaFin']

async function handleInfo(req, res) {
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

// ── /api/subject/delete-fuente ─────────────────────────────────────────────
// Borra UNA fuente del Asistente IA (fuentesAsignatura) y su archivo en
// Cloudinary — borrar en Cloudinary exige CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET,
// que nunca viven en el cliente. Sin este paso, quitar una fuente solo borraba
// el documento de Firestore y el PDF/Word se quedaba huérfano en Cloudinary.

async function handleDeleteFuente(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const { uid } = await verifyRequest(req)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const fuenteId = String(body.fuenteId || '').trim()
    if (!fuenteId) {
      return res.status(400).json({ error: 'Falta fuenteId.' })
    }

    const db = getDb()
    const fuenteRef = db.collection('fuentesAsignatura').doc(fuenteId)
    const fuenteDoc = await fuenteRef.get()
    if (!fuenteDoc.exists) {
      return res.status(200).json({ ok: true, archivos: { total: 0, borrados: 0, noEncontrados: 0, pendientes: [] } })
    }
    // Solo el docente dueño de la fuente puede borrarla — no basta con que
    // sea dueño de la asignatura de otro, ni con estar autenticado.
    if (fuenteDoc.data().docenteId !== uid) {
      return res.status(403).json({ error: 'Esta fuente no es tuya.' })
    }

    const assets = extraerAssets(fuenteDoc.data())
    await fuenteRef.delete()

    const archivos = await borrarAssets(assets, { origen: 'subject/delete-fuente', uid })
    if (archivos.pendientes?.length) {
      console.warn(
        `[borrar-fuente ${fuenteId}] archivo NO borrado de Cloudinary` +
        `${archivos.configurado === false ? ' (faltan CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)' : ''}: ` +
        archivos.pendientes.join(', ')
      )
    }

    return res.status(200).json({ ok: true, archivos })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo borrar la fuente.' })
  }
}

// ── /api/subject/delete-planeacion-archivo ────────────────────────────────
// Borra de Cloudinary el archivo de una planeación propia que YA dejó de ser
// la vigente (1-sep-2026). Mismo motivo: borrar en Cloudinary exige secretos
// que no viven en el cliente.
//
// El cliente NO manda ninguna URL: manda solo la asignatura. La URL real se
// lee de `subjects/{id}.planeacionArchivoPorBorrar`, que el propio cliente
// dejó escrita en la MISMA operación atómica en la que cambió la planeación
// vigente. Así el servidor nunca borra un archivo por el simple hecho de que
// alguien se lo pida: solo borra lo que el documento ya declara como reemplazado.
//
// Nunca borra el archivo de la planeación que SÍ está vigente: si por
// lo que sea las dos URLs coinciden, se limpia la marca y no se toca nada.

async function handleDeletePlaneacionArchivo(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const { uid } = await verifyRequest(req)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const subjectId = String(body.subjectId || '').trim()
    if (!subjectId) {
      return res.status(400).json({ error: 'Falta subjectId.' })
    }

    const db = getDb()
    const subjectRef = db.collection('subjects').doc(subjectId)
    const subjectDoc = await subjectRef.get()
    if (!subjectDoc.exists) {
      return res.status(404).json({ error: 'La asignatura no existe.' })
    }
    const datos = subjectDoc.data()
    if (datos.docenteId !== uid) {
      return res.status(403).json({ error: 'Esta asignatura no es tuya.' })
    }

    const porBorrar = datos.planeacionArchivoPorBorrar
    if (!porBorrar?.url) {
      return res.status(200).json({ ok: true, archivos: { total: 0, borrados: 0, noEncontrados: 0, pendientes: [] } })
    }

    // Candado final: jamás borrar el archivo de la planeación vigente.
    const vigente = datos.planeacionAceptada
    if (vigente?.origen === 'archivo' && vigente?.archivo?.url === porBorrar.url) {
      await subjectRef.update({ planeacionArchivoPorBorrar: admin.firestore.FieldValue.delete() })
      return res.status(200).json({ ok: true, archivos: { total: 0, borrados: 0, noEncontrados: 0, pendientes: [] } })
    }

    const assets = extraerAssets(porBorrar)
    const archivos = await borrarAssets(assets, { origen: 'subject/delete-planeacion-archivo', uid })

    // La marca se quita siempre: si el borrado falló, reintentarlo en cada
    // carga de la pantalla no lo arreglaría y dejaría el documento con basura.
    await subjectRef.update({ planeacionArchivoPorBorrar: admin.firestore.FieldValue.delete() })

    if (archivos.pendientes?.length) {
      console.warn(
        `[borrar-planeacion-archivo ${subjectId}] archivo NO borrado de Cloudinary` +
        `${archivos.configurado === false ? ' (faltan CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)' : ''}: ` +
        archivos.pendientes.join(', ')
      )
    }

    return res.status(200).json({ ok: true, archivos })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo borrar el archivo de la planeación.' })
  }
}

// ── /api/subject/delete-resources ─────────────────────────────────────────
// Borra los `resources` y `materials` de UNA asignatura, y sus archivos en
// Cloudinary — el paso que le faltaba a deleteSubjectCascade.js (A12 H1).
//
// El resto de la cascada (activities, students, attendance, submissions,
// horarioBloques) sigue borrándose en el cliente: esas colecciones no suben
// nada a Cloudinary, así que el navegador ya las deja limpias del todo.
// `resources`/`materials` sí guardan archivos (url / archivos[]), y borrar en
// Cloudinary necesita secretos que nunca viven en el cliente.
//
// Se llama ANTES de que el cliente borre el resto de la asignatura: solo
// aquí se puede leer resources/materials para sacar sus URLs antes de que
// desaparezcan.

async function handleDeleteResources(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const { uid } = await verifyRequest(req)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const subjectId = String(body.subjectId || '').trim()
    if (!subjectId) {
      return res.status(400).json({ error: 'Falta subjectId.' })
    }

    const db = getDb()

    // La asignatura tiene que ser de quien pide el borrado — un docente no
    // puede vaciar Cloudinary de la asignatura de otro con un POST directo.
    const subjectDoc = await db.collection('subjects').doc(subjectId).get()
    if (!subjectDoc.exists || subjectDoc.data().docenteId !== uid) {
      return res.status(403).json({ error: 'Esta asignatura no es tuya.' })
    }

    const [recursos, materiales] = await Promise.all([
      db.collection('resources').where('asignaturaId', '==', subjectId).get(),
      db.collection('materials').where('asignaturaId', '==', subjectId).get(),
    ])

    const assets = new Map()
    recursos.docs.forEach((d) => extraerAssets(d.data(), assets))
    materiales.docs.forEach((d) => extraerAssets(d.data(), assets))

    const batch = db.batch()
    recursos.docs.forEach((d) => batch.delete(d.ref))
    materiales.docs.forEach((d) => batch.delete(d.ref))
    if (recursos.size || materiales.size) await batch.commit()

    const archivos = await borrarAssets(assets, { origen: 'subject/delete-resources', uid })
    if (archivos.pendientes?.length) {
      console.warn(
        `[borrar-asignatura ${subjectId}] ${archivos.pendientes.length} archivos NO borrados de Cloudinary` +
        `${archivos.configurado === false ? ' (faltan CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)' : ''}: ` +
        archivos.pendientes.join(', ')
      )
    }

    return res.status(200).json({
      ok: true, recursos: recursos.size, materiales: materiales.size, archivos,
    })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudieron borrar los recursos.' })
  }
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return
  const { action } = req.query
  try {
    if (action === 'info')                      return await handleInfo(req, res)
    if (action === 'delete-fuente')             return await handleDeleteFuente(req, res)
    if (action === 'delete-planeacion-archivo') return await handleDeletePlaneacionArchivo(req, res)
    if (action === 'delete-resources')          return await handleDeleteResources(req, res)
    return res.status(404).json({ error: 'Acción no encontrada.' })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Error interno.' })
  }
}
