// Returns the display name for a subject.
// Default (reverse=false): "Matemáticas 1A"
// Reversed (reverse=true): "1A Matemáticas"
// Backward-compatible: subjects without `grupo` just show `nombre`.
export function subjectDisplayName(subject, reverse = false) {
  if (!subject) return ''
  const nombre = subject.nombre || ''
  const grupo = subject.grupo || ''
  if (!grupo) return nombre
  return reverse ? `${grupo} ${nombre}` : `${nombre} ${grupo}`
}
