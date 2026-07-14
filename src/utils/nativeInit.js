// Ajustes nativos que solo aplican dentro de la app Android (Capacitor) — en
// la web no hacen nada. Android 15+ (targetSdkVersion 36 en este proyecto)
// obliga el modo edge-to-edge: el WebView SIEMPRE se dibuja debajo de la
// barra de estado y de navegación, ya no hay forma de "reservar" ese
// espacio a nivel nativo (por eso se quitó @capacitor/status-bar — su
// setOverlaysWebView(false) dejó de tener efecto). En su lugar,
// @capacitor-community/safe-area corrige env(safe-area-inset-*) en el
// WebView (Android no lo reporta bien por su cuenta) para que el CSS
// (.safe-top/.safe-bottom en index.css) reserve el espacio correcto.
// El estilo de los íconos también se declara en capacitor.config.json
// (plugin SafeArea), pero se refuerza aquí por JS porque en Android la
// config del plugin no siempre se aplica de forma confiable antes del
// primer render. Ya no hay color de fondo nativo que fijar: en edge-to-edge
// lo provee el propio contenido (el fondo de cada header con `.safe-top`
// se extiende visualmente hasta debajo de la barra, que es transparente).
import { Capacitor } from '@capacitor/core'
import { SafeArea, SystemBarsStyle } from '@capacitor-community/safe-area'

export async function initStatusBar() {
  if (!Capacitor.isNativePlatform()) return
  try {
    // LIGHT = contenido OSCURO (íconos oscuros) para fondos claros — la
    // nomenclatura de este plugin es inversa a la de @capacitor/status-bar
    // (ahí "Dark" significaba íconos oscuros; aquí es al revés).
    await SafeArea.setSystemBarsStyle({ style: SystemBarsStyle.Light })
  } catch {
    // best-effort — sin esto la app sigue funcionando, solo con la barra de estado por defecto
  }
}
