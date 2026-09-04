import { useState, useEffect } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { IS_NATIVE_APP } from './platform'

// Cache a nivel módulo para no llamar a App.getInfo() más de una vez por sesión.
let cachedAndroidVersion = null

// Devuelve la versión de la APK instalada (solo en native) y los datos del
// build del frontend inyectados en tiempo de compilación.
//
// androidVersion: versionName de build.gradle, p. ej. "1.0.6". null en web.
// builtAt: ISO 8601 UTC del momento exacto en que se compiló este frontend.
// commit: SHA corto del commit de Vercel (7 chars), o "" en builds locales.
export function useAppVersion() {
  // Inicialización lazy: si ya tenemos la versión cacheada al montar, la
  // tomamos directo sin necesitar un setState posterior dentro del efecto.
  const [androidVersion, setAndroidVersion] = useState(() => cachedAndroidVersion)

  useEffect(() => {
    if (!IS_NATIVE_APP || cachedAndroidVersion !== null) return
    CapacitorApp.getInfo()
      .then((info) => {
        cachedAndroidVersion = info.version
        setAndroidVersion(info.version)
      })
      .catch(() => {})
  }, [])

  return {
    androidVersion,
    builtAt: __BUILD_TIMESTAMP__,
    commit: __BUILD_COMMIT__,
  }
}
