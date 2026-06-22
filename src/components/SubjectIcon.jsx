import { getSubjectIcon } from '../utils/subjectIcons'

// Renders a subject's chosen icon (falls back to a book).
export default function SubjectIcon({ iconKey, size = 20, className = '' }) {
  const Icon = getSubjectIcon(iconKey)
  return <Icon size={size} className={className} />
}
