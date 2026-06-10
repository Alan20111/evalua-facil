import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { studentEmail } from '../../utils/generate'
import { GraduationCap } from 'lucide-react'

export default function StudentLogin() {
  const [username, setUsername] = useState('')
  const [claveSEP, setClaveSEP] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      // 1. Find school by claveSEP
      const schoolSnap = await getDocs(
        query(collection(db, 'schools'), where('claveSEP', '==', claveSEP.trim().toUpperCase()))
      )
      if (schoolSnap.empty) {
        toast('Escuela no encontrada', 'error')
        return
      }
      const schoolId = schoolSnap.docs[0].id

      // 2. Find student by username + school
      const stuSnap = await getDocs(
        query(
          collection(db, 'students'),
          where('escuelaId', '==', schoolId),
          where('username', '==', username.trim().toUpperCase())
        )
      )
      if (stuSnap.empty) {
        toast('Usuario no encontrado', 'error')
        return
      }
      const student = stuSnap.docs[0].data()
      if (!student.activado) {
        toast('Cuenta no activada. Escanea el QR de tu grupo.', 'error')
        return
      }

      // 3. Sign in with generated email
      const email = studentEmail(username.trim().toUpperCase(), schoolId)
      await signInWithEmailAndPassword(auth, email, password)
      navigate('/alumno/dashboard')
    } catch (err) {
      if (err.code === 'auth/invalid-credential') {
        toast('Contraseña incorrecta', 'error')
      } else {
        toast('Error al iniciar sesión', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-slate-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Acceso Alumnos</h1>
          <p className="text-slate-500 text-sm mt-1">Evalúa Fácil</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Clave SEP de tu escuela</label>
              <input
                type="text"
                value={claveSEP}
                onChange={(e) => setClaveSEP(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
                placeholder="Ej: CBTis 255"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toUpperCase())}
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50 font-mono tracking-widest text-center text-lg"
                placeholder="Ej: MERK"
                maxLength={8}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
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
        </div>

        <p className="text-center text-sm text-slate-400 mt-4">
          ¿Eres docente?{' '}
          <Link to="/" className="text-indigo-600 hover:underline">Acceso docentes</Link>
        </p>
        <p className="text-center text-xs text-slate-400 mt-2">
          ¿Primera vez? Escanea el QR de tu grupo para activar tu cuenta.
        </p>
      </div>
    </div>
  )
}
