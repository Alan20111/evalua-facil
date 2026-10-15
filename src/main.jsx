import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/outfit'
import './index.css'
import App from './App.jsx'
import { initStatusBar } from './utils/nativeInit.js'
import { lockPortrait } from './utils/orientation.js'
import { IS_NATIVE_APP } from './utils/platform.js'
import { watchViewportWidth } from './utils/viewportWidth.js'
import { instalarRegistroErrores } from './utils/registroErrores.js'
import { CargaFallida } from './components/carga/Espera.jsx'

// Antes que nada: así también se registran los errores del arranque.
instalarRegistroErrores()

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

// Cuando Vite no puede cargar un chunk dinámico (version skew: el WebView
// conservó un index.html de un deploy anterior y los hashes de los chunks
// ya cambiaron), recarga la página UNA VEZ para obtener el index.html y
// los chunks actuales. event.preventDefault() suprime el error original
// antes de que llegue al catch de cada módulo (de lo contrario aparece
// "No se pudo iniciar sesión con Google" aunque Google no sea la causa).
// La marca de sessionStorage evita un loop si el deployment en sí está roto:
// si tras la recarga el chunk sigue sin existir, el error llega al usuario
// (y CargaFallida le ofrece «Reintentar»). La marca guarda la HORA y vence a
// los 60 s: antes era un '1' que nunca se borraba, así que el SEGUNDO deploy
// con la pestaña abierta ya no recargaba y la página se quedaba pegada.
window.addEventListener('vite:preloadError', (event) => {
  const ultima = Number(sessionStorage.getItem('vite_reload')) || 0
  if (Date.now() - ultima < 60000) return
  event.preventDefault()
  sessionStorage.setItem('vite_reload', String(Date.now()))
  window.location.reload()
})

function montar() {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      {/* Límite exterior: atrapa lo que truene fuera de las rutas (proveedores,
          avisos globales), que antes dejaba la pantalla en blanco. */}
      <CargaFallida>
        <App />
      </CargaFallida>
    </StrictMode>,
  )
}

// Montar DESPUÉS del primer cuadro (rendimiento, oct-2026): si el JS ya está
// en caché, el navegador lo ejecuta antes de pintar y React reemplazaba la
// pantalla inicial de index.html sin que llegara a verse (Lighthouse en
// celular: FCP 2.6 s en vez de ~1.2 s). requestAnimationFrame + setTimeout
// deja pintar un cuadro (~16 ms) y luego monta. En una pestaña oculta
// requestAnimationFrame no corre, así que ahí se monta de inmediato.
// En el build, el CSS de la app llega como `preload` (vite.config.js,
// cssSinBloquearPlugin) para no frenar la pantalla inicial: aquí se activa y
// React monta cuando ya cargó, así nada aparece sin estilo.
function cssListo() {
  const link = document.querySelector('link[data-css-app]')
  if (!link) return Promise.resolve()
  return new Promise((resolve) => {
    link.addEventListener('load', resolve, { once: true })
    link.addEventListener('error', resolve, { once: true })
    link.rel = 'stylesheet'
    if (link.sheet) resolve()
  })
}

cssListo().then(() => {
  if (document.visibilityState === 'visible') {
    requestAnimationFrame(() => setTimeout(montar, 0))
  } else {
    montar()
  }
})

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
