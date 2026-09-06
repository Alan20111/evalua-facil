// Despachador único de los endpoints de asignatura.
//
// Vercel trata este archivo como UNA sola función serverless (ruta dinámica):
// /api/subject/{action} llega con req.query.action = '{action}'.
//
// Están juntos porque el plan Hobby admite 12 funciones por despliegue.
// Al añadir un endpoint nuevo, agrégalo aquí como una acción más en vez de
// crear otro archivo suelto.
//
import crypto from 'crypto'
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

// ── /api/subject/content ──────────────────────────────────────────────────
// F-09 (2026-09-06): puerta de acceso verificada para los alumnos.
//
// Tras endurecer las reglas de Firestore, las colecciones de contenido
// (activities, resources, materials, avisos, academicEvents, horarioBloques)
// ya no son de lectura abierta para cualquier autenticado: solo el docente
// dueño o un admin puede leerlas directamente. Los alumnos pasan por aquí.
//
// El servidor verifica la inscripción real del alumno antes de devolver
// ningún documento: consulta `students.where('uid', '==', uid)` y comprueba
// que el asignaturaId solicitado esté en ese resultado. Misma fuente de
// verdad que studentLookup.js en el cliente.
//
// Modos de llamada (Body):
//   { tipo, subjectId }           → todos los docs de una asignatura
//   { tipo, subjectIds: [...] }   → batch: varias asignaturas a la vez (Agenda)
//   { tipo: 'activities', docId } → una actividad por id (ActivityPage)
//
// Colecciones permitidas: CONTENT_TIPOS (lista cerrada — no es un proxy
// genérico a Firestore).
//
// Serialización: los Timestamps del Admin SDK se convierten a
// { seconds, nanoseconds } para sobrevivir JSON. El cliente los rehidrata con
// rehydrateTimestamps() (src/utils/apiContent.js).

const CONTENT_TIPOS = new Set(['activities', 'resources', 'materials', 'avisos', 'academicEvents', 'horarioBloques'])

function serializeDoc(snap) {
  function walk(v) {
    if (v === null || v === undefined) return v
    if (typeof v.toDate === 'function') return { seconds: v._seconds ?? v.seconds, nanoseconds: v._nanoseconds ?? v.nanoseconds }
    if (Array.isArray(v)) return v.map(walk)
    if (typeof v === 'object') {
      const out = {}
      for (const k of Object.keys(v)) out[k] = walk(v[k])
      return out
    }
    return v
  }
  return { id: snap.id, ...walk(snap.data()) }
}

async function handleContent(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  let decoded
  try { decoded = await verifyRequest(req) }
  catch (err) { return res.status(err.status || 401).json({ error: err.message }) }

  let body
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) }
  catch { return res.status(400).json({ error: 'Body inválido.' }) }

  const { tipo, docId } = body
  let subjectIds = []
  if (body.subjectId) subjectIds = [String(body.subjectId).trim()]
  else if (Array.isArray(body.subjectIds)) subjectIds = body.subjectIds.map((s) => String(s).trim()).filter(Boolean)

  if (!tipo || !CONTENT_TIPOS.has(tipo)) {
    return res.status(400).json({ error: 'Tipo de contenido no válido.' })
  }
  const docIdStr = docId ? String(docId).trim() : null
  if (!docIdStr && subjectIds.length === 0) {
    return res.status(400).json({ error: 'Falta subjectId, subjectIds o docId.' })
  }
  if (docIdStr && tipo !== 'activities') {
    return res.status(400).json({ error: 'docId solo está permitido para activities.' })
  }

  const { uid, email } = decoded
  const db = getDb()
  const isAlumno = typeof email === 'string' && email.endsWith('@evalua.local')

  if (isAlumno) {
    // Alumno: verificar inscripción real vía Admin SDK
    const studSnap = await db.collection('students').where('uid', '==', uid).get()
    const enrolled = new Set(studSnap.docs.map((d) => d.data().asignaturaId).filter(Boolean))

    if (docIdStr) {
      // Una actividad por id: buscar su asignaturaId y verificar inscripción
      const actDoc = await db.collection('activities').doc(docIdStr).get()
      if (!actDoc.exists) return res.status(404).json({ error: 'Actividad no encontrada.' })
      if (!enrolled.has(actDoc.data().asignaturaId)) {
        return res.status(403).json({ error: 'No estás inscrito en esta asignatura.' })
      }
      return res.status(200).json({ ok: true, docs: [serializeDoc(actDoc)] })
    }

    for (const sid of subjectIds) {
      if (!enrolled.has(sid)) return res.status(403).json({ error: 'No estás inscrito en esta asignatura.' })
    }
  } else {
    // Docente o admin
    if (docIdStr) return res.status(400).json({ error: 'docId no está disponible para docentes.' })

    const userDoc = await db.collection('users').doc(uid).get()
    const role = userDoc.exists ? userDoc.data().role : null
    if (role !== 'admin') {
      // Docente: verificar propiedad de cada asignatura solicitada
      for (const sid of subjectIds) {
        const subDoc = await db.collection('subjects').doc(sid).get()
        if (!subDoc.exists || subDoc.data().docenteId !== uid) {
          return res.status(403).json({ error: 'Esta asignatura no es tuya.' })
        }
      }
    }
  }

  // Fetch: hasta 30 ids por cláusula `in` (límite de Firestore)
  const chunks = []
  for (let i = 0; i < subjectIds.length; i += 30) chunks.push(subjectIds.slice(i, i + 30))

  const snaps = await Promise.all(
    chunks.map((ids) => db.collection(tipo).where('asignaturaId', 'in', ids).get())
  )
  return res.status(200).json({ ok: true, docs: snaps.flatMap((s) => s.docs).map(serializeDoc) })
}

