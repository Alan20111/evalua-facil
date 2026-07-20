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
import { collection, doc, addDoc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../firebase'
import { subjectDisplayName } from './subjectName'

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

// category interno ('clase'/'evento', usado para el id reservado) → categoria
// que la Bitácora de notificaciones usa para saber cómo mostrar la entrada
// (ver describeEntry en NotificationSettings.jsx). Mismos nombres que useAlarmas.js.
const CATEGORIA_LOG = { clase: 'recordatorioClase', evento: 'recordatorioEvento' }

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
        // Se guarda de vuelta al registrar la entrega (registerDeliveredReminders)
        // para que la Bitácora muestre fecha/hora/anticipación/nombre/grupo por
        // separado, no solo el texto ya armado del body.
        extra: {
          categoria: CATEGORIA_LOG[category] || category,
          fecha: item.start.toISOString().slice(0, 10),
          hora: item.start.toTimeString().slice(0, 5),
          anticipacionMinutos: min,
          asignatura: item.asignatura || '',
          grupo: item.grupo || '',
          lugar: item.lugar || '',
          evento: item.evento || '',
        },
      }))
    )
    .filter((n) => n.schedule.at.getTime() > now)
  if (notifications.length) await LocalNotifications.schedule({ notifications })
  return notifications.length
}

let installed = false

// A diferencia del push del servidor (que la Cloud Function registra en
// notificationLog vía Admin SDK, ver functions/index.js), un recordatorio
// local lo dispara el propio teléfono sin que la app se entere en el
// momento — no hay ningún round-trip al servidor para dejar constancia.
// Para que también aparezcan en "Registro de notificaciones", se revisa la
// bandeja de notificaciones del sistema (getDeliveredNotifications) cada vez
// que la app abre/vuelve a primer plano: cualquier aviso nuestro (rango de
// id reservado) que siga ahí y todavía no se haya registrado, se guarda
// ahora. Limitación conocida: si el docente lo descarta sin haber vuelto a
// abrir la app, no queda registro — es lo más cercano a "se entregó de
// verdad" que se puede confirmar sin depender de un listener que solo
// dispara en primer plano.
const LOGGED_KEY = 'ef_recordatorios_registrados'
function loadLoggedIds() {
  try { return new Set(JSON.parse(localStorage.getItem(LOGGED_KEY) || '[]')) } catch { return new Set() }
}
function saveLoggedIds(set) {
  try { localStorage.setItem(LOGGED_KEY, JSON.stringify([...set].slice(-500))) } catch { /* almacenamiento lleno */ }
}

// Un solo punto para escribir la entrada — lo usan tanto el listener
// instantáneo (installReminderDeliveryListener) como el barrido de
// alcance (registerDeliveredReminders), con el mismo Set en localStorage
// para no duplicar si ambos ven la misma notificación.
//
// OJO — bug real encontrado con datos de producción: el id se marcaba como
// "ya registrado" DESPUÉS de terminar el addDoc (que tarda un viaje de red
// completo). Cuando el listener y el barrido veían la MISMA notificación
// casi al mismo tiempo (p. ej. la app pasa a primer plano justo cuando se
// entrega), ambos leían el Set ANTES de que el primero alcanzara a
// guardarlo de vuelta, y los dos escribían — duplicado. Se marca el id
// como registrado ANTES del addDoc (revirtiendo si falla) para cerrar esa
// ventana.
//
// La clave del Set incluye fecha+hora, no solo el id: el id de
// LocalNotifications sale de idFor(categoria, `${bloqueId}:${min}`) — NO
// cambia si el docente mueve la clase/evento a otra fecha/hora, así que sin
// esto, una vez registrado el primer aviso, el aviso de la nueva posición
// (mismo id, fecha/hora distinta) se descartaba en silencio como "ya
// registrado" aunque de verdad sonó — pedido explícito: sí debe quedar.
async function logIfNew(uid, id, title, body, extra) {
  const key = `${id}:${extra.fecha || ''}:${extra.hora || ''}`
  const logged = loadLoggedIds()
  if (logged.has(key)) return
  logged.add(key)
  saveLoggedIds(logged)
  try {
    await addDoc(collection(db, 'notificationLog'), {
      uid,
      categoria: extra.categoria || '',
      titulo: title || 'Recordatorio',
      descripcion: body || '',
      asignatura: extra.asignatura || '',
      grupo: extra.grupo || '',
      lugar: extra.lugar || '',
      evento: extra.evento || '',
      fecha: extra.fecha || '',
      hora: extra.hora || '',
      anticipacionMinutos: extra.anticipacionMinutos ?? null,
      createdAt: serverTimestamp(),
    })
  } catch (err) {
    logged.delete(key)
    saveLoggedIds(logged)
    throw err
  }
}

