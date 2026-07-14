// Marca "Evalúa Fácil" — imágenes oficiales en /public, fondo transparente:
//   · /logo-evalua-facil.png      → logo completo (icono + texto + subtítulo), texto negro — fondos claros
//   · /logo-icon.png              → solo el icono, colores originales — fondos claros
//   · /logo-evalua-facil-azul.png → logo completo, texto blanco + carpeta en blanco (alto contraste) — fondos azules/oscuros
//   · /logo-icon-azul.png         → solo el icono, carpeta en blanco (alto contraste) — fondos azules/oscuros
// El tamaño lo controla `className` (w-full h-auto en el sidebar, h-8 en móvil).
// Props: subtitle=false → variante compacta (solo icono). variant='azul' → variante de alto contraste para fondos azules/oscuros (sidebars, overlays).
export default function EFLogo({ className = '', subtitle = true, variant = 'default' }) {
  const suffix = variant === 'azul' ? '-azul' : ''
  const src = subtitle ? `/logo-evalua-facil${suffix}.png` : `/logo-icon${suffix}.png`
  return (
    <img
      src={src}
      alt="Evalúa Fácil"
      className={className}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  )
}
