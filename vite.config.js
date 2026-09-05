import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'fs'

// Identifica cada build para que la app detecte cuando el navegador se quedó
// con una pestaña vieja abierta (SPA: navegar dentro de la app NUNCA vuelve a
// descargar el JS). Se usa el commit de Vercel si existe; si no, la hora del
// build — cualquiera de los dos cambia en cada deploy real.
const buildId = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now())

// Información de build para mostrar en la UI de versiones (Perfil y sidebar).
// builtAt: siempre es la fecha/hora real del build (ISO 8601 UTC).
// commit: el SHA corto del commit de Vercel, o cadena vacía en builds locales.
const buildTimestamp = new Date().toISOString()
const buildCommit = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7)

// Escribe dist/version.json (para UpdateChecker) y dist/build-info.json (para
// la UI de versiones). Ambos se generan en cada build automáticamente.
function versionFilePlugin() {
  return {
    name: 'version-file',
    writeBundle(options) {
      writeFileSync(`${options.dir}/version.json`, JSON.stringify({ buildId }))
      writeFileSync(
        `${options.dir}/build-info.json`,
        JSON.stringify({ builtAt: buildTimestamp, commit: buildCommit }),
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionFilePlugin()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
})
