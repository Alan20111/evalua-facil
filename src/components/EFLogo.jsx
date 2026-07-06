// Marca "Evalúa Fácil" como SVG vectorial (escala nítida a cualquier ancho).
// Colores y proporciones según el brand oficial:
//  · "Evalúa" #011649 · "Fácil" #0967F0 · subtítulo #011649
//  · icono en degradado #011780 → #0975F0 · check #1CD3BB · línea #0FCEA9
//  · relación título:subtítulo ≈ 4:1 · tipografía Poppins (700 / 500)
// Props:
//  · subtitle=false → variante compacta (icono + "Evalúa Fácil", sin subtítulo)
export default function EFLogo({ className = '', subtitle = true }) {
  return (
    <svg
      className={className}
      viewBox={subtitle ? '0 0 1500 320' : '0 0 1200 300'}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Evalúa Fácil"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="efDocGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#011780" />
          <stop offset="1" stopColor="#0975F0" />
        </linearGradient>
      </defs>

      {/* ── Icono: documentos apilados con palomita ── */}
      {/* documento trasero */}
      <rect x="42" y="52" width="150" height="216" rx="26" fill="#011780" />
      {/* documento frontal con esquina doblada */}
      <path
        d="M84 78 L150 78 L198 124 L198 250 Q198 270 178 270 L84 270 Q64 270 64 250 L64 98 Q64 78 84 78 Z"
        fill="url(#efDocGrad)"
      />
      {/* doblez de la esquina */}
      <path d="M150 78 L198 124 L150 124 Z" fill="#cfe0fb" />
      {/* renglones */}
      <rect x="86" y="132" width="80" height="12" rx="6" fill="#cfe0fb" />
      <rect x="86" y="157" width="62" height="12" rx="6" fill="#cfe0fb" />
      <rect x="86" y="182" width="46" height="12" rx="6" fill="#cfe0fb" />
      {/* palomita */}
      <path
        d="M82 224 L114 258 L180 190"
        fill="none"
        stroke="#1CD3BB"
        strokeWidth="23"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* ── Tipografía ── */}
      <text
        x="268"
        y="196"
        fontFamily="Poppins, system-ui, sans-serif"
        fontWeight="700"
        fontSize="150"
        textLength="990"
        lengthAdjust="spacingAndGlyphs"
      >
        <tspan fill="#011649">Evalúa </tspan>
        <tspan fill="#0967F0">Fácil</tspan>
      </text>

      {subtitle && (
        <>
          <text
            x="272"
            y="258"
            fontFamily="Poppins, system-ui, sans-serif"
            fontWeight="500"
            fontSize="38"
            fill="#011649"
            textLength="985"
            lengthAdjust="spacingAndGlyphs"
          >
            Evidencias y calificaciones, sin complicaciones.
          </text>
          <line x1="272" y1="284" x2="1257" y2="284" stroke="#0FCEA9" strokeWidth="6" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}
