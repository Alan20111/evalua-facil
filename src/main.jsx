import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/outfit'
import './index.css'
import App from './App.jsx'
import { initStatusBar } from './utils/nativeInit.js'
import { lockPortrait } from './utils/orientation.js'
import { IS_NATIVE_APP } from './utils/platform.js'
import { watchViewportWidth } from './utils/viewportWidth.js'

initStatusBar()
// La app arranca (y se mantiene) en vertical; solo la pestaña Asistencias la
// pone en horizontal. Ya no se fija la orientación en el AndroidManifest para
// permitir la rotación en runtime vía plugin.
lockPortrait()

// Samsung S23 y similares: el layout viewport del WebView puede no coincidir
// con la pantalla, y entonces `100%`/`100vw`/`fixed inset-0` dejan una franja
// del fondo a la derecha. watchViewportWidth mide el ancho real (visualViewport)
// y lo publica en --layout-w y en <html>. Ver src/utils/viewportWidth.js.
watchViewportWidth(IS_NATIVE_APP)
if (IS_NATIVE_APP) document.documentElement.classList.add('is-native-app')

const root = createRoot(document.getElementById('root'))

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Solo en dev: audita el DOM real con axe-core y reporta violaciones en la
// consola sin tocar el bundle de producción. Import dinámico para que ni el
// paquete se resuelva fuera de dev. Ver docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md C-02.
if (import.meta.env.DEV) {
  Promise.all([import('@axe-core/react'), import('react'), import('react-dom')]).then(
    ([axe, React, ReactDOM]) => {
      axe.default(React, ReactDOM, 1000)
    }
  )
}
