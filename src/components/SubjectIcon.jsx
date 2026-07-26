import { getSubjectIcon, isDotIcon, dotIconColor } from '../utils/subjectIcons'
import { darkenHex } from '../utils/subjectPalette'

// Renders a subject's chosen icon. `iconKey` is a bank key from
// utils/subjectIcons, one of the `dot-*` color circles, OR the https URL of a
// teacher-uploaded custom icon (falls back to a book for unknown keys).
export default function SubjectIcon({ iconKey, size = 20, className = '' }) {
  // Bolita de color: círculo liso sobre fondo transparente. El color lo fija la
  // clave, así que NO se pinta con `currentColor` — a diferencia del resto del
  // banco, esta no sigue el acento de quien la muestra.
  if (isDotIcon(iconKey)) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={`flex-shrink-0 ${className}`}
      >
        {/* Aro finito del mismo color, oscurecido. Sin él las bolitas claras
            —el amarillo flúor sobre todo, que contra el lienzo azul apenas
            marca 1.12:1— se desdibujan con el fondo. El 0.45 no es al tanteo:
            es el punto en que las OCHO pasan de 3:1 contra el lienzo (la peor,
            el amarillo, queda en 3.63), que es el mínimo que pide la WCAG para
            un elemento gráfico. Al ser el mismo tono, se lee como sombra del
            borde y no como un contorno postizo. */}
        <circle
          cx="12"
          cy="12"
          r="8.4"
          fill={dotIconColor(iconKey)}
          stroke={darkenHex(dotIconColor(iconKey), 0.45)}
          strokeWidth="1.2"
        />
      </svg>
    )
  }
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
