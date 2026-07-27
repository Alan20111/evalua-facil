import { getSubjectIcon, isDotIcon, dotIconColor, dotOutlineColor } from '../utils/subjectIcons'
import { darkenHex } from '../utils/subjectPalette'

// Renders a subject's chosen icon. `iconKey` is a bank key from
// utils/subjectIcons, one of the `dot-*` color circles, OR the https URL of a
// teacher-uploaded custom icon (falls back to a book for unknown keys).
export default function SubjectIcon({ iconKey, size = 20, className = '' }) {
  // Bolita de color: círculo liso sobre fondo transparente. El color lo fija la
  // clave, así que NO se pinta con `currentColor` — a diferencia del resto del
  // banco, esta no sigue el acento de quien la muestra.
  if (isDotIcon(iconKey)) {
    // Aro propio (azul, rojo, violeta y blanca) o, si no lo tiene, el de
    // siempre: su mismo tono oscurecido. El propio va más grueso porque su
    // trabajo es notarse, no pasar por sombra del borde.
    const ownOutline = dotOutlineColor(iconKey)
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
        {/* radio + medio trazo = 12 SIEMPRE: así el círculo llena exacto el
            viewBox de 24 con cualquiera de los dos grosores (11.3+0.7 y
            10.9+1.1), sin que el aro grueso se recorte contra el borde. Antes
            iba a 8.4 —tres cuartos de la caja— imitando el aire interno que
            traen los íconos de lucide, y al lado de ellos se veía chico. Una
            bolita es una mancha de color: si no ocupa su caja completa,
            desperdicia justo lo que la hace útil. */}
        <circle
          cx="12"
          cy="12"
          r={ownOutline ? 10.9 : 11.3}
          fill={dotIconColor(iconKey)}
          stroke={ownOutline || darkenHex(dotIconColor(iconKey), 0.45)}
          strokeWidth={ownOutline ? 2.2 : 1.4}
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
