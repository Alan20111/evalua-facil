import { SUBJECT_ICON_KEYS, getSubjectIcon } from '../utils/subjectIcons'

// Grid of subject icons. `value` is an icon key, `onChange(key)`.
export default function IconSelect({ value = 'book', onChange }) {
  return (
    <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
      {SUBJECT_ICON_KEYS.map((key) => {
        const Icon = getSubjectIcon(key)
        const selected = (value || 'book') === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-label={key}
            className={`aspect-square rounded flex items-center justify-center transition-colors ${selected ? 'bg-accent text-white' : 'bg-surface-container text-muted hover:bg-[rgba(249,115,22,0.12)]'}`}
          >
            <Icon size={19} />
          </button>
        )
      })}
    </div>
  )
}
