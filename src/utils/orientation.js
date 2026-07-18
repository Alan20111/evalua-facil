// Bloqueo de orientación de pantalla — SOLO dentro de la app nativa (Capacitor).
// En la web no hace nada. Se usa para ver Asistencias en horizontal, mientras el
// resto de la app permanece en vertical (se fija al arrancar, ver main.jsx).
// Import estático (no dinámico) para evitar que el chunk falle en el WebView.
import { ScreenOrientation } from '@capacitor/screen-orientation'
import { IS_NATIVE_APP } from './platform'

export async function lockLandscape() {
  if (!IS_NATIVE_APP) return
  try { await ScreenOrientation.lock({ orientation: 'landscape' }) } catch { /* best-effort */ }
}

export async function lockPortrait() {
  if (!IS_NATIVE_APP) return
  try { await ScreenOrientation.lock({ orientation: 'portrait' }) } catch { /* best-effort */ }
}
