import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  sendEmailVerification,
  signOut,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { GraduationCap, Mail, ArrowLeft } from 'lucide-react'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.705A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.705V4.963H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.037l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.963L3.964 7.295C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}

export default function TeacherLogin() {
  const [method, setMethod] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [needsVerification, setNeedsVerification] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [resendDone, setResendDone] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  const handleEmail = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password)
      if (!cred.user.emailVerified) {
        await signOut(auth)
        setResendDone(false)
        setNeedsVerification(true)
        return
      }
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

  const handleGoogle = async () => {
    setLoading(true)
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider())
      const snap = await getDoc(doc(db, 'users', result.user.uid))
      navigate(snap.exists() ? '/dashboard' : '/register/school')
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user') {
        // user dismissed the popup — nothing to report
      } else {
        // If the popup succeeded but the profile lookup failed, the user is left
        // authenticated with no profile (blank screen). Sign back out to recover.
        if (auth.currentUser) await signOut(auth).catch(() => {})
        toast('Error al iniciar con Google', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResendLoading(true)
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password)
      await sendEmailVerification(cred.user)
      await signOut(auth)
      setResendDone(true)
      toast('Correo de verificación reenviado')
    } catch {
      toast('Error al reenviar el correo', 'error')
    } finally {
      setResendLoading(false)
    }
  }

  if (needsVerification) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-slate-50">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
              <Mail size={24} className="text-amber-500" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Verifica tu correo</h2>
            <p className="text-sm text-slate-500 mb-6">
              Enviamos un enlace de verificación a <strong>{email}</strong>.
              Ábrelo y regresa aquí para iniciar sesión.
            </p>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendLoading || resendDone}
              className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {resendLoading ? <Spinner size="sm" /> : null}
              {resendDone ? 'Correo enviado ✓' : 'Reenviar correo de verificación'}
            </button>
            <button
              type="button"
              onClick={() => setNeedsVerification(false)}
              className="w-full mt-3 py-3 bg-slate-100 text-slate-700 font-semibold rounded-xl hover:bg-slate-200 transition-colors"
            >
              Volver
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-slate-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Evalúa Fácil</h1>
          <p className="text-slate-500 text-sm mt-1">Acceso para docentes</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
          {method === null ? (
            <>
              {/* Google */}
              <div>
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={loading}
                  className="w-full py-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2 shadow-sm"
                >
                  {loading ? <Spinner size="sm" /> : <GoogleIcon />}
                  Continuar con Google
                </button>
                <p className="text-center text-xs text-slate-400 mt-2">
                  Recomendado para uso en un solo equipo
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400">o</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              {/* Email */}
              <div>
                <button
                  type="button"
                  onClick={() => setMethod('email')}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <Mail size={18} />
                  Acceso con correo electrónico
                </button>
                <p className="text-center text-xs text-slate-400 mt-2">
                  Recomendado para uso en varios equipos
                </p>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setMethod(null)}
                className="flex items-center gap-1.5 text-slate-400 hover:text-slate-600 text-sm -mb-1"
              >
                <ArrowLeft size={15} /> Volver
              </button>
              <form onSubmit={handleEmail} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Correo electrónico
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-slate-50"
                    placeholder="nombre@correo.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Contraseña
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-slate-50"
                    placeholder="••••••••"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {loading ? <Spinner size="sm" /> : null}
                  {loading ? 'Entrando…' : 'Iniciar sesión'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-sm text-slate-500 mt-6">
          ¿No tienes cuenta?{' '}
          <Link to="/register" className="text-indigo-600 font-semibold hover:underline">
            Crear cuenta nueva
          </Link>
        </p>
        <p className="text-center text-sm text-slate-400 mt-3">
          ¿Eres alumno?{' '}
          <Link to="/alumno" className="text-slate-500 hover:underline">
            Acceso de alumnos
          </Link>
        </p>
      </div>
    </div>
  )
}
