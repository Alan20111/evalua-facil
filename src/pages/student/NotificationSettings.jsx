import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { ArrowLeft, Settings } from 'lucide-react'
import { STUDENT_CONTAINER_NARROW } from '../../config/layout'
import { useBackHandler } from '../../hooks/useBackHandler'

// Pantalla completa (no usa StudentLayout — mismo patrón que EvaluacionRunner:
// un overlay fixed inset-0 con SOLO un encabezado del estudiante, sin la barra
// lateral de asignaturas). Aquí el estudiante SOLO decide qué acciones
// disparan una notificación — sonido, volumen y repetición los controla el
// propio teléfono (el sistema operativo), no la app.
//
// Colección `notificationSettings/{uid}` — UNA por estudiante (uid de Auth,
// global entre todas sus inscripciones):
//   {
//     actividadesNuevas: { habilitado },
//     calificaciones:    { habilitado },
//     recordatorios:     { habilitado, anticipacionMinutos },
//     fcmTokens: [],
//     updatedAt,
//   }

const ANTICIPACION_OPCIONES = [
  { minutos: 15, label: '15 minutos antes' },
  { minutos: 60, label: '1 hora antes' },
  { minutos: 180, label: '3 horas antes' },
  { minutos: 1440, label: '1 día antes' },
  { minutos: 2880, label: '2 días antes' },
]

const DEFAULTS = {
  actividadesNuevas: { habilitado: true },
  calificaciones: { habilitado: true },
  recordatorios: { habilitado: true, anticipacionMinutos: 1440 },
}

const CATEGORIAS = [
  { key: 'actividadesNuevas', label: 'Actividades nuevas', description: 'Cuando tu maestro publique una actividad' },
  { key: 'calificaciones', label: 'Calificaciones', description: 'Cuando te califiquen una entrega' },
  { key: 'recordatorios', label: 'Recordatorios de entrega', description: 'Antes de que cierre una fecha límite' },
]

function mergeWithDefaults(data) {
  const merged = {}
  CATEGORIAS.forEach(({ key }) => {
    merged[key] = { ...DEFAULTS[key], ...(data?.[key] || {}) }
  })
  return merged
}

// Interruptor simple — mismo patrón visual que el resto de la app.
function Toggle({ checked, onChange, label, description, children }) {
  return (
    <div className="py-1">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="w-full flex items-center gap-3 text-left"
      >
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

export default function NotificationSettings() {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [settings, setSettings] = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const saveTimer = useRef(null)
  const goBack = () => navigate('/alumno/dashboard')
  useBackHandler(goBack)

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
        .catch(() => toast('No se pudo guardar: intenta de nuevo', 'error'))
        .finally(() => setSaving(false))
    }, 400)
  }

  const firstName = userProfile?.nombre || 'Estudiante'

  return (
    <div className="fixed inset-0 z-50 bg-surface overflow-y-auto">
      <header className="bg-accent text-white px-4 py-3 shadow-lg sticky top-0 z-10 flex items-center gap-3 safe-top">
        <button
          type="button"
          onClick={goBack}
          className="p-2 -ml-2 hover:bg-white/10 rounded flex-shrink-0 transition-colors"
          aria-label="Regresar"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold truncate">Notificaciones</h1>
          <p className="text-xs text-white/60 truncate">{firstName}</p>
        </div>
        {saving && <Spinner size="sm" />}
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
      ) : (
        <div className={`px-4 py-5 space-y-4 ${STUDENT_CONTAINER_NARROW}`}>
          <div className="bg-surface-card rounded-card shadow-card border border-outline-variant p-4 divide-y divide-outline-variant">
            {CATEGORIAS.map((cat) => (
              <div key={cat.key} className={cat.key !== CATEGORIAS[0].key ? 'pt-3' : ''}>
                <Toggle
                  checked={settings[cat.key].habilitado}
                  onChange={(v) => updateCategoria(cat.key, { ...settings[cat.key], habilitado: v })}
                  label={cat.label}
                  description={cat.description}
                >
                  {cat.key === 'recordatorios' && (
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-on-surface">Avisar</span>
                      <select
                        value={settings.recordatorios.anticipacionMinutos}
                        onChange={(e) => updateCategoria('recordatorios', { ...settings.recordatorios, anticipacionMinutos: Number(e.target.value) })}
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

          {/* Sonido, volumen y repetición los controla el teléfono, no la
              app — aquí solo explicamos cómo activarlas ahí. */}
          <div className="bg-surface-card rounded-card shadow-card border border-outline-variant p-4">
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
        </div>
      )}
    </div>
  )
}
