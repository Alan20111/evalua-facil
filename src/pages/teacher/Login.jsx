import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  sendEmailVerification,
  signOut,
} from 'firebase/auth'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { GraduationCap, Mail } from 'lucide-react'

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.705A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.705V4.963H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.037l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.963L3.964 7.295C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}

export default function TeacherLogin() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [needsVerification, setNeedsVerification] = useState(false)
  const [verifyEmail, setVerifyEmail] = useState('')
  const [resendLoading, setResendLoading] = useState(false)
  const [resendDone, setResendDone] = useState(false)
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
      const cred = await signInWithEmailAndPassword(auth, userEmail, password)
      if (!cred.user.emailVerified) {
        await signOut(auth)
        setVerifyEmail(userEmail)
        setResendDone(false)
        setNeedsVerification(true)
        return
      }
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

  const handleGoogle = async () => {
    setGoogleLoading(true)
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider())
      const snap = await getDoc(doc(db, 'users', result.user.uid))
      navigate(snap.exists() ? '/dashboard' : '/register/school')
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        if (auth.currentUser) await signOut(auth).catch(() => {})
        toast('Error al iniciar con Google', 'error')
      }
    } finally {
      setGoogleLoading(false)
    }
  }

  const handleResend = async () => {
    setResendLoading(true)
    try {
      const cred = await signInWithEmailAndPassword(auth, verifyEmail, password)
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
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
              <Mail size={24} className="text-amber-500" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Verifica tu correo</h2>
            <p className="text-sm text-slate-500">
              Enviamos un enlace de verificación a <strong>{verifyEmail}</strong>.
              Ábrelo y regresa aquí para iniciar sesión.
            </p>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendLoading || resendDone}
              className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {resendLoading ? <Spinner size="sm" /> : null}
              {resendDone ? 'Correo enviado ✓' : 'Reenviar correo de verificación'}
            </button>
            <button
              type="button"
              onClick={() => setNeedsVerification(false)}
              className="w-full py-3 bg-slate-100 text-slate-700 font-semibold rounded-xl hover:bg-slate-200 transition-colors"
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
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Evalúa Fácil</h1>
          <p className="text-slate-500 text-sm mt-1">Evidencias y calificaciones. Sin complicaciones.</p>
        </div>

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
              <input
                type="password"
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

          {/* Minimal Google button */}
          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={handleGoogle}
              disabled={googleLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-slate-500 text-xs hover:bg-slate-50 transition-colors disabled:opacity-60"
            >
              {googleLoading ? <Spinner size="sm" /> : <GoogleIcon />}
              Google
            </button>
          </div>
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
