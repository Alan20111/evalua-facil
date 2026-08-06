import { getDb, getAuth, verifyRequest } from '../_lib/firebaseAdmin.js'
import { extraerAssets, borrarAssets } from '../_lib/cloudinary.js'
import { aplicarCors } from '../_lib/cors.js'

// Elimina definitivamente la cuenta de un docente y todo lo suyo: documentos,
// subcolecciones, archivos subidos, las cuentas de sus estudiantes que se
// queden sin clase y su propia cuenta de Firebase Auth. Después de esto no
// queda nada que ocupe espacio, y volver a registrarse con el mismo correo
// crea una cuenta nueva desde cero (Firebase asigna un uid distinto).
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

// Colecciones que cuelgan del docente directamente.
// `avisos`, `avisoPlantillas`, `academicEvents` y `horario` faltaban. Los
// avisos eran lo grave: se quedaban legibles para cualquier cuenta autenticada
// (`allow read: if request.auth != null`) y sin nadie que pudiera borrarlos
// nunca, porque su regla de borrado exige ser el docente dueño — un uid que ya
// no existe. Comunicados de un maestro que se fue, huérfanos y permanentes.
const POR_DOCENTE = ['subjects', 'activities', 'attendance', 'events', 'horarioBloques',
  'horario', 'asuetos', 'vacaciones', 'bancoReactivos', 'bancoRubricas',
  'avisos', 'avisoPlantillas', 'academicEvents', 'subscriptions', 'payments']

// Colecciones cuyos documentos tienen subcolecciones. Borrar un documento en
// Firestore NO borra lo que cuelga de él: los hijos quedan huérfanos,
// invisibles en la consola y ocupando espacio para siempre. Por eso estos van
// con recursiveDelete y no en el lote normal.
//   activities/{id}/preguntas    → las preguntas de una evaluación
//   submissions/{id}/respuestas  → las respuestas del estudiante
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

// Igual pero para muchos valores: Firestore solo acepta 30 por consulta `in`,
// así que se parte. Sin esto, un docente con más de 30 actividades dejaría
// entregas huérfanas.
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

