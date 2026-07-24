// Web Push (PWA) — registra el navegador / la PWA para recibir notificaciones
// usando el MISMO Firebase Cloud Messaging que la app nativa. El token se
// guarda en el mismo array `notificationSettings/{uid}.fcmTokens`, así que la
// Cloud Function existente (sendEachForMulticast en functions/index.js)
// entrega a la web SIN ningún cambio de backend.
//
// Solo corre en la WEB (no en la app nativa de Android, que usa
// @capacitor/push-notifications). En iOS el web push solo funciona con la PWA
// AGREGADA A LA PANTALLA DE INICIO y en iOS 16.4+.
//
// Requiere la variable VITE_FIREBASE_VAPID_KEY (la "Web Push certificate" que
// se genera en Firebase Console → Configuración del proyecto → Cloud
// Messaging). Sin ella, todo esto es un no-op silencioso.
import { Capacitor } from '@capacitor/core'
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging'
import { setDoc, doc, arrayUnion, arrayRemove } from 'firebase/firestore'
import app, { db } from '../firebase'

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY
const TOKEN_OWNER_KEY = 'ef_webpush_token_uid'
const SW_URL = '/firebase-messaging-sw.js'

let currentToken = null
let foregroundListenerReady = false

// El SW no puede leer las variables del build, así que la config va por query
// string en la URL de registro (todos estos valores son públicos).
function swUrlWithConfig() {
  const qs = new URLSearchParams({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  }).toString()
  return `${SW_URL}?${qs}`
}

// ¿Este entorno puede recibir web push? La app nativa NO (usa Capacitor).
export async function isWebPushSupported() {
  if (Capacitor.isNativePlatform()) return false
  if (typeof window === 'undefined') return false
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) return false
  try {
    return await isSupported()
  } catch {
    return false
  }
}

// Estado actual del permiso del navegador: 'granted' | 'denied' | 'default'.
export function webPushPermission() {
  return typeof Notification !== 'undefined' ? Notification.permission : 'denied'
}

// El token de FCM es del navegador/instalación, no de la sesión. Al cambiar de
// cuenta en el mismo dispositivo, hay que quitarlo del dueño anterior antes de
// asignarlo al nuevo (mismo criterio que la app nativa en pushNotifications.js),
// si no el dispositivo recibiría avisos de ambas cuentas.
async function reasignarToken(token, uid) {
  const anterior = localStorage.getItem(TOKEN_OWNER_KEY)
  if (anterior && anterior !== uid) {
    setDoc(doc(db, 'notificationSettings', anterior), { fcmTokens: arrayRemove(token) }, { merge: true }).catch(() => {})
  }
  localStorage.setItem(TOKEN_OWNER_KEY, uid)
  await setDoc(doc(db, 'notificationSettings', uid), { fcmTokens: arrayUnion(token) }, { merge: true })
}

// Registra el token de web push para `uid`.
//   requestPermission=true  → pide permiso al usuario (DEBE llamarse desde un
//                             gesto del usuario, p. ej. un botón — iOS lo exige).
//   requestPermission=false → solo registra si el permiso YA está concedido
//                             (re-registro silencioso al iniciar sesión).
// Devuelve true si el token quedó registrado.
export async function initWebPush(uid, { requestPermission = false } = {}) {
  if (!uid) return false
  if (!(await isWebPushSupported())) return false
  if (!VAPID_KEY) {
    // Sin la Web Push certificate no se puede obtener un token — avisa una vez
    // en consola para que sea fácil de diagnosticar en producción.
    console.warn('[webPush] Falta VITE_FIREBASE_VAPID_KEY — el web push no se registrará.')
    return false
  }

  let permission = Notification.permission
  if (permission === 'default' && requestPermission) {
    permission = await Notification.requestPermission()
  }
  if (permission !== 'granted') return false

  try {
    const registration = await navigator.serviceWorker.register(swUrlWithConfig())
    const messaging = getMessaging(app)
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration })
    if (!token) return false
    currentToken = token
    await reasignarToken(token, uid)

    if (!foregroundListenerReady) {
      foregroundListenerReady = true
      // Con la app en PRIMER PLANO el navegador no muestra la notificación por
      // su cuenta; la reflejamos con el SW registrado (mismo aspecto que en
      // segundo plano).
      onMessage(messaging, (payload) => {
        const n = payload.notification || {}
        registration.showNotification(n.title || 'Evalúa Fácil', {
          body: n.body || 'Toca para ver los detalles',
          icon: '/icon-192.png',
          data: payload.data || {},
        }).catch(() => {})
      })
    }
    return true
  } catch {
    // best-effort — la web sigue funcionando sin push si algo falla
    return false
  }
}

// Quita el token al cerrar sesión (mismo criterio que la app nativa): salir sin
// que entre nadie más no debe dejar el navegador recibiendo avisos de la cuenta
// anterior.
export async function clearWebPushToken() {
  if (Capacitor.isNativePlatform()) return
  const owner = localStorage.getItem(TOKEN_OWNER_KEY)
  const token = currentToken
  if (!owner || !token) return
  try {
    await setDoc(doc(db, 'notificationSettings', owner), { fcmTokens: arrayRemove(token) }, { merge: true })
    localStorage.removeItem(TOKEN_OWNER_KEY)
  } catch {
    // best-effort — el próximo login de todos modos reasigna
  }
}
