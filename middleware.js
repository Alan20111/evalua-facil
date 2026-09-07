// Vercel Edge Middleware — F-07 (2026-09-06)
//
// Rate-limiting por IP en los tres endpoints públicos (sin autenticación).
// El middleware corre en el runtime edge de la CDN, ANTES de que la petición
// llegue a la función serverless. No cuenta como función serverless, así que
// el límite de 9/12 del plan Hobby no varía.
//
// LIMITACIÓN CONOCIDA Y ACEPTADA: sin un almacén compartido (Redis/Upstash),
// el contador vive en el módulo JS del isolate edge que recibió la petición.
// Distintos nodos edge tienen contadores independientes. Esto protege contra
// flooding desde una sola IP a un solo nodo — el caso más común — pero no
// contra ataques distribuidos a través de muchas IPs. Aceptado en el análisis
// de F-07 como riesgo residual para prioridad MEDIO.
//
// Preflight OPTIONS: pasa siempre sin contar (el handler aplica CORS después).

const RULES = [
  // Búsqueda pública de alumnos — enumeración de PII si no se limita.
  // Límite 120/min/IP: cubre salones de hasta ~60 alumnos que inician
  // sesión al mismo tiempo desde la misma IP escolar (NAT), con margen para
  // un reintento por alumno, sin sacrificar protección contra scripts de
  // enumeración. Sin almacén distribuido el contador vive en el isolate —
  // ver limitación conocida en el encabezado de este archivo.
  { pattern: '/api/student/lookup',           limit: 120, windowSec: 60 },
  // Recuperación de contraseña — token de 32 hex chars (F-07), pero se añade
  // friction adicional igualmente: 5 intentos/min es suficiente para el flujo
  // legítimo (una o dos llamadas) y eleva el coste de cualquier abuso.
  { pattern: '/api/student/recover-password', limit: 5,  windowSec: 60 },
  // Info pública de asignatura — enumeración de grupos/horarios.
  { pattern: '/api/subject/info',             limit: 30, windowSec: 60 },
  // Firma de upload a Cloudinary (F-08) — genera una firma válida por 1 hora.
  // 20 firmas/min/IP cubre subidas simultáneas normales sin dar margen para
  // generar firmas en masa y usarlas desde otra IP o más tarde.
  { pattern: '/api/subject/sign-upload',      limit: 20, windowSec: 60 },
]

// Orígenes CORS permitidos (mismo conjunto que api/_lib/cors.js) — se incluyen
// en el 429 para que el navegador (web o WebView) pueda leer el cuerpo del
// error y mostrar un mensaje comprensible en lugar de un fallo opaco de red.
const ALLOWED_ORIGINS = [
  'https://evalua-facil.vercel.app', // producción web
  'https://localhost',
  'capacitor://localhost',           // app Android (Capacitor)
  'http://localhost',
]

// Almacén en memoria del isolate — persiste mientras el mismo isolate esté
// caliente. key = "ip|path", value = { count, resetAt (epoch seg) }.
const store = new Map()

function allow(ip, path, limit, windowSec) {
  const key = `${ip}|${path}`
  const now = Math.floor(Date.now() / 1000)
  const entry = store.get(key)
  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowSec })
    return true
  }
  if (entry.count >= limit) return false
  entry.count++
  return true
}

export default function middleware(request) {
  // Preflights CORS: dejar pasar sin contar para que la app móvil pueda
  // completar el handshake CORS y luego recibir el 429 si corresponde.
  if (request.method === 'OPTIONS') return

  const { pathname } = new URL(request.url)
  const rule = RULES.find((r) => r.pattern === pathname)
  if (!rule) return

  const forwarded = request.headers.get('x-forwarded-for') || ''
  const ip = forwarded.split(',')[0].trim() || 'unknown'

  if (allow(ip, pathname, rule.limit, rule.windowSec)) return

  // Cabeceras CORS opcionales — solo para orígenes móviles permitidos.
  const origin = request.headers.get('origin') || ''
  const corsHeaders = ALLOWED_ORIGINS.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : {}

  return new Response(
    JSON.stringify({ error: 'Demasiadas peticiones. Intenta de nuevo en un minuto.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(rule.windowSec),
        ...corsHeaders,
      },
    }
  )
}

export const config = {
  matcher: [
    '/api/student/lookup',
    '/api/student/recover-password',
    '/api/subject/info',
    '/api/subject/sign-upload',
  ],
}
