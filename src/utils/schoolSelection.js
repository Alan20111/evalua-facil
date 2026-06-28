import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { db } from '../firebase'

// Case/accent/spacing-insensitive key so two teachers typing the same custom
// school name in different ways ("Secundaria Juárez" vs "secundaria juarez")
// still land on the same `schools` doc — Profile.jsx promises that schools
// with the same name share groups, so the match can't be a fragile exact string.
function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

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
    const nombreNormalizado = normalizeName(name)
    const existing = await getDocs(
      query(collection(db, 'schools'), where('nombreNormalizado', '==', nombreNormalizado))
    )
    if (!existing.empty) {
      const match = existing.docs[0]
      return { escuelaId: match.id, schoolName: match.data().nombre || name }
    }
    // Fallback for custom schools created before nombreNormalizado existed —
    // match by the exact old field and self-heal it so future lookups (even
    // with different casing/accents) find it via nombreNormalizado too.
    const legacy = await getDocs(query(collection(db, 'schools'), where('nombre', '==', name)))
    if (!legacy.empty) {
      const match = legacy.docs[0]
      await setDoc(doc(db, 'schools', match.id), { nombreNormalizado }, { merge: true })
      return { escuelaId: match.id, schoolName: match.data().nombre || name }
    }
    const ref = doc(collection(db, 'schools'))
    await setDoc(ref, { nombre: name, nombreNormalizado, shortName: name, custom: true })
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
