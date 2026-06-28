// Student identity helpers for the multi-subject model.
//
// A real student can be enrolled in several subjects. Each enrollment is its own `students`
// doc, but they must all share ONE identity: the same `username` (hence the same fake email
// `username.escuelaId@evalua.local` and the same Firebase Auth `uid`). Otherwise the student
// ends up with several accounts and only ever sees one subject per session.
//
// To keep identity stable per (school + person) we match by normalized full name.

function clean(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
}

// A stable key for a person within a school (case/accents-insensitive full name).
export function studentNameKey(p) {
  return `${clean(p.apellidoPaterno)}|${clean(p.apellidoMaterno)}|${clean(p.nombre)}`
}

// Given all `students` docs of a school, find the canonical identity of a person (same full
// name), or null if this is a brand-new person. Prefers an already-activated enrollment so
// the new doc can inherit its uid and appear in the student's dashboard immediately.
export function findStudentIdentity(schoolDocs, person) {
  const key = studentNameKey(person)
  const matches = (schoolDocs || []).filter((d) => studentNameKey(d) === key)
  if (!matches.length) return null
  const canonical = matches.find((m) => m.uid) || matches[0]
  return {
    username: canonical.username,
    uid: canonical.uid || null,
    activado: !!canonical.activado,
    matches,
  }
}
