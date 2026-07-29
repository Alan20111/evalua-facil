import { IS_NATIVE_APP } from './platform'

// Las descargas del docente (Excel, PDF, ZIP) son de la versión web.
//
// Dos razones: el WebView de Android no guarda archivos con el patrón de
// descarga del navegador —se generaban y se perdían en silencio, sin error—, y
// un reporte de calificaciones o un paquete de entregas es material para
// revisar o entregar desde la computadora, no desde el celular.
//
// En vez de esconder los botones (el docente los buscaría sin encontrarlos),
// se quedan a la vista y al tocarlos explican dónde están. La única descarga
// que sí vive en la app es el PDF del QR para instalarla, porque justamente
// sirve para compartirla en el momento, frente al grupo.
export const MENSAJE_DESCARGA_SOLO_WEB =
  'Las descargas se hacen desde la versión web, en evaluafacil.mx — ahí el archivo queda guardado en tu computadora.'

// Devuelve true si hay que detenerse (estamos en la app y ya se avisó).
// Uso: `if (descargaSoloWeb(toast)) return` al inicio del handler.
export function descargaSoloWeb(toast) {
  if (!IS_NATIVE_APP) return false
  toast(MENSAJE_DESCARGA_SOLO_WEB, 'warning')
  return true
}
