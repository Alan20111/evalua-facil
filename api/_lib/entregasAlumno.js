// Lectura de entregas del ESTUDIANTE filtrada en el servidor, y registro de la
// versión del cliente. Las llaman las acciones `mis-entregas` y `cliente-ping`
// de api/student/[action].js (autenticación, App Check y CORS ya pasaron ahí).
//
// Por qué existe: las notas de un estudiante viven en su documento de entrega
// (`submissions`), y Firestore no sabe ocultar UN campo de un documento. La nota
// que el docente ocultó (subjects.calificacionesOcultas) tiene que quitarse del
// documento ANTES de que salga del servidor, y eso solo se puede hacer aquí.
//
// IMPORTANTE — protección real, hasta dónde llega: esto protege a las pantallas
// que lean por aquí. Mientras `firestore.rules` siga dejando al estudiante leer
// directo sus `submissions` y `respuestas`, un cliente modificado puede saltarse
// este endpoint. Cerrar esa lectura es una fase posterior e independiente.
//
// Reglas de este módulo:
//   · La identidad sale SOLO del token (`uid`): ningún campo del cuerpo la cambia.
//   · Nunca se escribe una nota, un id de estudiante ni un cuerpo de entrega en
//     los logs: solo conteos.
//   · Un error inesperado responde con un mensaje genérico, sin detalles internos.

import { admin } from './firebaseAdmin.js'
import { proyectarEntrega, proyectarRespuesta, promediosAlumno, paraJSON } from '../../src/utils/entregasAlumno.js'
import { actividadOculta } from '../../src/utils/visibilidadCalificaciones.js'
import { publicacionVisible } from '../../src/utils/evaluacionGrading.js'

export class ErrorEntregas extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const idValido = (v) => typeof v === 'string' && v.length > 0 && v.length <= 128 && !v.includes('/')

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} uid   el del token — nunca del cuerpo
 * @param {{asignaturaId?: string, actividadId?: string, respuestas?: boolean}} body
 *   · sin filtros → todas las asignaturas del estudiante (Dashboard, Agenda)
 *   · asignaturaId → una asignatura (pantalla de la asignatura)
 *   · actividadId  → una actividad (+ respuestas si `respuestas: true`)
 */
