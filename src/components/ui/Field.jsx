// Luminous field wrapper: label-caps above, soft pill input styling applied to
// the child input via `inputClass` for callers that render their own input.
export const inputClass =
  'w-full px-4 py-3 rounded border border-outline-variant bg-surface-card text-on-surface text-body-md focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 placeholder:text-muted'

export default function Field({ label, htmlFor, className = '', children }) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={htmlFor} className="block text-label-caps text-muted uppercase mb-1.5">
          {label}
        </label>
      )}
      {children}
    </div>
  )
}
