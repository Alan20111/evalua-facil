import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../../firebase'
import { useToast } from '../../components/Toast'
import { createTeacherAccount } from '../../utils/teacherAccount'
import Spinner from '../../components/Spinner'
import { GraduationCap } from 'lucide-react'
import PasswordInput from '../../components/PasswordInput'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  async function handleSubmit(e) {
    e.preventDefault()
    if (password !== confirmPassword) { toast('Las contraseñas no coinciden', 'error'); return }
    if (password.length < 6) { toast('Mínimo 6 caracteres', 'error'); return }
    setLoading(true)
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      await createTeacherAccount(cred.user.uid, email)
      navigate('/dashboard')
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        toast('Este correo ya tiene cuenta. Inicia sesión.', 'error')
      } else {
        toast('Error: ' + err.message, 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-card bg-blue-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-on-surface">Crear cuenta</h1>
          <p className="text-muted text-sm mt-1">Evalúa Fácil — Docente</p>
        </div>

        <div className="bg-surface-card rounded-card shadow-card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Correo electrónico</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-3 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface"
                placeholder="nombre@correo.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted mb-1">Contraseña</label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full px-4 py-3 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface"
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Confirmar contraseña</label>
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full px-4 py-3 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface"
                placeholder="Repite la contraseña"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? <Spinner size="sm" /> : null}
              {loading ? 'Creando cuenta…' : 'Crear cuenta'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-muted mt-6">
          ¿Ya tienes cuenta?{' '}
          <Link to="/docente" className="text-blue-600 font-semibold hover:underline">Iniciar sesión</Link>
        </p>
      </div>
    </div>
  )
}