export async function misEntregas(db, uid, body = {}) {
  const asignaturaId = body.asignaturaId ?? null
  const actividadId = body.actividadId ?? null
  const conRespuestas = body.respuestas === true
  if (asignaturaId !== null && !idValido(asignaturaId)) throw new ErrorEntregas(400, 'asignaturaId no válido.')
  if (actividadId !== null && !idValido(actividadId)) throw new ErrorEntregas(400, 'actividadId no válido.')
  if (conRespuestas && !actividadId) throw new ErrorEntregas(400, 'Las respuestas se piden junto con actividadId.')

  // Inscripciones REALES del estudiante, por el uid del token.
  const inscSnap = await db.collection('students').where('uid', '==', uid).get()
  let inscripciones = inscSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

  let actividadObjetivo = null
  if (actividadId) {
    const actSnap = await db.collection('activities').doc(actividadId).get()
    if (!actSnap.exists) throw new ErrorEntregas(404, 'Actividad no encontrada.')
    actividadObjetivo = { id: actSnap.id, ...actSnap.data() }
    inscripciones = inscripciones.filter((i) => i.asignaturaId === actividadObjetivo.asignaturaId)
    if (!inscripciones.length) throw new ErrorEntregas(403, 'No estás inscrito en esta asignatura.')
  } else if (asignaturaId) {
    inscripciones = inscripciones.filter((i) => i.asignaturaId === asignaturaId)
    if (!inscripciones.length) throw new ErrorEntregas(403, 'No estás inscrito en esta asignatura.')
  }
  if (!inscripciones.length) return { ok: true, entregas: [], promedios: {} }

  const asignaturaIds = [...new Set(inscripciones.map((i) => i.asignaturaId).filter(Boolean))]
  const subjSnaps = await db.getAll(...asignaturaIds.map((s) => db.collection('subjects').doc(s)))
  const asignaturas = new Map(subjSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()]))

  // Entregas de cada inscripción (una consulta con igualdades, sin índices nuevos).
  const porInscripcion = await Promise.all(inscripciones.map(async (insc) => {
    let q = db.collection('submissions').where('alumnoId', '==', insc.id)
    if (actividadId) q = q.where('actividadId', '==', actividadId)
    return { insc, docs: (await q.get()).docs }
  }))

  const entregas = []
  const subsPorAsignatura = new Map() // asignaturaId → { actividadId → entrega cruda }
  for (const { insc, docs } of porInscripcion) {
    const subj = asignaturas.get(insc.asignaturaId)
    if (!subj) continue
    const mapa = subsPorAsignatura.get(insc.asignaturaId) || {}
    for (const d of docs) {
      const data = { id: d.id, ...d.data() }
      mapa[data.actividadId] = data
      const oculta = actividadOculta(subj, data.actividadId)
      entregas.push({ ...proyectarEntrega(data, { notaOculta: oculta }), asignaturaId: insc.asignaturaId })
    }
    subsPorAsignatura.set(insc.asignaturaId, mapa)
  }

  // Promedios: solo cuando se pide más que una actividad suelta.
  const promedios = {}
  if (!actividadId) {
    for (const insc of inscripciones) {
      const subj = asignaturas.get(insc.asignaturaId)
      if (!subj) continue
      const actsSnap = await db.collection('activities').where('asignaturaId', '==', insc.asignaturaId).get()
      const acts = actsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      promedios[insc.asignaturaId] = promediosAlumno(
        subj, acts, subsPorAsignatura.get(insc.asignaturaId) || {}, { id: insc.id, createdAt: insc.createdAt },
      )
    }
  }

  const salida = { ok: true, entregas, promedios }

  // Respuestas de UNA actividad: la clave de lo correcto y los puntos solo viajan
  // con el examen finalizado, las respuestas publicadas por el docente Y la nota
  // a la vista (con la nota oculta, la clave permitiría calcularla).
  if (conRespuestas) {
    const entrega = entregas.find((e) => e.actividadId === actividadId)
    if (!entrega) {
      salida.respuestas = []
    } else {
      const ev = actividadObjetivo.evaluacion || {}
      const subj = asignaturas.get(entrega.asignaturaId)
      const claves = !actividadOculta(subj, actividadId) &&
        entrega.estadoEvaluacion === 'finalizado' &&
        publicacionVisible(ev.publicarRespuestas || 'inmediato', ev.publicarRespuestasFecha, ev.respuestasPublicadas, new Date().toISOString())
      const respSnap = await db.collection('submissions').doc(entrega.id).collection('respuestas').get()
      salida.respuestas = respSnap.docs.map((d) => proyectarRespuesta({ id: d.id, ...d.data() }, { claves }))
    }
  }

  return paraJSON(salida)
}

// ── Versión del cliente ───────────────────────────────────────────────────
//
// `clientesAlumno/{uid}` = { plataforma, versionName, buildId, primeraVez, ultimaVez }.
// Solo lo escribe el servidor (Admin SDK; ninguna regla lo expone al cliente).
// Sirve para saber, ANTES de cerrar la lectura directa de Firestore, qué
// versiones de la app siguen en uso (seeds-db/verificar-version-app.js). Un
// cliente viejo nunca llama aquí: su ausencia es justo la señal.

const PLATAFORMAS = new Set(['web', 'android', 'ios'])
const TEXTO_VERSION = /^[0-9A-Za-z._+-]{0,64}$/
const VEINTE_HORAS_MS = 20 * 60 * 60 * 1000

export async function clientePing(db, uid, body = {}) {
  const plataforma = body.plataforma
  const versionName = body.versionName ?? ''
  const buildId = body.buildId ?? ''
  if (!PLATAFORMAS.has(plataforma)) throw new ErrorEntregas(400, 'plataforma no válida.')
  if (typeof versionName !== 'string' || !TEXTO_VERSION.test(versionName)) throw new ErrorEntregas(400, 'versionName no válido.')
  if (typeof buildId !== 'string' || !TEXTO_VERSION.test(buildId)) throw new ErrorEntregas(400, 'buildId no válido.')

  const ref = db.collection('clientesAlumno').doc(uid)
  const snap = await ref.get()
  const previo = snap.exists ? snap.data() : null
  const igual = !!previo && previo.plataforma === plataforma && previo.versionName === versionName && previo.buildId === buildId
  const ultima = previo?.ultimaVez?.toMillis?.() ?? null
  // Como mucho una escritura al día por usuario mientras la versión no cambie.
  if (igual && ultima !== null && Date.now() - ultima < VEINTE_HORAS_MS) return { ok: true, registrado: false }

  const { FieldValue } = admin.firestore
  await ref.set({
    plataforma, versionName, buildId,
    primeraVez: previo?.primeraVez ?? FieldValue.serverTimestamp(),
    ultimaVez: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { ok: true, registrado: true }
}
