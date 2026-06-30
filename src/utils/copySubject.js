import {
  collection, query, where, getDocs, addDoc, doc, writeBatch,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'

function generateAccessCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

// Copies a subject with its activities to a new document.
// If keepStudents=true, copies student list with new activation state.
// Activities are copied as visible (oculta:false), without submissions/grades.
// Returns the new subject's Firestore ID.
export async function copySubject({ sourceSubjectId, nombre, grupo = '', fechaInicio = '', fechaFin = '', parciales, colorPalette = 'default', icon = 'book', keepStudents, docenteId, escuelaId }) {
  // 1. Create new subject doc
  const newSubRef = await addDoc(collection(db, 'subjects'), {
    nombre,
    grupo,
    docenteId,
    escuelaId,
    parciales: Number(parciales) || 3,
    fechaInicio,
    fechaFin,
    colorPalette,
    icon,
    accessCode: generateAccessCode(),
    archived: false,
    createdAt: serverTimestamp(),
  })
  const newSubjectId = newSubRef.id

  // 2. Fetch source activities
  const actsSnap = await getDocs(
    query(collection(db, 'activities'), where('asignaturaId', '==', sourceSubjectId))
  )

  const LIMIT = 490
  let batch = writeBatch(db)
  let ops = 0

  async function flush() {
    if (ops === 0) return
    await batch.commit()
    batch = writeBatch(db)
    ops = 0
  }

  // 3. Copy activities (visible, no extensions, no submissions)
  for (const d of actsSnap.docs) {
    const a = d.data()
    const ref = doc(collection(db, 'activities'))
    batch.set(ref, {
      nombre: a.nombre,
      categoria: a.categoria || 'actividad',
      maxCalif: a.maxCalif,
      instrucciones: a.instrucciones || '',
      archivosAdjuntos: a.archivosAdjuntos || [],
      fechaLimite: a.fechaLimite || null,
      tiposArchivo: a.tiposArchivo || 'imagenes',
      extensionesCustom: a.extensionesCustom || '',
      tipo: a.tipo || 'archivo',
      parcial: a.parcial,
      asignaturaId: newSubjectId,
      docenteId,
      oculta: false,
      publishAt: null,
      createdAt: serverTimestamp(),
    })
    ops++
    if (ops >= LIMIT) await flush()
  }

  // 4. Optionally copy students. Duplicating a subject = the SAME people in a new subject,
  //    so we PRESERVE their identity (username + uid + activado). That keeps the multi-subject
  //    model intact: an already-activated student gets the copied subject in their dashboard
  //    instantly, and others keep the same username they already know. No new credentials.
  if (keepStudents) {
    const studsSnap = await getDocs(
      query(collection(db, 'students'), where('asignaturaId', '==', sourceSubjectId))
    )

    const sorted = studsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))

    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i]
      const ref = doc(collection(db, 'students'))
      batch.set(ref, {
        apellidoPaterno: s.apellidoPaterno || '',
        apellidoMaterno: s.apellidoMaterno || '',
        nombre: s.nombre || '',
        username: s.username, // keep the same identity (same Auth account / email)
        resetPassword: null,
        uid: s.uid || null, // inherit the account if the student already activated
        escuelaId,
        asignaturaId: newSubjectId,
        activado: !!s.activado,
        orden: i + 1,
        createdAt: serverTimestamp(),
      })
      ops++
      if (ops >= LIMIT) await flush()
    }
  }

  await flush()
  return newSubjectId
}
