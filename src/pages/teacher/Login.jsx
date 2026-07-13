import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth'
import { auth } from '../../firebase'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import GoogleIcon from '../../components/GoogleIcon'
import EFLogo from '../../components/EFLogo'
import PasswordInput from '../../components/PasswordInput'
import { createTeacherAccountIfNew } from '../../utils/googleAuth'
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
      const result = await signInWithPopup(auth, new GoogleAuthProvider())
      await createTeacherAccountIfNew(result.user)
      navigate('/dashboard')
    } catch (err) {
      if (err.code === 'auth/account-exists-with-different-credential') {
        toast('Ya tienes una cuenta con este correo. Inicia sesión con tu contraseña.', 'error')
      } else if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        toast('No se pudo iniciar sesión con Google', 'error')
      }
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
          <EFLogo className="mx-auto w-56 sm:w-64 h-auto" />
        </div>

        <div className="bg-surface-card rounded-card shadow-card p-5 space-y-3">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
            className="w-full py-2.5 border border-outline-variant rounded font-semibold text-sm text-on-surface hover:bg-surface transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {googleLoading ? <Spinner size="sm" /> : <GoogleIcon />}
            {googleLoading ? 'Conectando…' : 'Continuar con Google'}
          </button>

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
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-muted mb-1">Correo electrónico</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus:border-transparent text-sm bg-surface"
                placeholder="nombre@correo.com"
              />
            </div>
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
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? <Spinner size="sm" /> : null}
              {loading ? 'Entrando…' : 'Iniciar sesión'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-muted mt-6">
          ¿No tienes cuenta de docente?{' '}
          <Link to="/register" className="text-accent font-semibold hover:underline">Crear cuenta de docente</Link>
        </p>
        <p className="text-center text-xs text-slate-400 mt-4">
          Para una mejor experiencia recomendamos utilizar Evalúa Fácil Docente desde una laptop o computadora de escritorio.
        </p>
      </div>

      {showLinkAccount && <LinkAccountModal onClose={() => setShowLinkAccount(false)} />}
    </div>
  )
}