// ── /api/subject/sign-upload ───────────────────────────────────────────────
// F-08 (2026-09-06): genera una firma de Cloudinary para que el cliente suba
// archivos directamente a la CDN sin exponer el upload_preset ni el cloud_name
// en el bundle público.
//
// El secreto (CLOUDINARY_API_SECRET) nunca abandona el servidor. La firma
// cubre { folder, timestamp } en orden alfabético y caduca cuando Cloudinary
// ya no la acepta: la API de Cloudinary rechaza timestamps con más de 1 hora
// de diferencia respecto a su reloj — esa es la ventana real; no existe ningún
// mecanismo oficial para acortarla más sin almacenar nonces en base de datos.
//
// Solo se firma una carpeta de la lista de permisos. Los alumnos únicamente
// pueden usar sus carpetas específicas; los docentes pueden usar todas.
// La distinción alumno/docente se hace por el dominio del email del token
// (@evalua.local es siempre un alumno — ver auth flow en CLAUDE.md).

const CARPETAS_DOCENTE = new Set([
  'evalua-facil/avatars',
  'evalua-facil/instrucciones',
  'evalua-facil/instrucciones-adjuntos',
  'evalua-facil/ia-fuentes',
  'evalua-facil/ia-rubrica-evidencia',
  'evalua-facil/preguntas',
  'evalua-facil/programas-estudio',
  'evalua-facil/planeaciones-docente',
  'evalua-facil/recursos',
  'evalua-facil/materiales',
])

const CARPETAS_ALUMNO = new Set([
  'evalua-facil/profiles',
  'evalua-facil/submissions',
])

async function handleSignUpload(req, res) {
  if (aplicarCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  let decoded
  try {
    decoded = await verifyRequest(req)
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message })
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
  } catch {
    return res.status(400).json({ error: 'Body inválido.' })
  }

  const folder = String(body.folder || '').trim()
  if (!folder) return res.status(400).json({ error: 'Falta la carpeta de destino.' })

  const isAlumno = decoded.email?.endsWith('@evalua.local') ?? false
  const permitidas = isAlumno
    ? CARPETAS_ALUMNO
    : new Set([...CARPETAS_DOCENTE, ...CARPETAS_ALUMNO])

  if (!permitidas.has(folder)) {
    return res.status(403).json({ error: 'Carpeta de destino no permitida.' })
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey    = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET

  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: 'El servidor no está configurado para subida de archivos.' })
  }

  const timestamp = Math.floor(Date.now() / 1000)
  // Parámetros firmados: folder y timestamp, en orden alfabético, seguido del
  // apiSecret. La firma cubre exactamente lo que el cliente mandará en el
  // FormData; si se añaden más parámetros deben entrar aquí en su lugar
  // alfabético o Cloudinary rechazará la petición por firma inválida.
  const signature = crypto
    .createHash('sha1')
    .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
    .digest('hex')

  return res.status(200).json({ cloudName, apiKey, timestamp, signature, folder })
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

// ┌─────────────────────────────────┬───────┬─────────────────────────────┐
// │ Acción                          │ Auth  │ Descripción                 │
// ├─────────────────────────────────┼───────┼─────────────────────────────┤
// │ info                            │ No    │ Datos públicos de asignatura │
// │ content                         │ Sí    │ Contenido protegido (F-09)  │
// │ sign-upload                     │ Sí    │ Firma de upload a Cloudinary │
// │ delete-fuente                   │ Sí    │ Borra fuente de IA          │
// │ delete-planeacion-archivo       │ Sí    │ Borra archivo de planeación │
// │ delete-resources                │ Sí    │ Borra recursos/materiales   │
// └─────────────────────────────────┴───────┴─────────────────────────────┘

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return
  const { action } = req.query
  try {
    if (action === 'info')                      return await handleInfo(req, res)
    if (action === 'content')                   return await handleContent(req, res)
    if (action === 'sign-upload')               return await handleSignUpload(req, res)
    if (action === 'delete-fuente')             return await handleDeleteFuente(req, res)
    if (action === 'delete-planeacion-archivo') return await handleDeletePlaneacionArchivo(req, res)
    if (action === 'delete-resources')          return await handleDeleteResources(req, res)
    return res.status(404).json({ error: 'Acción no encontrada.' })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Error interno.' })
  }
}
