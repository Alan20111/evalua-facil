/* Service worker de Firebase Cloud Messaging para Web Push (PWA).
 *
 * Solo se usa en la WEB (instalada como PWA o en el navegador). La app nativa
 * de Android NO usa este archivo — usa @capacitor/push-notifications.
 *
 * La config de Firebase se pasa por query string al registrar el SW desde
 * src/utils/webPush.js (un service worker no puede leer las variables VITE_
 * del build). Todos estos valores son públicos: viajan igual en el bundle del
 * cliente, no son secretos.
 */
/* global importScripts, firebase */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js')

const params = new URL(self.location).searchParams
firebase.initializeApp({
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
})

// Inicializar messaging habilita el manejo en segundo plano: cuando la Cloud
// Function manda un payload de "notification" (ver functions/index.js), el
// navegador la muestra por su cuenta, sin que tengamos que llamar a
// showNotification aquí — así se evitan notificaciones duplicadas.
firebase.messaging()

// Al TOCAR la notificación: enfocar una pestaña ya abierta de la app o abrir
// una nueva, yendo al deep-link que venga en data.link (si lo hay).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const link = data.link || (data.FCM_MSG && data.FCM_MSG.data && data.FCM_MSG.data.link) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) {
          client.focus()
          if ('navigate' in client) client.navigate(link)
          return undefined
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(link) : undefined
    })
  )
})
