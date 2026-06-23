// Luminous button. variant: 'primary' (solid accent) | 'ghost' (accent text).
export default function Button({ variant = 'primary', className = '', children, ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded font-semibold transition-colors disabled:opacity-60'
  const styles = {
    primary: 'bg-accent text-white hover:bg-accent-hover px-5 py-3',
    ghost: 'text-accent hover:bg-accent-light px-4 py-2',
    danger: 'bg-error text-white hover:opacity-90 px-5 py-3',
  }
  return (
    <button className={`${base} ${styles[variant] || styles.primary} ${className}`} {...props}>
      {children}
    </button>
  )
}
