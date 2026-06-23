// Luminous empty state: muted icon in a soft circular accent-tinted container.
export default function EmptyState({ icon: Icon, title, subtitle, action, className = '' }) {
  return (
    <div className={`text-center py-12 px-6 ${className}`}>
      {Icon && (
        <div className="w-16 h-16 rounded-full bg-accent-light flex items-center justify-center mx-auto mb-4">
          <Icon size={28} className="text-accent" />
        </div>
      )}
      {title && <p className="text-title-md text-on-surface mb-1">{title}</p>}
      {subtitle && <p className="text-body-sm text-muted">{subtitle}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
