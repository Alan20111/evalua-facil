import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'fs'

// Identifica cada build para que la app detecte cuando el navegador se quedó
// con una pestaña vieja abierta (SPA: navegar dentro de la app NUNCA vuelve a
// descargar el JS). Se usa el commit de Vercel si existe; si no, la hora del
// build — cualquiera de los dos cambia en cada deploy real.
const buildId = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now())

// Escribe dist/version.json con el mismo buildId embebido en el bundle, para
// que UpdateChecker (src/components/UpdateChecker.jsx) pueda comparar "con
// qué versión cargué" vs "qué hay en el servidor ahora mismo".
function versionFilePlugin() {
  return {
    name: 'version-file',
    writeBundle(options) {
      writeFileSync(`${options.dir}/version.json`, JSON.stringify({ buildId }))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionFilePlugin()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
})
