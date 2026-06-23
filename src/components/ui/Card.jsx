// Luminous card: white surface, large soft radius, ambient shadow.
export default function Card({ as: Tag = 'div', className = '', children, ...props }) {
  return (
    <Tag className={`bg-surface-card rounded-card shadow-card ${className}`} {...props}>
      {children}
    </Tag>
  )
}
