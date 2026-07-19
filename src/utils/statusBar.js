// Ocultar/mostrar la barra de estado del teléfono — SOLO en la app nativa.
// En la web no hace nada. Se usa para que los íconos del sistema no estorben
// en ventanas concretas de la vista horizontal de Asistencias.
import { StatusBar } from '@capacitor/status-bar'
import { IS_NATIVE_APP } from './platform'

export async function hideStatusBar() {
  if (!IS_NATIVE_APP) return
  try { await StatusBar.hide() } catch { /* best-effort */ }
}

export async function showStatusBar() {
  if (!IS_NATIVE_APP) return
  try { await StatusBar.show() } catch { /* best-effort */ }
}
