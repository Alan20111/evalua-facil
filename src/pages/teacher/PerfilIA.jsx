import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { Sparkles, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { perfilIAVacio, isPerfilIACompleto } from '../../utils/perfilIA'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'

const inputCls =
  'w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-y'

const CAMPOS = [
  {
    key: 'estiloClase',
    label: 'Estilo de facilitar clase',
    placeholder: 'Ej. Clases muy participativas, con dinámicas grupales y poca exposición teórica. Prefiero que los alumnos trabajen en equipo la mayor parte del tiempo.',
    rows: 3,
  },
  {
    key: 'habilidades',
    label: 'Habilidades como docente',
    placeholder: 'Ej. Manejo bien el trabajo por proyectos, la gamificación y el uso de herramientas digitales en clase.',
    rows: 3,
  },
  {
    key: 'experiencia',
    label: 'Experiencia y características relevantes',
    placeholder: 'Ej. 8 años dando clase en bachillerato tecnológico, la mayoría en grupos numerosos (40+ alumnos) del turno vespertino.',
    rows: 3,
  },
  {
    key: 'contextoEscuela',
    label: 'Contexto de la escuela (opcional)',
    placeholder: 'Ej. Plantel semiurbano, alumnos que en su mayoría también trabajan, acceso limitado a internet fuera de la escuela.',
    rows: 3,
  },
  {
    key: 'contextoGeneral',
    label: 'Otro contexto general de trabajo (opcional)',
    placeholder: 'Cualquier otra información general que te gustaría que la IA de Evalúa Fácil tuviera siempre presente.',
    rows: 3,
  },
]

export default function PerfilIA() {
  const { currentUser, userProfile, setUserProfile } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [form, setForm] = useState(() => ({ ...perfilIAVacio(), ...(userProfile?.perfilIA || {}) }))
  const [saving, setSaving] = useState(false)

  const savedPerfilIA = userProfile?.perfilIA || null
  const completo = isPerfilIACompleto(savedPerfilIA)

  const changed = CAMPOS.some((c) => (form[c.key] || '') !== (savedPerfilIA?.[c.key] || ''))

  async function handleSave(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    const perfilIA = {
      estiloClase: form.estiloClase.trim(),
      habilidades: form.habilidades.trim(),
      experiencia: form.experiencia.trim(),
      contextoEscuela: form.contextoEscuela.trim(),
      contextoGeneral: form.contextoGeneral.trim(),
      actualizadoEn: new Date().toISOString(),
    }
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), { perfilIA })
      setUserProfile((p) => ({ ...p, perfilIA }))
      toast('Perfil para IA guardado')
    } catch {
      toast('No se pudo guardar el perfil. Intenta de nuevo.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${TEACHER_CONTAINER_NARROW} mx-auto px-4 py-6`}>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-medium text-muted hover:text-on-surface mb-4"
      >
        <ArrowLeft size={16} /> Volver
      </button>

      <div className="flex items-start gap-3 mb-2">
        <div className="w-10 h-10 rounded-full bg-accent-light flex items-center justify-center flex-shrink-0">
          <Sparkles size={20} className="text-accent" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-on-surface">Perfil para la IA del Docente (para todas las asignaturas)</h1>
          <p className="text-sm text-muted mt-0.5">
            Cuéntanos cómo trabajas para que las funciones de IA de Evalúa Fácil
            (crear exámenes, cuestionarios, actividades, rúbricas y más) den
            resultados más ajustados a ti. Se captura una sola vez y se reutiliza
            en todas tus asignaturas — no es necesario repetirlo.
          </p>
        </div>
      </div>

      <div
        className={`flex items-center gap-2 text-sm font-medium rounded-card px-3 py-2 mb-5 ${
          completo
            ? 'bg-green-50 text-green-700'
            : 'bg-amber-50 text-amber-700'
        }`}
      >
        {completo ? <CheckCircle2 size={16} /> : <Sparkles size={16} />}
        {completo
          ? 'Tu perfil está completo.'
          : 'Tu perfil está incompleto. Complétalo para poder usar el Asistente IA en tus asignaturas.'}
      </div>

      <form onSubmit={handleSave} className="bg-surface-card rounded-card shadow-card p-4 space-y-4">
        {CAMPOS.map((c) => (
          <div key={c.key}>
            <label className="block text-sm font-medium text-muted mb-1" htmlFor={c.key}>
              {c.label}
            </label>
            <textarea
              id={c.key}
              className={inputCls}
              rows={c.rows}
              placeholder={c.placeholder}
              value={form[c.key]}
              onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))}
              maxLength={1000}
            />
          </div>
        ))}

        <button
          type="submit"
          disabled={saving || !changed}
          className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {saving && <Spinner size="sm" />}
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
    </div>
  )
}
