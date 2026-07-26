import { IS_NATIVE_APP } from './platform'

// A dónde apuntan las llamadas a /api/*.
//
// En la WEB una ruta relativa funciona sola: resuelve contra el mismo dominio
// que sirve la app, que es donde viven las funciones de Vercel.
//
// En la APP no. El WebView de Capacitor sirve el bundle desde
// https://localhost, así que `fetch('/api/algo')` va a
// https://localhost/api/algo — el servidor local de archivos, donde no hay
// ninguna función. Y el modo en que falla es el peor posible: ese servidor
// responde el index.html con 200, así que `res.ok` es true, el JSON no se
// puede leer, el cliente da la llamada por buena y el servidor nunca se
// enteró de nada. Se ve como que funcionó y no funcionó.
//
// Así se descubrió: al elegir "Sin foto" en la app, la foto se quitaba de la
// pantalla (actualización optimista), pero volvía a aparecer, porque el
// borrado real nunca llegó a ejecutarse.
//
// Por eso en la app se apunta al dominio de producción con URL absoluta. Del
// otro lado hace falta CORS para ese origen — ver api/_lib/cors.js.
const PRODUCCION = 'https://evalua-facil.vercel.app'

export function apiUrl(ruta) {
  return IS_NATIVE_APP ? `${PRODUCCION}${ruta}` : ruta
}
