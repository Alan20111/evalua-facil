import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAppVersion } from '../utils/useAppVersion'
import { IS_NATIVE_APP } from '../utils/platform'
import { registrarClienteAlumno } from '../utils/apiContent'

// Avisa al servidor desde qué versión entra este estudiante (plataforma,
// versionName de la app y build de la web). Sirve para saber, antes de cerrar la
// lectura directa de Firestore, qué clientes siguen siendo viejos: un cliente
// viejo nunca llama aquí, y esa ausencia es la señal (seeds-db/verificar-version-app.js).
//
// Una vez por sesión del navegador (el servidor además lo limita a una escritura
// cada 20 h por versión). Nunca estorba: si falla, no pasa nada y no se avisa.
const ESPERA_VERSION_MS = 5000

export default function useClientePing() {
  const { currentUser } = useAuth()
  const { androidVersion } = useAppVersion()
  const uid = currentUser?.uid

  useEffect(() => {
    if (!uid) return undefined
    const clave = `clientePing:${uid}`
    try { if (sessionStorage.getItem(clave)) return undefined } catch { /* sin sessionStorage: se manda igual */ }

    const enviar = (versionName) => {
      try { sessionStorage.setItem(clave, '1') } catch { /* nada */ }
      registrarClienteAlumno({
        plataforma: IS_NATIVE_APP ? 'android' : 'web',
        versionName: versionName || '',
        buildId: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '',
      })
    }

    // En la app, la versión se lee de forma asíncrona: se espera un momento; si
    // no llega, se manda sin ella (sigue siendo un cliente nuevo que avisa).
    if (IS_NATIVE_APP && androidVersion === null) {
      const timer = setTimeout(() => enviar(''), ESPERA_VERSION_MS)
      return () => clearTimeout(timer)
    }
    enviar(IS_NATIVE_APP ? androidVersion : '')
    return undefined
  }, [uid, androidVersion])
}
