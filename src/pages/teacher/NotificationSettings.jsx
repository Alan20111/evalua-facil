import { useState, useEffect, useRef } from 'react'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { Settings, FileCheck2, Clock, CalendarDays, UserCheck, Bell, ChevronDown, Check, X } from 'lucide-react'
import NotificationLog from '../../components/NotificationLog'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'
import { refreshTeacherReminders, requestExactAlarmAccess } from '../../utils/localReminders'
import { IS_NATIVE_APP } from '../../utils/platform'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { formatHora12 } from '../../utils/formatHora'
import InfoDisclosure from '../../components/ui/InfoDisclosure'

// Colección `notificationSettings/{uid}` (misma colección que usan los
// estudiantes, distinta por uid):
//   {
//     nuevasEntregas:     { habilitado } — solo en las actividades que el
//       propio docente marque con "Notificarme" en su editor (default
//       apagado, ver EntregableEditor.jsx / EvaluacionEditor.jsx — campo
//       notificarDocente). Vía push (Cloud Function).
//     activacionEstudiante: { habilitado } — solo en las asignaturas que el
//       propio docente marque con "Notificarme" en la pestaña Estudiantes
//       (SubjectPage.jsx, campo subject.notificarActivacion). Vía push
//       (Cloud Function).
//     recordatorioClase:  { habilitado, anticipacionMinutos } — local
//       (LocalNotifications), lee horarioBloques. Ver utils/localReminders.js.
//     recordatorioEvento: { habilitado, anticipacionMinutos } — local,
//       lee events. Ver utils/localReminders.js.
//     fcmTokens: [],
//     updatedAt,
//   }

// Cada opción es una LISTA de minutos de anticipación — un aviso por cada
// valor (ej. [15,10,5,0] programa 4 avisos independientes, uno cada 5 min,
// terminando justo al momento). El valor guardado en Firestore siempre es
// el arreglo completo; el <select> solo elige cuál arreglo usar.
const ANTICIPACION_OPCIONES = [
  { grupo: 'Un solo aviso', opciones: [
    { minutos: [15], label: '15 minutos antes' },
    { minutos: [10], label: '10 minutos antes' },
    { minutos: [5], label: '5 minutos antes' },
    { minutos: [0], label: 'Al momento' },
  ] },
  { grupo: 'Varios avisos (cada 5 min)', opciones: [
    { minutos: [15, 10, 5, 0], label: '15, 10, 5 min y al momento (4 avisos)' },
    { minutos: [10, 5, 0], label: '10, 5 min y al momento (3 avisos)' },
    { minutos: [5, 0], label: '5 min y al momento (2 avisos)' },
  ] },
]

// Compatibilidad hacia atrás: antes de esto, anticipacionMinutos era un solo
// número (ej. 10) — se guarda de aquí en adelante siempre como arreglo.
function normalizeAnticipacion(v) {
  if (Array.isArray(v) && v.length) return v
  if (typeof v === 'number') return [v]
  return [10]
}

const DEFAULTS = {
  nuevasEntregas: { habilitado: true },
  activacionEstudiante: { habilitado: true },
  recordatorioClase: { habilitado: false, anticipacionMinutos: [10] },
  recordatorioEvento: { habilitado: false, anticipacionMinutos: [10] },
}

const CATEGORIAS = [
  {
    key: 'nuevasEntregas',
    label: 'Nuevas entregas',
    description: 'Cuando un estudiante entrega una actividad que marcaste para notificarte (activa esa opción al editar cada actividad)',
    icon: FileCheck2,
  },
  {
    key: 'activacionEstudiante',
    label: 'Estudiante activado',
    description: 'Cuando un estudiante se activa en una asignatura que marcaste para notificarte (activa esa opción en la pestaña Estudiantes de la asignatura)',
    icon: UserCheck,
  },
  {
    key: 'recordatorioClase',
    label: 'Antes de una clase',
    description: 'Te avisa cuando esté por comenzar una clase de tu horario',
    icon: Clock,
    anticipacion: true,
  },
  {
    key: 'recordatorioEvento',
    label: 'Antes de un evento',
    description: 'Te avisa cuando esté por comenzar un evento de tu calendario',
    icon: CalendarDays,
    anticipacion: true,
  },
]

