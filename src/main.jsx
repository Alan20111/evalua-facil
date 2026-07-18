import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/outfit'
import './index.css'
import App from './App.jsx'
import { initStatusBar } from './utils/nativeInit.js'
import { lockPortrait } from './utils/orientation.js'

initStatusBar()
// La app arranca (y se mantiene) en vertical; solo la pestaña Asistencias la
// pone en horizontal. Ya no se fija la orientación en el AndroidManifest para
// permitir la rotación en runtime vía plugin.
lockPortrait()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
