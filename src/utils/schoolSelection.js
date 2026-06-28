import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { db } from '../firebase'

// Case/accent/spacing-insensitive key so two teachers typing the same custom
// school name in different ways ("Secundaria Juárez" vs "secundaria juarez")
// still land on the same `schools` doc — Profile.jsx promises that schools
// with the same name share groups, so the match can't be a fragile exact string.
// Exported so the school picker's search box can use the same rule: typing
// with or without accents/case finds the same results.
export function normalizeName(name) {
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

  // Re-selecting a custom school already shown in the suggestion list (its
  // Firestore id is already known) — skip matching entirely, it IS that school.
  if (plantel.existingId) {
    return { escuelaId: plantel.existingId, schoolName: plantel.nombre }
  }

  if (plantel.custom) {
    const name = plantel.nombre.trim()
    const nombreNormalizado = normalizeName(name)
    const cct = plantel.cct?.trim() || ''
    const mun = plantel.mun?.trim() || ''
    const edo = plantel.edo?.trim() || ''
    const municipioNormalizado = mun ? normalizeName(mun) : ''

    const extra = {}
    if (cct) extra.claveSEP = cct
    if (mun) { extra.municipio = mun; extra.municipioNormalizado = municipioNormalizado }
    if (edo) extra.estado = edo

    // Same CCT always means the same school, regardless of what name/city was typed.
    if (cct) {
      const byCCT = await getDocs(query(collection(db, 'schools'), where('claveSEP', '==', cct)))
      if (!byCCT.empty) {
        const match = byCCT.docs[0]
        if (Object.keys(extra).length) await setDoc(doc(db, 'schools', match.id), extra, { merge: true })
        return { escuelaId: match.id, schoolName: match.data().nombre || name }
      }
    }

    // No CCT match (or none given) — same name is only the same school if the
    // city matches too, so two unrelated "Escuela Primaria Juárez" in
    // different towns don't get merged into one.
    const sameName = await getDocs(query(collection(db, 'schools'), where('nombreNormalizado', '==', nombreNormalizado)))
    const cityMatch = sameName.docs.find((d) => {
      const data = d.data()
      if (data.municipioNormalizado) return data.municipioNormalizado === municipioNormalizado
      // Created before municipio was collected — no city on record to
      // conflict with, treat as the same school and backfill it below.
      return !data.municipio
    })
    if (cityMatch) {
      if (Object.keys(extra).length) await setDoc(doc(db, 'schools', cityMatch.id), extra, { merge: true })
      return { escuelaId: cityMatch.id, schoolName: cityMatch.data().nombre || name }
    }

    // Fallback for schools created before nombreNormalizado existed at all —
    // match by the exact old field (only when it has no city or it matches)
    // and self-heal it so future lookups go through the checks above.
    const legacy = await getDocs(query(collection(db, 'schools'), where('nombre', '==', name)))
    const legacyMatch = legacy.docs.find((d) => {
      const data = d.data()
      if (data.municipioNormalizado) return data.municipioNormalizado === municipioNormalizado
      return !data.municipio
    })
    if (legacyMatch) {
      await setDoc(doc(db, 'schools', legacyMatch.id), { nombreNormalizado, ...extra }, { merge: true })
      return { escuelaId: legacyMatch.id, schoolName: legacyMatch.data().nombre || name }
    }

    const ref = doc(collection(db, 'schools'))
    await setDoc(ref, { nombre: name, nombreNormalizado, shortName: name, custom: true, ...extra })
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
