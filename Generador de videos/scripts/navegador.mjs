// Navegador para las capturas de Google Play y el video de demo.
//
// Abre la app (servidor de Vite contra los EMULADORES, ver
// docs/VERIFICACION_VISUAL.md) en un teléfono de 360×640 a 3x (1080×1920, la
// proporción 9:16 que acepta Play) y la hace pasar por la app de Android:
// `window.CapacitorCustomPlatform = { name: 'android' }` hace que
// Capacitor.isNativePlatform() sea true, así que se ven la barra inferior, el
// botón flotante y todo lo que solo existe en la app. Los plugins caen a su
// versión web o fallan de forma controlada, como la app ya maneja.
//
// En modo nativo la app manda /api/* a producción (utils/apiBase.js): aquí se
// interceptan y se mandan al servidor local, que las atiende contra el
// emulador. Nunca sale nada a producción.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const { chromium } = createRequire(process.cwd() + '/package.json')('playwright-core')

export const BASE = process.env.BASE_URL || 'http://localhost:5175'
const PRODUCCION = 'https://evalua-facil.vercel.app'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const CLAVE = readFileSync('scripts/emulador/sembrar-docente.cjs', 'utf8').match(/const CLAVE = (['"`])(.*?)\1/)[2]

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Content-Type, Authorization, X-Firebase-AppCheck',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
}

export async function abrirTelefono({ video = null, dsf = 3, init = null } = {}) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    // Puntero táctil fijo en Blink: con solo hasTouch, una captura de página
    // completa pierde la emulación (ver scripts/visual/verificar.mjs).
    // --force-device-scale-factor: con la densidad solo emulada (deviceScaleFactor
    // de Playwright) el screencast entrega fotogramas de 360×640; con la real
    // entrega los 1440×2560 que necesita el video para poder acercarse sin
    // verse borroso. Por eso tampoco se usa isMobile (no combina con esta bandera).
    args: [
      '--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1',
      `--force-device-scale-factor=${dsf}`,
      '--hide-scrollbars',
    ],
  })
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: dsf,
    hasTouch: true,
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/145.0.0.0 Mobile Safari/537.36',
    ...(video ? { recordVideo: video } : {}),
  })
  await ctx.addInitScript(() => {
    window.CapacitorCustomPlatform = { name: 'android', plugins: {} }
    try {
      localStorage.setItem('ef_pwa_notif_dismissed', '1')
    } catch { /* sin almacenamiento */ }
  })
  if (init) await ctx.addInitScript(init)
  await ctx.route(`${PRODUCCION}/api/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = req.url().replace(PRODUCCION, BASE)
    const resp = await route.fetch({ url })
    return route.fulfill({ response: resp, headers: { ...resp.headers(), ...CORS } })
  })
  const page = await ctx.newPage()
  return { browser, ctx, page }
}

export async function esperarCarga(page, ms = 600, limite = 20000) {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && !document.querySelector('.pantalla-inicial'), null, { timeout: limite }).catch(() => {})
  await page.waitForTimeout(ms)
}

export async function entrarDocente(page, correo = 'docente.prueba@evalua.test') {
  await page.goto(`${BASE}/docente`)
  await page.waitForSelector('input[type=password]')
  await page.locator('input[type=email], input[type=text]').first().fill(correo)
  await page.locator('input[type=password]').fill(CLAVE)
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await page.waitForURL(/dashboard|onboarding|protect-account/, { timeout: 30000 })
  await esperarCarga(page)
}

export async function entrarAlumno(page, usuario = 'ANLO') {
  await page.goto(`${BASE}/alumno`)
  await page.waitForSelector('#login-username')
  await page.fill('#login-username', usuario)
  await page.fill('#login-password', CLAVE)
  await page.locator('#login-password').press('Enter')
  await page.waitForURL(/alumno\/dashboard/, { timeout: 30000 })
  await esperarCarga(page)
}

export async function salir(page) {
  await page.evaluate(async () => {
    for (const d of await indexedDB.databases()) if (d.name?.startsWith('firebase')) indexedDB.deleteDatabase(d.name)
    localStorage.clear()
    sessionStorage.clear()
  })
}

// Primera coincidencia que de verdad se ve. El menú lateral guarda copias
// ocultas de varios textos y `.first()` las elegiría; `filter({ visible })`
// no existe en la versión de Playwright que usamos.
export async function visible(loc) {
  const n = await loc.count()
  for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible()) return loc.nth(i)
  return loc.first()
}
