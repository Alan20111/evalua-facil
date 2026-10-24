// Monta el video de demo a partir de lo que dejó grabador.mjs.
//
//   node "Generador de videos/scripts/montar.mjs" <carpeta-de-grabación> [música.mp3] <salida.mp4>
//
// Sin música explícita usa la pista de siempre: musica/musica-principal-85s.mp3.
//
// Cada fotograma de salida (30 por segundo) se compone aquí con `sharp`: se toma
// el fotograma grabado que corresponde a ese instante, se recorta y se amplía
// según el zoom (una función del tiempo, suavizada entre un punto de enfoque y
// el siguiente) y se le pone encima el letrero, la tarjeta de inicio o la de
// cierre (PNG dibujados con Chrome: esta versión de ffmpeg no trae drawtext).
// ffmpeg solo codifica y mezcla la música, siempre a 1080×1920.
//
// Se hace así y no con filtros de ffmpeg (scale con eval=frame) porque ese
// escalado con tamaño variable por fotograma se cae de forma intermitente
// (SIGBUS) en este equipo.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const { chromium } = createRequire(process.cwd() + '/package.json')('playwright-core')
const MUSICA_POR_OMISION = fileURLToPath(new URL('../musica/musica-principal-85s.mp3', import.meta.url))
const argumentos = process.argv.slice(2)
const [carpeta, ...resto] = argumentos
const salida = resto.pop()
const musica = resto[0] ?? MUSICA_POR_OMISION
if (!carpeta || !salida) { console.error('uso: montar.mjs <carpeta> [música.mp3] <salida.mp4>'); process.exit(1) }

const W = 1080
const H = 1920
const FPS = 30
const INTRO = 3.2
const OUTRO = 4.5
const linea = JSON.parse(readFileSync(`${carpeta}/linea.json`, 'utf8'))
const { frames, zooms, textos, duracion } = linea
const TOTAL = INTRO + duracion + OUTRO

// ─── 1. Cámara: zoom y foco como funciones del tiempo ──────────────────────
// valor(t) = v0 + Σ (v_i − v_{i−1}) · suave((t − t_i) / d_i)
const suave = (u) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x) }
function funcion(claves, inicial) {
  const cambios = []
  let previo = inicial
  for (const c of claves) { cambios.push({ t: c.t, dur: c.dur, dif: c.v - previo }); previo = c.v }
  return (t) => cambios.reduce((v, c) => v + c.dif * suave((t - c.t) / c.dur), inicial)
}
// Al soltar el zoom el foco se queda donde estaba: así no «viaja» al centro.
let fx = 0.5
let fy = 0.5
const claveZ = []
const claveX = []
const claveY = []
for (const z of zooms) {
  if (z.z > 1) { fx = z.x; fy = z.y }
  claveZ.push({ t: z.t, v: z.z, dur: z.dur })
  claveX.push({ t: z.t, v: fx, dur: z.dur })
  claveY.push({ t: z.t, v: fy, dur: z.dur })
}
const Z = funcion(claveZ, 1)
const FX = funcion(claveX, 0.5)
const FY = funcion(claveY, 0.5)

// ─── 3. Letreros y tarjetas (Chrome) ────────────────────────────────────────
const fuente = readFileSync('node_modules/@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2').toString('base64')
const logo = readFileSync('public/logo-evalua-facil.png').toString('base64')
const CSS = `
  @font-face { font-family: 'Outfit'; src: url(data:font/woff2;base64,${fuente}) format('woff2'); font-weight: 100 900; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${W}px; height: ${H}px; background: transparent; font-family: 'Outfit', sans-serif; }
`
mkdirSync(`${carpeta}/png`, { recursive: true })
const navegador = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const pagina = await navegador.newPage({ viewport: { width: W, height: H } })
async function dibujar(nombre, html, opaco = false) {
  await pagina.setContent(`<style>${CSS}${opaco ? 'html,body{background:linear-gradient(160deg,#e6f1fb 0%,#ffffff 55%,#dbeafe 100%)}' : ''}</style>${html}`)
  await pagina.evaluate(() => document.fonts.ready)
  await pagina.screenshot({ path: `${carpeta}/png/${nombre}.png`, omitBackground: !opaco })
}
for (const [i, t] of textos.entries()) {
  await dibujar(`txt${i}`, `<div style="position:absolute;left:0;right:0;bottom:${t.alto ?? 270}px;display:flex;justify-content:center;padding:0 70px">
    <div style="background:rgba(19,27,46,.88);color:#fff;font-weight:600;font-size:62px;line-height:1.18;text-align:center;padding:34px 56px;border-radius:80px;box-shadow:0 20px 60px rgba(0,0,0,.35);max-width:940px">${t.texto}</div></div>`)
}
await dibujar('intro', `<div style="height:${H}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:56px;padding:0 90px;text-align:center">
  <img src="data:image/png;base64,${logo}" style="width:820px">
  <div style="font-size:84px;font-weight:700;color:#131b2e;line-height:1.1">Califica, organiza y evalúa<br>sin complicaciones</div>
  <div style="font-size:50px;color:#2563eb;font-weight:600">Para docentes de bachillerato</div></div>`, true)
