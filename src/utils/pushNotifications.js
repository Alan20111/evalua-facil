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
// navigate/ruta destino al TOCAR una notificación (no solo recibirla) — se
// actualizan en cada llamada por la misma razón que currentUid: los
// listeners se registran una sola vez pero deben reflejar la sesión activa.
let currentNavigate = null
let currentDeepLink = null
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

// A dónde llevar al tocar la notificación (push real o su reflejo local en
// primer plano), según `data.categoria` — pedido explícito: no basta con
// abrir la pantalla de Notificaciones, tiene que llevar directo a la entrega
// (o lo que haya pasado) que la disparó. `data` son los valores que manda la
// Cloud Function (ver functions/index.js) — todos strings, requisito de FCM.
// Sin match conocido (categoría vieja, o faltan ids) devuelve null y el
// llamador cae al deep link genérico (currentDeepLink).
function resolveDestino(data) {
  if (!data?.categoria) return null
  if (data.categoria === 'nuevasEntregas' && data.actividadId) {
    return { path: `/activity/${data.actividadId}`, state: data.alumnoId ? { openStudentId: data.alumnoId } : undefined }
  }
  if ((data.categoria === 'calificaciones' || data.categoria === 'actividadesNuevas') && data.actividadId) {
    return { path: `/alumno/actividad/${data.actividadId}` }
  }
  return null
}

function irADestino(data) {
  if (!currentNavigate) return
  const destino = resolveDestino(data)
  if (destino) currentNavigate(destino.path, destino.state ? { state: destino.state } : undefined)
  else if (currentDeepLink) currentNavigate(currentDeepLink)
}

async function mostrarEnPrimerPlano(notification) {
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: Math.floor(Date.now() % 1_000_000_000),
        title: notification.title || 'Evalúa Fácil',
        body: notification.body || 'Toca para ver los detalles',
        // `extra` viaja tal cual al listener de abajo (localNotificationActionPerformed)
        // — para que tocar el reflejo EN PRIMER PLANO también lleve directo a
        // la entrega, igual que el push real en segundo plano/cerrado.
        extra: notification.data || null,
      }],
    })
  } catch {
    // best-effort — sin esto la app sigue funcionando, solo sin el aviso local
  }
}

export async function initPushNotifications(uid, navigate, deepLink) {
  if (!uid || !Capacitor.isNativePlatform()) return
  currentUid = uid
  currentNavigate = navigate || null
  currentDeepLink = deepLink || null

  // Los listeners ya estaban puestos de una sesión anterior EN ESTE MISMO
  // proceso (cambio de cuenta sin cerrar la app del todo). Antes esto solo
  // volvía a llamar register() esperando que 'registration' disparara de
  // nuevo para que reasignarToken() moviera el token a la cuenta nueva —
  // bug real confirmado: en Android el plugin no siempre reemite
  // 'registration' si el token nativo no cambió (case normal: mismo
  // dispositivo, mismo token, solo cambia la cuenta), así que el cambio de
  // cuenta se quedaba sin reasignar y el teléfono seguía recibiendo avisos
  // de la cuenta anterior. Con el token ya conocido (currentToken, guardado
  // del último 'registration'), se reasigna aquí mismo de inmediato, sin
  // depender de que el evento nativo vuelva a disparar — register() se
  // sigue llamando también, por si acaso el token cambió de verdad.
  if (installed) {
    if (currentToken) reasignarToken(currentToken, uid).catch(() => {})
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
    // Al TOCAR la notificación (globo/banner), no solo recibirla — pedido
    // explícito: llevar directo a la entrega (o lo que haya pasado) que la
    // disparó, no solo a la pantalla de Notificaciones. Capacitor entrega
    // este evento también si la notificación fue la que abrió la app desde
    // cerrada (cold start), una vez que el listener queda registrado.
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      irADestino(action?.notification?.data)
    })
    // Mismo destino, pero para el reflejo local que se muestra con la app en
    // PRIMER PLANO (ver mostrarEnPrimerPlano) — sin este listener, tocar esa
    // notificación no hacía nada porque LocalNotifications es un sistema
    // aparte de PushNotifications.
    LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      irADestino(action?.notification?.extra)
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
