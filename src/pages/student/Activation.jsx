import { useState, useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  updateDoc,
  doc,
} from 'firebase/firestore'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { auth, db } from '../../firebase'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { studentEmail } from '../../utils/generate'
import { GraduationCap, Check } from 'lucide-react'

export default function StudentActivation() {
  const { accessCode } = useParams()
  const [group, setGroup] = useState(null)
  const [student, setStudent] = useState(null)
  const [step, setStep] = useState('username') // 'username' | 'password'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [initLoading, setInitLoading] = useState(true)
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    loadGroup()
  }, [accessCode])

  async function loadGroup() {
    try {
      const q = query(collection(db, 'groups'), where('accessCode', '==', accessCode))
      const snap = await getDocs(q)
      if (snap.empty) {
        toast('Código de acceso inválido', 'error')
        return
      }
      setGroup({ id: snap.docs[0].id, ...snap.docs[0].data() })
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setInitLoading(false)
    }
  }

  async function handleFindStudent(e) {
    e.preventDefault()
    if (!group) return
    setLoading(true)
    try {
      const q = query(
        collection(db, 'students'),
        where('grupoId', '==', group.id),
        where('username', '==', username.trim().toUpperCase())
      )
      const snap = await getDocs(q)
      if (snap.empty) {
        toast('Username no encontrado en este grupo', 'error')
        return
      }
      const data = { id: snap.docs[0].id, ...snap.docs[0].data() }
      if (data.activado) {
        toast('Esta cuenta ya fue activada. Usa el acceso de alumnos.', 'error')
        return
      }
      setStudent(data)
      setStep('password')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleActivate(e) {
    e.preventDefault()
    if (password !== confirmPassword) {
      toast('Las contraseñas no coinciden', 'error')
      return
    }
    if (password.length < 4) {
      toast('La contraseña debe tener al menos 4 caracteres', 'error')
      return
    }
    setLoading(true)
    try {
      const email = studentEmail(student.username, student.escuelaId)
      await createUserWithEmailAndPassword(auth, email, password)
      await updateDoc(doc(db, 'students', student.id), { activado: true })
      toast('¡Cuenta activada! Bienvenido/a')
      navigate('/alumno/dashboard')
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        // Account exists, just sign in and mark activated
        try {
          await signInWithEmailAndPassword(auth, studentEmail(student.username, student.escuelaId), password)
          await updateDoc(doc(db, 'students', student.id), { activado: true })
          navigate('/alumno/dashboard')
        } catch {
          toast('Esta cuenta ya existe. Usa el inicio de sesión de alumnos.', 'error')
        }
      } else {
        toast('Error al activar: ' + err.message, 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  if (initLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-slate-50 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Activar cuenta</h1>
          {group && (
            <p className="text-slate-500 text-sm mt-1">Grupo: <strong>{group.nombre}</strong> · {group.ciclo}</p>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          {step === 'username' ? (
            <form onSubmit={handleFindStudent} className="space-y-4">
              <div>
                <p className="text-sm text-slate-600 mb-4">
                  Introduce tu <strong>username</strong> (tu maestro te lo proporcionó).
                </p>
                <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toUpperCase())}
                  required
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50 font-mono tracking-widest text-center text-lg"
                  placeholder="Ej: MERK"
                  maxLength={8}
                />
              </div>
              <button
                type="submit"
                disabled={loading || !username.trim()}
                className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading ? <Spinner size="sm" /> : null}
                {loading ? 'Buscando…' : 'Continuar'}
              </button>
            </form>
          ) : (
            <div>
              <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded-xl mb-4">
                <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Check size={16} className="text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {student?.apellidoPaterno} {student?.apellidoMaterno} {student?.nombre}
                  </p>
                  <p className="text-xs text-slate-500 font-mono">{student?.username}</p>
                </div>
              </div>
              <form onSubmit={handleActivate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Elige tu contraseña</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
                    placeholder="Mínimo 4 caracteres"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Confirmar contraseña</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
                    placeholder="Repite tu contraseña"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {loading ? <Spinner size="sm" /> : <Check size={16} />}
                  {loading ? 'Activando…' : 'Activar cuenta'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
