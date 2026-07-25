import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { auth, db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { GraduationCap } from 'lucide-react'
import { useBackHandler } from '../../hooks/useBackHandler'

// Ventana para el "presiona de nuevo" de abajo — la misma que usa
// AndroidBackButton para salir de la app desde la pantalla raíz.
const SALIR_PRESS_WINDOW_MS = 2000

export default function Onboarding() {
  const { currentUser, setUserProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [realNombre, setRealNombre] = useState('')
  const [apellidoPaterno, setApellidoPaterno] = useState('')
  const [apellidoMaterno, setApellidoMaterno] = useState('')
  const [nombre, setNombre] = useState('')
  const [saving, setSaving] = useState(false)
  const ultimaSalidaRef = useRef(0)

  // Botón físico de Android. Esta pantalla no tiene "atrás" posible: la ruta
  // protegida rebota aquí mientras el perfil esté incompleto, y cerrar la app
  // tampoco ayuda porque al reabrirla la sesión sigue viva y vuelve a caer
  // aquí — sin ninguna salida a la vista. Así que atrás cierra la sesión y
  // regresa al inicio; la cuenta YA está creada, al entrar de nuevo se retoma
  // justo en este paso. Se pide dos veces para que un toque distraído no
  // saque a nadie de su cuenta.
  async function salirDelRegistro() {
    const ahora = Date.now()
    if (ahora - ultimaSalidaRef.current >= SALIR_PRESS_WINDOW_MS) {
      ultimaSalidaRef.current = ahora
      toast('Presiona de nuevo para salir de tu cuenta', 'warning')
      return
    }
    try {
      await signOut(auth)
      navigate('/', { replace: true })
      toast('Tu cuenta ya está creada — entra de nuevo cuando quieras terminar este paso')
    } catch (err) {
      toast('No se pudo cerrar la sesión: ' + err.message, 'error')
    }
  }
  useBackHandler(salirDelRegistro)

  async function finish(e) {
    e.preventDefault()
    if (!realNombre.trim() || !apellidoPaterno.trim()) { toast('Escribe tu nombre y apellido paterno', 'error'); return }
    if (!nombre.trim()) { toast('Escribe cómo quieres que te vean tus estudiantes', 'error'); return }
    setSaving(true)
    try {
      const updates = {
        nombre: realNombre.trim(),
        apellidoPaterno: apellidoPaterno.trim(),
        apellidoMaterno: apellidoMaterno.trim(),
        nombreMostrar: nombre.trim(),
        profileComplete: true,
      }
      await updateDoc(doc(db, 'users', currentUser.uid), updates)
      setUserProfile((p) => ({ ...p, ...updates }))
      navigate('/dashboard')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-card bg-accent flex items-center justify-center mx-auto mb-3">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-on-surface">Un último paso</h1>
          <p className="text-muted text-sm mt-1">Cuéntanos quién eres</p>
        </div>

        <div className="bg-surface-card rounded-card shadow-card p-5">
          <form onSubmit={finish} className="space-y-3">
            <div>
              <label htmlFor="onboarding-real-nombre" className="block text-sm font-medium text-muted mb-1">Nombre(s)</label>
              <input
                id="onboarding-real-nombre"
                type="text"
                value={realNombre}
                onChange={(e) => setRealNombre(e.target.value)}
                required
                /* autofocus: primer campo de este paso final del onboarding, el docente llega con intención directa de escribir */
                autoFocus
                className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                placeholder="Ej. Laura"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor="onboarding-apellido-paterno" className="block text-sm font-medium text-muted mb-1">Apellido paterno</label>
                <input
                  id="onboarding-apellido-paterno"
                  type="text"
                  value={apellidoPaterno}
                  onChange={(e) => setApellidoPaterno(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  placeholder="Ej. García"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="onboarding-apellido-materno" className="block text-sm font-medium text-muted mb-1">
                  Apellido materno <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                <input
                  id="onboarding-apellido-materno"
                  type="text"
                  value={apellidoMaterno}
                  onChange={(e) => setApellidoMaterno(e.target.value)}
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  placeholder="Ej. Pérez"
                />
              </div>
            </div>
            <div>
              <label htmlFor="onboarding-nombre" className="block text-sm font-medium text-muted mb-1">¿Cómo quieres que te vean tus estudiantes?</label>
              <input
                id="onboarding-nombre"
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                placeholder="Ej. Profa. Laura García"
              />
              <p className="text-sm text-muted mt-1">Puede ser distinto a tu nombre real — un apodo, un título, como prefieras.</p>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {saving ? <Spinner size="sm" /> : null}
              {saving ? 'Guardando…' : 'Entrar al panel'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
