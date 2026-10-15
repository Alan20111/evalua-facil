// Registro de errores de la app (docs/PLAN_GOOGLE_PLAY.md, O3).
//
// Android vitals solo ve los fallos nativos. Si React o un evento truena en el
// WebView, la persona ve un aviso o la pantalla en blanco y nadie se entera.
// Esto manda cada error a /api/error-report (api/error-report.js), que agrupa
// los errores iguales en `erroresCliente` con un contador. El admin los ve en
// Panel admin › Errores.
//
// No viaja nada de la persona: ni uid, ni correo, ni la URL completa (la ruta
// va con los ids reemplazados). Solo el rol, para saber en qué lado pasó.
import { Capacitor } from '@capacitor/core'
import { apiUrl } from './apiBase'

const MAX_POR_SESION = 15
const enviados = new Set()
let rolActual = 'sin sesión'

// Lo fija AuthContext cada vez que cambia la sesión.
export function fijarRolParaErrores(rol) {
  rolActual = rol || 'sin sesión'
}

// Ruido conocido que no es un error de la app.
function esRuido(mensaje, pila) {
  return /ResizeObserver loop|^Script error\.?$/.test(mensaje)
    || /(chrome|moz|safari)-extension:\/\//.test(pila)
    || /AbortError/.test(mensaje)
}

function rutaSinIds() {
  return location.pathname.split('/').map((s) => (/^[A-Za-z0-9_-]{15,}$/.test(s) ? ':id' : s)).join('/')
}

function navegador() {
  const ua = navigator.userAgent
  const m = ua.match(/(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/)
  if (!m) return 'otro'
  const nombre = { Edg: 'Edge', OPR: 'Opera', Version: 'Safari' }[m[1]] || m[1]
  return `${/; wv\)/.test(ua) ? 'WebView' : nombre} ${m[2]}`
}

export function reportarError(error, { tipo = 'error', pilaComponentes = '' } = {}) {
  try {
    // En desarrollo contra el proyecto real no hay /api; con los emuladores sí.
    if (import.meta.env.DEV && import.meta.env.VITE_EMULADORES !== '1') return
    const mensaje = String(error?.message || error || '').slice(0, 300)
    const pila = `${error?.stack || ''}${pilaComponentes ? `\n--- componentes ---${pilaComponentes}` : ''}`.slice(0, 2000)
    if (!mensaje || esRuido(mensaje, pila)) return
    const clave = `${tipo}|${mensaje}`
    if (enviados.has(clave) || enviados.size >= MAX_POR_SESION) return
    enviados.add(clave)
    const cuerpo = JSON.stringify({
      tipo,
      mensaje,
      pila,
      ruta: rutaSinIds(),
      version: typeof __BUILD_COMMIT__ !== 'undefined' && __BUILD_COMMIT__ ? __BUILD_COMMIT__ : 'local',
      plataforma: Capacitor.getPlatform(),
      navegador: navegador(),
      rol: rolActual,
    })
    // sendBeacon: sale aunque la página se esté cerrando, y no espera respuesta.
    // text/plain para que no haga preflight de CORS desde la app.
    navigator.sendBeacon?.(apiUrl('/api/error-report'), new Blob([cuerpo], { type: 'text/plain' }))
  } catch {
    // El registro de errores nunca debe provocar otro error.
  }
}

// Errores fuera de React: eventos, temporizadores, promesas sin catch.
export function instalarRegistroErrores() {
  window.addEventListener('error', (e) => reportarError(e.error || e.message, { tipo: 'error' }))
  window.addEventListener('unhandledrejection', (e) => reportarError(e.reason, { tipo: 'promesa' }))
}
