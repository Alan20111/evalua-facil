import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from 'firebase/auth'
import { auth } from '../../firebase'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import GoogleIcon from '../../components/GoogleIcon'
import EFLogo from '../../components/EFLogo'
import PasswordInput from '../../components/PasswordInput'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import { createTeacherAccountIfNew, signInWithGoogle, googleErrorInfo } from '../../utils/googleAuth'
import LinkAccountModal from '../../components/LinkAccountModal'

export default function TeacherLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [showLinkAccount, setShowLinkAccount] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  async function handleGoogleSignIn() {
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

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
      navigate('/dashboard')
    } catch (err) {
      toast(
        err.code === 'auth/invalid-credential'
          ? 'Correo o contraseña incorrectos'
          : 'Error al iniciar sesión',
        'error'
      )
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      toast('Escribe tu correo primero', 'error')
      return
    }
    if (resetLoading) return // guard against double-submit issuing two reset links at once
    setResetLoading(true)
    try {
      await sendPasswordResetEmail(auth, email.trim(), {
        url: `${window.location.origin}/reset-password`,
      })
    } catch {
      // Intentionally silent — don't reveal whether the email exists.
    } finally {
      setResetLoading(false)
    }
    toast('Si el correo existe, te enviamos un enlace para restablecer tu contraseña')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {/* Logotipo completo de la marca (icono + nombre + subtítulo) */}
          <EFLogo className="mx-auto w-56 sm:w-64 h-auto mb-3" />
          <h1 className="text-2xl font-bold text-on-surface">Acceso Docentes</h1>
        </div>

        <div className="bg-surface-card rounded-card shadow-card p-5 space-y-3">
          <Button variant="secondary" fullWidth onClick={handleGoogleSignIn} disabled={googleLoading}>
            {googleLoading ? <Spinner size="sm" /> : <GoogleIcon />}
            {googleLoading ? 'Conectando…' : 'Continuar con Google'}
          </Button>

          <button
            type="button"
            onClick={() => setShowLinkAccount(true)}
            className="w-full text-center text-xs text-accent hover:underline"
          >
            ¿Normalmente entras con Google y hoy usarás otra computadora?
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-outline-variant" />
            <span className="text-sm text-slate-500">o</span>
            <div className="flex-1 h-px bg-outline-variant" />
          </div>

          <form onSubmit={handleLogin} className="space-y-3">
            <Input
              label="Correo electrónico"
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="focus:border-transparent"
              placeholder="nombre@correo.com"
            />
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="login-password" className="block text-sm font-medium text-muted">Contraseña</label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={resetLoading}
                  className="text-xs text-accent hover:underline disabled:opacity-60"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <PasswordInput
                id="login-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus:border-transparent text-sm bg-surface"
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" fullWidth busy={loading}>
              {loading ? 'Entrando…' : 'Iniciar sesión'}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-muted mt-6">
          ¿No tienes cuenta de docente?{' '}
          <Link to="/register" className="text-accent font-semibold hover:underline">Crear cuenta de docente</Link>
        </p>
        <p className="text-center text-sm text-muted mt-2">
          ¿Eres estudiante?{' '}
          <Link to="/alumno" className="text-accent font-semibold hover:underline">Entra aquí</Link>
        </p>
        <p className="text-center text-sm text-muted mt-2">
          ¿Usas Android?{' '}
          {/* Ruta fija: resuelve sola a la versión de producción vigente, así que
              publicar una versión nueva desde el panel de admin actualiza este
              enlace sin tocar código. Ver src/pages/DescargaApp.jsx. */}
          <Link to="/descargar" className="text-accent font-semibold hover:underline">Descarga la app</Link>
        </p>
        <p className="text-center text-xs text-slate-400 mt-4">
          Para una mejor experiencia recomendamos utilizar Evalúa Fácil Docente desde una laptop o computadora de escritorio.
        </p>
      </div>

      {showLinkAccount && <LinkAccountModal onClose={() => setShowLinkAccount(false)} />}
    </div>
  )
}
