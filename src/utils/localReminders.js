// Recordatorios programados (clase / evento) — a diferencia de las
// notificaciones push (server → FCM), estas son puramente locales: el propio
// teléfono del docente las dispara en el instante calculado, vía
// LocalNotifications.schedule(). Solo corre en la app nativa de Android.
//
// Se reprograman por completo cada vez que se llama refreshTeacherReminders:
// cancela lo que ya estaba programado (en nuestro rango reservado de ids) y
// vuelve a programar desde cero con los datos frescos de Firestore — así un
// cambio de horario, un evento nuevo, o apagar el recordatorio, se refleja
// sin dejar avisos obsoletos. Se dispara en el login del docente, al volver
// la app a primer plano, y justo después de guardar la pantalla de
// Notificaciones (ver src/pages/teacher/NotificationSettings.jsx).
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { LocalNotifications } from '@capacitor/local-notifications'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase'

// Ventana hacia adelante en la que se programan recordatorios — más allá de
// esto no tiene caso programar (se reprograma de todos modos en cada
// login/resume, así que la ventana solo necesita cubrir hasta el próximo
// resume razonable).
const WINDOW_DAYS = 7

// Rango de ids reservado para estos recordatorios (siempre >= 1_200_000_000),
// para poder cancelar/reprogramar SOLO los nuestros vía getPending() sin
// tocar los de "reflejo en primer plano" de pushNotifications.js (esos usan
// Date.now() % 1_000_000_000, siempre < 1e9). Se queda muy por debajo del
// límite de un entero de 32 bits (2,147,483,647).
function idFor(category, docId) {
  let h = 0
  const s = `${category}:${docId}`
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return 1_200_000_000 + (Math.abs(h) % 800_000_000)
}

function parseFechaHora(fecha, hora) {
  return new Date(`${fecha}T${hora}:00`)
}

function anticipacionLabel(min) {
  return min > 0 ? `Empieza en ${min} min` : 'Empieza ahora'
}

async function scheduleUpcoming(category, items, anticipacionMinutos) {
  const now = Date.now()
  const notifications = items
    .map((item) => ({
      id: idFor(category, item.id),
      title: item.title,
      body: `${anticipacionLabel(anticipacionMinutos)}${item.subtitle ? ` — ${item.subtitle}` : ''}`,
      schedule: { at: new Date(item.start.getTime() - anticipacionMinutos * 60_000) },
    }))
    .filter((n) => n.schedule.at.getTime() > now)
  if (notifications.length) await LocalNotifications.schedule({ notifications })
  return notifications.length
}

let installed = false

export async function refreshTeacherReminders(uid) {
  if (!uid || !Capacitor.isNativePlatform()) return
  try {
    const perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted') {
      const req = await LocalNotifications.requestPermissions()
      if (req.display !== 'granted') {
        // Sin esto, un permiso denegado dejaba el interruptor "activado" en la
        // pantalla de Notificaciones sin que nada se programara jamás, y no
        // había ninguna pista visible de por qué — ni un log en logcat.
        console.warn('[localReminders] permiso de notificaciones no concedido, no se programan recordatorios')
        return
      }
    }

    const settingsSnap = await getDoc(doc(db, 'notificationSettings', uid))
    const settings = settingsSnap.exists() ? settingsSnap.data() : {}
    const clase = settings.recordatorioClase || { habilitado: false }
    const evento = settings.recordatorioEvento || { habilitado: false }

    // Cancela todo lo nuestro antes de reprogramar — evita duplicados y
    // avisos obsoletos si el docente cambió horario/eventos o el ajuste.
    const pending = await LocalNotifications.getPending()
    const ours = pending.notifications.filter((n) => n.id >= 1_200_000_000)
    if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) })

    const now = new Date()
    const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 86_400_000)
    const hoy = now.toISOString().slice(0, 10)
    const fin = windowEnd.toISOString().slice(0, 10)

    let programadas = 0
    if (clase.habilitado) {
      const snap = await getDocs(query(collection(db, 'horarioBloques'), where('docenteId', '==', uid)))
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((b) => b.fecha >= hoy && b.fecha <= fin && b.horaInicio)
        .map((b) => ({ id: b.id, start: parseFechaHora(b.fecha, b.horaInicio), title: 'Tu clase está por comenzar', subtitle: b.lugar || '' }))
      programadas += await scheduleUpcoming('clase', items, clase.anticipacionMinutos ?? 10)
    }

    if (evento.habilitado) {
      const snap = await getDocs(query(collection(db, 'events'), where('docenteId', '==', uid)))
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((e) => e.inicio)
        .map((e) => ({ id: e.id, start: new Date(e.inicio), title: e.titulo || 'Tienes un evento', subtitle: '' }))
        .filter((e) => e.start >= now && e.start <= windowEnd)
      programadas += await scheduleUpcoming('evento', items, evento.anticipacionMinutos ?? 10)
    }
    // Confirma que la función corrió de principio a fin y cuántos avisos
    // quedaron programados — antes no había ninguna señal de esto, ni
    // siquiera cuando todo salía bien.
    console.log(`[localReminders] recordatorios reprogramados: ${programadas}`)
  } catch (err) {
    // best-effort — sin esto la app sigue funcionando, solo sin recordatorios.
    // Se deja un rastro en consola (visible por adb logcat / chrome://inspect)
    // porque antes fallaba en silencio total: no había manera de distinguir
    // "el plugin nativo no está en este build" de "Firestore no respondió" de
    // cualquier otra causa, sin reconstruir la app con más instrumentación.
    console.error('[localReminders] refreshTeacherReminders falló:', err)
  }
}

// Vuelve a calcular los recordatorios cada vez que la app regresa a primer
// plano (además del login) — así una clase agregada mientras la app estaba
// en segundo plano días atrás no se queda con recordatorios obsoletos hasta
// el próximo login. Se instala una sola vez por sesión de la app.
export function installReminderResumeListener(uid) {
  if (installed || !uid || !Capacitor.isNativePlatform()) return
  installed = true
  CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) refreshTeacherReminders(uid)
  })
}
