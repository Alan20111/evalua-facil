#!/usr/bin/env node
// Verificación visual (docs/PLAN_NORMALIZACION_UI.md, fase 6).
//
// Recorre las pantallas clave contra el EMULADOR (ver docs/VERIFICACION_VISUAL.md)
// en compu (1280×800) y celular (375×812, táctil) y por cada vista:
//   1. Compara su HTML (normalizado) con la referencia de test/visual/referencia/.
//      Con --referencia la (re)escribe. Úsalo ANTES de un cambio grande que no
//      debe cambiar nada visible (refactor, división de archivos) y corre sin
//      la bandera DESPUÉS: cualquier diferencia se reporta con contexto.
//   2. Guarda una captura en test/visual/capturas/ (no se versiona).
//   3. Audita el contrato de diseño: controles con altura fuera de la escala
//      (h-control-sm / h-control / h-control-lg) o con esquina a medias.
//
// Uso: npm run test:visual [-- --referencia] [-- --solo=docente|alumno]
// Requiere: emuladores de Auth+Firestore con datos de sembrar-docente.cjs y el
// servidor de desarrollo apuntando a ellos (VITE_EMULADORES=1) en BASE_URL.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE_URL || 'http://localhost:5175'
const REF = 'test/visual/referencia'
const CAP = 'test/visual/capturas'
const args = new Set(process.argv.slice(2))
const ESCRIBIR_REF = args.has('--referencia')
const SOLO = [...args].find((a) => a.startsWith('--solo='))?.split('=')[1]
const VISTA = [...args].find((a) => a.startsWith('--vista='))?.split('=')[1]
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => fs.existsSync(p))

// Datos de prueba: al tomar REFERENCIAS se vacía el EMULADOR (proyecto
// demo-esqueletos, nunca producción) y se vuelve a sembrar; los ids quedan en
// test/visual/.semilla.json. Al COMPARAR se reutilizan esos mismos datos: si
// se resembrara, cambiarían los ids y con ellos el orden en que Firestore
// devuelve las listas, y todo «difería» sin que el código cambiara.
const PROYECTO = 'demo-esqueletos'
const ARCHIVO_SEMILLA = 'test/visual/.semilla.json'
let semilla
if (ESCRIBIR_REF || !fs.existsSync(ARCHIVO_SEMILLA)) {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`, { method: 'DELETE' })
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROYECTO}/accounts`, { method: 'DELETE' })
  semilla = JSON.parse(execFileSync('node', ['scripts/emulador/sembrar-docente.cjs'], { encoding: 'utf8' }).trim().split('\n').pop())
  fs.mkdirSync('test/visual', { recursive: true })
  fs.writeFileSync(ARCHIVO_SEMILLA, JSON.stringify(semilla))
} else {
  semilla = JSON.parse(fs.readFileSync(ARCHIVO_SEMILLA, 'utf8'))
}
const CLAVE = /CLAVE\s*=\s*['"]([^'"]+)/.exec(fs.readFileSync('scripts/emulador/sembrar-docente.cjs', 'utf8'))[1]

const VIEWPORTS = {
  compu: { viewport: { width: 1280, height: 800 } },
  celular: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
}

const VISTAS = {
  docente: [
    { nombre: 'tablero', url: '/dashboard' },
    { nombre: 'nueva-asignatura', url: '/dashboard', abrir: 'Nueva asignatura' },
    { nombre: 'asignatura', url: `/subject/${semilla.ids[0]}`, pestanas: true },
    { nombre: 'actividad', url: `/activity/${semilla.actividad}` },
    { nombre: 'calendario', url: '/calendario' },
    { nombre: 'perfil', url: '/profile', pestanas: true },
    { nombre: 'notificaciones', url: '/notificaciones' },
    { nombre: 'catalogo', url: '/dev/componentes' },
  ],
  alumno: [
    { nombre: 'alumno-tablero', url: '/alumno/dashboard' },
    { nombre: 'alumno-perfil', url: '/alumno/perfil', pestanas: true },
    { nombre: 'alumno-agenda', url: '/alumno/agenda' },
  ],
}
const CUENTAS = { docente: 'docente.prueba@evalua.test', alumno: 'anlo.cbtis255@evalua.local' }

function normalizar(html) {
  let h = html.replace(/(id|for|aria-controls|aria-labelledby|aria-describedby)="[^"]*:r[^"]*"/g, '$1=""')
  for (const id of [semilla.uid, semilla.actividad, semilla.alumno, ...semilla.ids]) h = h.split(id).join('ID')
  return h.replace(/\s+/g, ' ')
}

async function entrar(page, correo) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async ({ correo, clave }) => {
    const { auth } = await import('/src/firebase.js')
    const m = await import('/node_modules/.vite/deps/firebase_auth.js')
    await m.signOut(auth).catch(() => {})
    await m.signInWithEmailAndPassword(auth, correo, clave)
  }, { correo, clave: CLAVE })
}

