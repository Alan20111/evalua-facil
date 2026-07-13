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
import { doc, updateDoc, arrayUnion } from 'firebase/firestore'
import { db } from '../firebase'

let installed = false

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
  if (installed || !uid || !Capacitor.isNativePlatform()) return
  installed = true

  try {
    let perm = await PushNotifications.checkPermissions()
    if (perm.receive !== 'granted') perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') return
    await LocalNotifications.requestPermissions()

    // Se agrega (no reemplaza) — el estudiante puede tener más de un
    // dispositivo con la app instalada.
    PushNotifications.addListener('registration', (token) => {
      updateDoc(doc(db, 'notificationSettings', uid), { fcmTokens: arrayUnion(token.value) }).catch(() => {})
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