function mergeWithDefaults(data) {
  const merged = {}
  CATEGORIAS.forEach(({ key, anticipacion }) => {
    const base = { ...DEFAULTS[key], ...(data?.[key] || {}) }
    if (anticipacion) base.anticipacionMinutos = normalizeAnticipacion(base.anticipacionMinutos)
    merged[key] = base
  })
  return merged
}

// Selector propio para "Avisar" — el <select> nativo de Android se veía como
// el picker crudo del sistema (fondo oscuro, sin el estilo de la app). Un
// botón que abre una hoja con las opciones agrupadas se ve consistente con
// el resto de la app y sigue siendo compacto en la fila del interruptor.
function AnticipacionPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  useScrollLock(open)
  useBackHandler(() => setOpen(false), open)
  const valueKey = value.join(',')
  const current = ANTICIPACION_OPCIONES.flatMap((g) => g.opciones).find((op) => op.minutos.join(',') === valueKey)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant text-sm bg-surface text-on-surface hover:bg-[var(--accent-tint)] transition-colors"
      >
        <span>{current?.label || 'Elegir…'}</span>
        <ChevronDown size={14} className="text-muted flex-shrink-0" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setOpen(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-t-card sm:rounded-card drop-shadow-2xl w-full sm:max-w-sm max-h-[80vh] overflow-y-auto safe-bottom">
            <div className="sticky top-0 bg-surface-card px-4 py-3 border-b border-outline-variant flex items-center justify-between">
              <p className="font-semibold text-on-surface">Avisar</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="p-1 -mr-1 text-muted hover:text-on-surface rounded transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-2">
              {ANTICIPACION_OPCIONES.map((grupo) => (
                <div key={grupo.grupo} className="mb-2 last:mb-0">
                  <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{grupo.grupo}</p>
                  {grupo.opciones.map((op) => {
                    const key = op.minutos.join(',')
                    const selected = key === valueKey
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => { onChange(op.minutos); setOpen(false) }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded text-left text-sm transition-colors ${
                          selected ? 'bg-[var(--accent-tint)] text-accent font-medium' : 'text-on-surface hover:bg-[var(--accent-tint)]'
                        }`}
                      >
                        <span>{op.label}</span>
                        {selected && <Check size={16} className="flex-shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// Interruptor simple — mismo patrón visual que src/pages/student/NotificationSettings.jsx,
// con el mismo slot opcional para un sub-ajuste (anticipación) cuando está activo,
// más un ícono en una insignia de acento para que cada fila se distinga a simple vista.
function Toggle({ checked, onChange, label, description, icon: Icon, children }) {
  return (
    <div className="py-1">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="w-full flex items-center gap-3 text-left -mx-2 px-2 py-1 rounded-card hover:bg-accent-light active:bg-accent-light transition-colors"
      >
        {Icon && (
          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-accent-light flex-shrink-0">
            <Icon size={18} className="text-accent" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-on-surface">{label}</p>
          {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
        </div>
        <span
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
            checked ? 'bg-accent' : 'bg-slate-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-surface-card transition-transform ${
              checked ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </span>
      </button>
      {checked && children && <div className="mt-3">{children}</div>}
    </div>
  )
}

// Bitácora en formato tabla — encabezados cortos (Día semana / Fecha / Hora /
// Notificación / Detalles); el contenido de cada celda varía por categoría, ver
// describeEntry. Día/fecha/hora son SIEMPRE cuándo se recibió la
// notificación — no la hora propia de la clase/evento que la causó (pedido
// explícito: "la hora... debe ser la hora en la cual se recibió la
// notificación"), PERO "se recibió" no es lo mismo que createdAt (cuándo la
// app alcanzó a escribir el registro): para recordatorioClase/Evento
// (avisos locales, ver localReminders.js) createdAt puede quedar minutos
// atrás si el teléfono estaba en segundo plano y el registro se hizo hasta
// el siguiente resume de la app — mientras que disparadoEn (la hora exacta
// programada del aviso) no depende de eso. nuevasEntregas/activacionEstudiante
// (push del servidor) no traen disparadoEn — createdAt ya es preciso ahí,
// se escribe en el servidor en el momento real del evento.
// Rótulo fijo en MAYÚSCULAS que va SIEMPRE arriba, en su propio renglón,
// dentro de la celda de Notificación — pedido explícito, uno por categoría
// (y por tipo de actividad en nuevasEntregas: ENTREGA / CUESTIONARIO
// Realizado / EXAMEN Realizado). El resto del contenido de esa columna
// sigue igual, debajo.
function etiquetaCategoria(e) {
  switch (e.categoria) {
    case 'recordatorioClase': return 'CLASE'
    case 'recordatorioEvento': return 'EVENTO'
    case 'activacionEstudiante': return 'ESTUDIANTE ACTIVADO'
    case 'nuevasEntregas':
      return e.tipoEntrega === 'examen' ? 'EXAMEN Realizado'
        : e.tipoEntrega === 'cuestionario' ? 'CUESTIONARIO Realizado'
        : 'ENTREGA'
    default: return null
  }
}

// Arma las columnas Notificación/Detalles según la categoría. La columna se
// llama "Notificación" (no "Evento") para no confundirse con la palabra
// "evento" que ya aparece dentro del contenido de esa misma columna en la
// categoría recordatorioEvento. `e.categoria` falta en entradas viejas (de
// antes de este cambio): caen al resumen simple de siempre, sin nombre de
// estudiante. `navigate` solo lo usa nuevasEntregas, para que el nombre del
// estudiante en Detalles sea un enlace directo a esa entrega.
function describeEntry(e, navigate) {
  const etiqueta = etiquetaCategoria(e)
  switch (e.categoria) {
    case 'recordatorioClase': {
      // Mismo patrón que recordatorioEvento: cuál aviso es va en Notificación;
      // Detalles se queda con la hora exacta en la que la clase empieza y el
      // lugar (pedido explícito).
      const asignatura = e.asignatura ? `${e.asignatura}${e.grupo ? ` — ${e.grupo}` : ''}` : 'Tu clase'
      const aviso = e.anticipacionMinutos > 0 ? `Aviso de ${e.anticipacionMinutos} minutos antes` : 'Aviso al momento'
      const detalles = e.hora ? `La clase comienza a las ${formatHora12(e.hora)}${e.lugar ? `, en ${e.lugar}` : ''}` : ''
      return {
        notificacion: (<><div>{etiqueta}</div><div>{asignatura} — {aviso}</div></>),
        detalles,
      }
    }
    case 'recordatorioEvento': {
      // Pedido explícito: cuál aviso es (15/10/5 min antes, o al momento) va
      // en la columna Notificación, junto al nombre del evento — no en
      // Detalles, que se queda solo con la hora en la que el evento sucede.
      const aviso = e.anticipacionMinutos > 0 ? `Aviso de ${e.anticipacionMinutos} minutos antes` : 'Aviso al momento'
      return {
        notificacion: (<><div>{etiqueta}</div><div>{e.evento || 'Tu evento'} — {aviso}</div></>),
        detalles: e.hora ? `Evento a las ${formatHora12(e.hora)}` : '',
      }
    }
    case 'nuevasEntregas': {
      // Pedido explícito: asignatura+grupo en un renglón, número de la
      // ACTIVIDAD (no el intento del estudiante, que es intrascendente) +
      // nombre de la actividad en el renglón de abajo, dentro de la misma
      // celda de Notificación.
      const asignatura = e.asignatura ? `${e.asignatura}${e.grupo ? ` — ${e.grupo}` : ''}` : ''
      const actividad = `${e.numeroActividad ? `${e.numeroActividad} - ` : ''}${e.actividad || 'Actividad'}`
      // El nombre del estudiante en Detalles lleva a esa entrega (pedido
      // explícito) — mismo mecanismo que usa la tabla de calificaciones
      // (state.openStudentId, ver ActivityPage.jsx), así funciona igual
      // para entregables y para evaluaciones (EvaluacionManager lee el
      // mismo state). Entradas viejas sin actividadId/alumnoId (de antes de
      // este cambio) se quedan como texto plano, sin enlace.
      const puedeIrAEntrega = e.actividadId && e.alumnoId
      return {
        notificacion: (
          <>
            <div>{etiqueta}</div>
            {asignatura && <div>{asignatura}</div>}
            <div>{actividad}</div>
          </>
        ),
        detalles: puedeIrAEntrega ? (
          <button
            type="button"
            onClick={() => navigate(`/activity/${e.actividadId}`, { state: { openStudentId: e.alumnoId } })}
            className="text-accent underline decoration-dotted underline-offset-2 text-left"
          >
            {e.estudiante || 'Ver entrega'}
          </button>
        ) : (e.estudiante || ''),
      }
    }
    case 'activacionEstudiante': {
      // Pedido explícito: Notificación se queda fija en "ESTUDIANTE
      // ACTIVADO"; el nombre del estudiante y la asignatura (con grupo) van
      // en Detalles, en renglones separados dentro de la misma celda.
      const asignatura = e.asignatura ? `${e.asignatura}${e.grupo ? ` — ${e.grupo}` : ''}` : ''
      return {
        notificacion: etiqueta,
        detalles: (
          <>
            {e.estudiante && <div>{e.estudiante}</div>}
            {asignatura && <div>{asignatura}</div>}
          </>
        ),
      }
    }
    default:
      return { notificacion: e.descripcion || e.titulo || 'Notificación', detalles: '' }
  }
}

export default function TeacherNotificationSettings() {
  const { currentUser } = useAuth()
  const toast = useToast()

  const [settings, setSettings] = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const saveTimer = useRef(null)
  // Guardado pendiente (debounce de 400ms) — bug real reportado: si el
  // docente togglea un interruptor y sale de la pantalla ANTES de que se
  // cumplan los 400ms, el useEffect de limpieza de abajo cancelaba el
  // timeout sin nunca escribir el cambio, perdiéndolo en silencio. Ahora se
  // guarda aquí el último `updated` pendiente para poder escribirlo de
  // inmediato al desmontar, en vez de descartarlo.
  const pendingSaveRef = useRef(null)


  useEffect(() => {
    if (!currentUser) return
    getDoc(doc(db, 'notificationSettings', currentUser.uid))
      .then((snap) => {
        setSettings(mergeWithDefaults(snap.exists() ? snap.data() : null))
      })
      .catch(() => toast('No se pudo cargar tu configuración de notificaciones', 'error'))
      .finally(() => setLoading(false))
  }, [currentUser]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    clearTimeout(saveTimer.current)
    // Flush: si había un guardado pendiente sin cumplirse todavía, se
    // dispara aquí mismo en vez de perderse.
    const pending = pendingSaveRef.current
    if (pending) {
      pendingSaveRef.current = null
      setDoc(doc(db, 'notificationSettings', pending.uid), { ...pending.data, updatedAt: serverTimestamp() }, { merge: true })
        .then(() => refreshTeacherReminders(pending.uid))
        .catch(() => {})
    }
  }, [])

  // Se dispara desde el handler de cambio (no desde un efecto reactivo sobre
  // `settings`) para no llamar setState de forma síncrona dentro de un efecto.
  function updateCategoria(key, next) {
    const seActiva = (key === 'recordatorioClase' || key === 'recordatorioEvento')
      && !settings[key]?.habilitado && next.habilitado
    const updated = { ...settings, [key]: next }
    setSettings(updated)
    if (!currentUser) return
    // Al activar por primera vez un recordatorio de clase/evento, pide el
    // acceso especial de "Alarmas y recordatorios" (Android 12+). No es un
    // permiso con diálogo normal — sin él, el aviso se programa como alarma
    // INEXACTA y puede retrasarse mucho o no llegar (confirmado en
    // depuración con dispositivo real). Se pide aquí, a propósito, no en
    // cada refresh silencioso — sería muy invasivo redirigir a Ajustes del
    // sistema sin que el docente acabe de pedirlo.
    if (seActiva) requestExactAlarmAccess()
    clearTimeout(saveTimer.current)
    setSaving(true)
    pendingSaveRef.current = { uid: currentUser.uid, data: updated }
    saveTimer.current = setTimeout(() => {
      pendingSaveRef.current = null
      setDoc(doc(db, 'notificationSettings', currentUser.uid), { ...updated, updatedAt: serverTimestamp() }, { merge: true })
        .then(() => refreshTeacherReminders(currentUser.uid))
        .catch(() => toast('No se pudo guardar: intenta de nuevo', 'error'))
        .finally(() => setSaving(false))
    }, 400)
  }

  return (
    <>
      <div className={`px-4 py-4 space-y-4 ${TEACHER_CONTAINER_NARROW}`}>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-on-surface flex-1 min-w-0">Notificaciones</h1>
          {saving && <Spinner size="sm" />}
        </div>

        {!IS_NATIVE_APP && (
          <p className="text-xs text-muted -mt-2">
            Estos avisos llegan como notificación push al celular donde tengas instalada la app Evalúa Fácil — no a este navegador.
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
        ) : (
          <>
            {/* "Tus notificaciones" PRIMERO — orden natural de ajustes (lo
                que el docente vino a configurar) antes que el historial.
                Antes la Bitácora iba primero como workaround porque tocar el
                globo de una notificación no llevaba de forma confiable a
                verla; eso ya está resuelto (navigate a /notificaciones al
                tocar, más el orden por disparadoEn — ver entryDate abajo),
                así que ya no hace falta el workaround. */}
            <div className="rounded-card overflow-hidden bg-surface-card shadow-card border border-accent">
              <div className="px-4 py-3 bg-accent-light border-b border-accent flex items-center gap-2">
                <Bell size={18} className="text-accent flex-shrink-0" />
                <h2 className="font-semibold text-accent">Tus notificaciones</h2>
              </div>
              <div className="p-4 divide-y divide-outline-variant">
                {CATEGORIAS.map((cat) => (
                  <div key={cat.key} className={cat.key !== CATEGORIAS[0].key ? 'pt-3' : ''}>
                    <Toggle
                      checked={settings[cat.key].habilitado}
                      onChange={(v) => updateCategoria(cat.key, { ...settings[cat.key], habilitado: v })}
                      label={cat.label}
                      description={cat.description}
                      icon={cat.icon}
                    >
                      {cat.anticipacion && (
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-on-surface">Avisar</span>
                          <AnticipacionPicker
                            value={settings[cat.key].anticipacionMinutos}
                            onChange={(minutos) => updateCategoria(cat.key, { ...settings[cat.key], anticipacionMinutos: minutos })}
                          />
                        </div>
                      )}
                    </Toggle>
                  </div>
                ))}
              </div>
            </div>

            <NotificationLog uid={currentUser?.uid} describeEntry={describeEntry} />

            {/* Sonido, volumen y repetición los controla el teléfono, no la
                app — aquí solo explicamos cómo activarlas ahí. */}
            <div className="bg-surface-card rounded-card shadow-card border border-accent p-4">
              <div className="flex items-center gap-2 mb-2">
                <Settings size={16} className="text-accent flex-shrink-0" />
                <p className="text-sm font-semibold text-on-surface">Cómo activar las notificaciones en tu celular</p>
              </div>
              <InfoDisclosure label="Ver los pasos">
              <p className="text-xs text-muted mb-2">
                El sonido, el volumen y si se repiten los controla tu teléfono, igual que con cualquier otra app.
                Para asegurarte de recibirlas:
              </p>
              <ol className="text-sm text-muted space-y-1.5 list-decimal list-inside">
                <li>Abre los <strong>Ajustes</strong> de tu teléfono.</li>
                <li>Busca <strong>Aplicaciones</strong> (o &quot;Apps&quot;) y selecciona <strong>Evalúa Fácil</strong>.</li>
                <li>Entra a <strong>Notificaciones</strong> y actívalas.</li>
                <li>Si tu teléfono te pregunta al abrir la app, elige <strong>Permitir</strong>.</li>
              </ol>
              </InfoDisclosure>
            </div>
          </>
        )}
      </div>

    </>
  )
}
