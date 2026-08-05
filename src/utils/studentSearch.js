import { capitalizarNombre, sinAcentos } from './nombres'

// Single source of truth for a student's full display name — Apellido Paterno,
// Apellido Materno, Nombre(s). Must be used everywhere a student name is
// shown to the teacher (Estudiantes, Calificaciones, confirmaciones, etc.) so
// they never drift out of sync with each other.
//
// Capitaliza al mostrar (ver capitalizarNombre): en la base hay nombres en
// MAYÚSCULAS (listas importadas de Excel) y en minúsculas (capturas a mano), y
// todos deben verse igual sin tener que corregir uno por uno lo ya guardado.
export function studentFullName(student) {
  return [student?.apellidoPaterno, student?.apellidoMaterno, student?.nombre]
    .map(capitalizarNombre)
    .filter(Boolean)
    .join(' ')
}

// Shared "buscar alumno" matcher: full name OR the student's list number
// (`orden`, shown as "No." en Calificaciones/Alumnos) — typing "4" finds the
// student whose número de lista es 4, not just a name containing "4".
//
// Sin acentos de los dos lados: nadie escribe "María" con acento en un
// buscador, y antes eso dejaba al alumno fuera de la lista.
export function matchesStudentSearch(student, query) {
  const q = sinAcentos(query).trim()
  if (!q) return true
  if (String(student.orden ?? '') === q) return true
  return sinAcentos(studentFullName(student)).includes(q)
}

// Single source of truth for how a teacher's name is shown TO STUDENTS —
// their chosen prefijo (e.g. "Profe", "Mtro.") plus their nombreMostrar,
// falling back through username/nombre if nombreMostrar was never set.
// El username NO se capitaliza: es el identificador del docente (CBTIS255-01)
// y "Cbtis255-01" no es su nombre. El prefijo lo elige él de una lista, así
// que también va tal cual.
export function teacherDisplayName(teacher) {
  const base = capitalizarNombre(teacher?.nombreMostrar || teacher?.nombre) || teacher?.username || ''
  if (!base) return ''
  return teacher?.prefijo ? `${teacher.prefijo} ${base}` : base
}
