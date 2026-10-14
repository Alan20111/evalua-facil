import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import { FileCheck2, Clock, CalendarDays, UserCheck, Bell, ChevronDown, Check, X, History } from 'lucide-react'
import NotificationLog from '../../components/NotificationLog'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'
import { refreshTeacherReminders, requestExactAlarmAccess } from '../../utils/localReminders'
import { IS_NATIVE_APP } from '../../utils/platform'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { formatHora12 } from '../../utils/formatHora'
import InfoDisclosure from '../../components/ui/InfoDisclosure'
import { Button, IconTile, Skeleton, SkeletonLine, Switch, Modal, Tabs } from '../../components/ui'
import { ICONO } from '../../config/iconos'

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

// Tres pestañas, con la misma jerarquía que el Perfil (oct-2026): lo que
// llega por push, lo que el teléfono te recuerda, y lo que ya llegó. Viven en
// la URL (?seccion=), así un enlace a /notificaciones abre en «Avisos».
const SECCIONES = [
  { value: 'avisos', label: 'Avisos', icon: Bell },
  { value: 'recordatorios', label: 'Recordatorios', icon: Clock },
  { value: 'bitacora', label: 'Bitácora', icon: History },
]

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
    description: 'De las actividades que marques con «Notificarme».',
    icon: FileCheck2,
    seccion: 'avisos',
  },
  {
    key: 'activacionEstudiante',
    label: 'Estudiante activado',
    description: 'En las asignaturas que marques con «Notificarme».',
    icon: UserCheck,
    seccion: 'avisos',
  },
  {
    key: 'recordatorioClase',
    label: 'Antes de una clase',
    description: 'Según tu horario.',
    icon: Clock,
    anticipacion: true,
    seccion: 'recordatorios',
  },
  {
    key: 'recordatorioEvento',
    label: 'Antes de un evento',
    description: 'Según tu calendario.',
    icon: CalendarDays,
    anticipacion: true,
    seccion: 'recordatorios',
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
      <Button variant="secondary"
        onClick={() => setOpen(true)}
       
      >
        <span>{current?.label || 'Elegir…'}</span>
        <ChevronDown size={ICONO.xs} className="text-muted flex-shrink-0" />
      </Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} variant="sheet" z={80} padding="" className="safe-bottom">
            <div className="sticky top-0 bg-surface-card px-4 py-3 border-b border-outline-variant flex items-center justify-between">
              <p className="font-semibold text-on-surface">Avisar</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="size-control inline-flex items-center justify-center -mr-1 text-muted hover:text-on-surface rounded-full transition-colors">
                <X size={ICONO.md} />
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
                        {selected && <Check size={ICONO.sm} className="flex-shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </Modal>
      )}
    </>
  )
}

