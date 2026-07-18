import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { ArrowLeft, Settings, FileCheck2, Clock, CalendarDays, Bell } from 'lucide-react'
import TeacherLayout from '../../components/Layout'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'
import { refreshTeacherReminders } from '../../utils/localReminders'

// Colección `notificationSettings/{uid}` (misma colección que usan los
// estudiantes, distinta por uid):
//   {
//     nuevasEntregas:     { habilitado } — solo en las actividades que el
//       propio docente marque con "Notificarme" en su editor (default
//       apagado, ver EntregableEditor.jsx / EvaluacionEditor.jsx — campo
//       notificarDocente). Vía push (Cloud Function).
//     recordatorioClase:  { habilitado, anticipacionMinutos } — local
//       (LocalNotifications), lee horarioBloques. Ver utils/localReminders.js.
//     recordatorioEvento: { habilitado, anticipacionMinutos } — local,
//       lee events. Ver utils/localReminders.js.
//     fcmTokens: [],
//     updatedAt,
//   }

const ANTICIPACION_OPCIONES = [
  { minutos: 15, label: '15 minutos antes' },
  { minutos: 10, label: '10 minutos antes' },
  { minutos: 5, label: '5 minutos antes' },
  { minutos: 0, label: 'Al momento' },
]

const DEFAULTS = {
  nuevasEntregas: { habilitado: true },
  recordatorioClase: { habilitado: false, anticipacionMinutos: 10 },
  recordatorioEvento: { habilitado: false, anticipacionMinutos: 10 },
}

const CATEGORIAS = [
  {
    key: 'nuevasEntregas',
    label: 'Nuevas entregas',
    description: 'Cuando un estudiante entrega una actividad que marcaste para notificarte (activa esa opción al editar cada actividad)',
    icon: FileCheck2,
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
  CATEGORIAS.forEach(({ key }) => {
    merged[key] = { ...DEFAULTS[key], ...(data?.[key] || {}) }
  })
  return merged
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
      {checked && children && <div className="mt-3 pt-3 border-t border-outline-variant">{children}</div>}
    </div>
  )
}

export default function TeacherNotificationSettings() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [settings, setSettings] = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const saveTimer = useRef(null)

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
    const updated = { ...settings, [key]: next }
    setSettings(updated)
    if (!currentUser) return
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
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 text-muted hover:text-accent rounded transition-colors flex-shrink-0"
            aria-label="Regresar"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-bold text-on-surface flex-1 min-w-0">Notificaciones</h1>
          {saving && <Spinner size="sm" />}
        </div>

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
                        <label className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-on-surface">Avisar</span>
                          <select
                            value={settings[cat.key].anticipacionMinutos}
                            onChange={(e) => updateCategoria(cat.key, { ...settings[cat.key], anticipacionMinutos: Number(e.target.value) })}
                            className="px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface-container"
                          >
                            {ANTICIPACION_OPCIONES.map((op) => (
                              <option key={op.minutos} value={op.minutos}>{op.label}</option>
                            ))}
                          </select>
                        </label>
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
          </>
        )}
      </div>
    </TeacherLayout>
  )
}
