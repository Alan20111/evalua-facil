// Desplazamientos por código (scrollIntoView / scrollTo): suaves, salvo que la
// persona haya pedido menos movimiento en su sistema. La regla global de
// index.css (prefers-reduced-motion) frena animaciones y transiciones de CSS,
// pero no alcanza a `behavior: 'smooth'` de JavaScript — por eso esta función.
export function desplazamiento() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'smooth'
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}
