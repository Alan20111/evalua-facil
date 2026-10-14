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
// --a11y: además de comparar, corre axe (WCAG 2.1 A/AA) y un recorrido con
// Tab que busca controles que reciben el foco sin indicador visible.
const A11Y = args.has('--a11y')
const AXE = A11Y ? fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8') : null
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
    { nombre: 'editar-asignatura', url: `/subject/${semilla.ids[0]}`, abrir: 'Editar los datos de la asignatura (nombre, grupo, color, icono…)' },
    // En el teléfono (web) no hay «Duplicar»: la vista se salta sola.
    { nombre: 'duplicar-asignatura', url: `/subject/${semilla.ids[0]}`, abrir: 'Duplicar esta asignatura (con o sin la lista de estudiantes)' },
    { nombre: 'nueva-actividad', url: `/subject/${semilla.ids[0]}`, abrir: 'Agregar actividad' },
    // El editor de entregable es una pantalla completa, no un diálogo.
    { nombre: 'nueva-evaluacion', url: `/subject/${semilla.ids[0]}`, abrir: ['Agregar actividad', 'Evaluación', 'Cuestionario', /^Crear manualmente/], captura: '.fixed.inset-0.z-50' },
    { nombre: 'nuevo-entregable', url: `/subject/${semilla.ids[0]}`, abrir: ['Agregar actividad', 'Entregable', /^Crear manualmente/], captura: '.fixed.inset-0.z-50' },
    { nombre: 'actividad', url: `/activity/${semilla.actividad}` },
    { nombre: 'calendario', url: '/calendario' },
    { nombre: 'nuevo-evento', url: '/calendario', abrir: /^(Evento|Nuevo evento)$/ },
    { nombre: 'perfil', url: '/profile', pestanas: true },
    { nombre: 'notificaciones', url: '/notificaciones' },
    { nombre: 'catalogo', url: '/dev/componentes' },
  ],
  alumno: [
    { nombre: 'alumno-tablero', url: '/alumno/dashboard' },
    // Leen de /api/subject/content: en local las sirve el plugin apiLocal de
    // vite.config.js contra los emuladores.
    { nombre: 'alumno-asignatura', url: `/alumno/materia/${semilla.ids[0]}`, pestanas: true },
    { nombre: 'alumno-actividad', url: `/alumno/actividad/${semilla.actividad}` },
    { nombre: 'alumno-perfil', url: '/alumno/perfil', pestanas: true },
    { nombre: 'alumno-agenda', url: '/alumno/agenda' },
  ],
}
const CUENTAS = { docente: 'docente.prueba@evalua.test', alumno: 'anlo.cbtis255@evalua.local' }

