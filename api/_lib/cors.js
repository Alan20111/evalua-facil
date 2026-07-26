// CORS para las llamadas que llegan desde la APP.
//
// La web llama a /api/* desde el mismo dominio y no necesita nada. La app sí:
// su WebView sirve el bundle desde https://localhost, así que sus llamadas a
// evalua-facil.vercel.app son de otro origen — y sin estas cabeceras el
// navegador las bloquea antes de que el handler se entere (ver
// src/utils/apiBase.js, que es la otra mitad del arreglo).
//
// La lista de origenes es CERRADA, nunca '*': estos endpoints se autentican
// con un Bearer token, y con '*' cualquier página web podría llamarlos con un
// token robado. Solo los origenes que puede tener el WebView de Capacitor.
const PERMITIDOS = [
  'https://localhost',      // Android (androidScheme https, el default)
  'capacitor://localhost',  // iOS
  'http://localhost',       // WebView antiguo / desarrollo
]

// Devuelve true si ya respondió (preflight OPTIONS) y el handler debe salir.
// Uso: `if (aplicarCors(req, res)) return`
export function aplicarCors(req, res) {
  const origen = req.headers.origin
  if (origen && PERMITIDOS.includes(origen)) {
    res.setHeader('Access-Control-Allow-Origin', origen)
    // Sin Vary la CDN podría servirle a un origen la respuesta cacheada de
    // otro, junto con su cabecera Allow-Origin equivocada.
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Max-Age', '86400')
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }
  return false
}
