import { useState, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  setDoc,
  doc,
} from 'firebase/firestore'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updatePassword } from 'firebase/auth'
import { auth, db } from '../../firebase'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { studentEmail } from '../../utils/generate'
import { GraduationCap, Check } from 'lucide-react'
import PasswordInput from '../../components/PasswordInput'

export default function StudentActivation() {
  const { accessCode } = useParams()
  const location = useLocation()
  const [subject, setSubject] = useState(null)
  const [student, setStudent] = useState(null)
  const [step, setStep] = useState('username') // 'username' | 'password' | 'link_existing'
  const [username, setUsername] = useState(location.state?.prefillUsername ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [linkPassword, setLinkPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [initLoading, setInitLoading] = useState(true)
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    loadSubject()
  }, [accessCode])

  // Auto-advance to password step when prefillUsername is set (teacher reset flow)
  useEffect(() => {
    const pre = location.state?.prefillUsername
    if (!pre || !subject) return
    async function autoFind() {
      try {
        const q = query(
          collection(db, 'students'),
          where('asignaturaId', '==', subject.id),
          where('username', '==', pre)
        )
        const snap = await getDocs(q)
        if (!snap.empty) {
          setStudent({ id: snap.docs[0].id, ...snap.docs[0].data() })
          setStep('password')
        }
      } catch {
        // fall through to manual entry
      }
    }
    autoFind()
  }, [subject])

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
        toast('Esta materia ya está en tu cuenta. Inicia sesión.')
        navigate('/alumno')
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
        // Re-activation flow: teacher reset the password, student gets a new one
        if (student.resetPassword) {
          try {
            const email = studentEmail(student.username, student.escuelaId)
            const cred = await signInWithEmailAndPassword(auth, email, student.resetPassword)
            await updatePassword(cred.user, password)
            await updateDoc(doc(db, 'students', student.id), {
              activado: true,
              uid: cred.user.uid,
              resetPassword: null,
            })
            toast('¡Contraseña actualizada! Bienvenido/a de nuevo')
            navigate('/alumno/dashboard')
          } catch {
            setPasswordError('Error al restablecer. Verifica que el código sea correcto o pide a tu maestro que vuelva a restablecerla.')
          }
        } else {
          // Account exists from another subject — ask them to link with their current password
          setStep('link_existing')
          setPassword('')
          setConfirmPassword('')
          setPasswordError('')
        }
      } else {
        setPasswordError('Error al activar. Intenta de nuevo.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleLinkExisting(e) {
    e.preventDefault()
    setPasswordError('')
    if (!linkPassword) return
    setLoading(true)
    try {
      const email = studentEmail(student.username, student.escuelaId)
      const cred = await signInWithEmailAndPassword(auth, email, linkPassword)
      await updateDoc(doc(db, 'students', student.id), { activado: true, uid: cred.user.uid })
      toast('¡Materia agregada a tu cuenta!')
      navigate('/alumno/dashboard')
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setPasswordError('Contraseña incorrecta. Intenta de nuevo.')
      } else {
        setPasswordError('Error al conectar. Intenta de nuevo.')
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
          {step === 'link_existing' ? (
            <div>
              <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl mb-4">
                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
                  <Check size={16} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Ya tienes cuenta</p>
                  <p className="text-xs text-slate-500">Escribe tu contraseña para agregar esta materia</p>
                </div>
              </div>
              <form onSubmit={handleLinkExisting} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tu contraseña actual</label>
                  <PasswordInput
                    value={linkPassword}
                    onChange={(e) => { setLinkPassword(e.target.value); setPasswordError('') }}
                    required
                    autoFocus
                    className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50 ${passwordError ? 'border-red-400' : 'border-slate-200'}`}
                    placeholder="Tu contraseña de Evalúa Fácil"
                  />
                </div>
                {passwordError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                    {passwordError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleLinkExisting}
                  onMouseDown={(e) => e.preventDefault()}
                  disabled={loading || !linkPassword}
                  style={{ touchAction: 'manipulation' }}
                  className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {loading ? <Spinner size="sm" /> : <Check size={16} />}
                  {loading ? 'Vinculando…' : 'Agregar materia'}
                </button>
              </form>
            </div>
          ) : step === 'username' ? (
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

        <p className="text-center text-xs text-slate-400 mt-5">
          ¿Ya tienes cuenta?{' '}
          <button
            type="button"
            onClick={() => navigate('/alumno')}
            className="underline hover:text-slate-600 transition-colors"
          >
            Accede por aquí
          </button>
        </p>
      </div>
    </div>
  )
}
