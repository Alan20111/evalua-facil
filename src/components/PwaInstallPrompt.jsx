// Prompt de instalación / notificaciones para la WEB (no aparece en la app
// nativa de Android). Cubre la "Opción B" (PWA + web push):
//
//  · En iPhone/iPad, si la web NO está agregada a la pantalla de inicio, invita
//    a agregarla (en iOS el web push SOLO funciona con la PWA instalada,
//    iOS 16.4+). Le muestra el instructivo Compartir → Agregar a inicio.
//  · Una vez instalada (o en cualquier navegador compatible), si el usuario ya
//    inició sesión y no ha dado permiso, ofrece un botón para activar las
//    notificaciones (el permiso debe pedirse desde un gesto del usuario).
//  · En Android/Chrome, si el navegador ofrece instalar la PWA, muestra un
//    botón "Instalar app".
//
// Nada de esto bloquea la app: es una tarjeta inferior descartable.
import { useState, useEffect } from 'react'
import { Share, Plus, Bell, X, Download } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { useAuth } from '../context/AuthContext'
import { isWebPushSupported, webPushPermission, initWebPush } from '../utils/webPush'

const IOS_DISMISS_KEY = 'ef_pwa_ios_dismissed'
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
  const [installEvent, setInstallEvent] = useState(null)
  const [iosDismissed, setIosDismissed] = useState(() => localStorage.getItem(IOS_DISMISS_KEY) === '1')
  const [notifDismissed, setNotifDismissed] = useState(() => localStorage.getItem(NOTIF_DISMISS_KEY) === '1')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    isWebPushSupported().then((ok) => { if (alive) setSupported(ok) })
    return () => { alive = false }
  }, [])

  // Android/Chrome: capturar el evento nativo de instalación para ofrecer botón.
  useEffect(() => {
    const onBeforeInstall = (e) => { e.preventDefault(); setInstallEvent(e) }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  // Nunca en la app nativa.
  if (Capacitor.isNativePlatform()) return null

  const ios = isIOS()
  const standalone = isStandalone()

  // 1) iOS sin instalar → invitar a agregar a la pantalla de inicio.
  const showIosInstall = ios && !standalone && !iosDismissed

  // 2) Notificaciones: usuario con sesión, navegador compatible, permiso sin
  //    decidir. En iOS solo tiene sentido una vez instalada (standalone).
  const showEnableNotif =
    !!currentUser &&
    supported &&
    permission === 'default' &&
    !notifDismissed &&
    (!ios || standalone)

  // 3) Android/Chrome: instalar PWA nativamente.
  const showAndroidInstall = !ios && !standalone && !!installEvent

  if (!showIosInstall && !showEnableNotif && !showAndroidInstall) return null

  async function handleEnableNotifications() {
    setBusy(true)
    try {
      await initWebPush(currentUser.uid, { requestPermission: true })
    } finally {
      setPermission(webPushPermission())
      setBusy(false)
    }
  }

  async function handleAndroidInstall() {
    if (!installEvent) return
    installEvent.prompt()
    try { await installEvent.userChoice } catch { /* ignore */ }
    setInstallEvent(null)
  }

  function dismissIos() {
    localStorage.setItem(IOS_DISMISS_KEY, '1')
    setIosDismissed(true)
  }
  function dismissNotif() {
    localStorage.setItem(NOTIF_DISMISS_KEY, '1')
    setNotifDismissed(true)
  }

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md">
      {showEnableNotif ? (
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
      ) : showIosInstall ? (
        <div className="relative bg-surface-card rounded-card shadow-2xl border border-outline-variant p-4">
          <button
            type="button"
            onClick={dismissIos}
            aria-label="Cerrar"
            className="absolute top-2 right-2 p-1.5 text-muted hover:text-on-surface rounded transition-colors"
          >
            <X size={18} />
          </button>
          <div className="flex items-start gap-3 pr-6">
            <div className="w-10 h-10 rounded-full bg-accent-light flex items-center justify-center flex-shrink-0">
              <Plus size={20} className="text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface">Agrega Evalúa Fácil a tu inicio</p>
              <p className="text-xs text-muted mt-0.5">
                Instálala en tu iPhone para abrirla como app y poder recibir notificaciones.
              </p>
              <p className="text-xs text-on-surface mt-2 flex items-center flex-wrap gap-1">
                Toca <Share size={15} className="inline text-accent" /> <span className="font-semibold">Compartir</span>
                <span className="text-muted">→</span>
                <span className="font-semibold">Agregar a inicio</span>
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative bg-surface-card rounded-card shadow-2xl border border-outline-variant p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-light flex items-center justify-center flex-shrink-0">
              <Download size={20} className="text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-on-surface">Instala Evalúa Fácil</p>
              <p className="text-xs text-muted mt-0.5">Ábrela como app y recibe notificaciones.</p>
            </div>
            <button
              type="button"
              onClick={handleAndroidInstall}
              className="py-2 px-3 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded transition-colors flex-shrink-0"
            >
              Instalar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
