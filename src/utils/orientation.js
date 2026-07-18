// Bloqueo de orientación de pantalla — SOLO dentro de la app nativa (Capacitor).
// En la web no hace nada. Se usa para la vista de Asistencias en horizontal.
// El plugin se carga de forma diferida para no incluirlo en el bundle web.
import { IS_NATIVE_APP } from './platform'

async function plugin() {
  if (!IS_NATIVE_APP) return null
  try {
    const mod = await import('@capacitor/screen-orientation')
    return mod.ScreenOrientation
  } catch {
    return null
  }
}

export async function lockLandscape() {
  const p = await plugin()
  try { await p?.lock({ orientation: 'landscape' }) } catch { /* best-effort */ }
}

export async function lockPortrait() {
  const p = await plugin()
  try { await p?.lock({ orientation: 'portrait' }) } catch { /* best-effort */ }
}
