import {
  collection, query, where, getDocs, getDoc, doc, deleteField,
} from 'firebase/firestore'
// Escrituras a través del candado de suscripción vencida (ver ./firestoreGuard.js).
import { updateDoc, writeBatch } from './firestoreGuard'
import { db } from '../firebase'

// F-06: usa queries '==' individuales por actividad en lugar de 'in' con
// múltiples IDs. La regla de lectura de submissions ahora exige
// ownsActivity(actividadId), y ownsActivity hace 1 get() al doc de la
// actividad. Con 'in', Firestore evaluaría N get()s (uno por ID del array)
// más 1 del users doc = N+1, excediendo el límite de 10 en asignaturas con
// muchas actividades. Con '==' individual cada query usa exactamente 2 get()s.
async function fetchSubmissionsForActivities(actIds) {
  if (actIds.length === 0) return []
  const snaps = await Promise.all(
    actIds.map((id) => getDocs(query(collection(db, 'submissions'), where('actividadId', '==', id))))
  )
  return snaps.flatMap((s) => s.docs)
}

// Deletes in writeBatch chunks of ≤500 ops to stay within Firestore limits.
// Las reglas de `submissions` leen, por cada borrado, la actividad y su
// asignatura, y un lote no puede consultar más de 20 documentos distintos
// (medido en el emulador: con actividades mezcladas, un lote de 9 entregas ya
// no pasa). Por eso las entregas se borran agrupadas por actividad, y las de un
// solo estudiante —una por actividad— en lotes chicos.
const LOTE_ENTREGAS_MEZCLADAS = 5

async function borrarEntregasPorActividad(subDocs) {
  const porActividad = new Map()
  subDocs.forEach((d) => {
    const actId = d.data().actividadId
    if (!porActividad.has(actId)) porActividad.set(actId, [])
    porActividad.get(actId).push(doc(db, 'submissions', d.id))
  })
  for (const refs of porActividad.values()) await batchDeleteDocs(refs)
}

async function batchDeleteDocs(refs) {
  const LIMIT = 490
  for (let i = 0; i < refs.length; i += LIMIT) {
    const batch = writeBatch(db)
    refs.slice(i, i + LIMIT).forEach((r) => batch.delete(r))
    await batch.commit()
  }
}

// Un parcial CERRADO DEFINITIVAMENTE no deja borrar sus calificaciones ni sus
// actividades (firestore.rules). Las dos operaciones administrativas que sí
// deben poder hacerlo —eliminar la asignatura y "empezar de cero" al
// desarchivar— primero pasan cada parcial cerrado a «reabierto» (parcialesAtencion):
// la misma transición que "Reabrir" (cerrado → atención, una sola escritura).
async function liberarParcialesCerrados(subjectId) {
  const snap = await getDoc(doc(db, 'subjects', subjectId))
  if (!snap.exists()) return
  const data = snap.data()
  const updates = {}
  Object.entries(data.parcialesCerrados || {}).forEach(([p, fecha]) => {
    if (!fecha) return
    updates[`parcialesCerrados.${p}`] = deleteField()
    updates[`parcialesAtencion.${p}`] = data.parcialesAtencion?.[p] || fecha
  })
  if (Object.keys(updates).length) await updateDoc(doc(db, 'subjects', subjectId), updates)
}

// Aquí vivía deleteSubjectCascade, el borrado de una asignatura completa desde el navegador. Desde F-09 (#1416) se
// detenía a la mitad: no podía listar las actividades sin filtrar por docenteId y nunca pudo borrar sus subcolecciones
// ni los registros que solo escribe el servidor. Ahora lo hace el servidor, por partes y reanudable:
// /api/subject/eliminar-asignatura (api/_lib/eliminarAsignatura.js), que el navegador llama con
// src/utils/eliminarAsignatura.js.

// Aquí vivía deleteSubjectSubmissions, que borraba las entregas de toda la
// asignatura al archivarla. Se quitó junto con ese comportamiento: archivar ya
// no borra nada. Borraba el trabajo del estudiante y ni siquiera liberaba el
// espacio que pretendía —los archivos seguían en Cloudinary, solo se destruía
// el documento que apuntaba a ellos— así que no había nada que salvar de ella.

// Deletes the submissions of a single student enrollment (submissions are keyed by the
// per-subject `students` doc id). Call before deleting the student doc to avoid orphans.
// F-06: ya no filtra por alumnoId directamente — con la nueva regla el docente
// solo puede leer submissions cuya actividadId le pertenece, y un query filtrado
// solo por alumnoId no permite demostrar esa propiedad en las rules. En su lugar,
// hace una query compuesta (actividadId == X AND alumnoId == studentDocId) por
// cada actividad; el índice compuesto (actividadId, alumnoId) ya existe en
// firestore.indexes.json, cada query devuelve 0 o 1 documentos.
// actIds es obligatorio: el caller (SubjectPage.confirmDeleteStudent) lo tiene.
export async function deleteSubmissionsByStudent(studentDocId, actIds) {
  if (!actIds || actIds.length === 0) return
  const snaps = await Promise.all(
    actIds.map((actId) =>
      getDocs(query(
        collection(db, 'submissions'),
        where('actividadId', '==', actId),
        where('alumnoId', '==', studentDocId),
      ))
    )
  )
  const refs = snaps.flatMap((s) => s.docs.map((d) => doc(db, 'submissions', d.id)))
  for (let i = 0; i < refs.length; i += LOTE_ENTREGAS_MEZCLADAS) {
    await batchDeleteDocs(refs.slice(i, i + LOTE_ENTREGAS_MEZCLADAS))
  }
}

// Deletes the submissions of a single activity. Call before deleting the activity doc.
export async function deleteSubmissionsByActivity(activityId) {
  const snap = await getDocs(query(collection(db, 'submissions'), where('actividadId', '==', activityId)))
  await batchDeleteDocs(snap.docs.map((d) => doc(db, 'submissions', d.id)))
}

// Deletes only the students of a subject and their submissions.
// Used in the "start from 0" unarchive flow.
export async function deleteSubjectStudents(subjectId) {
  await liberarParcialesCerrados(subjectId)
  const [actsSnap, studsSnap] = await Promise.all([
    getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', subjectId))),
    getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId))),
  ])
  const actIds = actsSnap.docs.map((d) => d.id)
  const subsDocs = await fetchSubmissionsForActivities(actIds)

  await borrarEntregasPorActividad(subsDocs)
  await batchDeleteDocs(studsSnap.docs.map((d) => doc(db, 'students', d.id)))
}
