// Ajustes nativos que solo aplican dentro de la app Android (Capacitor) — en
// la web no hacen nada. El color/overlay de la barra de estado se declara
// también en capacitor.config.json, pero se refuerza aquí por JS porque en
// Android la config del plugin no siempre se aplica de forma confiable antes
// del primer render.
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'

export async function initStatusBar() {
  if (!Capacitor.isNativePlatform()) return
  try {
    await StatusBar.setOverlaysWebView({ overlay: false })
    await StatusBar.setStyle({ style: Style.Dark })
    await StatusBar.setBackgroundColor({ color: '#f8fafc' })
  } catch {
    // best-effort — sin esto la app sigue funcionando, solo con la barra de estado por defecto
  }
}
