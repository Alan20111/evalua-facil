// Marca "Evalúa Fácil" — imágenes oficiales en /public:
//   · /logo-evalua-facil.png → logo completo (icono + texto + subtítulo)
//   · /logo-icon.png         → solo el icono (variante compacta / móvil)
// Props: subtitle=false → variante compacta (solo icono).
export default function EFLogo({ className = '', subtitle = true }) {
  const src = subtitle ? '/logo-evalua-facil.png' : '/logo-icon.png'
  return (
    <img
      src={src}
      alt="Evalúa Fácil"
      className={className}
      style={{ objectFit: 'contain' }}
    />
  )
}
