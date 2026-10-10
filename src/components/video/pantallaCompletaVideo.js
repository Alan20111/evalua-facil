// Pantalla completa del Video interactivo — decisiones puras (sin DOM real), para poder probarlas.
//
// POR QUÉ NO SE SUPERPONE LA PREGUNTA AL VIDEO
// Las reglas de YouTube para el reproductor incrustado (developers.google.com/youtube/terms/
// required-minimum-functionality, sección «Overlays and frames») dicen: «You must not display
// overlays, frames, or other visual elements in front of any part of a YouTube embedded player».
// Una capa de pregunta encima del video —aunque esté en pausa— cae en eso, y la cuenta de API
// del proyecto puede ser suspendida. Por eso en pantalla completa la pregunta aparece AL LADO
// (teléfono horizontal) o ABAJO (vertical) del reproductor, que se encoge para dejarle sitio:
// el video sigue a la vista, pausado, y nada lo tapa.
//
// POR QUÉ SE PONE EN PANTALLA COMPLETA EL CONTENEDOR Y NO EL IFRAME
// El botón nativo de YouTube (`fs=1`) pone en pantalla completa SOLO el iframe: la pregunta y la
// línea de tiempo —que viven fuera de él— desaparecerían. Se pide la pantalla completa del
// contenedor que incluye video + controles + pregunta (`fs: 0` en el reproductor).
//
// COMPATIBILIDAD REAL (mdn/browser-compat-data, consultado el 9-oct-2026):
//   · Element.requestFullscreen: Chrome/Edge/Firefox/Samsung Internet en Android y escritorio ✔.
//     Safari en iPad (16.4+, parcial) ✔. Safari en iPHONE ✘ (la API no existe para elementos;
//     solo el <video> nativo, que aquí no aplica porque el video es un iframe de YouTube).
//   · screen.orientation.lock(): Chrome Android 38+ ✔, Firefox Android ✔ (parcial), Safari iOS ✘.
// Donde no hay pantalla completa real se usa una «simulada»: el mismo contenedor a toda la
// ventana (position: fixed, 100dvh). Es honesta: no oculta la barra del navegador, y se dice así.

export const MODO_PANTALLA = { NATIVA: 'nativa', SIMULADA: 'simulada' }

// Fases del reproductor en que el panel (instrucciones, pregunta, entrega) debe verse en pantalla
// completa. Mientras el video corre o está en pausa, el panel se esconde y el video ocupa todo.
const FASES_CON_PANEL = ['listo', 'pregunta', 'final']
export function panelVisibleEnPantallaCompleta(fase) {
  return FASES_CON_PANEL.includes(fase)
}

// ¿Hay pantalla completa real para este elemento? (requiere el método Y que el documento la permita)
export function modoPantallaCompleta({ elemento, documento } = {}) {
  const el = elemento || {}
  const doc = documento || {}
  const tieneMetodo = typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function'
  const habilitada = doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true
  return tieneMetodo && habilitada ? MODO_PANTALLA.NATIVA : MODO_PANTALLA.SIMULADA
}

// Teléfono = pantalla táctil y lado corto menor a 600 px. Solo ahí se intenta fijar la orientación
// horizontal: en tablet o escritorio no se le quita al usuario su orientación.
export function esTelefono({ tactil, ancho, alto } = {}) {
  const a = Number(ancho)
  const h = Number(alto)
  return !!tactil && a > 0 && h > 0 && Math.min(a, h) < 600
}

export function elementoEnPantallaCompleta(doc) {
  return doc?.fullscreenElement || doc?.webkitFullscreenElement || null
}

export function pedirPantallaCompleta(el) {
  if (typeof el?.requestFullscreen === 'function') return el.requestFullscreen({ navigationUI: 'hide' })
  if (typeof el?.webkitRequestFullscreen === 'function') return Promise.resolve(el.webkitRequestFullscreen())
  return Promise.reject(new Error('Sin pantalla completa'))
}

export function salirDePantallaCompleta(doc) {
  if (typeof doc?.exitFullscreen === 'function') return doc.exitFullscreen()
  if (typeof doc?.webkitExitFullscreen === 'function') return Promise.resolve(doc.webkitExitFullscreen())
  return Promise.resolve()
}

// ── Medidas del reproductor (puras, para poder probarlas sin navegador) ───────────────────────────────
// Alto que queda libre para la pantalla del video: el de la ventana menos la cabecera de la página que lo contiene.
// Nunca negativo. Se publica como la variable CSS `--vi-alto` del contenedor.
export function altoDisponibleVideo({ ventana, cabecera = 0 } = {}) {
  const v = Number(ventana)
  const c = Number(cabecera)
  return Math.max(0, (Number.isFinite(v) ? v : 0) - (Number.isFinite(c) ? c : 0))
}

// Caja del video dentro de un espacio (ancho × alto): el más grande 16:9 que cabe. Es lo mismo que calcula el CSS
// `width: min(100cqw, 100cqh * 16 / 9)`; está aquí para fijar la regla con números y no solo con texto.
export function tamanoVideo({ ancho, alto } = {}) {
  const a = Math.max(0, Number(ancho) || 0)
  const h = Math.max(0, Number(alto) || 0)
  const w = Math.min(a, (h * 16) / 9)
  return { ancho: w, alto: (w * 9) / 16 }
}
