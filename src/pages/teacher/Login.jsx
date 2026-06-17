import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { GraduationCap } from 'lucide-react'
import PasswordInput from '../../components/PasswordInput'

export default function TeacherLogin() {
  const location = useLocation()
  const emailReminderEmail = location.state?.showEmailReminder ? location.state.email : null

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      // Lookup email by username
      const snap = await getDocs(
        query(collection(db, 'users'), where('username', '==', username.trim()))
      )
      if (snap.empty) {
        toast('Usuario o contraseña incorrectos', 'error')
        return
      }
      const userEmail = snap.docs[0].data().email
      await signInWithEmailAndPassword(auth, userEmail, password)
      navigate('/dashboard')
    } catch (err) {
      toast(
        err.code === 'auth/invalid-credential'
          ? 'Usuario o contraseña incorrectos'
          : 'Error al iniciar sesión',
        'error'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-slate-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Evalúa Fácil</h1>
          <p className="text-slate-500 text-sm mt-1">Evidencias y calificaciones. Sin complicaciones.</p>
        </div>

        {emailReminderEmail && (
          <div className="mb-4 flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3">
            <span className="text-blue-500 text-lg mt-0.5">✉</span>
            <p className="text-sm text-blue-700 leading-relaxed">
              Tu nombre de usuario fue enviado a <strong>{emailReminderEmail}</strong>.
              Revisa tu bandeja de entrada.
            </p>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Usuario</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm bg-slate-50"
                placeholder="Ej. 110010-01"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Contraseña</label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm bg-slate-50"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? <Spinner size="sm" /> : null}
              {loading ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-slate-500 mt-6">
          ¿No tienes cuenta?{' '}
          <Link to="/register" className="text-blue-600 font-semibold hover:underline">Crear cuenta</Link>
        </p>
        <p className="text-center text-sm text-slate-400 mt-3">
          ¿Eres alumno?{' '}
          <Link to="/alumno" className="text-slate-500 hover:underline">Acceso de alumnos</Link>
        </p>
      </div>
    </div>
  )
}
