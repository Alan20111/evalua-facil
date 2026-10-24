// Grabador del video de demo (ver «Generador de videos/README.md»).
//
// Graba la app con el screencast de Chrome (CDP), no con recordVideo de
// Playwright: el screencast entrega fotogramas de 1440×2560 (el teléfono a 4x),
// así el zoom que se aplica después en ffmpeg no se ve borroso.
//
// Además de los fotogramas deja una línea de tiempo (`linea.json`) con:
//   · zooms:     cuándo y sobre qué punto de la pantalla acercar la cámara;
//   · textos:    qué letrero mostrar y durante cuánto.
// montar.mjs las convierte en el video final.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { abrirTelefono, BASE, visible } from './navegador.mjs'

export const ANCHO = 360 // px CSS del teléfono
export const ALTO = 640
const DSF = 4

// Círculo que aparece donde se toca la pantalla: en un video de demo, ver
// DÓNDE se toca es la mitad de la explicación.
const RIPPLE = () => {
  const estilo = document.createElement('style')
  estilo.textContent = `
    @keyframes ef-ripple { from { transform: translate(-50%,-50%) scale(.3); opacity: .85 } to { transform: translate(-50%,-50%) scale(1.6); opacity: 0 } }
    .ef-ripple { position: fixed; z-index: 2147483647; width: 64px; height: 64px; border-radius: 9999px; pointer-events: none;
      background: rgba(37,99,235,.28); border: 3px solid rgba(37,99,235,.9); animation: ef-ripple 700ms ease-out forwards }
    html[data-role="alumno"] .ef-ripple, body[data-role="alumno"] .ef-ripple { background: rgba(194,65,12,.28); border-color: rgba(194,65,12,.9) }
  `
  const poner = () => document.head.appendChild(estilo)
  if (document.head) poner(); else document.addEventListener('DOMContentLoaded', poner)
  window.addEventListener('pointerdown', (e) => {
    const r = document.createElement('div')
    r.className = 'ef-ripple'
    r.style.left = `${e.clientX}px`
    r.style.top = `${e.clientY}px`
    document.body.appendChild(r)
    setTimeout(() => r.remove(), 1000)
  }, true)
}

export async function iniciarGrabacion(carpeta, { lento = 0.45 } = {}) {
  rmSync(carpeta, { recursive: true, force: true })
  mkdirSync(carpeta, { recursive: true })
  const { browser, ctx, page } = await abrirTelefono({ dsf: DSF, init: RIPPLE })
  const cdp = await ctx.newCDPSession(page)
  const frames = [] // { archivo, t }
  const linea = { zooms: [], textos: [] }
  let n = 0
  let t0 = null
  let recibiendo = false

  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    if (!recibiendo) return
    const t = metadata.timestamp
    if (t0 === null) t0 = t
    const archivo = `f${String(n++).padStart(6, '0')}.jpg`
    writeFileSync(`${carpeta}/${archivo}`, Buffer.from(data, 'base64'))
    frames.push({ archivo, t: t - t0 })
  })

  // Animaciones en cámara lenta: «exagerar» lo que se mueve. Afecta CSS
  // (transiciones y animaciones), no los temporizadores de JavaScript.
  await cdp.send('Animation.enable')
  await cdp.send('Animation.setPlaybackRate', { playbackRate: lento })
  cdp.on('Page.frameNavigated', () => cdp.send('Animation.setPlaybackRate', { playbackRate: lento }).catch(() => {}))

  const ahora = () => (t0 === null ? 0 : Date.now() / 1000 - t0Reloj)
  let t0Reloj = 0
  const empezar = async () => {
    recibiendo = true
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: ANCHO * DSF, maxHeight: ALTO * DSF, everyNthFrame: 1 })
    // Reloj: el primer fotograma fija el cero; se calibra contra Date.now().
    await page.evaluate(() => document.body.getBoundingClientRect())
    const esperar = Date.now()
    while (t0 === null && Date.now() - esperar < 5000) await new Promise((r) => setTimeout(r, 20))
    t0Reloj = Date.now() / 1000
  }

  // Cámara: acerca hacia el centro de `objetivo` (selector, locator o {x,y}).
  async function enfocar(objetivo, zoom = 1.7, dur = 0.9) {
    let c
    if (objetivo && typeof objetivo.boundingBox === 'function') {
      // Solo lo visible: el menú lateral guarda copias ocultas de varios textos.
      const b = await (await visible(objetivo)).boundingBox({ timeout: 5000 })
      c = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    } else if (typeof objetivo === 'string') {
      const b = await (await visible(page.locator(objetivo))).boundingBox({ timeout: 5000 })
      c = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    } else c = objetivo
    linea.zooms.push({ t: ahora(), z: zoom, x: c.x / ANCHO, y: c.y / ALTO, dur })
  }
  const soltar = (dur = 0.9) => linea.zooms.push({ t: ahora(), z: 1, x: 0.5, y: 0.5, dur })
  const texto = (texto, segundos = 3.2) => linea.textos.push({ t: ahora(), texto, dur: segundos })
  const pausa = (s) => page.waitForTimeout(s * 1000)

  async function terminar() {
    await cdp.send('Page.stopScreencast').catch(() => {})
    await new Promise((r) => setTimeout(r, 300))
    const fin = frames.length ? frames[frames.length - 1].t : 0
    writeFileSync(`${carpeta}/linea.json`, JSON.stringify({ frames, ...linea, duracion: fin }, null, 1))
    await browser.close()
    return { frames: frames.length, duracion: fin }
  }

  return { page, ctx, cdp, empezar, enfocar, soltar, texto, pausa, terminar, BASE }
}
