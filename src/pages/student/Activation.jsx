import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  doc,
} from 'firebase/firestore'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { auth, db } from '../../firebase'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { studentEmail, usernameCandidates } from '../../utils/generate'
import { GraduationCap, Check } from 'lucide-react'
import EFLogo from '../../components/EFLogo'
import PasswordInput from '../../components/PasswordInput'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectPeriodLabel } from '../../utils/dateRange'

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
  const [loadError, setLoadError] = useState('')
  const submitting = useRef(false) // guards against double-submit (rapid taps)
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    loadSubject()
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps -- mount-only intencional
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
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps -- mount-only intencional
  }, [subject])

  async function loadSubject() {
    try {
      const q = query(collection(db, 'subjects'), where('accessCode', '==', accessCode))
      const snap = await getDocs(q)
      if (snap.empty) {
        setLoadError('No encontramos ninguna asignatura con ese código de acceso. Revisa el código o el QR con tu maestro.')
        return
      }
      setSubject({ id: snap.docs[0].id, ...snap.docs[0].data() })
    } catch {
      setLoadError('No pudimos cargar la asignatura. Revisa tu conexión e intenta de nuevo.')
    } finally {
      setInitLoading(false)
    }
  }

  async function handleFindStudent(e) {
    e.preventDefault()
    if (!subject) return
    setLoading(true)
    try {
      // Legacy codes are UPPERCASE, new ones lowercase — search both
      const snaps = await Promise.all(usernameCandidates(username).map((u) =>
        getDocs(query(
          collection(db, 'students'),
          where('asignaturaId', '==', subject.id),
          where('username', '==', u)
        ))
      ))
      const found = snaps.flatMap((s) => s.docs)
      if (found.length === 0) {
        toast('Username no encontrado en esta asignatura', 'error')
        return
      }
      const data = { id: found[0].id, ...found[0].data() }
      if (data.activado) {
        toast('Esta asignatura ya está en tu cuenta. Inicia sesión.')
        navigate('/alumno')
        return
      }
      setStudent(data)
      setPasswordError('')
      setStep('password')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Links a student record to an auth account and routes to the dashboard.
  // NOTE: students live in the `students` collection, NOT `users`. We do NOT create a
  // users/{uid} doc for alumnos — the firestore rules only allow creating users docs with
  // role 'docente', and AuthContext already resolves the student profile from the
  // `students` collection via the @evalua.local email. Writing users/{uid} here used to
  // throw AFTER the auth account was created, showing a spurious error on first activation.
  async function finishActivation(authUser) {
    // Propagate the uid + activated flag to ALL of this student's enrollments (same username
    // + school) so every subject they belong to shows up, not just the one activated here.
    const snap = await getDocs(query(
      collection(db, 'students'),
      where('username', '==', student.username),
      where('escuelaId', '==', student.escuelaId),
    ))
    const batch = writeBatch(db)
    snap.forEach((d) => batch.update(doc(db, 'students', d.id), {
      activado: true,
      uid: authUser.uid,
      resetPassword: null,
    }))
    // Safety: ensure the matched doc is updated even if the query is momentarily stale.
    if (!snap.docs.some((d) => d.id === student.id)) {
      batch.update(doc(db, 'students', student.id), { activado: true, uid: authUser.uid, resetPassword: null })
    }
    await batch.commit()
    navigate('/alumno/dashboard')
  }

  async function handleActivate(e) {
    e.preventDefault()
    if (submitting.current) return
    setPasswordError('')
    if (password.length < 6) {
      setPasswordError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (password !== confirmPassword) {
      setPasswordError('Las contraseñas no coinciden')
      return
    }
    submitting.current = true
    setLoading(true)
    const email = studentEmail(student.username, student.escuelaId)
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      await finishActivation(cred.user)
      toast('¡Cuenta activada! Bienvenido/a')
    } catch (err) {
      if (err.code !== 'auth/email-already-in-use') {
        setPasswordError('Error al activar. Intenta de nuevo.')
        return
      }
      // An auth account with this email already exists. Decide if it belongs to THIS
      // student (double-submit, re-activation, or returning student) and log in directly
      // when possible — only fall back to the "ya tienes cuenta" screen as a last resort.
      let cred = null
      // Try the password they just typed (covers a double-tap that already created the
      // account, and a returning student who reused their real password). A forgotten
      // password is NOT handled here — that goes through "Recuperar contraseña" on /alumno.
      try {
        cred = await signInWithEmailAndPassword(auth, email, password)
      } catch { /* not their current password */ }
      if (cred) {
        try {
          await finishActivation(cred.user)
          toast('¡Listo! Bienvenido/a')
        } catch {
          setPasswordError('Error al activar. Intenta de nuevo.')
        }
        return
      }
      // 3) The account exists with a different password → returning student. Ask for it.
      setStep('link_existing')
      setPassword('')
      setConfirmPassword('')
      setPasswordError('')
    } finally {
      submitting.current = false
      setLoading(false)
    }
  }

  async function handleLinkExisting(e) {
    e.preventDefault()
    if (submitting.current) return
    setPasswordError('')
    if (!linkPassword) return
    submitting.current = true
    setLoading(true)
    try {
      const email = studentEmail(student.username, student.escuelaId)
      const cred = await signInWithEmailAndPassword(auth, email, linkPassword)
      await finishActivation(cred.user)
      toast('¡Asignatura agregada a tu cuenta!')
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setPasswordError('Contraseña incorrecta. Intenta de nuevo.')
      } else {
        setPasswordError('Error al conectar. Intenta de nuevo.')
      }
    } finally {
      submitting.current = false
      setLoading(false)
    }
  }

  if (initLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  )

  if (!subject) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface">
      <div className="w-full max-w-sm text-center">
        <div className="w-16 h-16 rounded-card bg-red-100 flex items-center justify-center mx-auto mb-3">
          <GraduationCap size={32} className="text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-on-surface mb-2">Código no válido</h1>
        <p className="text-muted text-sm mb-6">
          {loadError || 'No encontramos una asignatura con ese código de acceso.'}
        </p>
        <button
          type="button"
          onClick={() => navigate('/alumno')}
          className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors"
        >
          Volver al inicio
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <EFLogo className="mx-auto w-52 sm:w-60 h-auto mb-3" />
          <h1 className="text-2xl font-bold text-on-surface">Activar cuenta</h1>
          {subject && (
            <p className="text-muted text-sm mt-1 break-words">
              <strong>{subjectDisplayName(subject)}</strong>
              {subjectPeriodLabel(subject) && ` · ${subjectPeriodLabel(subject)}`}
            </p>
          )}
        </div>

        <div className="bg-surface-card rounded-card shadow-card p-5">
          {step === 'link_existing' ? (
            <div>
              <div className="flex items-center gap-3 p-3 bg-accent-light rounded mb-3">
                <div className="w-9 h-9 rounded-full bg-accent-light flex items-center justify-center flex-shrink-0">
                  <Check size={18} className="text-accent" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-on-surface">Ya tienes cuenta</p>
                  <p className="text-xs text-muted">Escribe tu contraseña para agregar esta asignatura</p>
                </div>
              </div>
              <form onSubmit={handleLinkExisting} className="space-y-3">
                <div>
                  <label htmlFor="activation-link-password" className="block text-sm font-medium text-muted mb-1">Tu contraseña actual</label>
                  <PasswordInput
                    id="activation-link-password"
                    value={linkPassword}
                    onChange={(e) => { setLinkPassword(e.target.value); setPasswordError('') }}
                    required
                    // autoFocus intencional: único campo de este paso (contraseña para vincular cuenta existente),
                    // se muestra una sola vez por sesión de activación — no es un modal reabrible.
                    autoFocus
                    className={`w-full px-4 py-2.5 rounded border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface ${passwordError ? 'border-red-400' : 'border-outline-variant'}`}
                    placeholder="Tu contraseña de Evalúa Fácil"
                  />
                </div>
                {passwordError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2.5">
                    {passwordError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleLinkExisting}
                  onMouseDown={(e) => e.preventDefault()}
                  disabled={loading || !linkPassword}
                  style={{ touchAction: 'manipulation' }}
                  className="w-full py-2.5 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {loading ? <Spinner size="sm" /> : <Check size={18} />}
                  {loading ? 'Vinculando…' : 'Agregar asignatura'}
                </button>
              </form>
            </div>
          ) : step === 'username' ? (
            <form onSubmit={handleFindStudent} className="space-y-3">
              <div>
                <p className="text-sm text-muted mb-3">
                  Introduce tu <strong>username</strong> (tu maestro te lo proporcionó).
                </p>
                <label htmlFor="activation-username" className="block text-sm font-medium text-muted mb-1">Username</label>
                <input
                  id="activation-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  // autoFocus intencional: único campo de este paso (buscar alumno por username),
                  // se muestra una sola vez por sesión de activación — no es un modal reabrible.
                  autoFocus
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface font-mono tracking-widest text-center text-lg"
                  placeholder="Ej: mendez.enrique"
                  maxLength={40}
                />
              </div>
              <button
                type="button"
                onClick={handleFindStudent}
                onMouseDown={(e) => e.preventDefault()}
                disabled={loading || !username.trim()}
                style={{ touchAction: 'manipulation' }}
                className="w-full py-2.5 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading ? <Spinner size="sm" /> : null}
                {loading ? 'Buscando…' : 'Continuar'}
              </button>
            </form>
          ) : (
            <div>
              <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded mb-3">
                <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <Check size={18} className="text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-on-surface break-words">
                    {student?.apellidoPaterno} {student?.apellidoMaterno} {student?.nombre}
                  </p>
                  <p className="text-xs text-muted font-mono">{student?.username}</p>
                </div>
              </div>
              <form onSubmit={handleActivate} className="space-y-3">
                <div>
                  <label htmlFor="activation-password" className="block text-sm font-medium text-muted mb-1">Elige tu contraseña</label>
                  <PasswordInput
                    id="activation-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setPasswordError('') }}
                    required
                    // autoFocus intencional: primer campo de este paso (elegir contraseña),
                    // se muestra una sola vez por sesión de activación — no es un modal reabrible.
                    autoFocus
                    className={`w-full px-4 py-2.5 rounded border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface ${passwordError ? 'border-red-400' : 'border-outline-variant'}`}
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
                <div>
                  <label htmlFor="activation-confirm-password" className="block text-sm font-medium text-muted mb-1">Confirmar contraseña</label>
                  <PasswordInput
                    id="activation-confirm-password"
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError('') }}
                    required
                    className={`w-full px-4 py-2.5 rounded border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface ${passwordError ? 'border-red-400' : 'border-outline-variant'}`}
                    placeholder="Repite tu contraseña"
                  />
                </div>
                {passwordError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2.5">
                    {passwordError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleActivate}
                  onMouseDown={(e) => e.preventDefault()}
                  disabled={loading}
                  style={{ touchAction: 'manipulation' }}
                  className="w-full py-2.5 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {loading ? <Spinner size="sm" /> : <Check size={18} />}
                  {loading ? 'Activando…' : 'Activar cuenta'}
                </button>
              </form>
            </div>
          )}
        </div>

        <p className="text-center text-sm text-slate-500 mt-5">
          ¿Ya tienes cuenta?{' '}
          <button
            type="button"
            onClick={() => navigate('/alumno')}
            className="underline hover:text-muted transition-colors"
          >
            Accede por aquí
          </button>
        </p>
      </div>
    </div>
  )
}
