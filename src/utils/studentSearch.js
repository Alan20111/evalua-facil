// Single source of truth for a student's full display name — Apellido Paterno,
// Apellido Materno, Nombre(s). Must be used everywhere a student name is
// shown to the teacher (Estudiantes, Calificaciones, confirmaciones, etc.) so
// they never drift out of sync with each other.
export function studentFullName(student) {
  return `${student?.apellidoPaterno || ''} ${student?.apellidoMaterno || ''} ${student?.nombre || ''}`
    .replace(/\s+/g, ' ')
    .trim()
}

// Shared "buscar alumno" matcher: full name OR the student's list number
// (`orden`, shown as "No." en Calificaciones/Alumnos) — typing "4" finds the
// student whose número de lista is 4, not just a name containing "4".
export function matchesStudentSearch(student, query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return true
  if (String(student.orden ?? '') === q) return true
  return studentFullName(student).toLowerCase().includes(q)
}
