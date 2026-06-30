// Permanent role indicator next to the "Evalúa Fácil" logo — lets the user tell
// at a glance whether they're in the Docente or Estudiante portal.
export default function PortalBadge({ role }) {
  const isTeacher = role === 'docente'
  return (
    <span
      className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-bold leading-tight tracking-wide whitespace-nowrap text-black ${
        isTeacher ? 'bg-[#39FF14]' : 'bg-[#FF6600]'
      }`}
    >
      {isTeacher ? 'DOCENTE' : 'ESTUDIANTE'}
    </span>
  )
}
