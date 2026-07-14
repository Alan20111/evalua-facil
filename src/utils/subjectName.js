// Returns the display name for a subject: "Matemáticas — 1A".
// Same order everywhere (web and native app) — backward-compatible:
// subjects without `grupo` just show `nombre`.
export function subjectDisplayName(subject) {
  if (!subject) return ''
  const nombre = subject.nombre || ''
  const grupo = subject.grupo || ''
  if (!grupo) return nombre
  return `${nombre} — ${grupo}`
}
