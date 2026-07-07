// Marca "Evalúa Fácil" — imágenes oficiales en /public:
//   · /logo-evalua-facil.png → logo completo (icono + texto + subtítulo)
//   · /logo-icon.png         → solo el icono (variante compacta / móvil)
// El PNG completo trae margen blanco arriba/abajo; lo recortamos con object-fit
// cover + una proporción más apretada para que el marco quede pegado al logo.
// Props: subtitle=false → variante compacta (solo icono).
export default function EFLogo({ className = '', subtitle = true }) {
  const src = subtitle ? '/logo-evalua-facil.png' : '/logo-icon.png'
  const style = subtitle
    ? { display: 'block', width: '100%', aspectRatio: '3.6 / 1', objectFit: 'cover', objectPosition: 'center' }
    : { display: 'block', objectFit: 'contain' }
  return <img src={src} alt="Evalúa Fácil" className={className} style={style} />
}
