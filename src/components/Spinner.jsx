export default function Spinner({ size = 'md' }) {
  const s = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-10 w-10' : 'h-6 w-6'
  return (
    <div className={`${s} animate-spin rounded-full border-2 border-indigo-600 border-t-transparent`} />
  )
}
