// Shared "buscar alumno" matcher: full name OR the student's list number
// (`orden`, shown as "No." in Calificaciones/Alumnos) — typing "4" finds the
// student whose número de lista is 4, not just a name containing "4".
export function matchesStudentSearch(student, query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return true
  if (String(student.orden ?? '') === q) return true
  return `${student.apellidoPaterno} ${student.apellidoMaterno} ${student.nombre}`
    .toLowerCase()
    .includes(q)
}
