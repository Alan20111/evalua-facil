// Detecta cuando el navegador se quedó con una pestaña vieja de la web
// abierta: al ser una SPA, navegar dentro de la app (cambiar de vista, entrar
// a una asignatura, etc.) NUNCA vuelve a descargar el JS — solo lo hace la
// primera carga de la página. Si el docente deja una pestaña abierta durante
// semanas, sigue corriendo en memoria el código con el que abrió, aunque el
// servidor ya tenga una versión más nueva.
//
// Esto importa más de lo normal aquí: hubo un incidente real donde una
// pestaña vieja siguió ejecutando lógica de "mover clase" que ya se había
// corregido semanas antes en el código fuente, y el docente no tenía forma de
// saber que su pestaña estaba desactualizada.
//
// No aplica a la app nativa (Capacitor): ahí las actualizaciones se instalan
// aparte, no hay "pestaña" que se quede vieja de la misma forma.
import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { IS_NATIVE_APP } from '../utils/platform'
import { isAppOutdated } from '../utils/checkAppVersion'

const CHECK_INTERVAL_MS = 10 * 60 * 1000 // 10 min

export default function UpdateChecker() {
  const [hayVersionNueva, setHayVersionNueva] = useState(false)
  const dismissedRef = useRef(false)

  const checkVersion = useCallback(async () => {
    if (dismissedRef.current || hayVersionNueva) return
    if (await isAppOutdated()) setHayVersionNueva(true)
  }, [hayVersionNueva])

  useEffect(() => {
    if (IS_NATIVE_APP) return
    checkVersion()
    const id = setInterval(checkVersion, CHECK_INTERVAL_MS)
    // Al volver a una pestaña que estuvo en segundo plano un rato es cuando
    // más probable es que ya haya una versión más nueva esperando.
    const onVisible = () => { if (document.visibilityState === 'visible') checkVersion() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [checkVersion])

  if (IS_NATIVE_APP || !hayVersionNueva) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-4 py-3 rounded-card shadow-2xl bg-surface-card border border-outline max-w-[calc(100vw-2rem)]">
      <RefreshCw size={18} className="flex-shrink-0 text-accent" />
      <p className="text-sm text-on-surface">Hay una versión nueva de Evalúa Fácil. Recarga para actualizar.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="flex-shrink-0 px-3 py-1.5 rounded bg-accent text-white text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Recargar
      </button>
      <button
        type="button"
        aria-label="Cerrar"
        onClick={() => { dismissedRef.current = true; setHayVersionNueva(false) }}
        className="flex-shrink-0 p-2 text-muted hover:text-on-surface rounded transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  )
}
