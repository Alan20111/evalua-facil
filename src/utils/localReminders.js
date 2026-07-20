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

// Compatibilidad hacia atrás: antes anticipacionMinutos era un solo número
// (ej. 10) guardado en Firestore — de aquí en adelante siempre es un
// arreglo (ej. [10] o [15,10,5,0] para varios avisos). Ver
// NotificationSettings.jsx (misma normalización, duplicada a propósito:
// ese archivo no debe importar de acá ni viceversa solo por esto).
function normalizeAnticipacion(v) {
  if (Array.isArray(v) && v.length) return v
  if (typeof v === 'number') return [v]
  return [10]
}

// anticipacionMinutos es un ARREGLO — un aviso independiente por cada valor
// (ej. [15,10,5,0] programa 4 avisos por elemento, cada uno con su propio id
// vía idFor(category, `${item.id}:${min}`) para no chocar entre sí).
async function scheduleUpcoming(category, items, anticipacionMinutos) {
  const now = Date.now()
  const minutos = normalizeAnticipacion(anticipacionMinutos)
  const notifications = items
    .flatMap((item) =>
      minutos.map((min) => ({
        id: idFor(category, `${item.id}:${min}`),
        title: item.title,
        body: `${anticipacionLabel(min)}${item.subtitle ? ` — ${item.subtitle}` : ''}`,
        schedule: { at: new Date(item.start.getTime() - min * 60_000) },
      }))
    )
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

    // Solo diagnóstico aquí (no interrumpe con una pantalla de ajustes en
    // cada refresh) — ver requestExactAlarmAccess para el flujo que sí
    // dirige al docente a concederlo, disparado explícitamente al activar
    // un recordatorio en Ajustes. Sin este permiso, Android agenda alarmas
    // INEXACTAS que pueden retrasarse mucho o no entregarse a tiempo.
    try {
      const exacta = await LocalNotifications.checkExactNotificationSetting?.()
      if (exacta && exacta.exact_alarm !== 'granted') {
        console.warn(`[localReminders] alarmas exactas no concedidas (exact_alarm=${exacta.exact_alarm}) — los avisos pueden llegar tarde o no llegar`)
      }
    } catch { /* método puede no existir en versiones viejas del plugin */ }

    const settingsSnap = await getDoc(doc(db, 'notificationSettings', uid))
    const settings = settingsSnap.exists() ? settingsSnap.data() : {}
    const clase = settings.recordatorioClase || { habilitado: false }
    const evento = settings.recordatorioEvento || { habilitado: false }

    // Cancela lo nuestro antes de reprogramar — evita duplicados y avisos
    // obsoletos si el docente cambió horario/eventos o el ajuste.
    //
    // OJO — bug real encontrado en depuración con dispositivo: esta función
    // se dispara en CADA resume de la app (además de login/settings/crear
    // evento), y antes cancelaba TODO lo pendiente sin excepción. Un aviso
    // ya disparado por AlarmManager pero que Android aún no entrega (alarma
    // inexacta bajo Doze/ahorro de batería puede tardar más de lo
    // programado) quedaba cancelado por el siguiente resume ANTES de
    // mostrarse — reproducido: evento a las 16:25, el docente cambió de app
    // a las 16:56, el resume canceló el aviso porque para entonces "ya
    // pasó" y no calificaba para reprogramarse. Se deja un margen: no se
    // toca un aviso nuestro cuya hora ya pasó hace menos de este margen,
    // dándole tiempo a Android de entregarlo.
    const GRACIA_CANCELACION_MS = 60 * 60 * 1000 // 60 min
    const nowMs = Date.now()
    const pending = await LocalNotifications.getPending()
    const ours = pending.notifications.filter((n) => {
      if (n.id < 1_200_000_000) return false
      const at = n.schedule?.at ? new Date(n.schedule.at).getTime() : null
      if (at != null && at <= nowMs && nowMs - at < GRACIA_CANCELACION_MS) return false
      return true
    })
    if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) })

    const now = new Date()
    const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 86_400_000)
    const hoy = now.toISOString().slice(0, 10)
    const fin = windowEnd.toISOString().slice(0, 10)

    let programadas = 0
    if (clase.habilitado) {
      // subjects.notificarClase — palomita "Notificarme antes de que empiecen
      // las clases de esta asignatura" (ProgramarBloquesModal.jsx). Ausente =
      // true (asignaturas de antes de que existiera este campo se incluyen,
      // como siempre se hizo).
      const [snapBloques, snapSubjects] = await Promise.all([
        getDocs(query(collection(db, 'horarioBloques'), where('docenteId', '==', uid))),
        getDocs(query(collection(db, 'subjects'), where('docenteId', '==', uid))),
      ])
      const subjectsById = {}
      snapSubjects.docs.forEach((d) => { subjectsById[d.id] = d.data() })
      const items = snapBloques.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((b) => b.fecha >= hoy && b.fecha <= fin && b.horaInicio)
        .filter((b) => subjectsById[b.asignaturaId]?.notificarClase !== false)
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

// Sin el acceso especial "Alarmas y recordatorios" (Android 12+), el plugin
// cae a alarmas INEXACTAS: el aviso de clase/evento puede retrasarse mucho o
// no llegar. A diferencia del permiso normal de notificaciones, este NO
// tiene un diálogo — solo se concede llevando al docente a una pantalla de
// Ajustes del sistema (changeExactNotificationSetting), así que solo se
// llama a propósito (al activar un recordatorio en Ajustes), no en cada
// refresh silencioso.
export async function requestExactAlarmAccess() {
  if (!Capacitor.isNativePlatform()) return true
  try {
    if (!LocalNotifications.checkExactNotificationSetting) return true // plugin viejo, no aplica
    const current = await LocalNotifications.checkExactNotificationSetting()
    if (current.exact_alarm === 'granted') return true
    const result = await LocalNotifications.changeExactNotificationSetting()
    return result.exact_alarm === 'granted'
  } catch (err) {
    console.error('[localReminders] requestExactAlarmAccess falló:', err)
    return false
  }
}
