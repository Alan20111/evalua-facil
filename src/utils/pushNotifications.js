// Notificaciones push — registra el dispositivo y maneja la recepción con la
// app en primer plano. Solo corre en la app nativa de Android (Capacitor) —
// en la web no hace nada.
//
// Sonido, volumen y repetición los controla el propio teléfono del
// estudiante (como con cualquier otra app) — no la app. La Cloud Function
// manda un "notification" payload normal (ver functions/index.js), así que
// con la app en segundo plano o cerrada, Android la muestra solo, con el
// sonido/volumen que el estudiante tenga configurado en su teléfono. El
// único caso que hay que manejar aquí es la app en PRIMER PLANO: ahí Android
// no la muestra automáticamente, así que se refleja con una notificación
// local simple usando el mismo título/cuerpo que mandó la Cloud Function.
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { LocalNotifications } from '@capacitor/local-notifications'
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore'
import { db } from '../firebase'

let installed = false
// uid "dueño" del token en este proceso — los listeners de abajo se registran
// UNA sola vez (installed) pero deben reflejar SIEMPRE la sesión activa, así
// que leen esta variable en vez de cerrar sobre el uid del primer login.
let currentUid = null
// Último token recibido — lo necesita clearPushToken() para poder quitarlo
// al cerrar sesión sin tener que esperar un nuevo 'registration'.
let currentToken = null
const TOKEN_OWNER_KEY = 'ef_push_token_uid'

// El token de FCM es del DISPOSITIVO/instalación, no de la sesión — sigue
// siendo el mismo aunque se cierre sesión y entre otra cuenta en el mismo
// teléfono (docente probando como alumno, o viceversa). Antes de esto, el
// token se agregaba (arrayUnion) a quien iniciara sesión SIN quitarlo nunca
// de la cuenta anterior — el teléfono terminaba recibiendo avisos de ambas
// cuentas a la vez sin importar cuál tuviera la sesión abierta. Se detecta
// comparando contra el uid guardado la última vez que este dispositivo
// registró un token.
async function reasignarToken(token, uid) {
  const anterior = localStorage.getItem(TOKEN_OWNER_KEY)
  if (anterior && anterior !== uid) {
    updateDoc(doc(db, 'notificationSettings', anterior), { fcmTokens: arrayRemove(token) }).catch(() => {})
  }
  localStorage.setItem(TOKEN_OWNER_KEY, uid)
  await updateDoc(doc(db, 'notificationSettings', uid), { fcmTokens: arrayUnion(token) })
}

async function mostrarEnPrimerPlano(notification) {
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: Math.floor(Date.now() % 1_000_000_000),
        title: notification.title || 'Evalúa Fácil',
        body: notification.body || 'Toca para ver los detalles',
      }],
    })
  } catch {
    // best-effort — sin esto la app sigue funcionando, solo sin el aviso local
  }
}

export async function initPushNotifications(uid) {
  if (!uid || !Capacitor.isNativePlatform()) return
  currentUid = uid

  // Los listeners ya estaban puestos de una sesión anterior EN ESTE MISMO
  // proceso (cambio de cuenta sin cerrar la app del todo) — con currentUid ya
  // actualizado arriba, solo falta volver a registrar para que 'registration'
  // dispare de nuevo y reasignarToken() mueva el token a la cuenta nueva.
  if (installed) {
    PushNotifications.register().catch(() => {})
    return
  }
  installed = true

  try {
    let perm = await PushNotifications.checkPermissions()
    if (perm.receive !== 'granted') perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') return
    await LocalNotifications.requestPermissions()

    PushNotifications.addListener('registration', (token) => {
      currentToken = token.value
      if (currentUid) reasignarToken(token.value, currentUid).catch(() => {})
    })
    PushNotifications.addListener('registrationError', () => {
      // best-effort — sin token registrado, la Cloud Function simplemente no
      // encuentra a quién mandarle el push (ver enviarPush() en functions/index.js)
    })
    // Solo dispara con la app en primer plano — en segundo plano o cerrada,
    // Android ya mostró la notificación del sistema por su cuenta.
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      mostrarEnPrimerPlano(notification)
    })

    await PushNotifications.register()
  } catch {
    // best-effort — la app sigue funcionando sin push si algo de esto falla
  }
}

// Quita el token de quien lo tenga registrado en este momento — se llama al
// cerrar sesión (ver AuthContext.jsx, onAuthStateChanged con user=null).
// Sin esto, cerrar sesión y NO volver a entrar de inmediato dejaba el
// teléfono recibiendo avisos de la cuenta con la que se salió: initPushNotifications
// solo reasigna el token en el PRÓXIMO login, así que el hueco entre "cerró
// sesión" y "alguien más entró" quedaba sin cubrir. Docente y alumno en el
// mismo dispositivo: entrar como uno debe apagar al otro, y salir sin entrar
// a nadie más no debe dejar sonando la cuenta anterior.
export async function clearPushToken() {
  if (!Capacitor.isNativePlatform()) return
  const owner = localStorage.getItem(TOKEN_OWNER_KEY)
  const token = currentToken
  currentUid = null
  if (!owner || !token) return
  try {
    await updateDoc(doc(db, 'notificationSettings', owner), { fcmTokens: arrayRemove(token) })
    localStorage.removeItem(TOKEN_OWNER_KEY)
  } catch {
    // best-effort — si falla, el próximo login de todos modos reasigna
  }
}
