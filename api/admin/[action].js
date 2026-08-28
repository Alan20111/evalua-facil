import { getDb, getAuth, verifyRequest } from '../_lib/firebaseAdmin.js'
import { extraerAssets, borrarAssets } from '../_lib/cloudinary.js'
import { aplicarCors } from '../_lib/cors.js'

// Dispatcher único para todos los endpoints de administración.
// Vercel trata este archivo como UNA sola función serverless (ruta dinámica).
// La URL /api/admin/{action} llega con req.query.action = '{action}'.

const LIMITE_LOTE = 400

const POR_DOCENTE = ['subjects', 'activities', 'attendance', 'events', 'horarioBloques',
  'horario', 'asuetos', 'vacaciones', 'bancoReactivos', 'bancoRubricas',
  'avisos', 'avisoPlantillas', 'academicEvents', 'subscriptions', 'payments']

const CON_SUBCOLECCIONES = { activities: 'preguntas', submissions: 'respuestas' }

async function borrarRefs(db, refs) {
  for (let i = 0; i < refs.length; i += LIMITE_LOTE) {
    const batch = db.batch()
    refs.slice(i, i + LIMITE_LOTE).forEach((r) => batch.delete(r))
    await batch.commit()
  }
}

async function docsPorCampo(db, coll, campo, valor) {
  const snap = await db.collection(coll).where(campo, '==', valor).get()
  return snap.docs
}

async function docsPorCampoEnLista(db, coll, campo, valores) {
  const docs = []
  for (let i = 0; i < valores.length; i += 30) {
    const trozo = valores.slice(i, i + 30)
    if (!trozo.length) continue
    const snap = await db.collection(coll).where(campo, 'in', trozo).get()
    docs.push(...snap.docs)
  }
  return docs
}

