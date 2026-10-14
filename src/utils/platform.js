// true solo dentro de la app nativa de Android (Capacitor); false en la web
// (incluso abierta desde el navegador del celular). Úsalo para restringir UI
// exclusiva de la app móvil sin afectar nunca la versión web.
import { Capacitor } from '@capacitor/core'

export const IS_NATIVE_APP = Capacitor.isNativePlatform()

// false dentro de la app nativa: ahí no se venden créditos de IA. La política
// de pagos de Google Play exige su propio cobro (Play Billing) para bienes
// digitales y prohíbe mandar a pagar fuera, incluso con un texto que diga
// dónde comprar (docs/PLAN_GOOGLE_PLAY.md, B1). En la app solo se ve y se
// gasta el saldo; los créditos de regalo sí se activan, porque no son venta.
// Todo botón, texto o enlace de compra va detrás de esta constante, y
// ComprarCreditosModal solo se monta con ella (check-ui-standards.sh).
export const PUEDE_COMPRAR = !IS_NATIVE_APP

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