await dibujar('outro', `<div style="height:${H}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:50px;padding:0 90px;text-align:center">
  <img src="data:image/png;base64,${logo}" style="width:820px">
  <div style="font-size:78px;font-weight:700;color:#131b2e;line-height:1.12">Menos papeleo,<br>más tiempo para enseñar</div>
  <div style="font-size:56px;color:#fff;background:#2563eb;padding:26px 70px;border-radius:90px;font-weight:600">evaluafacil.mx</div></div>`, true)
await navegador.close()

// ─── 2. Composición fotograma por fotograma ────────────────────────────────
const sharp = createRequire(process.cwd() + '/package.json')('sharp')
const SRC_W = 1440
const SRC_H = 2560
const NUM = Math.round(TOTAL * FPS)
const rampa = (t, ini, dur) => Math.min(1, Math.max(0, (t - ini) / dur))

// Las imágenes se decodifican una sola vez a RGBA crudo; la opacidad se aplica
// multiplicando el canal alfa (solo mientras se desvanecen).
async function cargar(nombre) {
  const { data } = await sharp(`${carpeta}/png/${nombre}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return data
}
const intro = await cargar('intro')
const outro = await cargar('outro')
const capas = []
for (const [i, t] of textos.entries()) capas.push({ rgba: await cargar(`txt${i}`), ini: INTRO + t.t, fin: INTRO + t.t + t.dur })
const inicioOutro = INTRO + duracion - 0.2

const conOpacidad = (rgba, a) => {
  let buf = rgba
  if (a < 0.999) {
    buf = Buffer.from(rgba)
    for (let i = 3; i < buf.length; i += 4) buf[i] = (buf[i] * a) | 0
  }
  return { input: buf, raw: { width: W, height: H, channels: 4 }, top: 0, left: 0 }
}

const ffmpeg = spawn('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error', '-stats',
  '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0',
  // La pista se encadena consigo misma (fundido cruzado de 5 s) para cubrir el
  // video completo aunque la música dure menos.
  '-i', musica, '-i', musica,
  '-filter_complex', `[1:a][2:a]acrossfade=d=5,afade=t=in:d=1.2,afade=t=out:st=${(TOTAL - 3).toFixed(2)}:d=3,volume=0.9[aud]`,
  '-map', '0:v', '-map', '[aud]', '-t', TOTAL.toFixed(2),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '192k', salida,
], { stdio: ['pipe', 'inherit', 'inherit'] })
const terminado = new Promise((resolve, reject) => {
  ffmpeg.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg terminó con código ${c}`))))
  ffmpeg.stdin.on('error', () => {})
})

let ultimoFotograma = -1
let ultimoFoto = null
let idx = 0
for (let n = 0; n < NUM; n++) {
  const T = n / FPS
  const r = Math.min(Math.max(T - INTRO, 0), duracion) // tiempo dentro de la grabación
  const aIntro = 1 - rampa(T, INTRO - 0.7, 0.7)
  const aOutro = rampa(T, inicioOutro, 0.8)
  let imagen
  if (aIntro >= 0.999) imagen = sharp(intro, { raw: { width: W, height: H, channels: 4 } }).removeAlpha()
  else if (aOutro >= 0.999) imagen = sharp(outro, { raw: { width: W, height: H, channels: 4 } }).removeAlpha()
  else {
    while (idx + 1 < frames.length && frames[idx + 1].t <= r) idx++
    if (idx !== ultimoFotograma) { ultimoFoto = readFileSync(`${carpeta}/${frames[idx].archivo}`); ultimoFotograma = idx }
    const z = Z(r)
    const ancho = Math.round(SRC_W / z)
    const alto = Math.round(SRC_H / z)
    const izq = Math.round(Math.min(Math.max(FX(r) * SRC_W - ancho / 2, 0), SRC_W - ancho))
    const arr = Math.round(Math.min(Math.max(FY(r) * SRC_H - alto / 2, 0), SRC_H - alto))
    imagen = sharp(ultimoFoto).extract({ left: izq, top: arr, width: ancho, height: alto }).resize(W, H, { kernel: 'lanczos3', fit: 'fill' })
    const encima = []
    for (const c of capas) {
      const a = Math.min(rampa(T, c.ini, 0.4), 1 - rampa(T, c.fin - 0.4, 0.4))
      if (a > 0.003) encima.push(conOpacidad(c.rgba, a))
    }
    if (aIntro > 0.003) encima.push(conOpacidad(intro, aIntro))
    if (aOutro > 0.003) encima.push(conOpacidad(outro, aOutro))
    if (encima.length) imagen = sharp(await imagen.raw().toBuffer(), { raw: { width: W, height: H, channels: 3 } }).composite(encima)
    imagen = imagen.removeAlpha()
  }
  const crudo = await imagen.raw().toBuffer()
  if (!ffmpeg.stdin.write(crudo)) await new Promise((res) => ffmpeg.stdin.once('drain', res))
  if (n % 150 === 0) process.stdout.write(`\r  fotograma ${n}/${NUM}   `)
}
ffmpeg.stdin.end()
await terminado
console.log(`\nListo: ${salida} (${TOTAL.toFixed(1)} s)`)
