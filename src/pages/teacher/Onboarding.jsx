import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { GraduationCap } from 'lucide-react'

export default function Onboarding() {
  const { currentUser, setUserProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [nombre, setNombre] = useState('')
  const [saving, setSaving] = useState(false)

  async function finish(e) {
    e.preventDefault()
    if (!nombre.trim()) { toast('Escribe cómo quieres que te vean tus alumnos', 'error'); return }
    setSaving(true)
    try {
      const updates = { nombreMostrar: nombre.trim(), profileComplete: true }
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
          <div className="w-16 h-16 rounded-card bg-blue-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-on-surface">Un último paso</h1>
          <p className="text-muted text-sm mt-1">Así te verán tus alumnos</p>
        </div>

        <div className="bg-surface-card rounded-card shadow-card p-6">
          <form onSubmit={finish} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted mb-1">¿Cómo quieres que te vean tus alumnos?</label>
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
                autoFocus
                className="w-full px-4 py-3 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface"
                placeholder="Ej. Profa. Laura García"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
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
