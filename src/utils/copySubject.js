import {
  collection, query, where, getDocs, addDoc, doc, writeBatch,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { generateUsername, generateResetPassword } from './generate'

function generateAccessCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

// Copies a subject with its activities to a new document.
// If keepStudents=true, copies student list with new activation state.
// Activities are copied as visible (oculta:false), without submissions/grades.
// Returns the new subject's Firestore ID.
export async function copySubject({ sourceSubjectId, nombre, ciclo, parciales, keepStudents, docenteId, escuelaId }) {
  // 1. Create new subject doc
  const newSubRef = await addDoc(collection(db, 'subjects'), {
    nombre,
    docenteId,
    escuelaId,
    parciales: Number(parciales) || 3,
    ciclo,
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
      maxCalif: a.maxCalif,
      instrucciones: a.instrucciones || '',
      fechaLimite: a.fechaLimite || null,
      tiposArchivo: a.tiposArchivo || 'imagenes',
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

  // 4. Optionally copy students (new docs, activado:false, new resetPassword)
  if (keepStudents) {
    const studsSnap = await getDocs(
      query(collection(db, 'students'), where('asignaturaId', '==', sourceSubjectId))
    )
    const taken = new Set()

    const sorted = studsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))

    sorted.forEach((s, i) => {
      let username = generateUsername(s.apellidoPaterno, s.apellidoMaterno, s.nombre)
      let suffix = 2
      while (taken.has(username)) {
        const base = generateUsername(s.apellidoPaterno, s.apellidoMaterno, s.nombre).slice(0, 3)
        username = base + suffix; suffix++
      }
      taken.add(username)

      const ref = doc(collection(db, 'students'))
      batch.set(ref, {
        apellidoPaterno: s.apellidoPaterno || '',
        apellidoMaterno: s.apellidoMaterno || '',
        nombre: s.nombre || '',
        username,
        resetPassword: generateResetPassword(),
        escuelaId,
        asignaturaId: newSubjectId,
        activado: false,
        orden: i + 1,
        createdAt: serverTimestamp(),
      })
      ops++
      if (ops >= LIMIT) { flush(); }
    })
  }

  await flush()
  return newSubjectId
}
