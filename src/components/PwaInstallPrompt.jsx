// Prompt de notificaciones para la WEB (no aparece en la app nativa de
// Android). Evalúa Fácil es una plataforma web — la app nativa es solo un
// complemento (ver CLAUDE.md/memoria del proyecto) — así que este componente
// YA NO ofrece "instalar como app" ni en iOS ni en Android/Chrome: pedido
// explícito, ese empuje contradecía el posicionamiento web-first. Lo único
// que queda es, para quien ya inició sesión en un navegador compatible y no
// ha decidido sobre el permiso, ofrecerle activar las notificaciones push del
// navegador (el permiso debe pedirse desde un gesto del usuario). En iOS el
// web push solo funciona con la PWA agregada a inicio (iOS 16.4+), así que
// ahí no se ofrece nada — no hay instructivo de instalación que mostrar.
//
// Nada de esto bloquea la app: es una tarjeta inferior descartable.
import { useState, useEffect } from 'react'
import { Bell, X } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { useAuth } from '../context/AuthContext'
import { isWebPushSupported, webPushPermission, initWebPush } from '../utils/webPush'

const NOTIF_DISMISS_KEY = 'ef_pwa_notif_dismissed'

function isIOS() {
  const ua = navigator.userAgent || ''
  const iOSDevice = /iphone|ipad|ipod/i.test(ua)
  // iPadOS moderno se reporta como "MacIntel" con pantalla táctil.
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return iOSDevice || iPadOS
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

export default function PwaInstallPrompt() {
  const { currentUser } = useAuth()
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState(() => webPushPermission())
  const [notifDismissed, setNotifDismissed] = useState(() => localStorage.getItem(NOTIF_DISMISS_KEY) === '1')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    isWebPushSupported().then((ok) => { if (alive) setSupported(ok) })
    return () => { alive = false }
  }, [])

  // Nunca en la app nativa.
  if (Capacitor.isNativePlatform()) return null

  const ios = isIOS()
  const standalone = isStandalone()

  // Usuario con sesión, navegador compatible, permiso sin decidir. En iOS
  // solo tiene sentido una vez agregada a inicio (standalone).
  const showEnableNotif =
    !!currentUser &&
    supported &&
    permission === 'default' &&
    !notifDismissed &&
    (!ios || standalone)

  if (!showEnableNotif) return null

  async function handleEnableNotifications() {
    setBusy(true)
    try {
      await initWebPush(currentUser.uid, { requestPermission: true })
    } finally {
      setPermission(webPushPermission())
      setBusy(false)
    }
  }

  function dismissNotif() {
    localStorage.setItem(NOTIF_DISMISS_KEY, '1')
    setNotifDismissed(true)
  }

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md">
      <div className="relative bg-surface-card rounded-card shadow-2xl border border-outline-variant p-4">
        <button
          type="button"
          onClick={dismissNotif}
          aria-label="Cerrar"
          className="absolute top-2 right-2 p-1.5 text-muted hover:text-on-surface rounded transition-colors"
        >
          <X size={18} />
        </button>
        <div className="flex items-start gap-3 pr-6">
          <div className="w-10 h-10 rounded-full bg-accent-light flex items-center justify-center flex-shrink-0">
            <Bell size={20} className="text-accent" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-on-surface">Activa las notificaciones</p>
            <p className="text-xs text-muted mt-0.5">
              Recibe avisos de tus clases, entregas y calificaciones directo en este dispositivo.
            </p>
            <button
              type="button"
              onClick={handleEnableNotifications}
              disabled={busy}
              className="mt-3 w-full py-2 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded transition-colors disabled:opacity-60"
            >
              {busy ? 'Activando…' : 'Activar notificaciones'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
