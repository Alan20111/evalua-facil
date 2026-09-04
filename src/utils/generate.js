// Student username format: APELLIDO_PATERNO.PRIMER_NOMBRE (e.g. MENDEZ.ENRIQUE)
// - accents stripped and ñ/Ñ converted explicitly to n before removing non-alpha
//   (NFD + \p{Diacritic} covers á/é/í/ó/ú/ü; ñ is handled by the explicit step
//   because the older combining-mark regex did not reliably strip it)
// - anything non-alphabetic removed, so "Del Rio" with spaces -> DELRIO
// - stored in lowercase; lookups query both lower/upper variants
//   (usernameCandidates) so matching is case-insensitive and legacy
//   UPPERCASE 4-letter codes keep working
// - only the FIRST given name is used ("Juan Carlos" -> JUAN)
export function generateUsername(apPaterno, apMaterno, nombre) {
  const clean = (s) =>
    (s || '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '') // quita acentos (á→a, é→e, ü→u, etc.)
      .replace(/[ñÑ]/g, 'n')          // ñ→n explícito: NFD no la descompone con el regex anterior
      .replace(/[^a-zA-Z]/g, '')
      .toLowerCase()
  const paterno = clean(apPaterno)
  const primerNombre = clean((nombre || '').trim().split(/\s+/)[0])
  return `${paterno || 'x'}.${primerNombre || 'x'}`
}

// Firestore can't compare case-insensitively: legacy codes are UPPERCASE,
// new ones lowercase — look up both variants of whatever the student typed.
// A third normalized candidate (diacritics stripped, ñ→n) lets a student who
// types "muñoz.enrique" find an account stored as "munoz.enrique".
// NOTE: this cannot bridge the gap for accounts created with the old bug
// (stored as "muoz.enrique") when the student types "munoz.enrique" —
// those are structurally different strings and require knowing their exact username.
export function usernameCandidates(input) {
  const raw = (input || '').trim()
  const norm = raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[ñÑ]/g, 'n')
    .replace(/[^a-zA-Z0-9.]/g, '')
    .toLowerCase()
  return [...new Set([raw.toLowerCase(), raw.toUpperCase(), norm])].filter(Boolean)
}

// El correo de Auth de un estudiante, derivado de su usuario y su escuela. Es
// determinista a propósito: los estudiantes no tienen correo real, y esto es
// lo que las reglas de Firestore usan para comprobar que quien reclama una
// inscripción es de verdad esa persona (ver match /students en
// firestore.rules). Cambiar la forma de este correo rompe esa comprobación.
export function studentEmail(username, escuelaId) {
  return `${username.toLowerCase()}.${escuelaId.toLowerCase()}@evalua.local`
}

// Aquí vivían `generateResetPassword` y `maskEmail`, las dos sin un solo uso:
//   · La primera armaba contraseñas temporales con Math.random(), que no sirve
//     para credenciales — es predecible. Hoy el docente no dicta ninguna
//     contraseña: solo habilita el rescate y el propio alumno elige la suya
//     (ver confirmResetStudentPassword y api/student/recover-password.js).
//   · La segunda enmascaraba un correo de recuperación que ya no existe.
// Se retiran en A04: código muerto en la superficie de credenciales es una
// invitación a que alguien lo reutilice creyendo que está probado.