async function auditar(page) {
  return page.evaluate(() => {
    // Alturas permitidas = las variables CSS reales de la página (cambian en
    // táctil): control-sm, control, control-lg y la píldora de pestaña
    // segmentada (control − 0.5rem, va dentro de una barra de un control).
    const raiz = parseFloat(getComputedStyle(document.documentElement).fontSize)
    const v = (n) => { const x = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return x.endsWith('rem') ? parseFloat(x) * raiz : parseFloat(x) }
    const alturas = [v('--control-sm'), v('--control'), v('--control-lg'), v('--control') - 0.5 * raiz]
    const malos = []
    const CAMPOS = 'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]):not([type=color])'
    for (const e of document.querySelectorAll(`main button, main ${CAMPOS}, main select, [role=dialog] button, [role=dialog] ${CAMPOS}, [role=dialog] select`)) {
      if (!e.offsetParent || e.getAttribute('role') === 'switch') continue
      // Muestras de color o ícono: celdas fijas de 2.5rem en su propia
      // rejilla (REJILLA_MUESTRAS, DESIGN_SYSTEM §6.7) — no son controles.
      if (e.parentElement?.className?.includes?.('auto-fill,2.5rem')) continue
      const r = e.getBoundingClientRect()
      if (r.height < 20 || r.height > 56) continue // íconos sueltos y filas de varios renglones
      const st = getComputedStyle(e)
      if (st.backgroundColor === 'rgba(0, 0, 0, 0)' && st.borderStyle === 'none' && !e.matches('[role=tab]')) continue // texto plano y filas sin caja
      // Filas y tarjetas (no son controles): llevan un fondo de ícono grande o
      // texto en dos renglones (título + detalle).
      const hijoGrande = [...e.querySelectorAll('*')].some((c) => c.getBoundingClientRect().height >= r.height - 12 && c.getBoundingClientRect().width >= 36 && c !== e && getComputedStyle(c).borderRadius === '9999px')
      const renglones = new Set([...e.querySelectorAll('p, span')].filter((c) => c.textContent.trim()).map((c) => Math.round(c.getBoundingClientRect().top / 6)))
      if (hijoGrande || renglones.size >= 2) continue
      const h = Math.round(r.height * 10) / 10
      const radio = parseFloat(st.borderTopLeftRadius)
      const nombre = (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 40)
      if (!alturas.some((a) => Math.abs(a - h) < 0.6)) malos.push({ tipo: 'altura', h, nombre })
      if (radio > 0 && radio < h / 2 - 1 && radio < 20) malos.push({ tipo: 'esquina', h, radio, nombre })
    }
    return malos
  })
}

