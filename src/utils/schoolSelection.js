import { collection, doc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
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
// `createdBy` (the teacher's uid) is recorded only when a brand-new custom
// school doc is created — not shown to anyone, just there so a bad/junk entry
// can be traced back if it ever needs reviewing.
export async function resolveSchoolSelection(plantel, createdBy) {
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
    await setDoc(ref, {
      nombre: name,
      nombreNormalizado,
      shortName: name,
      custom: true,
      ...extra,
      createdBy: createdBy || null,
      createdAt: serverTimestamp(),
    })
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

function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function digitsOf(s) {
  return (s.match(/\d+/g) || []).join(',')
}

// True if two school names look like the same school written differently —
// typos or reordered words ("María Fuentez" vs "María Fuentes"). Used to
// suggest "¿es esta la misma escuela?" before creating a new custom entry,
// not to silently merge anything — so it's tuned to avoid false positives:
// many real schools share an otherwise-identical name and differ only by a
// number ("CBTIS 255" vs "CBTIS 256", "Secundaria Técnica 5" vs "... 12"),
// so any digit mismatch rules out a match outright before anything else.
export function namesAreSimilar(a, b) {
  const na = normalizeName(a || '')
  const nb = normalizeName(b || '')
  if (!na || !nb) return false
  if (na === nb) return true
  const da = digitsOf(na)
  const db = digitsOf(nb)
  if (da && db && da !== db) return false
  const maxLen = Math.max(na.length, nb.length)
  const similarity = 1 - levenshtein(na, nb) / maxLen
  if (similarity >= 0.85) return true
  const wordsA = new Set(na.split(' ').filter((w) => w.length > 2))
  const wordsB = new Set(nb.split(' ').filter((w) => w.length > 2))
  let common = 0
  wordsA.forEach((w) => { if (wordsB.has(w)) common++ })
  const union = new Set([...wordsA, ...wordsB]).size
  return common >= 2 && union > 0 && common / union >= 0.8
}

// Finds existing schools (catalog or custom) that plausibly match a
// newly-typed name+city+state, so the teacher can confirm it's the same
// school instead of accidentally creating a duplicate. City/state are
// required to roughly match (when known on both sides) before even
// comparing names — a common name in a different town shouldn't surface.
export function findSimilarSchools(name, mun, edo, candidates) {
  const targetMun = mun ? normalizeName(mun) : ''
  const targetEdo = edo ? normalizeName(edo) : ''
  return candidates.filter((c) => {
    const cMun = c.municipio ? normalizeName(c.municipio) : ''
    const cEdo = c.estado ? normalizeName(c.estado) : ''
    if (targetEdo && cEdo && targetEdo !== cEdo) return false
    if (targetMun && cMun && targetMun !== cMun) return false
    return namesAreSimilar(name, c.nombre)
  })
}