// Las cuentas de Firebase Auth de los estudiantes no son del docente: un mismo
// estudiante puede estar inscrito con varios maestros de su escuela y esa
// cuenta es la misma. Solo se borra la de quien se quedó sin ninguna
// inscripción — si no, borrar una cuenta dejaría a estudiantes ajenos sin
// poder entrar con otro maestro.
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
  // deleteUsers borra hasta 1000 de un golpe y no truena si alguno ya no está.
  for (let i = 0; i < huerfanos.length; i += 1000) {
    await auth.deleteUsers(huerfanos.slice(i, i + 1000))
  }
  return { huerfanos: huerfanos.length }
}

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return // preflight de la app
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
    const auth = getAuth()

    // Un admin no puede borrarse desde aquí: se quedaría el proyecto sin
    // quien administre y este endpoint es el del autoservicio del docente.
    const perfil = await db.collection('users').doc(uid).get()
    if (perfil.exists && perfil.data().role === 'admin') {
      return res.status(403).json({ error: 'Las cuentas de administrador no se eliminan desde el perfil.' })
    }

    // Los archivos subidos se van recolectando conforme se leen los
    // documentos: es el único momento en que se sabe qué subió esta cuenta.
    const assets = new Map()
    extraerAssets(perfil.data(), assets) // la foto de perfil

    // ── 1. Todo lo que cuelga del docente directamente ──────────────────
    const listas = await Promise.all(POR_DOCENTE.map((c) => docsPorCampo(db, c, 'docenteId', uid)))
    const porColeccion = Object.fromEntries(POR_DOCENTE.map((c, i) => [c, listas[i]]))

    const subjectIds = porColeccion.subjects.map((d) => d.id)
    const activityIds = porColeccion.activities.map((d) => d.id)

    // ── 2. Lo que cuelga de sus asignaturas ─────────────────────────────
    // `attendance` se consulta por las dos vías (docenteId arriba, y aquí por
    // asignatura) porque los registros viejos pueden no traer docenteId.
    // El estado por-estudiante de los avisos (leído / guardado / oculto) cuelga
    // de la asignatura igual que los materiales. Se borra aquí porque una vez
    // que la inscripción desaparece ya nadie puede: su regla exige
    // `ownsStudentDoc`, y eso falla en cuanto el documento del alumno no está.
    const [alumnos, materiales, recursos, asistenciaPorAsignatura,
      avisoLecturas, avisoGuardados, avisoOcultos] = await Promise.all([
      docsPorCampoEnLista(db, 'students', 'asignaturaId', subjectIds),
      docsPorCampoEnLista(db, 'materials', 'asignaturaId', subjectIds),
      docsPorCampoEnLista(db, 'resources', 'asignaturaId', subjectIds),
      docsPorCampoEnLista(db, 'attendance', 'asignaturaId', subjectIds),
      docsPorCampoEnLista(db, 'avisoLecturas', 'asignaturaId', subjectIds),
      docsPorCampoEnLista(db, 'avisoGuardados', 'asignaturaId', subjectIds),
      docsPorCampoEnLista(db, 'avisoOcultos', 'asignaturaId', subjectIds),
    ])

    // ── 3. Entregas: por actividad y por alumno ─────────────────────────
    // Las dos vías, porque una entrega puede quedar colgando si su actividad
    // ya no existe pero su inscripción sí (o al revés).
    const [entregasPorActividad, entregasPorAlumno] = await Promise.all([
      docsPorCampoEnLista(db, 'submissions', 'actividadId', activityIds),
      docsPorCampoEnLista(db, 'submissions', 'alumnoId', alumnos.map((d) => d.id)),
    ])

    // ── 4. Lo que se identifica con el uid, no con docenteId ────────────
    const bitacora = await docsPorCampo(db, 'notificationLog', 'uid', uid)

    // ── 5. Archivos de todo lo anterior, subcolecciones incluidas ───────
    const todosLosDocs = [
      ...Object.values(porColeccion).flat(),
      ...alumnos, ...materiales, ...recursos, ...asistenciaPorAsignatura,
      ...avisoLecturas, ...avisoGuardados, ...avisoOcultos,
      ...entregasPorActividad, ...entregasPorAlumno, ...bitacora,
    ]
    todosLosDocs.forEach((d) => extraerAssets(d.data(), assets))

    // Las preguntas traen imágenes y las respuestas, archivos entregados: hay
    // que leerlas ANTES de borrarlas o sus archivos quedan en Cloudinary sin
    // que nada apunte a ellos.
    const padresConHijos = [
      ...new Map([...porColeccion.activities.map((d) => [d.ref.path, { d, sub: CON_SUBCOLECCIONES.activities }]),
        ...[...entregasPorActividad, ...entregasPorAlumno].map((d) => [d.ref.path, { d, sub: CON_SUBCOLECCIONES.submissions }])]).values(),
    ]
    const hijos = await Promise.all(padresConHijos.map(({ d, sub }) => d.ref.collection(sub).get()))
    hijos.forEach((snap) => snap.docs.forEach((h) => extraerAssets(h.data(), assets)))

    // ── 6. Borrado ──────────────────────────────────────────────────────
    // Los padres con subcolecciones van por recursiveDelete, que arrastra
    // todo lo que cuelgue de ellos (incluso subcolecciones que alguien agregue
    // después y que este archivo todavía no conozca). El resto, en lotes.
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

    // Las dos vías de entregas y de asistencia pueden traer el mismo doc dos
    // veces; borrar dos veces el mismo ref en un batch es un error.
    const unicas = [...new Map([
      ...planos.map((r) => [r.path, r]),
      [`notificationSettings/${uid}`, db.collection('notificationSettings').doc(uid)],
      [`users/${uid}`, db.collection('users').doc(uid)],
    ]).values()]
    await borrarRefs(db, unicas)

    // ── 7. Cuentas de sus estudiantes que se quedaron sin ninguna clase ──
    const uidsAlumnos = [...new Set(alumnos.map((d) => d.data().uid).filter(Boolean))]
    const { huerfanos } = await borrarAlumnosHuerfanos(db, auth, uidsAlumnos)

    // ── 8. Archivos en Cloudinary ───────────────────────────────────────
    const archivos = await borrarAssets(assets)
    // Lo que no se pudo borrar se anota en el log de Vercel: es la única
    // forma de enterarse de que quedaron archivos ocupando espacio, porque
    // el docente ya se fue y nadie va a ver esta respuesta.
    if (archivos.pendientes?.length) {
      console.warn(
        `[eliminar-cuenta ${uid}] ${archivos.pendientes.length} archivos NO borrados de Cloudinary` +
        `${archivos.configurado === false ? ' (faltan CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)' : ''}: ` +
        archivos.pendientes.join(', ')
      )
    }

    // ── Constancia de baja ────────────────────────────────────────────
    // Se guarda ANTES del punto final, y a propósito NO en `users` (que ya
    // se borró): un documento aparte, mínimo, con lo justo para que el panel
    // pueda mostrar "Cuenta eliminada" en vez de que el renglón desaparezca
    // sin dejar rastro. Solo nombre, correo y fecha — nada de su contenido,
    // que es lo que se acaba de eliminar.
    const datosPerfil = perfil.exists ? perfil.data() : {}
    await db.collection('bajas').doc(uid).set({
      docenteId: uid,
      nombre: datosPerfil.nombreMostrar || datosPerfil.nombre || datosPerfil.username || '',
      email: datosPerfil.email || '',
      fechaBaja: new Date(),
      cuentaEliminada: true,
    })

    // Hasta aquí no había vuelta atrás pero sí posibilidad de reintentar.
    // Este es el punto final.
    await auth.deleteUser(uid)

    return res.status(200).json({
      ok: true,
      documentosEliminados: unicas.length + padresConHijos.length,
      asignaturas: subjectIds.length,
      estudiantes: alumnos.length,
      cuentasDeAlumnosEliminadas: huerfanos,
      archivos,
    })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo eliminar la cuenta.' })
  }
}
