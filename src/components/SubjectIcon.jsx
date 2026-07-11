import { getSubjectIcon } from '../utils/subjectIcons'

// Renders a subject's chosen icon. `iconKey` is a bank key from
// utils/subjectIcons OR the https URL of a teacher-uploaded custom icon
// (falls back to a book for unknown keys).
export default function SubjectIcon({ iconKey, size = 20, className = '' }) {
  if (/^https?:\/\//.test(iconKey || '')) {
    return (
      <img
        src={iconKey}
        alt=""
        style={{ width: size, height: size }}
        className={`object-contain ${className}`}
      />
    )
  }
  const Icon = getSubjectIcon(iconKey)
  return <Icon size={size} className={className} />
}
