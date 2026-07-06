// Marca "Evalúa Fácil": icono oficial (/logo-icon.png) + texto en Poppins.
// El icono es tu imagen real; el texto se dibuja en SVG con los colores del brand
// (así todo escala nítido al ancho del contenedor).
//  · "Evalúa" #011649 · "Fácil" #0967F0 · subtítulo #011649 · línea #0FCEA9
//  · relación título:subtítulo ≈ 4:1 · Poppins 700 / 500
// Props: subtitle=false → variante compacta (icono + "Evalúa Fácil", sin subtítulo).
export default function EFLogo({ className = '', subtitle = true }) {
  return (
    <svg
      className={className}
      viewBox={subtitle ? '0 0 1500 320' : '0 0 1150 300'}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Evalúa Fácil"
      style={{ display: 'block' }}
    >
      {/* Icono oficial */}
      <image
        href="/logo-icon.png"
        x="8"
        y="14"
        width="240"
        height="292"
        preserveAspectRatio="xMidYMid meet"
      />

      {/* Título */}
      <text
        x="272"
        y="196"
        fontFamily="Poppins, system-ui, sans-serif"
        fontWeight="700"
        fontSize="150"
        textLength={subtitle ? '985' : '840'}
        lengthAdjust="spacingAndGlyphs"
      >
        <tspan fill="#011649">Evalúa </tspan>
        <tspan fill="#0967F0">Fácil</tspan>
      </text>

      {subtitle && (
        <>
          <text
            x="276"
            y="258"
            fontFamily="Poppins, system-ui, sans-serif"
            fontWeight="500"
            fontSize="38"
            fill="#011649"
            textLength="980"
            lengthAdjust="spacingAndGlyphs"
          >
            Evidencias y calificaciones, sin complicaciones.
          </text>
          <line x1="276" y1="284" x2="1256" y2="284" stroke="#0FCEA9" strokeWidth="6" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}
