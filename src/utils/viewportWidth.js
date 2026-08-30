// Ancho REAL de la pantalla visible, en píxeles CSS.
//
// Dentro del WebView de Android (Samsung S23 + Capacitor) las tres medidas
// "obvias" se pueden contradecir entre sí:
//
//   document.documentElement.clientWidth → layout viewport
//   window.innerWidth                    → layout viewport (NO el visual)
//   window.visualViewport.width          → lo que de verdad se ve
//
// Cuando el layout viewport no coincide con la pantalla, `100%`, `100vw` y
// `fixed inset-0` se quedan cortos y aparece la franja de fondo a la derecha.
//
// visualViewport es la única medida atada a lo que el usuario ve. Se corrige
// por `scale` para que un pinch-zoom no la haga "encoger": con zoom 2x, width
// es la mitad y scale es 2, así que el producto sigue siendo el ancho real.
//
// Lo que NUNCA se hace aquí: reescribir el <meta name="viewport"> en runtime.
// Fijarle un `width=N` mayor que la pantalla (por ejemplo el screenWidthDp que
// reporta Android, que está en otra unidad que los px CSS de Chrome) hace la
// página más ancha de lo que se ve: el contenido queda cortado a la izquierda
// y sobra una franja vacía a la derecha. Medido: meta `width=411` en una
// pantalla de 375 → overlay de 411px, visualViewport de 375px, franja de 36px.
export function realViewportWidth() {
  const vv = window.visualViewport
  if (vv && vv.width > 0) return Math.round(vv.width * (vv.scale || 1))
  return document.documentElement.clientWidth || window.innerWidth
}

// Publica el ancho real en --layout-w (lo consumen los elementos `fixed`:
// nav inferior, Toast y el overlay de evaluar) y, solo en la app nativa, lo
// fija también en <html> para que el contenido normal de las páginas —que
// resuelve `width:100%` contra el layout viewport— ocupe la pantalla completa.
// html.is-native-app lleva overflow-x:hidden, así que si el layout viewport
// resultara más angosto no se genera scroll horizontal.
export function publishViewportWidth(isNative) {
  const w = realViewportWidth()
  const root = document.documentElement
  const next = w + 'px'
  if (root.style.getPropertyValue('--layout-w') === next) return
  root.style.setProperty('--layout-w', next)
  if (isNative) root.style.width = next
}

// Se recalcula en rotación y en cambios de tamaño de ventana. A propósito NO
// se escucha visualViewport.resize: ese evento sí dispara con el pinch-zoom y
// haría que la nav y el overlay encogieran mientras el docente amplía una
// entrega.
export function watchViewportWidth(isNative) {
  const update = () => publishViewportWidth(isNative)
  update()
  window.addEventListener('resize', update)
  window.addEventListener('orientationchange', update)
}
