import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { GraduationCap } from 'lucide-react'
import PasswordInput from '../../components/PasswordInput'
import { createTeacherAccount } from '../../utils/teacherAccount'

function GoogleIcon(props) {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" {...props}>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.6 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.5 29.6 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 7.1 29.6 5 24 5c-7.7 0-14.3 4.4-17.7 10.7z"/>
      <path fill="#4CAF50" d="M24 43.5c5.5 0 10.4-1.9 14.2-5.1l-6.6-5.4C29.6 34.7 26.9 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.6 5.1C9.6 39.1 16.3 43.5 24 43.5z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.7l6.6 5.4C41.6 35.7 43.5 30.3 43.5 24c0-1.2-.1-2.4-.4-3.5z"/>
    </svg>
  )
}

export default function TeacherLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  async function landNewOrExistingAccount(user) {
    const ref = doc(db, 'users', user.uid)
    const snap = await getDoc(ref)
    if (!snap.exists()) {
      await createTeacherAccount(user.uid, user.email, user.photoURL || null)
    }
    navigate('/dashboard')
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true)
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider())
      await landNewOrExistingAccount(result.user)
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
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
          <div className="w-16 h-16 rounded-card bg-blue-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-on-surface">Evalúa Fácil</h1>
          <p className="text-muted text-sm mt-1">Evidencias y calificaciones. Sin complicaciones.</p>
        </div>

        <div className="bg-surface-card rounded-card shadow-card p-6 space-y-4">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
            className="w-full py-3 border border-outline-variant rounded font-semibold text-sm text-on-surface hover:bg-surface transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {googleLoading ? <Spinner size="sm" /> : <GoogleIcon />}
            {googleLoading ? 'Conectando…' : 'Continuar con Google'}
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-outline-variant" />
            <span className="text-xs text-slate-400">o</span>
            <div className="flex-1 h-px bg-outline-variant" />
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Correo electrónico</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-3 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm bg-surface"
                placeholder="nombre@correo.com"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-muted">Contraseña</label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={resetLoading}
                  className="text-xs text-blue-600 hover:underline disabled:opacity-60"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-4 py-3 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm bg-surface"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? <Spinner size="sm" /> : null}
              {loading ? 'Entrando…' : 'Iniciar sesión'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-muted mt-6">
          ¿No tienes cuenta?{' '}
          <Link to="/register" className="text-blue-600 font-semibold hover:underline">Crear cuenta</Link>
        </p>
        <p className="text-center text-sm text-slate-400 mt-3">
          ¿Eres alumno?{' '}
          <Link to="/alumno" className="text-muted hover:underline">Acceso de alumnos</Link>
        </p>
      </div>
    </div>
  )
}
