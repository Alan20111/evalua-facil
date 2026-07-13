// Fase 4 de notificaciones push — recibe el mensaje de datos que manda la
// Cloud Function (Fase 3) y lo convierte en una notificación LOCAL real con
// el sonido/repetición/postergación que el estudiante configuró (Fase 1).
// Solo corre en la app nativa de Android (Capacitor) — en la web no hace nada.
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { LocalNotifications } from '@capacitor/local-notifications'
import { doc, updateDoc, arrayUnion } from 'firebase/firestore'
import { db } from '../firebase'

let installed = false

// Debe coincidir con los nombres de archivo en android/app/src/main/res/raw/
// (generados por scripts/generar-sonidos-notificacion.cjs — Fase 2).
const SOUND_FILES = {
  campana: 'notif_campana.wav',
  timbre: 'notif_timbre.wav',
  suave: 'notif_suave.wav',
  digital: 'notif_digital.wav',
  marimba: 'notif_marimba.wav',
}

const TITULOS = {
  actividadesNuevas: 'Nueva actividad',
  calificaciones: 'Te calificaron',
  recordatorios: 'Recordatorio de entrega',
}

// Convierte el data payload de FCM en 1 (repetir: 'una_vez') o varias
// notificaciones LOCALES encadenadas (repetir: 'hasta_interactuar'): la
// primera suena de inmediato, las siguientes se programan cada
// `postergarMinutos` hasta `maxPostergaciones` veces. Todas comparten
// `chainIds` en `extra` — al interactuar con cualquiera se cancelan las demás
// (ver el listener de abajo), sin necesidad de mantener un servicio corriendo.
async function mostrarNotificacion(data) {
  const soundFile = SOUND_FILES[data.sonido] || SOUND_FILES.campana
  const title = TITULOS[data.categoria] || 'Evalúa Fácil'
  const repiteHastaInteractuar = data.repetir === 'hasta_interactuar'
  const max = repiteHastaInteractuar ? Math.max(0, Number(data.maxPostergaciones) || 0) : 0
  const minutos = Number(data.postergarMinutos) || 5

  const baseId = Math.floor(Date.now() % 1_000_000_000)
  const chainIds = Array.from({ length: max + 1 }, (_, i) => baseId + i)

  const notifications = chainIds.map((id, i) => ({
    id,
    title,
    body: 'Toca para ver los detalles en Evalúa Fácil',
    sound: soundFile,
    extra: { ...data, chainIds },
    ...(i > 0 ? { schedule: { at: new Date(Date.now() + minutos * 60_000 * i) } } : {}),
  }))

  try {
    await LocalNotifications.schedule({ notifications })
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
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      mostrarNotificacion(notification.data || {})
    })
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      mostrarNotificacion(action.notification.data || {})
    })

    LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      const chainIds = action.notification.extra?.chainIds
      if (!Array.isArray(chainIds)) return
      LocalNotifications.cancel({ notifications: chainIds.map((id) => ({ id })) }).catch(() => {})
    })

    await PushNotifications.register()
  } catch {
    // best-effort — la app sigue funcionando sin push si algo de esto falla
  }
}
