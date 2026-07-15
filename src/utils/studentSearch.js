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
// student whose número de lista es 4, not just a name containing "4".
export function matchesStudentSearch(student, query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return true
  if (String(student.orden ?? '') === q) return true
  return studentFullName(student).toLowerCase().includes(q)
}

// Single source of truth for how a teacher's name is shown TO STUDENTS —
// their chosen prefijo (e.g. "Profe", "Mtro.") plus their nombreMostrar,
// falling back through username/nombre if nombreMostrar was never set.
export function teacherDisplayName(teacher) {
  const base = teacher?.nombreMostrar || teacher?.nombre || teacher?.username || ''
  if (!base) return ''
  return teacher?.prefijo ? `${teacher.prefijo} ${base}` : base
}