// Interruptor simple — mismo patrón visual que src/pages/student/NotificationSettings.jsx,
// con el mismo slot opcional para un sub-ajuste (anticipación) cuando está activo,
// más un ícono en una insignia de acento para que cada fila se distinga a simple vista.
function Toggle({ checked, onChange, label, description, icon: Icon, children }) {
  // ui/Switch: role="switch", perilla que se desliza y toda la fila es su
  // etiqueta (tocar el texto también alterna). El sub-ajuste (children) entra
  // animado debajo cuando se enciende.
  return (
    <div className="py-1">
      <div className="flex items-center gap-3">
        {Icon && <IconTile icon={Icon} size="sm" />}
        <Switch className="flex-1 min-w-0" label={label} hint={description} checked={checked} onChange={onChange} />
      </div>
      {checked && children && <div className="mt-3 animate-aparece motion-reduce:animate-none">{children}</div>}
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
  const [params, setParams] = useSearchParams()
  const seccion = SECCIONES.some((x) => x.value === params.get('seccion')) ? params.get('seccion') : 'avisos'
  const elegir = (sec) => setParams(sec === 'avisos' ? {} : { seccion: sec }, { replace: true })
  const { currentUser } = useAuth()
  const toast = useToast()

  const [settings, setSettings] = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
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
    pendingSaveRef.current = { uid: currentUser.uid, data: updated }
    saveTimer.current = setTimeout(() => {
      pendingSaveRef.current = null
      setDoc(doc(db, 'notificationSettings', currentUser.uid), { ...updated, updatedAt: serverTimestamp() }, { merge: true })
        .then(() => refreshTeacherReminders(currentUser.uid))
        .catch(() => toast('No se pudo guardar: intenta de nuevo', 'error'))
    }, 400)
  }

  function filaCategoria(cat) {
    return (
      <Toggle
        key={cat.key}
        checked={settings[cat.key].habilitado}
        onChange={(v) => updateCategoria(cat.key, { ...settings[cat.key], habilitado: v })}
        label={cat.label}
        description={cat.description}
        icon={cat.icon}
      >
        {cat.anticipacion && (
          <div className="flex items-center justify-between gap-2 text-sm pl-12">
            <span className="text-on-surface">Avisar</span>
            <AnticipacionPicker
              value={settings[cat.key].anticipacionMinutos}
              onChange={(minutos) => updateCategoria(cat.key, { ...settings[cat.key], anticipacionMinutos: minutos })}
            />
          </div>
        )}
      </Toggle>
    )
  }

  // Tarjeta de interruptores: mismo formato que las del Perfil. `nota` es una
  // sola línea arriba (dónde llegan), nunca un párrafo.
  function tarjeta(seccionActual, nota) {
    return (
      <div className="bg-surface-card rounded-card shadow-card p-4">
        {nota && <p className="text-sm text-muted mb-3">{nota}</p>}
        <div className="divide-y divide-outline-variant [&>*]:py-3 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
          {CATEGORIAS.filter((c) => c.seccion === seccionActual).map(filaCategoria)}
        </div>
      </div>
    )
  }

  return (
    <div className={`px-4 py-4 space-y-4 ${TEACHER_CONTAINER_NARROW}`}>
      <h1 className="sr-only">Notificaciones</h1>
      <Tabs options={SECCIONES} value={seccion} onChange={elegir} label="Secciones de notificaciones" />

      <div key={seccion} role="tabpanel" className="space-y-4 animate-pagina motion-reduce:animate-none">
        {seccion === 'bitacora' ? (
          <NotificationLog uid={currentUser?.uid} describeEntry={describeEntry} plegable={false} />
        ) : loading ? (
          // Mismo armado que la tarjeta real: ícono, dos renglones e interruptor.
          <div className="bg-surface-card rounded-card shadow-card p-4 divide-y divide-outline-variant [&>*]:py-3 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0" aria-busy="true" aria-label="Cargando tus notificaciones">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-full flex-shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <SkeletonLine texto="text-sm font-medium" className="w-32" />
                  <SkeletonLine texto="text-xs" className="w-48" />
                </div>
                <Skeleton className="w-11 h-6 rounded-full flex-shrink-0" />
              </div>
            ))}
          </div>
        ) : seccion === 'avisos' ? (
          <>
            {tarjeta('avisos', IS_NATIVE_APP ? null : 'Llegan a tu celular con la app instalada.')}
            {/* Sonido, volumen y repetición los controla el teléfono, no la
                app: aquí solo cómo permitirlas ahí. */}
            <div className="bg-surface-card rounded-card shadow-card p-4">
              <InfoDisclosure label="¿No te llegan?">
                <ol className="text-sm text-muted space-y-1.5 list-decimal list-inside">
                  <li>Ajustes del teléfono › <strong>Aplicaciones</strong> › <strong>Evalúa Fácil</strong>.</li>
                  <li>Entra a <strong>Notificaciones</strong> y actívalas.</li>
                  <li>Si la app te pregunta al abrirla, elige <strong>Permitir</strong>.</li>
                </ol>
              </InfoDisclosure>
            </div>
          </>
        ) : (
          tarjeta('recordatorios', IS_NATIVE_APP ? null : 'Solo suenan en la app del celular.')
        )}
      </div>
    </div>
  )
}
