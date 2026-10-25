// Capturas de pantalla para la ficha de Google Play.
//
//   node "Generador de videos/scripts/capturas.mjs" <ids.json> <carpeta-de-salida>
//
// `ids.json` es la última línea que imprime scripts/emulador/sembrar-demo.cjs.
// Google pide de 2 a 8 capturas de teléfono, PNG de 24 bits (sin transparencia)
// o JPEG, lado menor ≥ 320 px y lado mayor ≤ 3840 px, proporción máxima 2:1.
// Salen de 1080×1920 (9:16): son capturas REALES de la app, con datos de
// demostración; Play rechaza capturas que no muestren la app tal cual es.
import { readFileSync, mkdirSync } from 'node:fs'
import { abrirTelefono, BASE, entrarAlumno, entrarDocente, esperarCarga, salir } from './navegador.mjs'

const [archivoIds, salida] = process.argv.slice(2)
const ids = JSON.parse(readFileSync(archivoIds, 'utf8'))
mkdirSync(salida, { recursive: true })

const { browser, page } = await abrirTelefono()
const errores = []
page.on('pageerror', (e) => errores.push(e.message))

let n = 0
async function captura(nombre) {
  await esperarCarga(page, 1400)
  n += 1
  const archivo = `${salida}/${String(n).padStart(2, '0')}-${nombre}.png`
  await page.screenshot({ path: archivo })
  console.log('  ✓', archivo.split('/').pop())
}
const ir = async (ruta) => { await page.goto(BASE + ruta); await esperarCarga(page, 800) }
const tocar = async (nombre, opciones = {}) => {
  await page.getByRole(opciones.rol || 'tab', { name: nombre, exact: opciones.exacto ?? true }).first().click()
  await page.waitForTimeout(900)
}

// Sube la página hasta que `objetivo` quede justo debajo de la barra superior.
const bajarA = async (objetivo, margen = 96) => {
  const caja = await objetivo.first().boundingBox()
  await page.evaluate((dy) => window.scrollBy(0, dy), caja.y - margen)
  await page.waitForTimeout(700)
}

console.log('Docente')
await entrarDocente(page)
await captura('tablero')

await ir(`/subject/${ids.ids[0]}`)
await bajarA(page.getByText('Parcial 1', { exact: true }), 100)
await captura('asignatura-actividades')

await ir(`/activity/${ids.featuredActivity}`)
await bajarA(page.getByText('Presiona un nombre para evaluar'), 150)
await captura('actividad-entregas')

await ir(`/subject/${ids.ids[0]}`)
await tocar('Estudiantes')
await bajarA(page.getByText('Presiona para editar'), 100)
await captura('estudiantes-lista')

await ir('/calendario')
await captura('horario-y-agenda')

await ir('/notificaciones?seccion=bitacora')
await captura('notificaciones')

console.log('Alumno')
await salir(page)
await entrarAlumno(page)
await captura('alumno-tablero')
await ir(`/alumno/materia/${ids.ids[0]}`)
await bajarA(page.getByText('Parcial 1', { exact: true }), 96)
await captura('alumno-asignatura')

await browser.close()

// Play pide PNG de 24 bits (RGB, sin canal alfa): se normaliza aquí.
const { execFileSync } = await import('node:child_process')
const { readdirSync, renameSync } = await import('node:fs')
for (const f of readdirSync(salida).filter((x) => x.endsWith('.png'))) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${salida}/${f}`, '-pix_fmt', 'rgb24', `${salida}/_${f}`])
  renameSync(`${salida}/_${f}`, `${salida}/${f}`)
}
if (errores.length) console.log('Errores de página:', [...new Set(errores)].slice(0, 5))
