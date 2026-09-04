import { useAppVersion } from '../utils/useAppVersion'
import { IS_NATIVE_APP } from '../utils/platform'

function formatFechaHora(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const fecha = d.toLocaleDateString('es-MX', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
    const hora = d.toLocaleTimeString('es-MX', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
    return `${fecha} · ${hora}`
  } catch {
    return ''
  }
}

// Bloque discreto que muestra la versión de la APK instalada (solo en native)
// y la identidad del frontend web actualmente cargado. Se usa en Perfil.
export default function AppVersionInfo() {
  const { androidVersion, builtAt, commit } = useAppVersion()

  return (
    <div className="space-y-0.5">
      {IS_NATIVE_APP && androidVersion && (
        <p className="text-xs text-muted">App Android · {androidVersion}</p>
      )}
      <p className="text-xs text-muted">Frontend web · {formatFechaHora(builtAt)}</p>
      {commit && <p className="text-xs text-muted">Build · {commit}</p>}
    </div>
  )
}