async function borrarAlumnosHuerfanos(db, auth, uids) {
  const huerfanos = []
  for (const uid of uids) {
    const quedan = await db.collection('students').where('uid', '==', uid).limit(1).get()
    if (quedan.empty) huerfanos.push(uid)
  }
  if (!huerfanos.length) return { huerfanos: 0 }

  const refs = []
  for (const uid of huerfanos) {
    refs.push(db.collection('notificationSettings').doc(uid))
    const bitacora = await docsPorCampo(db, 'notificationLog', 'uid', uid)
    bitacora.forEach((d) => refs.push(d.ref))
  }
  await borrarRefs(db, refs)
  for (let i = 0; i < huerfanos.length; i += 1000) {
    await auth.deleteUsers(huerfanos.slice(i, i + 1000))
  }
  return { huerfanos: huerfanos.length }
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleCloudinaryStatus(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const { uid } = await verifyRequest(req)
  const db = getDb()
  const perfil = await db.collection('users').doc(uid).get()
  if (perfil.data()?.role !== 'admin') return res.status(403).json({ error: 'Solo para administradores' })
  return res.status(200).json({
    configurado: Boolean(process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET),
  })
}

async function handleLastAccess(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const { uid } = await verifyRequest(req)
  const db = getDb()
  const perfil = await db.collection('users').doc(uid).get()
  if (perfil.data()?.role !== 'admin') return res.status(403).json({ error: 'Solo para administradores' })

  const uids = Array.isArray(req.body?.uids) ? req.body.uids.filter(Boolean) : []
  if (uids.length === 0) return res.status(200).json({ accesos: {} })

  const auth = getAuth()
  const accesos = {}
  const creadoEn = {}
  for (let i = 0; i < uids.length; i += 100) {
    const lote = uids.slice(i, i + 100).map((id) => ({ uid: id }))
    const { users } = await auth.getUsers(lote)
    users.forEach((u) => {
      accesos[u.uid] = u.metadata?.lastSignInTime || null
      creadoEn[u.uid] = u.metadata?.creationTime || null
    })
  }
  return res.status(200).json({ accesos, creadoEn })
}

async function handleDeleteAccount(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const { uid: callerUid } = await verifyRequest(req)
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
  const { targetUid } = body

  if (!targetUid || typeof targetUid !== 'string') return res.status(400).json({ error: 'Falta targetUid.' })

  const db = getDb()
  const auth = getAuth()

  const callerDoc = await db.collection('users').doc(callerUid).get()
  if (!callerDoc.exists || callerDoc.data().role !== 'admin') return res.status(403).json({ error: 'Acceso denegado.' })

  const targetDoc = await db.collection('users').doc(targetUid).get()
  if (targetDoc.exists && targetDoc.data().role === 'admin') {
    return res.status(403).json({ error: 'No se puede eliminar una cuenta de administrador.' })
  }

  await auth.revokeRefreshTokens(targetUid).catch(() => {})

  const assets = new Map()
  extraerAssets(targetDoc.exists ? targetDoc.data() : {}, assets)

  const listas = await Promise.all(POR_DOCENTE.map((c) => docsPorCampo(db, c, 'docenteId', targetUid)))
  const porColeccion = Object.fromEntries(POR_DOCENTE.map((c, i) => [c, listas[i]]))

  const subjectIds = porColeccion.subjects.map((d) => d.id)
  const activityIds = porColeccion.activities.map((d) => d.id)

  const [alumnos, materiales, recursos, asistenciaPorAsignatura,
    avisoLecturasPorAsig, avisoGuardadosPorAsig, avisoOcultosPorAsig] = await Promise.all([
    docsPorCampoEnLista(db, 'students', 'asignaturaId', subjectIds),
    docsPorCampoEnLista(db, 'materials', 'asignaturaId', subjectIds),
    docsPorCampoEnLista(db, 'resources', 'asignaturaId', subjectIds),
    docsPorCampoEnLista(db, 'attendance', 'asignaturaId', subjectIds),
    docsPorCampoEnLista(db, 'avisoLecturas', 'asignaturaId', subjectIds),
    docsPorCampoEnLista(db, 'avisoGuardados', 'asignaturaId', subjectIds),
    docsPorCampoEnLista(db, 'avisoOcultos', 'asignaturaId', subjectIds),
  ])

  const avisoIds = porColeccion.avisos.map((d) => d.id)
  const [lectPorAviso, guardPorAviso, ocultPorAviso] = await Promise.all([
    docsPorCampoEnLista(db, 'avisoLecturas', 'avisoId', avisoIds),
    docsPorCampoEnLista(db, 'avisoGuardados', 'avisoId', avisoIds),
    docsPorCampoEnLista(db, 'avisoOcultos', 'avisoId', avisoIds),
  ])
  function dedup(a, b) {
    const seen = new Set(a.map((d) => d.ref.path))
    return [...a, ...b.filter((d) => !seen.has(d.ref.path))]
  }
  const avisoLecturas = dedup(avisoLecturasPorAsig, lectPorAviso)
  const avisoGuardados = dedup(avisoGuardadosPorAsig, guardPorAviso)
  const avisoOcultos = dedup(avisoOcultosPorAsig, ocultPorAviso)

  const [entregasPorActividad, entregasPorAlumno] = await Promise.all([
    docsPorCampoEnLista(db, 'submissions', 'actividadId', activityIds),
    docsPorCampoEnLista(db, 'submissions', 'alumnoId', alumnos.map((d) => d.id)),
  ])

  const bitacora = await docsPorCampo(db, 'notificationLog', 'uid', targetUid)
  const consumosIA = await docsPorCampo(db, 'iaConsumos', 'uid', targetUid)
  const consumosIAInterno = await docsPorCampo(db, 'iaConsumosInterno', 'uid', targetUid)

  const todosLosDocs = [
    ...Object.values(porColeccion).flat(),
    ...alumnos, ...materiales, ...recursos, ...asistenciaPorAsignatura,
    ...avisoLecturas, ...avisoGuardados, ...avisoOcultos,
    ...entregasPorActividad, ...entregasPorAlumno, ...bitacora,
  ]
  todosLosDocs.forEach((d) => extraerAssets(d.data(), assets))

  const padresConHijos = [
    ...new Map([...porColeccion.activities.map((d) => [d.ref.path, { d, sub: CON_SUBCOLECCIONES.activities }]),
      ...[...entregasPorActividad, ...entregasPorAlumno].map((d) => [d.ref.path, { d, sub: CON_SUBCOLECCIONES.submissions }])]).values(),
  ]
  const hijos = await Promise.all(padresConHijos.map(({ d, sub }) => d.ref.collection(sub).get()))
  hijos.forEach((snap) => snap.docs.forEach((h) => extraerAssets(h.data(), assets)))

  const escritor = db.bulkWriter()
  await Promise.all(padresConHijos.map(({ d }) => db.recursiveDelete(d.ref, escritor)))
  await escritor.close()

  const conSubcolecciones = new Set(padresConHijos.map(({ d }) => d.ref.path))
  const planos = [
    ...alumnos, ...materiales, ...recursos, ...asistenciaPorAsignatura,
    ...avisoLecturas, ...avisoGuardados, ...avisoOcultos,
    ...porColeccion.attendance, ...porColeccion.events, ...porColeccion.horarioBloques,
    ...porColeccion.horario, ...porColeccion.asuetos, ...porColeccion.vacaciones,
    ...porColeccion.bancoReactivos, ...porColeccion.bancoRubricas,
    ...porColeccion.avisos, ...porColeccion.avisoPlantillas, ...porColeccion.academicEvents,
    ...porColeccion.subjects, ...porColeccion.subscriptions, ...porColeccion.payments,
    ...bitacora,
  ].map((d) => d.ref).filter((r) => !conSubcolecciones.has(r.path))

  const unicas = [...new Map([
    ...planos.map((r) => [r.path, r]),
    ...consumosIA.map((d) => [d.ref.path, d.ref]),
    ...consumosIAInterno.map((d) => [d.ref.path, d.ref]),
    [`iaCreditos/${targetUid}`, db.collection('iaCreditos').doc(targetUid)],
    [`iaTrialRegistro/${targetUid}`, db.collection('iaTrialRegistro').doc(targetUid)],
    [`notificationSettings/${targetUid}`, db.collection('notificationSettings').doc(targetUid)],
    [`users/${targetUid}`, db.collection('users').doc(targetUid)],
  ]).values()]
  await borrarRefs(db, unicas)

  const uidsAlumnos = [...new Set(alumnos.map((d) => d.data().uid).filter(Boolean))]
  const { huerfanos } = await borrarAlumnosHuerfanos(db, auth, uidsAlumnos)

  const archivos = await borrarAssets(assets, { origen: 'admin/delete-account', uid: targetUid })

  const datosPerfil = targetDoc.exists ? targetDoc.data() : {}
  await db.collection('bajas').doc(targetUid).set({
    docenteId: targetUid,
    nombre: datosPerfil.nombreMostrar || datosPerfil.nombre || datosPerfil.username || '',
    email: datosPerfil.email || '',
    fechaBaja: new Date(),
    cuentaEliminada: true,
    eliminadoPorAdmin: callerUid,
  })

  await auth.deleteUser(targetUid)

  return res.status(200).json({
    ok: true,
    documentosEliminados: unicas.length + padresConHijos.length,
    asignaturas: subjectIds.length,
    estudiantes: alumnos.length,
    cuentasDeAlumnosEliminadas: huerfanos,
    archivos,
  })
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return
  const action = req.query.action
  try {
    if (action === 'cloudinary-status') return await handleCloudinaryStatus(req, res)
    if (action === 'last-access') return await handleLastAccess(req, res)
    if (action === 'delete-account') return await handleDeleteAccount(req, res)
    return res.status(404).json({ error: 'Acción no encontrada.' })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Error interno.' })
  }
}
