// true solo dentro de la app nativa de Android (Capacitor); false en la web
// (incluso abierta desde el navegador del celular). Úsalo para restringir UI
// exclusiva de la app móvil sin afectar nunca la versión web.
import { Capacitor } from '@capacitor/core'

export const IS_NATIVE_APP = Capacitor.isNativePlatform()

// true cuando conviene enfocar un campo solo al abrir una pantalla o un modal.
//
// En celular NO conviene: el foco abre el teclado de golpe, que tapa media
// pantalla y desplaza el contenido antes de que la persona haya visto qué
// tiene enfrente (Web Interface Guidelines de Vercel: "autofocus rarely on
// mobile"). Antes solo se excluía la app nativa con `!IS_NATIVE_APP`, pero el
// mismo problema pasa en el navegador del celular.
//
// `pointer: coarse` = la pantalla se maneja con el dedo, sin importar su
// ancho: cubre celulares y tablets, y deja el autofocus en escritorio, donde
// ahorra un clic.
const PANTALLA_TACTIL =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches

export const PUEDE_AUTOFOCUS = !IS_NATIVE_APP && !PANTALLA_TACTIL
