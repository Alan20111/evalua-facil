// Comparison shown when the teacher taps the trial banner: the free trial on the
// left vs. the paid plans (from the admin-managed `plans` catalog) on the right.
export default function PlanCompareModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-surface-card w-full max-w-2xl rounded-t-card sm:rounded-card p-6 shadow-2xl max-h-[92vh] overflow-y-auto" />
    </div>
  )
}
