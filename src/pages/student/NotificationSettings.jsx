import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { ArrowLeft, Play } from 'lucide-react'
import { ALARMA_SONIDOS, reproducirSonido } from '../../utils/horarioBloques'
import { STUDENT_CONTAINER_NARROW } from '../../config/layout'

// Pantalla completa (no usa StudentLayout — mismo patrón que EvaluacionRunner:
// un overlay fixed inset-0 con SOLO un encabezado del estudiante, sin la barra
// lateral de asignaturas) donde el estudiante configura, por separado, cómo
// quiere que suenen sus tres tipos de notificación.
//
// Colección `notificationSettings/{uid}` — UNA por estudiante (uid de Auth,
// global entre todas sus inscripciones, a diferencia de notifPrefs que vivía
// duplicado en cada doc de `students`):
//   {
//     actividadesNuevas: { habilitado, sonido, repetir, volumen, postergarMinutos, maxPostergaciones },
//     calificaciones:    { ...misma forma... },
//     recordatorios:     { ...misma forma... },
//     fcmTokens: [],   // reservado — se llena cuando se conecte el push real
//     updatedAt,
//   }

const CATEGORIA_DEFAULT = {
  habilitado: true,
  sonido: 'campana',
  repetir: 'una_vez',
  volumen: 70,
  postergarMinutos: 5,
  maxPostergaciones: 3,
}

const DEFAULTS = {
  actividadesNuevas: { ...CATEGORIA_DEFAULT, sonido: 'campana' },
  calificaciones: { ...CATEGORIA_DEFAULT, sonido: 'timbre' },
  recordatorios: { ...CATEGORIA_DEFAULT, sonido: 'suave' },
}

const CATEGORIAS = [
  { key: 'actividadesNuevas', label: 'Actividades nuevas', description: 'Cuando tu maestro publique una actividad' },
  { key: 'calificaciones', label: 'Calificaciones', description: 'Cuando te califiquen una entrega' },
  { key: 'recordatorios', label: 'Recordatorios de entrega', description: 'Antes de que cierre una fecha límite' },
]

const REPETIR_OPCIONES = [
  { value: 'una_vez', label: 'Suena una vez' },
  { value: 'hasta_interactuar', label: 'Suena hasta que interactúes' },
]

function mergeWithDefaults(data) {
  const merged = {}
  CATEGORIAS.forEach(({ key }) => {
    merged[key] = { ...DEFAULTS[key], ...(data?.[key] || {}) }
  })
  return merged
}

// Interruptor simple — mismo patrón visual que el resto de la app (ver
// PaymentConfig.jsx / el modal de notificaciones que reemplaza esta pantalla).
function Toggle({ checked, onChange, label, description }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 py-1 text-left"
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
  )
}

function CategoriaCard({ categoria, valor, onChange }) {
  const postergarDeshabilitado = valor.repetir === 'una_vez'

  return (
    <div className="bg-surface-card rounded-card shadow-card border border-outline-variant p-4 space-y-4">
      <Toggle
        checked={valor.habilitado}
        onChange={(v) => onChange({ ...valor, habilitado: v })}
        label={categoria.label}
        description={categoria.description}
      />

      {valor.habilitado && (
        <div className="space-y-4 pt-1 border-t border-outline-variant">
          {/* Sonido */}
          <div className="space-y-1.5 pt-3">
            <span className="text-xs font-semibold text-muted uppercase tracking-wide">Sonido</span>
            <div className="space-y-1">
              {ALARMA_SONIDOS.map((s) => (
                <label
                  key={s.id}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded border text-sm cursor-pointer transition-colors ${
                    valor.sonido === s.id ? 'border-accent bg-accent-light' : 'border-outline-variant hover:bg-surface'
                  }`}
                >
                  <input
                    type="radio"
                    name={`sonido-${categoria.key}`}
                    checked={valor.sonido === s.id}
                    onChange={() => onChange({ ...valor, sonido: s.id })}
                    className="accent-[var(--accent)]"
                  />
                  <span className="flex-1 text-on-surface">{s.label}</span>
                  <button
                    type="button"
                    onClick={() => reproducirSonido(s.id, valor.volumen)}
                    className="p-1.5 text-accent hover:bg-accent-tint rounded-full transition-colors flex-shrink-0"
                    data-tooltip="Probar"
                    aria-label={`Probar sonido ${s.label}`}
                  >
                    <Play size={13} />
                  </button>
                </label>
              ))}
            </div>
          </div>

          {/* Repetición */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted uppercase tracking-wide">Repetición</span>
            <div className="flex flex-wrap gap-2">
              {REPETIR_OPCIONES.map((op) => (
                <button
                  key={op.value}
                  type="button"
                  onClick={() => onChange({ ...valor, repetir: op.value })}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    valor.repetir === op.value
                      ? 'bg-accent text-white border-accent'
                      : 'border-outline-variant text-muted hover:bg-surface'
                  }`}
                >
                  {op.label}
                </button>
              ))}
            </div>
          </div>

          {/* Volumen */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted uppercase tracking-wide">Volumen</span>
              <span className="text-xs text-muted">{valor.volumen}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={valor.volumen}
              onChange={(e) => onChange({ ...valor, volumen: Number(e.target.value) })}
              className="w-full accent-[var(--accent)]"
            />
            <p className="text-[11px] text-muted">
              Con la app abierta suena a este volumen. Con el celular bloqueado o la app cerrada, suena al volumen de notificaciones de tu teléfono.
            </p>
          </div>

          {/* Postergación */}
          <div className="space-y-1.5">
            <span className={`text-xs font-semibold uppercase tracking-wide ${postergarDeshabilitado ? 'text-slate-300' : 'text-muted'}`}>
              Postergación
            </span>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm">
                <span className={postergarDeshabilitado ? 'text-slate-300' : 'text-on-surface'}>Cada</span>
                <select
                  disabled={postergarDeshabilitado}
                  value={valor.postergarMinutos}
                  onChange={(e) => onChange({ ...valor, postergarMinutos: Number(e.target.value) })}
                  className="px-2 py-1 rounded border border-outline-variant text-sm bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {[5, 10, 15].map((m) => <option key={m} value={m}>{m} min</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className={postergarDeshabilitado ? 'text-slate-300' : 'text-on-surface'}>hasta</span>
                <select
                  disabled={postergarDeshabilitado}
                  value={valor.maxPostergaciones}
                  onChange={(e) => onChange({ ...valor, maxPostergaciones: Number(e.target.value) })}
                  className="px-2 py-1 rounded border border-outline-variant text-sm bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'vez' : 'veces'}</option>)}
                </select>
              </label>
            </div>
          </div>
        </div>
      )}
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

  // Cambia una categoría y programa el guardado con un pequeño debounce —
  // así arrastrar el slider de volumen no dispara una escritura a Firestore
  // por cada tick. Se dispara desde el handler de cambio (no desde un efecto
  // reactivo sobre `settings`) para no llamar setState de forma síncrona
  // dentro de un efecto.
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
    }, 500)
  }

  const firstName = userProfile?.nombre || 'Estudiante'

  return (
    <div className="fixed inset-0 z-50 bg-surface overflow-y-auto">
      <header className="bg-accent text-white px-4 py-3 shadow-lg sticky top-0 z-10 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/alumno/dashboard')}
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
          {CATEGORIAS.map((cat) => (
            <CategoriaCard
              key={cat.key}
              categoria={cat}
              valor={settings[cat.key]}
              onChange={(next) => updateCategoria(cat.key, next)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
