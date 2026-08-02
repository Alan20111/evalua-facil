// Compara el buildId con el que arrancó esta pestaña contra el que el
// servidor tiene publicado ahora mismo — mismo mecanismo que UpdateChecker.jsx
// (ver ese archivo para el contexto completo del incidente que motivó esto),
// factorizado aquí para que pantallas críticas (como el pago) puedan pedir
// una verificación puntual además del chequeo periódico global.
import { IS_NATIVE_APP } from './platform'

// Devuelve true si esta pestaña está corriendo una versión vieja del bundle.
// false también ante cualquier error de red — nunca bloquea por falta de
// conexión momentánea.
export async function isAppOutdated() {
  if (IS_NATIVE_APP) return false
  try {
    const res = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return false
    const { buildId } = await res.json()
    return !!buildId && buildId !== __BUILD_ID__
  } catch {
    return false
  }
}
