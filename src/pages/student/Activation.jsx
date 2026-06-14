import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  setDoc,
  doc,
} from 'firebase/firestore'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { auth, db } from '../../firebase'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { studentEmail } from '../../utils/generate'
import { GraduationCap, Check } from 'lucide-react'
import PasswordInput from '../../components/PasswordInput'

export default function StudentActivation() {
  const { accessCode } = useParams()
  const [subject, setSubject] = useState(null)
  const [student, setStudent] = useState(null)
  const [step, setStep] = useState('username') // 'username' | 'password'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [loading, setLoading] = useState(false)
  const [initLoading, setInitLoading] = useState(true)
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    loadSubject()
  }, [accessCode])

  async function loadSubject() {
    try {
      const q = query(collection(db, 'subjects'), where('accessCode', '==', accessCode))
      const snap = await getDocs(q)
      if (snap.empty) {
        toast('Código de acceso inválido', 'error')
        return
      }
      setSubject({ id: snap.docs[0].id, ...snap.docs[0].data() })
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setInitLoading(false)
    }
  }

  async function handleFindStudent(e) {
    e.preventDefault()
    if (!subject) return
    setLoading(true)
    try {
      const q = query(
        collection(db, 'students'),
        where('asignaturaId', '==', subject.id),
        where('username', '==', username.trim().toUpperCase())
      )
      const snap = await getDocs(q)
      if (snap.empty) {
        toast('Username no encontrado en esta asignatura', 'error')
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
    setPasswordError('')
    if (password.length < 6) {
      setPasswordError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (password !== confirmPassword) {
      setPasswordError('Las contraseñas no coinciden')
      return
    }
    setLoading(true)
    try {
      const email = studentEmail(student.username, student.escuelaId)
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      await Promise.all([
        setDoc(doc(db, 'users', cred.user.uid), {
          role: 'alumno',
          username: student.username,
          escuelaId: student.escuelaId,
          studentId: student.id,
          nombre: student.nombre,
          apellidoPaterno: student.apellidoPaterno,
          apellidoMaterno: student.apellidoMaterno,
        }),
        updateDoc(doc(db, 'students', student.id), { activado: true, uid: cred.user.uid }),
      ])
      toast('¡Cuenta activada! Bienvenido/a')
      navigate('/alumno/dashboard')
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        try {
          await signInWithEmailAndPassword(auth, studentEmail(student.username, student.escuelaId), password)
          await updateDoc(doc(db, 'students', student.id), { activado: true })
          navigate('/alumno/dashboard')
        } catch {
          setPasswordError('Esta cuenta ya existe. Usa el inicio de sesión de alumnos.')
        }
      } else {
        setPasswordError('Error al activar. Intenta de nuevo.')
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
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Activar cuenta</h1>
          {subject && (
            <p className="text-slate-500 text-sm mt-1">
              <strong>{subject.nombre}</strong> · {subject.ciclo}
            </p>
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
                  onInput={(e) => setUsername(e.target.value.toUpperCase())}
                  required
                  autoFocus
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50 font-mono tracking-widest text-center text-lg"
                  placeholder="Ej: MERK"
                  maxLength={8}
                />
              </div>
              <button
                type="button"
                onClick={handleFindStudent}
                onMouseDown={(e) => e.preventDefault()}
                disabled={loading || !username.trim()}
                style={{ touchAction: 'manipulation' }}
                className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
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
                  <PasswordInput
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setPasswordError('') }}
                    required
                    autoFocus
                    className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50 ${passwordError ? 'border-red-400' : 'border-slate-200'}`}
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Confirmar contraseña</label>
                  <PasswordInput
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError('') }}
                    required
                    className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50 ${passwordError ? 'border-red-400' : 'border-slate-200'}`}
                    placeholder="Repite tu contraseña"
                  />
                </div>
                {passwordError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                    {passwordError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleActivate}
                  onMouseDown={(e) => e.preventDefault()}
                  disabled={loading}
                  style={{ touchAction: 'manipulation' }}
                  className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
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
