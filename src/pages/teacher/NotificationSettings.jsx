import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { ArrowLeft, Settings } from 'lucide-react'
import TeacherLayout from '../../components/Layout'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'

// Colección `notificationSettings/{uid}` (misma colección que usan los
// estudiantes, distinta por uid) — para el docente, por ahora solo una
// categoría: avisos de nuevas entregas, y solo en las actividades que el
// propio docente marque con "Notificarme" en su editor (default apagado,
// ver EntregableEditor.jsx / EvaluacionEditor.jsx — campo notificarDocente).
//   {
//     nuevasEntregas: { habilitado },
//     fcmTokens: [],
//     updatedAt,
//   }

const DEFAULTS = {
  nuevasEntregas: { habilitado: true },
}

const CATEGORIAS = [
  {
    key: 'nuevasEntregas',
    label: 'Nuevas entregas',
    description: 'Cuando un estudiante entrega una actividad que marcaste para notificarte (activa esa opción al editar cada actividad)',
  },
]

function mergeWithDefaults(data) {
  const merged = {}
  CATEGORIAS.forEach(({ key }) => {
    merged[key] = { ...DEFAULTS[key], ...(data?.[key] || {}) }
  })
  return merged
}

// Interruptor simple — mismo patrón visual que src/pages/student/NotificationSettings.jsx.
function Toggle({ checked, onChange, label, description }) {
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
            <div className="bg-surface-card rounded-card shadow-card border border-outline-variant p-4 divide-y divide-outline-variant">
              {CATEGORIAS.map((cat) => (
                <div key={cat.key} className={cat.key !== CATEGORIAS[0].key ? 'pt-3' : ''}>
                  <Toggle
                    checked={settings[cat.key].habilitado}
                    onChange={(v) => updateCategoria(cat.key, { ...settings[cat.key], habilitado: v })}
                    label={cat.label}
                    description={cat.description}
                  />
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
          </>
        )}
      </div>
    </TeacherLayout>
  )
}
