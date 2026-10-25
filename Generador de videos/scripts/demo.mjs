// Guion del video de demo: recorre la app en modo teléfono y deja la grabación
// y su línea de tiempo (zooms y letreros) en <carpeta>.
//
//   node "Generador de videos/scripts/demo.mjs" <ids.json> <carpeta>
//   node "Generador de videos/scripts/montar.mjs" <carpeta> [música.mp3] <salida.mp4>
//
// Requiere los emuladores con scripts/emulador/sembrar-demo.cjs y el servidor
// de Vite contra ellos (docs/VERIFICACION_VISUAL.md). Sin ningún dato real.
import { readFileSync } from 'node:fs'
import { iniciarGrabacion } from './grabador.mjs'
import { BASE, CLAVE, esperarCarga, visible } from './navegador.mjs'

const [archivoIds, carpeta] = process.argv.slice(2)
const ids = JSON.parse(readFileSync(archivoIds, 'utf8'))
const g = await iniciarGrabacion(carpeta, { lento: 0.45 })
const { page, enfocar, soltar, texto, pausa } = g

// Un paso que falla no tumba la grabación: se anota y se sigue.
const inicio = Date.now()
async function paso(nombre, fn) {
  const t = Date.now()
  try { await fn(); console.log(`  ✓ ${nombre} (${((Date.now() - t) / 1000).toFixed(1)} s, total ${((Date.now() - inicio) / 1000).toFixed(0)} s)`) } catch (e) {
    console.log(`  ✗ ${nombre}: ${String(e.message).split('\n')[0]}`)
    await page.screenshot({ path: `${carpeta}/fallo-${nombre.replace(/\W+/g, '_')}.png` }).catch(() => {})
  }
}
// Esperas cortas: una pantalla con un spinner permanente no debe estirar el video.
const cargar = (ms = 700) => esperarCarga(page, ms, 3500)
const ir = async (ruta) => { await page.goto(BASE + ruta); await cargar(700) }
// Desplazamiento suave y controlado (JS, no lo afecta la cámara lenta).
const deslizar = (dy, ms = 1500) => page.evaluate(([d, t]) => new Promise((res) => {
  const y0 = window.scrollY
  const t0 = performance.now()
  // performance.now(), no la marca de rAF: con la cámara lenta (grabador.mjs)
  // el reloj de las animaciones corre más despacio y los dos dejan de coincidir.
  const paso = () => {
    const u = Math.min(1, (performance.now() - t0) / t)
    window.scrollTo(0, y0 + d * (u * u * (3 - 2 * u)))
    u < 1 ? requestAnimationFrame(paso) : res()
  }
  requestAnimationFrame(paso)
}), [dy, ms])
// Toca por coordenadas, como un dedo: algunas filas (las que se reordenan
// arrastrando) hacen que locator.tap() espere en vano a que «reciban eventos».
const tocar = async (loc) => {
  const c = await (await visible(loc)).boundingBox({ timeout: 5000 })
  await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height / 2)
  await pausa(0.9)
}
const escribir = async (loc, valor) => (await visible(loc)).pressSequentially(valor, { delay: 85 })
const nav = (nombre) => page.getByText(nombre, { exact: true }).last()

// ─── Docente ────────────────────────────────────────────────────────────────
// Todo se hace tocando, como un docente real: sin recargar la página (una
// recarga mostraría la pantalla inicial con el logo grande a media demo).
await page.goto(BASE + '/')
await esperarCarga(page, 600, 3500)
await g.empezar()
await pausa(0.9)

await paso('elegir rol', async () => {
  texto('Elige cómo quieres entrar', 3)
  await pausa(1.1)
  await tocar(page.getByText('Soy Docente', { exact: true }))
  await page.waitForSelector('input[type=password]')
  await pausa(0.4)
})

await paso('login', async () => {
  texto('Entra con tu cuenta de docente', 3.6)
  await enfocar('input[type=email], input[type=text]', 1.7)
  await escribir(page.locator('input[type=email], input[type=text]'), 'docente.prueba@evalua.test')
  await pausa(0.4)
  await enfocar('input[type=password]', 1.7)
  await escribir(page.locator('input[type=password]'), CLAVE)
  await pausa(0.5)
  await enfocar(page.getByRole('button', { name: 'Iniciar sesión', exact: true }), 1.5, 0.7)
  await pausa(0.6)
  await tocar(page.getByRole('button', { name: 'Iniciar sesión', exact: true }))
  soltar()
  await page.waitForURL(/dashboard/, { timeout: 30000 })
  await cargar(900)
})

await paso('tablero', async () => {
  texto('Todas tus asignaturas, en un solo lugar', 3.6)
  await pausa(1)
  await enfocar(page.getByText('Matemáticas III — 3A', { exact: true }), 1.45)
  await pausa(2)
  await enfocar(page.getByText('Programación — 5C', { exact: true }), 1.45, 1.1)
  await pausa(1.4)
  soltar()
  await pausa(0.4)
})

