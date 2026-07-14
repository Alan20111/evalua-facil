// true solo dentro de la app nativa de Android (Capacitor); false en la web
// (incluso abierta desde el navegador del celular). Úsalo para restringir UI
// exclusiva de la app móvil sin afectar nunca la versión web.
import { Capacitor } from '@capacitor/core'

export const IS_NATIVE_APP = Capacitor.isNativePlatform()