// Segunda vía para registrar un recordatorio entregado — además del barrido
// en registerDeliveredReminders (que depende de que el docente vuelva a
// abrir la app SIN haber descartado el aviso), este listener escucha el
// evento de entrega mientras el proceso de la app sigue vivo (primer plano,
// o recién puesto en segundo plano) y registra AL INSTANTE, sin depender de
// que la notificación siga en la bandeja. Entre los dos, la única ventana
// que queda sin cubrir es: la app fue matada por el sistema Y el docente
// descartó el aviso antes de volver a abrirla — límite real de Android que
// ningún listener en JS puede cerrar sin un servicio nativo en segundo plano.
let deliveryListenerInstalled = false

export function installReminderDeliveryListener(uid) {
  if (deliveryListenerInstalled || !uid || !Capacitor.isNativePlatform()) return
  deliveryListenerInstalled = true
  LocalNotifications.addListener('localNotificationReceived', (n) => {
    if (n.id < 1_200_000_000) return // no es nuestro (ver rango reservado arriba)
    // Mismo bug que en registerDeliveredReminders: en Android este evento
    // trae los datos en `data`, no en `extra` (ese campo del tipo declarado
    // es solo iOS) — confirmado con una entrada real en producción que
    // quedó guardada con categoria/asignatura/evento vacíos porque solo se
    // leía `n.extra`.
    const extra = n.data || n.extra || {}
    logIfNew(uid, n.id, n.title, n.body, extra)
      .catch((err) => console.error('[localReminders] logIfNew (listener) falló:', err))
  })
}

export async function registerDeliveredReminders(uid) {
  if (!uid || !Capacitor.isNativePlatform()) return
  try {
    const { notifications } = await LocalNotifications.getDeliveredNotifications()
    const nuestras = (notifications || []).filter((n) => n.id >= 1_200_000_000)
    if (!nuestras.length) return
    const logged = loadLoggedIds()
    // La clave es id+fecha+hora (ver logIfNew) — un id reprogramado tras
    // mover la clase/evento a otra fecha/hora NO cuenta como ya visto aquí.
    const nuevas = nuestras.filter((n) => {
      const extra = n.data || n.extra || {}
      return !logged.has(`${n.id}:${extra.fecha || ''}:${extra.hora || ''}`)
    })
    if (!nuevas.length) return
    for (const n of nuevas) {
      // El plugin devuelve los "extra" al programar como `data` en Android
      // (DeliveredNotificationSchema) — `extra` en esa lectura es solo iOS,
      // que esta app no tiene. Cae a `n.extra` por si acaso, sin costo.
      const extra = n.data || n.extra || {}
      await logIfNew(uid, n.id, n.title, n.body, extra)
    }
    console.log(`[localReminders] recordatorios entregados registrados: ${nuevas.length}`)
  } catch (err) {
    console.error('[localReminders] registerDeliveredReminders falló:', err)
  }
}

export async function refreshTeacherReminders(uid) {
  if (!uid || !Capacitor.isNativePlatform()) return
  await registerDeliveredReminders(uid)
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
        .map((b) => {
          // El nombre de la asignatura va en el CUERPO (subtitle), no solo
          // en el título — "Registro de notificaciones" solo muestra un
          // renglón (descripcion), que se arma a partir del cuerpo.
          const subj = subjectsById[b.asignaturaId]
          const nombreClase = subjectDisplayName(subj) || 'tu clase'
          const detalle = b.lugar ? `${nombreClase} · ${b.lugar}` : nombreClase
          return {
            id: b.id,
            start: parseFechaHora(b.fecha, b.horaInicio),
            title: 'Tu clase está por comenzar',
            subtitle: detalle,
            asignatura: subj?.nombre || '',
            grupo: subj?.grupo || '',
            lugar: b.lugar || '',
          }
        })
      programadas += await scheduleUpcoming('clase', items, clase.anticipacionMinutos ?? 10)
    }

    if (evento.habilitado) {
      const snap = await getDocs(query(collection(db, 'events'), where('docenteId', '==', uid)))
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((e) => e.inicio)
        // El nombre del evento va en subtitle (cuerpo) Y en `evento` (campo
        // estructurado aparte para la Bitácora) — igual que la asignatura
        // arriba, así queda en el cuerpo del aviso y también como dato propio.
        .map((e) => ({ id: e.id, start: new Date(e.inicio), title: 'Tu evento está por comenzar', subtitle: e.titulo || 'Evento', evento: e.titulo || 'Evento' }))
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
