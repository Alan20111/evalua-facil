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

// API local para desarrollo contra los EMULADORES (VITE_EMULADORES=1).
// Sirve /api/<carpeta>/<acción> con los MISMOS manejadores de Vercel
// (api/<carpeta>/[acción].js o api/<nombre>.js), cargados con ssrLoadModule
// para que tomen los cambios sin reiniciar. El Admin SDK se conecta a los
// emuladores (ver api/_lib/firebaseAdmin.js). Así el alumno puede ver su
// asignatura y sus actividades en local, que leen de /api/subject/content.
// Nunca corre en producción: solo existe en `vite` (serve) y con esa variable.
function apiLocalPlugin() {
  return {
    name: 'api-local-emuladores',
    apply: 'serve',
    configureServer(server) {
      if (process.env.VITE_EMULADORES !== '1') return
      process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
      process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
      process.env.GCLOUD_PROJECT ||= process.env.VITE_FIREBASE_PROJECT_ID || 'demo-esqueletos'
      server.middlewares.use('/api', async (req, res) => {
        const url = new URL(req.url, 'http://local')
        const partes = url.pathname.split('/').filter(Boolean)
        const candidatos = partes.length >= 2
          ? [`/api/${partes[0]}/[action].js`, `/api/${partes[0]}/${partes[1]}.js`]
          : [`/api/${partes[0]}.js`]
        let mod = null
        for (const c of candidatos) {
          try { mod = await server.ssrLoadModule(c); break } catch { /* siguiente */ }
        }
        if (!mod?.default) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Sin manejador local para ' + url.pathname })); return }
        let crudo = ''
        for await (const trozo of req) crudo += trozo
        let body = crudo
        try { body = crudo ? JSON.parse(crudo) : {} } catch { /* se queda como texto */ }
        const vReq = Object.assign(req, { query: { ...Object.fromEntries(url.searchParams), ...(partes[1] ? { action: partes[1] } : {}) }, body })
        const vRes = Object.assign(res, {
          status(c) { res.statusCode = c; return vRes },
          json(o) { if (!res.headersSent) res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return vRes },
          send(d) { res.end(typeof d === 'string' || Buffer.isBuffer(d) ? d : JSON.stringify(d)); return vRes },
        })
        try {
          await mod.default(vReq, vRes)
        } catch (err) {
          server.config.logger.error(`[api local] ${url.pathname}: ${err.stack || err}`)
          if (!res.writableEnded) { res.statusCode = 500; res.end(JSON.stringify({ error: err.message })) }
        }
      })
    },
  }
}

// https://vite.dev/config/
// CSS de la app sin bloquear el primer pintado (rendimiento, oct-2026): en
// celular, ese CSS competía por el ancho de banda con ~180 KB de JS y la
// pantalla inicial de index.html (que ya trae su estilo en línea) no se
// pintaba hasta ~2 s. Se precarga como `preload`, y src/main.jsx lo activa
// y espera a que cargue antes de montar React, así nada se ve sin estilo.
// Sin onload en línea (lo bloquearía la CSP). Solo en el build: en dev el
// CSS lo inyecta Vite por JS.
function cssSinBloquearPlugin() {
  return {
    name: 'css-sin-bloquear',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(
          /<link rel="stylesheet" crossorigin href="([^"]+\.css)">/,
          '<link rel="preload" as="style" crossorigin href="$1" data-css-app>',
        )
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), versionFilePlugin(), apiLocalPlugin(), cssSinBloquearPlugin()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
})
