// Student username format: APELLIDO_PATERNO.PRIMER_NOMBRE (e.g. MENDEZ.ENRIQUE)
// - accents stripped and n with tilde becomes n (NFD + combining-marks removal)
// - anything non-alphabetic removed, so "Del Rio" with spaces -> DELRIO
// - stored in lowercase; lookups query both lower/upper variants
//   (usernameCandidates) so matching is case-insensitive and legacy
//   UPPERCASE 4-letter codes keep working
// - only the FIRST given name is used ("Juan Carlos" -> JUAN)
export function generateUsername(apPaterno, apMaterno, nombre) {
  const clean = (s) =>
    (s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z]/g, '')
      .toLowerCase()
  const paterno = clean(apPaterno)
  const primerNombre = clean((nombre || '').trim().split(/\s+/)[0])
  return `${paterno || 'x'}.${primerNombre || 'x'}`
}

// Firestore can't compare case-insensitively: legacy codes are UPPERCASE,
// new ones lowercase — look up both variants of whatever the student typed.
export function usernameCandidates(input) {
  const raw = (input || '').trim()
  return [...new Set([raw.toLowerCase(), raw.toUpperCase()])].filter(Boolean)
}

export function generateResetPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let pw = ''
  for (let i = 0; i < 6; i++) {
    pw += chars[Math.floor(Math.random() * chars.length)]
  }
  return pw
}

export function studentEmail(username, escuelaId) {
  return `${username.toLowerCase()}.${escuelaId}@evalua.local`
}
