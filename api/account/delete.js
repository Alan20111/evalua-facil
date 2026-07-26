import { getDb, getAuth, verifyRequest } from '../_lib/firebaseAdmin.js'

// Elimina definitivamente la cuenta de un docente y todo lo suyo.
//
// Va en el servidor por dos razones. Una, las reglas de Firestore no le
// permiten al docente borrar su propio `users/{uid}` ni sus suscripciones y
// pagos (a propósito: es el historial de cobros). Dos, y más importante,
// borrar desde el navegador es a medias por naturaleza — son cientos de
// documentos en once colecciones y si el docente cierra la pestaña a medio
// camino la cuenta queda en un estado inconsistente, con su Auth vivo y sus
// datos mutilados. Aquí termina o falla entero.
//
// La cuenta de Firebase Auth se borra AL FINAL: mientras exista, un fallo a
// media limpieza deja al docente pudiendo entrar y reintentar, en vez de
// dejarlo fuera con basura suya en la base.

const PALABRA_CONFIRMACION = 'ELIMINAR'
const LIMITE_LOTE = 400 // el tope duro de Firestore es 500 operaciones

async function borrarRefs(db, refs) {
  for (let i = 0; i < refs.length; i += LIMITE_LOTE) {
    const batch = db.batch()
    refs.slice(i, i + LIMITE_LOTE).forEach((r) => batch.delete(r))
    await batch.commit()
  }
}

// Devuelve las refs de todos los docs de `coll` donde `campo == valor`.
async function refsPorCampo(db, coll, campo, valor) {
  const snap = await db.collection(coll).where(campo, '==', valor).get()
  return snap.docs.map((d) => d.ref)
}

// Igual pero para muchos valores: Firestore solo acepta 30 por consulta `in`,
// así que se parte. Sin esto, un docente con más de 30 actividades dejaría
// entregas huérfanas.
async function refsPorCampoEnLista(db, coll, campo, valores) {
  const refs = []
  for (let i = 0; i < valores.length; i += 30) {
    const trozo = valores.slice(i, i + 30)
    if (!trozo.length) continue
    const snap = await db.collection(coll).where(campo, 'in', trozo).get()
    snap.docs.forEach((d) => refs.push(d.ref))
  }
  return refs
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const { uid } = await verifyRequest(req)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})

    // El cliente ya pidió la palabra y volvió a autenticar; esto es el
    // segundo cerrojo, para que un POST suelto a este endpoint no baste.
    if (String(body.confirmacion || '').trim().toUpperCase() !== PALABRA_CONFIRMACION) {
      return res.status(400).json({ error: 'Falta la confirmación.' })
    }

    const db = getDb()

    // Un admin no puede borrarse desde aquí: se quedaría el proyecto sin
    // quien administre y este endpoint es el del autoservicio del docente.
    const perfil = await db.collection('users').doc(uid).get()
    if (perfil.exists && perfil.data().role === 'admin') {
      return res.status(403).json({ error: 'Las cuentas de administrador no se eliminan desde el perfil.' })
    }

    // ── 1. Todo lo que cuelga del docente directamente ──────────────────
    const porDocente = ['subjects', 'activities', 'attendance', 'events', 'horarioBloques',
      'asuetos', 'vacaciones', 'bancoReactivos', 'bancoRubricas', 'subscriptions', 'payments']
    const listas = await Promise.all(porDocente.map((c) => refsPorCampo(db, c, 'docenteId', uid)))
    const porColeccion = Object.fromEntries(porDocente.map((c, i) => [c, listas[i]]))

    const subjectIds = porColeccion.subjects.map((r) => r.id)
    const activityIds = porColeccion.activities.map((r) => r.id)

    // ── 2. Lo que cuelga de sus asignaturas ─────────────────────────────
    // `attendance` se consulta por las dos vías (docenteId arriba, y aquí por
    // asignatura) porque los registros viejos pueden no traer docenteId.
    const [alumnos, materiales, recursos, asistenciaPorAsignatura] = await Promise.all([
      refsPorCampoEnLista(db, 'students', 'asignaturaId', subjectIds),
      refsPorCampoEnLista(db, 'materials', 'asignaturaId', subjectIds),
      refsPorCampoEnLista(db, 'resources', 'asignaturaId', subjectIds),
      refsPorCampoEnLista(db, 'attendance', 'asignaturaId', subjectIds),
    ])

    // ── 3. Entregas: por actividad y por alumno ─────────────────────────
    // Las dos vías, porque una entrega puede quedar colgando si su actividad
    // ya no existe pero su inscripción sí (o al revés).
    const [entregasPorActividad, entregasPorAlumno] = await Promise.all([
      refsPorCampoEnLista(db, 'submissions', 'actividadId', activityIds),
      refsPorCampoEnLista(db, 'submissions', 'alumnoId', alumnos.map((r) => r.id)),
    ])

    // ── 4. Lo que se identifica con el uid, no con docenteId ────────────
    const bitacora = await refsPorCampo(db, 'notificationLog', 'uid', uid)

    // Se borra de adentro hacia afuera —entregas antes que actividades,
    // alumnos antes que asignaturas— para que un fallo a medio camino deje
    // huérfanos de los inofensivos y no al revés.
    const todas = [
      ...entregasPorActividad, ...entregasPorAlumno,
      ...alumnos, ...materiales, ...recursos, ...asistenciaPorAsignatura,
      ...porColeccion.activities, ...porColeccion.attendance,
      ...porColeccion.events, ...porColeccion.horarioBloques,
      ...porColeccion.asuetos, ...porColeccion.vacaciones,
      ...porColeccion.bancoReactivos, ...porColeccion.bancoRubricas,
      ...porColeccion.subjects,
      ...porColeccion.subscriptions, ...porColeccion.payments,
      ...bitacora,
      db.collection('notificationSettings').doc(uid),
      db.collection('users').doc(uid),
    ]

    // Las dos vías de entregas y de asistencia pueden traer el mismo doc dos
    // veces; borrar dos veces el mismo ref en un batch es un error.
    const unicas = [...new Map(todas.map((r) => [r.path, r])).values()]
    await borrarRefs(db, unicas)

    // Hasta aquí no había vuelta atrás pero sí posibilidad de reintentar.
    // Este es el punto final.
    await getAuth().deleteUser(uid)

    return res.status(200).json({
      ok: true,
      documentosEliminados: unicas.length,
      asignaturas: subjectIds.length,
      estudiantes: alumnos.length,
    })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo eliminar la cuenta.' })
  }
}
