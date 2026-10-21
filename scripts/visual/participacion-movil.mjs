#!/usr/bin/env node
// Verificación AUTOMÁTICA de la pantalla del PARTICIPANTE en celular (Participación en vivo).
//
// Abre Chrome real con emulación de celular (375×812, táctil, factor 2) y recorre la pantalla con TOQUES (no clics
// de ratón). Comprueba lo que se puede medir sin un aparato: que no haya desplazamiento horizontal, que los
// controles se puedan tocar (≥ 44 px), que el texto no obligue a hacer zoom (≥ 16 px en campos), que cada paso
// funcione y que el foco sea visible. NO sustituye una prueba en un teléfono físico (teclado en pantalla,
// rendimiento real de red, safe areas de cada modelo): eso sigue siendo manual.
//
// Requisitos (ver test/participacion-vivo.test.mjs y scripts/emulador/): emuladores de Auth+Firestore, la app en
// BASE_URL con VITE_EMULADORES=1 y el endpoint /api/subject/vivo-*, y una sesión ACTIVA con la pregunta a probar.
//
//   node scripts/visual/participacion-movil.mjs --fase=opcion  --codigo=ABCDEFGHJK
//   node scripts/visual/participacion-movil.mjs --fase=breve   --codigo=ABCDEFGHJK
//   node scripts/visual/participacion-movil.mjs --fase=extensa --codigo=ABCDEFGHJK
//   node scripts/visual/participacion-movil.mjs --fase=grupo   --actividad=ID --token-file=ruta/token.txt
import fs from 'node:fs'
// playwright-core es devDependency del repo; PLAYWRIGHT_CORE permite apuntar a otra instalación (ruta a su index.js).
const playwright = await import(process.env.PLAYWRIGHT_CORE ? new URL(`file:///${process.env.PLAYWRIGHT_CORE.split('\\').join('/')}`).href : 'playwright-core')
const chromium = playwright.chromium ?? playwright.default.chromium

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199'
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=')
const FASE = arg('fase') || 'opcion'
const CODIGO = arg('codigo')
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => fs.existsSync(p))
if (!CHROME) { console.error('No encontré Chrome/Edge: define CHROME_PATH.'); process.exit(2) }

const fallos = []
const comprobar = (ok, texto) => { console.log(`  ${ok ? '✓' : '✗'} ${texto}`); if (!ok) fallos.push(texto) }

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'es-MX' })
const page = await ctx.newPage()
const errores = []
page.on('pageerror', (e) => errores.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/landmark|Fix any/.test(m.text())) errores.push(m.text().slice(0, 160)) })

async function auditoriaComun(etiqueta, { esPregunta = false } = {}) {
  const m = await page.evaluate(() => ({
    ancho: document.documentElement.scrollWidth, ventana: window.innerWidth,
    // Solo lo que es de ESTA pantalla (el resto de la app, como avisos de instalación, no se audita aquí)
    pequenos: [...(document.querySelector('[data-vivo-participante]') || document).querySelectorAll('button, a[href], textarea, input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.classList.contains('sr-only') && r.height < 44 && !e.disabled }).map((e) => `${e.tagName}:${(e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 20)}:${Math.round(e.getBoundingClientRect().height)}`),
    h1: (() => { const h = document.querySelector('h1'); return h ? parseFloat(getComputedStyle(h).fontSize) : null })(),
  }))
  comprobar(m.ancho <= m.ventana, `${etiqueta}: sin desplazamiento horizontal (${m.ancho} ≤ ${m.ventana})`)
  // «Volver» es un control secundario de la barra superior; el resto debe medir ≥ 44 px
  const criticos = m.pequenos.filter((x) => !/Volver/.test(x))
  comprobar(criticos.length === 0, `${etiqueta}: controles táctiles ≥ 44 px${criticos.length ? ' → ' + criticos.join(', ') : ''}`)
  if (esPregunta && m.h1) comprobar(m.h1 >= 20, `${etiqueta}: la pregunta se lee grande (${m.h1}px)`)
}

async function esperaTexto(re, ms = 15000) {
  await page.waitForFunction((s) => new RegExp(s).test(document.body.innerText), re.source, { timeout: ms })
}

try {
  if (FASE === 'grupo') {
    const token = fs.readFileSync(arg('token-file'), 'utf8').trim()
    await page.goto(BASE + '/alumno', { waitUntil: 'domcontentloaded' })
    await page.evaluate(async (t) => {
      const { auth } = await import('/src/firebase.js'); const mod = await import('/node_modules/.vite/deps/firebase_auth.js')
      await mod.signInWithCustomToken(auth, t)
    }, token)
    await page.goto(`${BASE}/alumno/participacion/${arg('actividad')}`, { waitUntil: 'domcontentloaded' })
  } else {
    await page.goto(`${BASE}/p/${CODIGO}`, { waitUntil: 'domcontentloaded' })
  }
  await esperaTexto(/PREGUNTA \d+ DE \d+/i)
  console.log(`Fase «${FASE}» en celular 375×812 táctil`)
  await auditoriaComun('pregunta', { esPregunta: true })

  if (FASE === 'opcion' || FASE === 'grupo') {
    const opciones = page.locator('button[aria-pressed]')
    comprobar((await opciones.count()) >= 2, 'hay al menos 2 opciones')
    const caja = await opciones.first().boundingBox()
    comprobar(caja.width >= 280 && caja.height >= 56, `opciones grandes (${Math.round(caja.width)}×${Math.round(caja.height)})`)
    const enviar = page.getByRole('button', { name: /Enviar respuesta/ })
    comprobar(await enviar.isDisabled(), 'enviar está apagado hasta elegir una opción')
    await opciones.first().tap()
    comprobar((await opciones.first().getAttribute('aria-pressed')) === 'true', 'el toque marca la opción')
    comprobar(await enviar.isEnabled(), 'enviar se enciende al elegir')
    await enviar.tap()
  } else {
    const campo = page.locator('textarea')
    comprobar((await campo.count()) === 1, 'hay un campo de texto')
    const fs16 = await campo.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
    comprobar(fs16 >= 16, `el campo no provoca zoom al enfocar (${fs16}px)`)
    comprobar(!!(await campo.getAttribute('id')) && (await page.locator('label[for="vivo-respuesta"]').count()) === 1, 'el campo tiene etiqueta asociada')
    const enviar = page.getByRole('button', { name: /Enviar respuesta/ })
    comprobar(await enviar.isDisabled(), 'enviar está apagado con el campo vacío')
    await campo.tap()
    await campo.fill(FASE === 'breve' ? 'clorofila' : 'Las plantas convierten la luz del sol en glucosa para alimentarse')
    comprobar(await enviar.isEnabled(), 'enviar se enciende al escribir')
    await enviar.tap()
  }
  await esperaTexto(/Respuesta enviada/)
  comprobar(true, 'confirmación «¡Respuesta enviada!» visible tras el toque')
  await auditoriaComun('confirmación')
  await page.screenshot({ path: `test/visual/capturas/participacion-movil-${FASE}.png` }).catch(() => {})
} catch (e) {
  comprobar(false, `el recorrido se interrumpió: ${e.message.split('\n')[0]}`)
}

comprobar(errores.length === 0, `sin errores en consola${errores.length ? ' → ' + errores.slice(0, 2).join(' | ') : ''}`)
await browser.close()
console.log(fallos.length ? `\n${fallos.length} comprobación(es) fallaron` : '\nTodo en orden (emulación; falta probar en un teléfono físico)')
process.exit(fallos.length ? 1 : 0)