await paso('asignatura', async () => {
  await tocar(page.getByText('Matemáticas III — 3A', { exact: true }))
  await cargar(800)
  texto('Actividades ordenadas por parcial', 3.8)
  await pausa(1.2)
  await deslizar(230, 1300)
  await enfocar(page.getByText('Parcial 1', { exact: true }), 1.5)
  await pausa(1.6)
  await enfocar(page.getByText('Parcial 2', { exact: true }), 1.5, 1)
  await tocar(page.getByText('Parcial 2', { exact: true }))
  await pausa(1.8)
  soltar()
})

await paso('actividad', async () => {
  await tocar(page.getByText(/Ley de senos y cosenos/))
  await cargar(900)
  texto('Revisa entregas y calificaciones de un vistazo', 4.2)
  await pausa(1.2)
  await deslizar(560, 1500)
  await enfocar(page.getByText('Tarde', { exact: true }), 1.9)
  await pausa(2)
  await enfocar(page.getByText('10/10'), 1.9, 1)
  await pausa(1.6)
  soltar()
  await pausa(0.4)
  await page.goBack() // el botón «atrás» de Android
  await cargar(900)
})

await paso('estudiantes', async () => {
  await deslizar(-2000, 600)
  texto('Tu lista de estudiantes, al día', 3.4)
  await tocar(page.getByRole('tab', { name: 'Estudiantes', exact: true }))
  await pausa(1.2)
  await deslizar(260, 1300)
  await enfocar(page.getByText('Presiona para editar'), 1.4)
  await pausa(2.2)
  soltar()
})

await paso('horario', async () => {
  await tocar(nav('Horario'))
  await cargar(900)
  texto('Tu horario y tu agenda de clases', 3.6)
  await pausa(1.2)
  await enfocar(page.getByText(/Matemáticas III — 3A/), 1.6)
  await pausa(2.4)
  soltar()
})

await paso('notificaciones', async () => {
  await tocar(nav('Notificaciones'))
  await cargar(900)
  texto('Avisos y recordatorios en tu celular', 3.6)
  await pausa(1)
  await tocar(page.getByRole('tab', { name: 'Recordatorios', exact: true }))
  await pausa(1.2)
  await tocar(page.getByRole('tab', { name: 'Bitácora', exact: true }))
  await pausa(1)
  await enfocar(page.getByText('Recibidas', { exact: true }), 1.5)
  await pausa(1.6)
  soltar()
})

await paso('ia', async () => {
  await tocar(nav('Asignaturas'))
  await cargar(800)
  await deslizar(-3000, 500) // la barra superior se oculta al bajar: hay que volver arriba
  await pausa(0.8)
  const creditos = page.getByRole('button', { name: /Créditos de IA/ })
  texto('Funciones de IA con tus créditos', 3.8)
  await pausa(0.8)
  await enfocar(creditos, 2.1)
  await pausa(1)
  await tocar(creditos)
  await pausa(1.4)
  soltar()
  await enfocar(page.getByText('Consumo por categoría (histórico)'), 1.6, 1)
  await pausa(2.6)
  soltar()
  await page.keyboard.press('Escape')
  await pausa(0.8)
})

// ─── Alumno ─────────────────────────────────────────────────────────────────
await paso('cambiar a alumno', async () => {
  await deslizar(-3000, 500)
  await pausa(0.6)
  await tocar(page.getByRole('button', { name: 'Cerrar sesión' }))
  await tocar(page.getByRole('dialog').getByRole('button', { name: 'Salir', exact: true }))
  await page.waitForSelector('text=Soy Estudiante', { timeout: 15000 })
  await pausa(0.6)
  texto('Y tus estudiantes entran con su usuario', 3.8)
  await tocar(page.getByText('Soy Estudiante', { exact: true }))
  await page.waitForSelector('#login-username')
  await pausa(0.4)
})

await paso('login alumno', async () => {
  await enfocar('#login-username', 1.7)
  await escribir(page.locator('#login-username'), 'ANLO')
  await pausa(0.4)
  await enfocar('#login-password', 1.7)
  await escribir(page.locator('#login-password'), CLAVE)
  await pausa(0.5)
  soltar()
  await page.locator('#login-password').press('Enter')
  await page.waitForURL(/alumno\/dashboard/, { timeout: 30000 })
  await cargar(1000)
})

await paso('alumno tablero', async () => {
  texto('Ven su promedio en cada asignatura', 3.6)
  await pausa(1)
  await enfocar(page.getByText('9.7'), 2.1)
  await pausa(2.2)
  soltar()
})

await paso('alumno asignatura', async () => {
  await tocar(page.getByText(/Matemáticas III/))
  await cargar(900)
  texto('Con la retroalimentación de su docente', 4)
  await pausa(1)
  await deslizar(190, 1200)
  await enfocar(page.getByText('9.5'), 1.9)
  await pausa(2.4)
  soltar()
  await pausa(0.5)
})

await paso('alumno agenda', async () => {
  await tocar(nav('Agenda'))
  await cargar(900)
  texto('Y una agenda con todo lo que sigue', 3.4)
  await pausa(3.4)
})

console.log(await g.terminar())
