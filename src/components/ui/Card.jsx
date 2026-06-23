// Luminous card: white surface, large soft radius, ambient shadow.
export default function Card({ as: Tag = 'div', className = '', children, ...props }) {
  return (
    <Tag className={`bg-surface-card rounded-lg shadow-card ${className}`} {...props}>
      {children}
    </Tag>
  )
}
