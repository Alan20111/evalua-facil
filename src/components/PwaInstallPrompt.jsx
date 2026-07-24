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
import { Share, Plus, Bell, X, Download, ChevronLeft, ChevronRight, Copy, Star } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { useAuth } from '../context/AuthContext'
import { useScrollLock } from '../hooks/useScrollLock'
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

// Guía visual a pantalla completa para instalar la PWA en iPhone/iPad.
// iOS NO permite disparar la instalación por código (no hay beforeinstallprompt
// en Safari) — esto es lo máximo que la plataforma permite: bajar la fricción
// de los 2 toques manuales con una guía ilustrada, en vez de una tarjetita de
// texto. Overlay fullscreen (patrón §6.7 fullscreen, sin backdrop clicable).
function IosInstallGuide({ onClose }) {
  return (
    <div className="fixed inset-0 z-[120] bg-surface flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-surface-card border-b border-outline-variant px-4 py-3 flex items-center justify-between shadow-card">
        <p className="text-base font-bold text-on-surface">Instalar en tu iPhone</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar guía"
          className="p-2 text-muted hover:text-on-surface rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 px-4 py-5 max-w-md w-full mx-auto space-y-5">
        <p className="text-sm text-muted">
          Son solo 2 toques — sin App Store. Al terminar, Evalúa Fácil se abre
          desde tu inicio como cualquier app y podrás recibir notificaciones.
        </p>

        {/* Paso 1 — botón Compartir de Safari */}
        <div className="bg-surface-card rounded-card shadow-card border border-outline-variant p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
            <p className="text-sm font-semibold text-on-surface">
              Toca <span className="text-accent">Compartir</span> en la barra de Safari
            </p>
          </div>
          {/* Mock de la barra inferior de Safari con flecha animada */}
          <div className="relative pt-10">
            <div className="absolute left-1/2 -translate-x-1/2 top-0 animate-bounce text-accent" aria-hidden="true">
              <svg width="20" height="26" viewBox="0 0 20 26" fill="none">
                <path d="M10 2v18M10 20l-6-6M10 20l6-6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="bg-surface-container rounded-xl px-4 py-3 flex items-center justify-between">
              <ChevronLeft size={22} className="text-accent/60" aria-hidden="true" />
              <ChevronRight size={22} className="text-outline" aria-hidden="true" />
              <span className="relative inline-flex" aria-hidden="true">
                <span className="absolute inset-0 -m-2 rounded-full bg-accent/20 animate-pulse" />
                <Share size={26} className="relative text-accent" />
              </span>
              <span className="w-[22px] h-[22px] rounded border-2 border-outline" aria-hidden="true" />
              <Copy size={22} className="text-outline" aria-hidden="true" />
            </div>
            <p className="text-xs text-muted mt-2 text-center">Está en la parte de abajo de Safari</p>
          </div>
        </div>

        {/* Paso 2 — Agregar a pantalla de inicio */}
        <div className="bg-surface-card rounded-card shadow-card border border-outline-variant p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>
            <p className="text-sm font-semibold text-on-surface">
              Elige <span className="text-accent">&quot;Agregar a inicio&quot;</span>
            </p>
          </div>
          {/* Mock del menú de compartir de iOS */}
          <div className="bg-surface-container rounded-xl overflow-hidden divide-y divide-outline-variant/50">
            <div className="px-4 py-2.5 flex items-center justify-between opacity-50">
              <span className="text-sm text-on-surface">Copiar</span>
              <Copy size={18} className="text-muted" aria-hidden="true" />
            </div>
            <div className="px-4 py-2.5 flex items-center justify-between opacity-50">
              <span className="text-sm text-on-surface">Agregar a favoritos</span>
              <Star size={18} className="text-muted" aria-hidden="true" />
            </div>
            <div className="px-4 py-2.5 flex items-center justify-between bg-accent-light/60 ring-2 ring-accent ring-inset">
              <span className="text-sm font-semibold text-on-surface">Agregar a inicio</span>
              <span className="w-[18px] h-[18px] rounded border-2 border-on-surface flex items-center justify-center" aria-hidden="true">
                <Plus size={12} className="text-on-surface" />
              </span>
            </div>
          </div>
          <p className="text-xs text-muted mt-2 text-center">Desliza hacia abajo en el menú si no lo ves</p>
        </div>

        {/* Paso 3 — confirmar */}
        <div className="bg-surface-card rounded-card shadow-card border border-outline-variant p-4">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center flex-shrink-0">3</span>
            <p className="text-sm font-semibold text-on-surface">
              Toca <span className="text-accent">&quot;Agregar&quot;</span> — ¡y listo!
            </p>
          </div>
          <p className="text-xs text-muted mt-2 pl-8">
            Abre Evalúa Fácil desde el icono nuevo de tu inicio. Ahí adentro
            podrás activar las notificaciones de tus clases y entregas.
          </p>
        </div>
      </div>

      {/* Cierre */}
      <div className="sticky bottom-0 bg-surface-card border-t border-outline-variant px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="w-full max-w-md mx-auto block py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Entendido
        </button>
      </div>
    </div>
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
  const [showGuide, setShowGuide] = useState(false)

  // Sin scroll de fondo mientras la guía fullscreen está abierta.
  useScrollLock(showGuide)

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

  // Guía visual fullscreen (solo se abre desde la tarjeta de iOS).
  if (showGuide) return <IosInstallGuide onClose={() => setShowGuide(false)} />

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
              <p className="text-sm font-semibold text-on-surface">Instala Evalúa Fácil en tu iPhone</p>
              <p className="text-xs text-muted mt-0.5">
                Ábrela como app desde tu inicio y recibe notificaciones — sin App Store.
              </p>
              <button
                type="button"
                onClick={() => setShowGuide(true)}
                className="mt-3 w-full py-2 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Instalar en iPhone
              </button>
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
