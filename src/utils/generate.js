// Student username format: APELLIDO_PATERNO.PRIMER_NOMBRE (e.g. MENDEZ.ENRIQUE)
// - accents stripped and n with tilde becomes n (NFD + combining-marks removal)
// - anything non-alphabetic removed, so "Del Rio" with spaces -> DELRIO
// - stored/compared in UPPERCASE; every input uppercases before querying,
//   which makes the whole flow case-insensitive
// - only the FIRST given name is used ("Juan Carlos" -> JUAN)
export function generateUsername(apPaterno, apMaterno, nombre) {
  const clean = (s) =>
    (s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z]/g, '')
      .toUpperCase()
  const paterno = clean(apPaterno)
  const primerNombre = clean((nombre || '').trim().split(/\s+/)[0])
  return `${paterno || 'X'}.${primerNombre || 'X'}`
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
