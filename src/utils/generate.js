export function generateUsername(apPaterno, apMaterno, nombre) {
  const clean = (s) =>
    (s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z]/g, '')
      .toUpperCase()
  const p = clean(apPaterno)
  const m = clean(apMaterno)
  const n = clean(nombre)
  return (p[0] || 'X') + (p[1] || 'X') + (m[0] || 'X') + (n[0] || 'X')
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