function normalizar(html) {
  // Ids de useId: «:r1:» (React 18) y «_r_1_» (React 19). Cambian si se
  // monta un componente más arriba en el árbol, sin que cambie nada visible.
  let h = html.replace(/(id|for|aria-controls|aria-labelledby|aria-describedby)="[^"]*(:r|_r_)[^"]*"/g, '$1=""')
  for (const id of [semilla.uid, semilla.actividad, semilla.alumno, ...semilla.ids]) h = h.split(id).join('ID')
  // La línea de «ahora» del calendario baja con el reloj.
  h = h.replace(/style="top: [\d.]+px;"(><div style="height: 3px; background: var\(--accent\);")/g, 'style="top: AHORA;"$1')
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

async function auditar(page, captura = 'main') {
  return page.evaluate((captura) => {
    // Alturas permitidas = las variables CSS reales de la página (cambian en
    // táctil): control-sm, control, control-lg y la píldora de pestaña
    // segmentada (control − 0.5rem, va dentro de una barra de un control).
    const raiz = parseFloat(getComputedStyle(document.documentElement).fontSize)
    // Se mide con un elemento de prueba: así se resuelve cualquier valor
    // (rem, px, max(3rem, 48px), var(--control)…) igual que lo haría un botón.
    const v = (n) => {
      const d = document.createElement('div')
      d.style.cssText = `position:absolute;visibility:hidden;height:var(${n})`
      document.body.append(d)
      const h = d.getBoundingClientRect().height
      d.remove()
      return h
    }
    const alturas = [v('--control-sm'), v('--control'), v('--control-lg'), v('--control') - 0.5 * raiz]
    const malos = []
    const CAMPOS = 'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]):not([type=color])'
    const raices = ['main', '[role=dialog]', captura]
    for (const e of new Set(document.querySelectorAll(raices.flatMap((r) => [`${r} button`, `${r} ${CAMPOS}`, `${r} select`]).join(', ')))) {
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
  }, captura)
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
const a11y = []
for (const [vp, opts] of Object.entries(VIEWPORTS)) {
  async function revisarA11y(page) {
  await page.addScriptTag({ content: AXE })
  const axe = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] })
    return r.violations.map((v) => ({ id: v.id, impacto: v.impact, ayuda: v.help, nodos: v.nodes.length, ejemplo: v.nodes[0]?.target?.join(' '),
      detalle: v.nodes.map((n) => ({ html: n.html.slice(0, 220), resumen: n.failureSummary?.slice(0, 220) })) }))
  })
  // Recorrido con Tab: hasta 80 paradas. Un control «sin foco visible» es el
  // que al enfocarse no cambia outline ni box-shadow respecto a sin foco.
  const sinFoco = []
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0) })
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab')
    const r = await page.evaluate(() => {
      const e = document.activeElement
      if (!e || e === document.body) return null
      const st = getComputedStyle(e)
      const conFoco = `${st.outlineStyle}|${st.outlineWidth}|${st.boxShadow}|${st.backgroundColor}|${st.borderColor}`
      e.blur()
      const st2 = getComputedStyle(e)
      const sinF = `${st2.outlineStyle}|${st2.outlineWidth}|${st2.boxShadow}|${st2.backgroundColor}|${st2.borderColor}`
      e.focus({ preventScroll: true })
      const nombre = (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 40)
      return { visible: conFoco !== sinF, nombre, tag: e.tagName.toLowerCase() }
    })
    if (!r) break
    if (!r.visible) sinFoco.push(`${r.tag} «${r.nombre}»`)
  }
  return { axe, sinFoco: [...new Set(sinFoco)] }
}

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
      // `abrir`: uno o varios botones que se tocan en orden (p. ej. el
      // menú de «Nueva actividad» y luego el tipo). Si falta alguno en esta
      // vista (el teléfono no tiene todo), la vista se salta.
      const captura = v.captura || (v.abrir ? '[role=dialog]' : 'main')
      let saltar = false
      for (const nombreBoton of [v.abrir || []].flat()) {
        // Texto exacto, o una expresión regular cuando el botón lleva también
        // su descripción dentro (el nombre accesible es todo el texto).
        const boton = page.getByRole('button', { name: nombreBoton, exact: typeof nombreBoton === 'string' }).and(page.locator(':visible')).first()
        if (!(await boton.count())) { console.log(`– ${vp}/${v.nombre}: no hay botón «${nombreBoton}» en esta vista, se salta`); saltar = true; break }
        await boton.click({ timeout: 5000 })
        // El ratón se queda donde estaba el botón: sin esto, lo que caiga
        // debajo dentro de la hoja sale con su estilo de «pasar encima».
        await page.mouse.move(0, 0)
        await page.waitForTimeout(500)
      }
      if (saltar) continue
      if (v.abrir) {
        await page.waitForSelector(captura, { timeout: 5000 })
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
        const html = normalizar(await page.locator(captura).last().innerHTML().catch(() => ''))
        const refArchivo = path.join(REF, clave + '.html')
        fs.mkdirSync(path.dirname(refArchivo), { recursive: true })
        if (ESCRIBIR_REF) fs.writeFileSync(refArchivo, html)
        else if (fs.existsSync(refArchivo)) {
          const ref = normalizar(fs.readFileSync(refArchivo, 'utf8')) // por si la referencia se tomó con una normalización más vieja
          if (ref !== html) {
            diferencias++
            let i = 0; while (i < ref.length && ref[i] === html[i]) i++
            console.log(`✖ ${clave} — difiere en ${i}:\n    antes: …${ref.slice(Math.max(0, i - 50), i + 70)}…\n    ahora: …${html.slice(Math.max(0, i - 50), i + 70)}…`)
          } else console.log(`✓ ${clave}`)
        }
        for (const m of await auditar(page, captura)) auditoria.push({ vista: clave, ...m })
        if (A11Y) a11y.push({ vista: clave, ...(await revisarA11y(page)) })
        fs.mkdirSync(path.join(CAP, vp), { recursive: true })
        await page.screenshot({ path: path.join(CAP, clave + '.png'), fullPage: true })
        if (v.abrir) {
          // La hoja se desplaza por dentro: segunda captura con su pie.
          await page.evaluate((sel) => { const raiz = [...document.querySelectorAll(sel)].pop(); for (const el of [raiz, ...raiz.querySelectorAll('*')]) if (el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = el.scrollHeight }, captura)
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
if (A11Y) {
  // Resumen por regla (no por vista): cuántas vistas la tienen y un ejemplo.
  const reglas = new Map()
  for (const v of a11y) for (const x of v.axe) {
    const r = reglas.get(x.id) || { ...x, vistas: [], nodos: 0 }
    r.vistas.push(v.vista); r.nodos += x.nodos; reglas.set(x.id, r)
  }
  const orden = { critical: 0, serious: 1, moderate: 2, minor: 3 }
  console.log(`\n=== axe WCAG 2.1 AA (${reglas.size} reglas) ===`)
  for (const r of [...reglas.values()].sort((a, b) => orden[a.impacto] - orden[b.impacto])) {
    console.log(`  [${r.impacto}] ${r.id} — ${r.ayuda} · ${r.nodos} nodos en ${r.vistas.length} vistas · ej. ${r.ejemplo}`)
  }
  fs.writeFileSync('test/visual/a11y.json', JSON.stringify(a11y, null, 1))
  const focos = new Map()
  for (const v of a11y) for (const f of v.sinFoco) focos.set(f, (focos.get(f) || []).concat(v.vista))
  console.log(`\n=== Teclado: foco sin indicador visible (${focos.size}) ===`)
  for (const [f, vs] of focos) console.log(`  ${f} — ${vs.length} vistas (${vs.slice(0, 2).join(', ')})`)
}
if (ESCRIBIR_REF) console.log(`\nReferencias escritas en ${REF}/`)
else if (diferencias) { console.log(`\n❌ ${diferencias} vista(s) cambiaron respecto a la referencia.`); process.exit(1) }
else console.log('\n✅ Todas las vistas coinciden con la referencia.')
