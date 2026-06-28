import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { db } from '../firebase'

// Resolves a plantel (from the catalog, a custom name, or null for "sin escuela")
// to a `schools/{id}` doc, creating it if it doesn't exist yet. Shared by Profile.jsx
// and Onboarding.jsx so the school-picker logic isn't duplicated across both.
export async function resolveSchoolSelection(plantel) {
  if (!plantel) {
    await setDoc(
      doc(db, 'schools', 'sin-escuela'),
      { nombre: 'Sin escuela', shortName: 'EF', sinEscuela: true },
      { merge: true }
    )
    return { escuelaId: 'sin-escuela', schoolName: 'Sin escuela' }
  }

  if (plantel.custom) {
    const name = plantel.nombre.trim()
    const existing = await getDocs(query(collection(db, 'schools'), where('nombre', '==', name)))
    const escuelaId = existing.empty ? null : existing.docs[0].id
    if (escuelaId) return { escuelaId, schoolName: name }
    const ref = doc(collection(db, 'schools'))
    await setDoc(ref, { nombre: name, shortName: name, custom: true })
    return { escuelaId: ref.id, schoolName: name }
  }

  const snap = await getDocs(query(collection(db, 'schools'), where('claveSEP', '==', plantel.cct)))
  if (!snap.empty) {
    return { escuelaId: snap.docs[0].id, schoolName: plantel.short || plantel.nombre }
  }
  const ref = doc(collection(db, 'schools'))
  await setDoc(ref, {
    claveSEP: plantel.cct,
    nombre: plantel.nombre,
    shortName: plantel.short,
    subsistema: plantel.sub,
    municipio: plantel.mun,
    estado: plantel.edo,
  })
  return { escuelaId: ref.id, schoolName: plantel.short || plantel.nombre }
}