// El celular va en su propio navegador con el puntero táctil fijado en Blink.
// La emulación táctil de Playwright (hasTouch) sola NO basta: la captura de
// página completa redimensiona la ventana y Chromium la pierde, así que
// (pointer: coarse) deja de cumplirse y el «celular» se vuelve una compu
// angosta (contadores de escritorio, controles de 40 px en vez de 43).
const TACTIL = ['--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1']
const t0 = Date.now()
let diferencias = 0
const auditoria = []
for (const [vp, opts] of Object.entries(VIEWPORTS)) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: opts.hasTouch ? TACTIL : [] })
  for (const [rol, vistas] of Object.entries(VISTAS)) {
    if (SOLO && SOLO !== rol) continue
    if (VISTA && !vistas.some((v) => v.nombre === VISTA)) continue
    const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' })
    // Sin el aviso flotante «Activa las notificaciones»: tapa el pie de las
    // hojas y de la página en todas las capturas.
    await ctx.addInitScript(() => { try { localStorage.setItem('ef_pwa_notif_dismissed', '1') } catch { /* sin almacenamiento */ } })
    const page = await ctx.newPage()
    await entrar(page, CUENTAS[rol])
    for (const v of vistas) {
      if (VISTA && v.nombre !== VISTA) continue
      // No 'networkidle': Firestore deja conexiones abiertas y nunca se cumple.
      // Se espera a que no quede ningún esqueleto de carga (aria-busy).
      await page.goto(BASE + v.url, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('main', { timeout: 15000 }).catch(() => {})
      await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(800)
      // Formularios en hoja (fase 3): se abre con su botón y se captura el
      // diálogo en lugar de la página.
      if (v.abrir) {
        await page.getByRole('button', { name: v.abrir, exact: true }).and(page.locator(':visible')).first().click({ timeout: 5000 })
        await page.waitForSelector('[role=dialog]', { timeout: 5000 })
        await page.waitForTimeout(600)
      }
      const tomas = [['', null]]
      if (v.pestanas) {
        const pestanas = await page.locator('[role=tablist]').first().locator('[role=tab]').allTextContents()
        for (const t of pestanas) tomas.push([t.trim().slice(0, 14), t])
      }
      for (const [sufijo, texto] of tomas) {
        if (texto) {
          await page.locator('[role=tablist]').first().getByRole('tab', { name: texto, exact: true }).click({ timeout: 5000 }).catch(() => {})
          await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 10000 }).catch(() => {})
          await page.waitForTimeout(700)
        }
        const clave = `${vp}/${v.nombre}${sufijo ? '-' + sufijo.replace(/[^\wáéíóúñ]+/gi, '_') : ''}`
        const html = normalizar(await page.locator(v.abrir ? '[role=dialog]' : 'main').first().innerHTML().catch(() => ''))
        const refArchivo = path.join(REF, clave + '.html')
        fs.mkdirSync(path.dirname(refArchivo), { recursive: true })
        if (ESCRIBIR_REF) fs.writeFileSync(refArchivo, html)
        else if (fs.existsSync(refArchivo)) {
          const ref = fs.readFileSync(refArchivo, 'utf8')
          if (ref !== html) {
            diferencias++
            let i = 0; while (i < ref.length && ref[i] === html[i]) i++
            console.log(`✖ ${clave} — difiere en ${i}:\n    antes: …${ref.slice(Math.max(0, i - 50), i + 70)}…\n    ahora: …${html.slice(Math.max(0, i - 50), i + 70)}…`)
          } else console.log(`✓ ${clave}`)
        }
        for (const m of await auditar(page)) auditoria.push({ vista: clave, ...m })
        fs.mkdirSync(path.join(CAP, vp), { recursive: true })
        await page.screenshot({ path: path.join(CAP, clave + '.png'), fullPage: true })
        if (v.abrir) {
          // La hoja se desplaza por dentro: segunda captura con su pie.
          await page.evaluate(() => { for (const el of document.querySelectorAll('[role=dialog], [role=dialog] *')) if (el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = el.scrollHeight })
          await page.waitForTimeout(300)
          await page.screenshot({ path: path.join(CAP, clave + '-pie.png') })
        }
      }
    }
    await ctx.close()
  }
  await browser.close()
}
console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`)

const unicos = new Map()
for (const a of auditoria) { const k = `${a.vista.split('/')[0]}|${a.tipo}|${a.nombre}|${a.h}`; if (!unicos.has(k)) unicos.set(k, a) }
console.log(`\n=== Auditoría del contrato (${unicos.size} hallazgos) ===`)
for (const a of unicos.values()) console.log(`  ${a.vista}: ${a.tipo === 'altura' ? `alto ${a.h}px fuera de la escala` : `esquina ${a.radio}px en alto ${a.h}px (a medias)`} — «${a.nombre}»`)
if (ESCRIBIR_REF) console.log(`\nReferencias escritas en ${REF}/`)
else if (diferencias) { console.log(`\n❌ ${diferencias} vista(s) cambiaron respecto a la referencia.`); process.exit(1) }
else console.log('\n✅ Todas las vistas coinciden con la referencia.')
