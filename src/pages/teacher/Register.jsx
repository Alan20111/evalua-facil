import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../../firebase'
import { useToast } from '../../components/Toast'
import { createTeacherAccount } from '../../utils/teacherAccount'
import { createTeacherAccountIfNew, signInWithGoogle, googleErrorInfo } from '../../utils/googleAuth'
import Spinner from '../../components/Spinner'
import GoogleIcon from '../../components/GoogleIcon'
import EFLogo from '../../components/EFLogo'
import PasswordInput from '../../components/PasswordInput'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import { useBackHandler } from '../../hooks/useBackHandler'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  // Botón físico de Android: hace lo mismo que el enlace "Iniciar sesión" de
  // abajo. Sin esto, atrás caía en "presiona de nuevo para salir" y la única
  // salida de la pantalla de registro era cerrar la app.
  useBackHandler(() => navigate('/docente'))

  async function handleGoogleSignUp() {
    setGoogleLoading(true)
    try {
      const user = await signInWithGoogle()
      await createTeacherAccountIfNew(user)
      navigate('/dashboard')
    } catch (err) {
      const { cancelled, message } = googleErrorInfo(err)
      if (!cancelled) toast(message, 'error')
    } finally {
      setGoogleLoading(false)
    }
  }

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
        toast('Este correo ya tiene cuenta (quizá con Google). Inicia sesión.', 'error')
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
          <EFLogo className="mx-auto w-52 sm:w-60 h-auto mb-3" />
          <h1 className="text-2xl font-bold text-on-surface">Crear cuenta</h1>
        </div>

        <div className="bg-surface-card rounded-card shadow-card p-5 space-y-3">
          <Button variant="secondary" fullWidth onClick={handleGoogleSignUp} disabled={googleLoading}>
            {googleLoading ? <Spinner size="sm" /> : <GoogleIcon />}
            {googleLoading ? 'Conectando…' : 'Continuar con Google'}
          </Button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-outline-variant" />
            <span className="text-sm text-slate-500">o</span>
            <div className="flex-1 h-px bg-outline-variant" />
          </div>

          <p className="text-xs font-semibold text-muted uppercase tracking-wide">Crear cuenta con correo electrónico</p>

          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              label="Correo electrónico"
              id="register-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="nombre@correo.com"
            />

            <div>
              <label htmlFor="register-password" className="block text-sm font-medium text-muted mb-1">Contraseña</label>
              <PasswordInput
                id="register-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div>
              <label htmlFor="register-confirm-password" className="block text-sm font-medium text-muted mb-1">Confirmar contraseña</label>
              <PasswordInput
                id="register-confirm-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                placeholder="Repite la contraseña"
              />
            </div>

            <Button type="submit" fullWidth busy={loading}>
              {loading ? 'Creando cuenta…' : 'Crear cuenta'}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-muted mt-6">
          ¿Ya tienes cuenta?{' '}
          <Link to="/docente" className="text-accent font-semibold hover:underline">Iniciar sesión</Link>
        </p>
      </div>
    </div>
  )
}
