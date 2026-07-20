import { useState, useEffect, useRef } from 'react'
import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { Settings, FileCheck2, Clock, CalendarDays, UserCheck, Bell, ChevronDown, ChevronUp, Check, X, History } from 'lucide-react'
import TeacherLayout from '../../components/Layout'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'
import { refreshTeacherReminders, requestExactAlarmAccess } from '../../utils/localReminders'
import { IS_NATIVE_APP } from '../../utils/platform'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'

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
          <div className="relative bg-surface-card rounded-t-card sm:rounded-card shadow-2xl w-full sm:max-w-sm max-h-[80vh] overflow-y-auto safe-bottom">
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
        className="w-full flex items-center gap-3 text-left"
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

// Se comparte con el registro inline de abajo — nada más se usa aquí.
function fmtFechaHora(ts) {
  const d = ts?.toDate ? ts.toDate() : null
  if (!d) return { fecha: '—', hora: '' }
  const fecha = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
  const hora = d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })
  return { fecha, hora }
}

// La fecha/hora de la propia clase (e.fecha "YYYY-MM-DD" + e.hora "HH:MM"),
// que es lo que el docente quiere ver — no cuándo se guardó el registro.
function fmtFechaClase(fecha) {
  if (!fecha) return ''
  const d = new Date(`${fecha}T00:00:00`)
  if (Number.isNaN(d.getTime())) return fecha
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Etiqueta corta por categoría — va como subtítulo de cada renglón (el
// nombre de la clase/evento/estudiante es el encabezado, ver describeEntry).
const CATEGORIA_LABEL = {
  recordatorioClase: 'Antes de clase',
  recordatorioEvento: 'Antes de evento',
  nuevasEntregas: 'Nueva entrega',
  activacionEstudiante: 'Estudiante activado',
}

// Arma cada renglón de la Bitácora: `nombre` es lo primero que se lee — la
// clase, el evento, o el estudiante que causó el aviso — en negritas, NUNCA
// solo la categoría genérica (pedido explícito, dos veces). `sub` es la
// categoría + el resto del detalle (grupo, asignatura, cuándo). `e.categoria`
// falta en entradas viejas (de antes de este cambio): caen al resumen simple
// de siempre, con el título original como nombre.
function describeEntry(e) {
  const categoriaLabel = CATEGORIA_LABEL[e.categoria] || ''
  switch (e.categoria) {
    case 'recordatorioClase': {
      const nombre = e.asignatura ? `${e.asignatura}${e.grupo ? ` — ${e.grupo}` : ''}` : 'Tu clase'
      const cuando = e.anticipacionMinutos > 0 ? `empezaba en ${e.anticipacionMinutos} min` : 'empezaba en ese momento'
      return { nombre, sub: `${categoriaLabel} · ${cuando}${e.hora ? ` (${fmtFechaClase(e.fecha)}, ${e.hora})` : ''}` }
    }
    case 'recordatorioEvento': {
      const nombre = e.evento || 'Tu evento'
      const cuando = e.anticipacionMinutos > 0 ? `empezaba en ${e.anticipacionMinutos} min` : 'empezaba en ese momento'
      return { nombre, sub: `${categoriaLabel} · ${cuando}${e.hora ? ` (${fmtFechaClase(e.fecha)}, ${e.hora})` : ''}` }
    }
    case 'nuevasEntregas':
      return {
        nombre: e.estudiante || 'Un estudiante',
        sub: `${categoriaLabel} · "${e.actividad || ''}" — ${e.asignatura || ''}${e.grupo ? ` · ${e.grupo}` : ''}`,
      }
    case 'activacionEstudiante':
      return {
        nombre: e.estudiante || 'Un estudiante',
        sub: `${categoriaLabel} · ${e.asignatura || ''}${e.grupo ? ` · ${e.grupo}` : ''}`,
      }
    default:
      return { nombre: e.titulo || 'Notificación', sub: e.descripcion || '' }
  }
}

export default function TeacherNotificationSettings() {
  const { currentUser } = useAuth()
  const toast = useToast()

  const [settings, setSettings] = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const saveTimer = useRef(null)

  // Bitácora de notificaciones — vive en su propia caja con scroll debajo de
  // los ajustes (pedido explícito), siempre visible y cargada sola al entrar
  // a la pantalla — no hace falta darle clic para verla. `logOpen` solo deja
  // colapsarla si estorba, no controla si se carga.
  const [logOpen, setLogOpen] = useState(true)
  const [logLoading, setLogLoading] = useState(true)
  const [logEntries, setLogEntries] = useState(null)

  useEffect(() => {
    if (!currentUser) return
    setLogLoading(true)
    getDocs(query(collection(db, 'notificationLog'), where('uid', '==', currentUser.uid)))
      .then((snap) => {
        // Más nueva arriba — no se puede pedir orderBy en la query (regla del
        // proyecto: solo igualdad en Firestore), así que se ordena en memoria.
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
        setLogEntries(rows)
      })
      .catch(() => toast('No se pudo cargar la bitácora de notificaciones', 'error'))
      .finally(() => setLogLoading(false))
  }, [currentUser]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!currentUser) return
    getDoc(doc(db, 'notificationSettings', currentUser.uid))
      .then((snap) => {
        setSettings(mergeWithDefaults(snap.exists() ? snap.data() : null))
      })
      .catch(() => toast('No se pudo cargar tu configuración de notificaciones', 'error'))
      .finally(() => setLoading(false))
  }, [currentUser]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(saveTimer.current), [])

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
    saveTimer.current = setTimeout(() => {
      setDoc(doc(db, 'notificationSettings', currentUser.uid), { ...updated, updatedAt: serverTimestamp() }, { merge: true })
        .then(() => refreshTeacherReminders(currentUser.uid))
        .catch(() => toast('No se pudo guardar: intenta de nuevo', 'error'))
        .finally(() => setSaving(false))
    }, 400)
  }

  return (
    <TeacherLayout>
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

            {/* Sonido, volumen y repetición los controla el teléfono, no la
                app — aquí solo explicamos cómo activarlas ahí. */}
            <div className="bg-surface-card rounded-card shadow-card border border-accent p-4">
              <div className="flex items-center gap-2 mb-2">
                <Settings size={16} className="text-accent flex-shrink-0" />
                <p className="text-sm font-semibold text-on-surface">Cómo activar las notificaciones en tu celular</p>
              </div>
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
            </div>

            <div className="rounded-card border border-outline-variant overflow-hidden bg-surface-card shadow-card">
              <button
                type="button"
                onClick={() => setLogOpen((v) => !v)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-on-surface hover:bg-[var(--accent-tint)] transition-colors"
              >
                <History size={16} className="flex-shrink-0 text-accent" />
                <span className="flex-1 text-left">Bitácora de notificaciones</span>
                {logOpen ? <ChevronUp size={16} className="text-muted flex-shrink-0" /> : <ChevronDown size={16} className="text-muted flex-shrink-0" />}
              </button>
              {logOpen && (
                <div className="border-t border-outline-variant">
                  {logLoading ? (
                    <div className="flex justify-center py-6"><Spinner size="sm" /></div>
                  ) : !logEntries?.length ? (
                    <p className="text-center text-muted text-sm py-6">Aún no tienes notificaciones registradas</p>
                  ) : (
                    // Toda la bitácora vive en UNA caja con scroll (pedido explícito) —
                    // renglones seguidos separados por una línea delgada, no tarjetas
                    // individuales, la más nueva arriba, cada entrada en máximo dos
                    // renglones: el nombre de la clase/evento/estudiante primero (lo que
                    // causó el aviso), la categoría y el resto del detalle abajo.
                    <ul className="divide-y divide-outline-variant max-h-[28rem] overflow-y-auto px-4 bg-surface">
                      {logEntries.map((e) => {
                        const { fecha, hora } = fmtFechaHora(e.createdAt)
                        const { nombre, sub } = describeEntry(e)
                        return (
                          <li key={e.id} className="py-2">
                            <p className="text-sm text-on-surface font-semibold truncate">
                              {nombre}
                              <span className="text-muted font-normal"> · {fecha} · {hora}</span>
                            </p>
                            {sub && <p className="text-xs text-muted truncate">{sub}</p>}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </TeacherLayout>
  )
}
