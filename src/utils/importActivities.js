import {
  collection, doc, setDoc, getDocs, writeBatch, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'

// Copies selected activities from ANOTHER subject into `targetSubjectId`, as
// DRAFTS (oculta, never published) inside `targetParcial`. The teacher reviews
// and publishes them afterward — dates almost always differ between groups.
//
// Carried over: name, type, category, instructions, attachments, accepted file
// types, evaluación config + its `preguntas` subcollection.
// NOT carried over: deadline, per-student extensions, submissions/grades.
//
// Returns the created activity docs ({ id, ...data }) for optimistic state.
export async function importActivitiesToSubject({ sourceActivities, targetSubjectId, targetParcial, docenteId, startOrden }) {
  const created = []
  let orden = startOrden
  for (const src of sourceActivities) {
    const newRef = doc(collection(db, 'activities'))
    const data = {
      nombre: src.nombre || '',
      categoria: src.categoria || 'entregable',
      maxCalif: src.maxCalif ?? 10,
      instrucciones: src.instrucciones || '',
      archivosAdjuntos: src.archivosAdjuntos || [],
      fechaLimite: null,
      tiposArchivo: src.tiposArchivo || 'imagenes',
      extensionesCustom: src.extensionesCustom || '',
      tipo: src.tipo || 'archivo',
      ...(src.evaluacion ? { evaluacion: src.evaluacion } : {}),
      parcial: targetParcial,
      orden: orden++,
      asignaturaId: targetSubjectId,
      docenteId,
      oculta: true,       // draft — the teacher reviews before publishing
      publishAt: null,
      publishedAt: null,
      createdAt: serverTimestamp(),
    }
    // Create the activity FIRST and commit — the `preguntas` security rule does
    // a get() on the parent activity, which must already exist (a same-batch
    // write isn't visible to that get()).
    await setDoc(newRef, data)

    // Evaluaciones keep their questions in a subcollection — copy them now that
    // the parent activity exists.
    if (src.tipo === 'evaluacion') {
      const preSnap = await getDocs(collection(db, 'activities', src.id, 'preguntas'))
      if (!preSnap.empty) {
        const batch = writeBatch(db)
        preSnap.docs.forEach((pd) => {
          const pref = doc(collection(db, 'activities', newRef.id, 'preguntas'))
          batch.set(pref, { ...pd.data() })
        })
        await batch.commit()
      }
    }

    created.push({ id: newRef.id, ...data })
  }
  return created
}
