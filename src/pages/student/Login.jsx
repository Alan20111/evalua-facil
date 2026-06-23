import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth'
import { collection, query, where, getDocs, doc, setDoc, updateDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import Spinner from '../../components/Spinner'
import { studentEmail } from '../../utils/generate'
import { GraduationCap, Hash, ChevronDown } from 'lucide-react'
import PasswordInput from '../../components/PasswordInput'

export default function StudentLogin() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Manual access-code entry for first-time activation
  const [showCodeSection, setShowCodeSection] = useState(false)
  const [codeInput, setCodeInput] = useState('')

  const navigate = useNavigate()

  // Marks the student doc + users doc as activated and routes in.
  async function finishAccess(docId, student, authUser) {
    await Promise.all([
      setDoc(doc(db, 'users', authUser.uid), {
        role: 'alumno',
        username: student.username,
        escuelaId: student.escuelaId,
        studentId: docId,
        nombre: student.nombre,
        apellidoPaterno: student.apellidoPaterno,
        apellidoMaterno: student.apellidoMaterno,
      }, { merge: true }),
      updateDoc(doc(db, 'students', docId), { activado: true, uid: authUser.uid, resetPassword: null }),
    ])
    navigate('/alumno/dashboard')
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const uname = username.trim().toUpperCase()
      const stuSnap = await getDocs(
        query(collection(db, 'students'), where('username', '==', uname))
      )
      if (stuSnap.empty) {
        setError('Usuario no encontrado. Verifica tu username o activa tu cuenta con el código.')
        return
      }
      const docId = stuSnap.docs[0].id
      const student = stuSnap.docs[0].data()
      const email = studentEmail(uname, student.escuelaId)

      // Already activated → normal sign-in.
      if (student.activado) {
        await signInWithEmailAndPassword(auth, email, password)
        navigate('/alumno/dashboard')
        return
      }

      // First-time access from the login screen: no separate activation step, no
      // re-typing. The password they enter here becomes their password.
      if (password.length < 6) {
        setError('Tu contraseña debe tener al menos 6 caracteres.')
        return
      }
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password)
        await finishAccess(docId, student, cred.user)
      } catch (err2) {
        if (err2.code === 'auth/email-already-in-use') {
          // Account already exists (e.g. enrolled in another subject) → sign in.
          const cred = await signInWithEmailAndPassword(auth, email, password)
          await finishAccess(docId, student, cred.user)
        } else {
          throw err2
        }
      }
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setError('Contraseña incorrecta.')
      } else {
        setError('Error al iniciar sesión. Intenta de nuevo.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleActivateWithCode = (e) => {
    e.preventDefault()
    const code = codeInput.trim().toUpperCase()
    if (!code) return
    navigate(`/activate/${code}`)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-card bg-accent flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-on-surface">Acceso Alumnos</h1>
          <p className="text-muted text-sm mt-1">Evalúa Fácil</p>
        </div>

        {/* ── Login form ── */}
        <div className="bg-surface-card rounded-card shadow-card p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value.toUpperCase()); setError('') }}
                required
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="w-full px-4 py-3 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface font-mono tracking-widest text-center text-lg"
                placeholder="Ej: MERK"
                maxLength={8}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Contraseña</label>
              <PasswordInput
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError('') }}
                required
                className="w-full px-4 py-3 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                placeholder="••••••••"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2.5">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? <Spinner size="sm" /> : null}
              {loading ? 'Entrando…' : 'Iniciar sesión'}
            </button>
          </form>
        </div>

        {/* ── First-time activation ── */}
        <div className="mt-4 bg-surface-card rounded-card shadow-card overflow-hidden">
          <button
            type="button"
            onClick={() => setShowCodeSection((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 text-left"
          >
            <span className="text-sm font-semibold text-muted">¿Primera vez? Activa tu cuenta</span>
            <ChevronDown
              size={17}
              className={`text-slate-400 transition-transform duration-200 ${showCodeSection ? 'rotate-180' : ''}`}
            />
          </button>

          {showCodeSection && (
            <div className="px-5 pb-5 border-t border-outline-variant pt-4">
              <p className="text-xs text-muted mb-3 leading-relaxed">
                Escanea el <strong>código QR</strong> de tu asignatura, abre el <strong>link</strong> que te compartió tu maestro, o ingresa el <strong>código de acceso</strong> de 6 caracteres:
              </p>
              <form onSubmit={handleActivateWithCode} className="flex gap-2">
                <input
                  type="text"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={8}
                  placeholder="Ej: A3B7K2"
                  className="flex-1 px-4 py-3 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface font-mono tracking-widest text-center"
                />
                <button
                  type="submit"
                  disabled={!codeInput.trim()}
                  className="px-4 py-3 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
                >
                  <Hash size={16} />
                  Ir
                </button>
              </form>
            </div>
          )}
        </div>

        <p className="text-center text-sm text-slate-400 mt-4">
          ¿Eres docente?{' '}
          <Link to="/docente" className="text-accent hover:underline">Acceso docentes</Link>
        </p>

        <p className="text-center text-xs text-slate-400 mt-5 px-2">
          Tu maestro te otorgará tus datos de acceso.
        </p>
      </div>
    </div>
  )
}
