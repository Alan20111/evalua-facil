// Marca "Evalúa Fácil" — imágenes oficiales en /public, fondo transparente,
// colores originales de la marca (texto azul marino, carpeta azul, cheque teal):
//   · /logo-evalua-facil.png → logo completo (icono + texto + subtítulo)
//   · /logo-icon.png         → solo el icono (variante compacta / móvil)
// El logo SIEMPRE va sobre fondo blanco/claro. No existe variante de texto
// blanco: sobre superficies de color (p. ej. el sidebar azul) se envuelve el
// logo en un contenedor blanco, no se cambia el logo.
// En pantalla se usan las .webp (900 px de ancho / 240 px de alto: nítidas a 3x
// y 30 KB / 5 KB, contra 170 KB / 300 KB de los PNG originales, que se comían el
// ancho de banda del arranque en datos móviles). Los PNG se quedan para quien
// necesita el original (marca de agua de exportaciones, correos).
// El tamaño lo controla `className` (w-full h-auto en el sidebar, h-8 en móvil).
// Props: subtitle=false → variante compacta (solo icono).
export default function EFLogo({ className = '', subtitle = true }) {
  const src = subtitle ? '/logo-evalua-facil.webp' : '/logo-icon.webp'
  return (
    <img
      src={src}
      alt="Evalúa Fácil"
      decoding="async"
      className={className}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  )
}
