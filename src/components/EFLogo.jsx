// Marca "Evalúa Fácil" — imágenes oficiales en /public, fondo transparente,
// colores originales de la marca (texto azul marino, carpeta azul, cheque teal):
//   · /logo-evalua-facil.png → logo completo (icono + texto + subtítulo)
//   · /logo-icon.png         → solo el icono (variante compacta / móvil)
// El logo SIEMPRE va sobre fondo blanco/claro. No existe variante de texto
// blanco: sobre superficies de color (p. ej. el sidebar azul) se envuelve el
// logo en un contenedor blanco, no se cambia el logo.
// El tamaño lo controla `className` (w-full h-auto en el sidebar, h-8 en móvil).
// Props: subtitle=false → variante compacta (solo icono).
export default function EFLogo({ className = '', subtitle = true }) {
  const src = subtitle ? '/logo-evalua-facil.png' : '/logo-icon.png'
  return (
    <img
      src={src}
      alt="Evalúa Fácil"
      className={className}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  )
}
