import { useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth'
import { collection, query, where, getDocs, doc, documentId, writeBatch } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import Spinner from '../../components/Spinner'
import { studentEmail } from '../../utils/generate'
import { GraduationCap, Hash, ChevronDown, ArrowLeft, KeyRound } from 'lucide-react'
import PasswordInput from '../../components/PasswordInput'

export default function StudentLogin() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Manual access-code entry for first-time activation
  const [showCodeSection, setShowCodeSection] = useState(false)
  const [codeInput, setCodeInput] = useState('')

  // First-time login must confirm the subject's access code before the account
  // is created — otherwise anyone who guesses a classmate's username could
  // self-activate without ever being given that code by the teacher.
  const [step, setStep] = useState('login') // 'login' | 'need_code'
  const [pendingActivation, setPendingActivation] = useState(null)
  const [subjectCodeInput, setSubjectCodeInput] = useState('')
  const [codeError, setCodeError] = useState('')

  // Password recovery ('login' | 'recover')
  const [mode, setMode] = useState('login')
  const [recoverStep, setRecoverStep] = useState('username') // 'username' | 'password'
  const [recoverUsername, setRecoverUsername] = useState('')
  const [recoverStudent, setRecoverStudent] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [recoverError, setRecoverError] = useState('')

  const navigate = useNavigate()
  const submitting = useRef(false) // guards against double-submit (rapid taps)

  // Marks ALL of this account's enrollments (same username + school) as activated and writes
  // the uid, so every subject the student belongs to shows up — not just the one used to log
  // in. NOTE: students live in `students`, NOT `users`; AuthContext resolves the profile from
  // the @evalua.local email. We never create users/{uid} for alumnos (rules forbid it).
  async function finishAccess(uname, escuelaId, authUser) {
    const snap = await getDocs(query(
      collection(db, 'students'),
      where('username', '==', uname),
      where('escuelaId', '==', escuelaId),
    ))
    const batch = writeBatch(db)
    snap.forEach((d) => batch.update(doc(db, 'students', d.id), {
      activado: true,
      uid: authUser.uid,
      resetPassword: null,
    }))
    await batch.commit()
    navigate('/alumno/dashboard')
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    if (submitting.current) return
    setError(''); submitting.current = true; setLoading(true)
    try {
      const uname = username.trim().toUpperCase()
      const stuSnap = await getDocs(
        query(collection(db, 'students'), where('username', '==', uname))
      )
      if (stuSnap.empty) {
        setError('Usuario no encontrado. Verifica tu username o activa tu cuenta con el código.')
        return
      }
      const docs = stuSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

      // A username can repeat across schools, so each school is a different account/email.
      // For already-activated accounts, try sign-in against each school's email — the correct
      // password authenticates exactly one of them.
      const activatedSchools = [...new Set(docs.filter((d) => d.activado).map((d) => d.escuelaId))]
      if (activatedSchools.length > 0) {
        for (const esc of activatedSchools) {
          try {
            await signInWithEmailAndPassword(auth, studentEmail(uname, esc), password)
            navigate('/alumno/dashboard')
            return
          } catch { /* wrong password for this school — try the next */ }
        }
        setError('Contraseña incorrecta. Si la olvidaste, usa “Recuperar contraseña”.')
        return
      }

      // No activated account yet → first-time access. Password they enter becomes theirs.
      const pendingSchools = [...new Set(docs.map((d) => d.escuelaId))]
      if (pendingSchools.length > 1) {
        setError('Tu usuario existe en varias escuelas. Activa tu cuenta con el código o QR de tu asignatura.')
        return
      }
      if (password.length < 6) {
        setError('Tu contraseña debe tener al menos 6 caracteres.')
        return
      }
      const escuelaId = pendingSchools[0]

      // Don't create the account yet — first confirm the access code of the
      // subject(s) this username belongs to, so first-time access requires
      // something only someone with that code (from the teacher/QR) would know.
      const asignaturaIds = [...new Set(docs.map((d) => d.asignaturaId).filter(Boolean))]
      let validCodes = []
      if (asignaturaIds.length) {
        const subSnap = await getDocs(
          query(collection(db, 'subjects'), where(documentId(), 'in', asignaturaIds.slice(0, 30)))
        )
        validCodes = subSnap.docs.map((d) => (d.data().accessCode || '').toUpperCase()).filter(Boolean)
      }
      setPendingActivation({ uname, escuelaId, password, validCodes })
      setSubjectCodeInput('')
      setCodeError('')
      setStep('need_code')
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setError('Contraseña incorrecta. Si la olvidaste, usa “Recuperar contraseña”.')
      } else {
        setError('Error al iniciar sesión. Intenta de nuevo.')
      }
    } finally {
      submitting.current = false
      setLoading(false)
    }
  }

  const handleActivateWithCode = (e) => {
    e.preventDefault()
    const code = codeInput.trim().toUpperCase()
    if (!code) return
    navigate(`/activate/${code}`)
  }

  // Final step of first-time access: the code must match the access code of
  // one of the subjects this username was added to — otherwise we don't know
  // it was really the teacher who shared it with this student.
  const handleConfirmCode = async (e) => {
    e.preventDefault()
    if (submitting.current || !pendingActivation) return
    setCodeError('')
    const code = subjectCodeInput.trim().toUpperCase()
    if (!code) return
    if (!pendingActivation.validCodes.includes(code)) {
      setCodeError('Ese código no coincide con el de tu asignatura. Pídeselo a tu maestro o maestra.')
      return
    }
    submitting.current = true
    setLoading(true)
    try {
      const { uname, escuelaId, password: pwd } = pendingActivation
      const email = studentEmail(uname, escuelaId)
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, pwd)
        await finishAccess(uname, escuelaId, cred.user)
      } catch (err2) {
        if (err2.code === 'auth/email-already-in-use') {
          const cred = await signInWithEmailAndPassword(auth, email, pwd)
          await finishAccess(uname, escuelaId, cred.user)
        } else {
          throw err2
        }
      }
    } catch {
      setCodeError('Error al activar tu cuenta. Intenta de nuevo.')
    } finally {
      submitting.current = false
      setLoading(false)
    }
  }

  function cancelNeedCode() {
    setStep('login')
    setPendingActivation(null)
    setSubjectCodeInput('')
    setCodeError('')
  }

  function openRecover() {
    setMode('recover')
    setRecoverStep('username')
    setRecoverUsername(username.trim().toUpperCase())
    setRecoverStudent(null)
    setNewPassword('')
    setConfirmNewPassword('')
    setRecoverError('')
  }

  function backToLogin() {
    setMode('login')
    setRecoverError('')
  }

  // Step 1: find the student and check the teacher enabled recovery (resetPassword set).
  const handleRecoverFind = async (e) => {
    e.preventDefault()
    setRecoverError('')
    setLoading(true)
    try {
      const uname = recoverUsername.trim().toUpperCase()
      if (!uname) return
      const snap = await getDocs(query(collection(db, 'students'), where('username', '==', uname)))
      if (snap.empty) {
        setRecoverError('Usuario no encontrado. Verifica tu username con tu maestro.')
        return
      }
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const enabled = docs.find((d) => d.resetPassword)
      if (!enabled) {
        setRecoverError('La recuperación de contraseña está inhabilitada. Pídele a tu maestro que la habilite desde su panel y vuelve a intentar.')
        return
      }
      setRecoverStudent(enabled)
      setRecoverStep('password')
    } catch {
      setRecoverError('Ocurrió un error. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  // Step 2: set a new password. A forgotten Firebase password can't be reset from the
  // browser, so this calls a serverless endpoint (Admin SDK) gated by the teacher-enabled
  // recovery flag; then we sign in with the new password.
  const handleRecoverSetPassword = async (e) => {
    e.preventDefault()
    setRecoverError('')
    if (newPassword.length < 6) { setRecoverError('La contraseña debe tener al menos 6 caracteres.'); return }
    if (newPassword !== confirmNewPassword) { setRecoverError('Las contraseñas no coinciden.'); return }
    setLoading(true)
    try {
      const email = studentEmail(recoverStudent.username, recoverStudent.escuelaId)
      const resp = await fetch('/api/student/recover-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: recoverStudent.username,
          escuelaId: recoverStudent.escuelaId,
          newPassword,
        }),
      })
      if (!resp.ok) {
        // The endpoint changes the Auth password BEFORE the Firestore cleanup; if the cleanup
        // failed (non-atomic) the password may already be the new one. Try signing in before
        // giving up so the student isn't stuck after a partial success.
        try {
          await signInWithEmailAndPassword(auth, email, newPassword)
          navigate('/alumno/dashboard')
          return
        } catch { /* genuinely failed — show the server message */ }
        let msg = 'No pudimos recuperar tu contraseña. Pídele a tu maestro que vuelva a habilitar la recuperación.'
        try { const data = await resp.json(); if (data?.error) msg = data.error } catch { /* ignore */ }
        setRecoverError(msg)
        return
      }
      // Password is already changed server-side; sign in. If THIS fails (e.g. network),
      // tell the student to just log in — their new password is valid.
      try {
        await signInWithEmailAndPassword(auth, email, newPassword)
        navigate('/alumno/dashboard')
      } catch {
        setRecoverError('Tu contraseña se actualizó. Vuelve a “Iniciar sesión” con tu nueva contraseña.')
      }
    } catch {
      setRecoverError('No pudimos recuperar tu contraseña. Intenta de nuevo en un momento.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 bg-surface">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-card bg-accent flex items-center justify-center mx-auto mb-3">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-on-surface">
            {mode === 'recover' ? 'Recuperar contraseña' : 'Acceso Estudiantes'}
          </h1>
          <p className="text-muted text-sm mt-1">Evalúa Fácil</p>
        </div>

        {mode === 'login' && step === 'need_code' ? (
          /* ── Confirm subject access code before creating the account ── */
          <div className="bg-surface-card rounded-card shadow-card p-5">
            <form onSubmit={handleConfirmCode} className="space-y-3">
              <p className="text-sm text-muted">
                Es tu primera vez. Para activar tu cuenta, ingresa el <strong>código de acceso</strong>{' '}
                de tu asignatura (el del QR o el que te dio tu maestro o maestra):
              </p>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Código de la asignatura</label>
                <input
                  type="text"
                  value={subjectCodeInput}
                  onChange={(e) => { setSubjectCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); setCodeError('') }}
                  required
                  autoFocus
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={8}
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface font-mono tracking-widest text-center text-lg"
                  placeholder="Ej: A3B7K2"
                />
              </div>
              {codeError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2.5">{codeError}</p>
              )}
              <button
                type="submit"
                disabled={loading || !subjectCodeInput.trim()}
                className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading ? <Spinner size="sm" /> : <Hash size={18} />}
                {loading ? 'Activando…' : 'Activar mi cuenta'}
              </button>
            </form>
            <button
              type="button"
              onClick={cancelNeedCode}
              className="mt-3 w-full flex items-center justify-center gap-1.5 text-sm text-muted hover:text-on-surface transition-colors"
            >
              <ArrowLeft size={17} /> Volver
            </button>
          </div>
        ) : mode === 'recover' ? (
          /* ── Recovery ── */
          <div className="bg-surface-card rounded-card shadow-card p-5">
            {recoverStep === 'username' ? (
              <form onSubmit={handleRecoverFind} className="space-y-3">
                <p className="text-sm text-muted">
                  Tu maestro debe <strong>habilitar la recuperación</strong> antes de que puedas elegir
                  una nueva contraseña. Escribe tu username:
                </p>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">Username</label>
                  <input
                    type="text"
                    value={recoverUsername}
                    onChange={(e) => { setRecoverUsername(e.target.value.toUpperCase()); setRecoverError('') }}
                    required
                    autoFocus
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface font-mono tracking-widest text-center text-lg"
                    placeholder="Ej: MENDEZ.ENRIQUE"
                    maxLength={40}
                  />
                </div>
                {recoverError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2.5">{recoverError}</p>
                )}
                <button
                  type="submit"
                  disabled={loading || !recoverUsername.trim()}
                  className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {loading ? <Spinner size="sm" /> : <KeyRound size={18} />}
                  {loading ? 'Verificando…' : 'Continuar'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRecoverSetPassword} className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-accent-light rounded">
                  <div className="w-9 h-9 rounded-full bg-accent-light flex items-center justify-center flex-shrink-0">
                    <KeyRound size={18} className="text-accent" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-on-surface truncate">
                      {recoverStudent?.apellidoPaterno} {recoverStudent?.apellidoMaterno} {recoverStudent?.nombre}
                    </p>
                    <p className="text-xs text-muted font-mono">{recoverStudent?.username}</p>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">Nueva contraseña</label>
                  <PasswordInput
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setRecoverError('') }}
                    required
                    autoFocus
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">Confirmar contraseña</label>
                  <PasswordInput
                    value={confirmNewPassword}
                    onChange={(e) => { setConfirmNewPassword(e.target.value); setRecoverError('') }}
                    required
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                    placeholder="Repite tu contraseña"
                  />
                </div>
                {recoverError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2.5">{recoverError}</p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {loading ? <Spinner size="sm" /> : <KeyRound size={18} />}
                  {loading ? 'Guardando…' : 'Guardar contraseña'}
                </button>
              </form>
            )}
            <button
              type="button"
              onClick={backToLogin}
              className="mt-3 w-full flex items-center justify-center gap-1.5 text-sm text-muted hover:text-on-surface transition-colors"
            >
              <ArrowLeft size={17} /> Volver al inicio de sesión
            </button>
          </div>
        ) : (
          <>
            {/* ── Login form ── */}
            <div className="bg-surface-card rounded-card shadow-card p-5">
              <form onSubmit={handleLogin} className="space-y-3">
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
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface font-mono tracking-widest text-center text-lg"
                    placeholder="Ej: MENDEZ.ENRIQUE"
                    maxLength={40}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">Contraseña</label>
                  <PasswordInput
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError('') }}
                    required
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
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
                  className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {loading ? <Spinner size="sm" /> : null}
                  {loading ? 'Entrando…' : 'Iniciar sesión'}
                </button>
              </form>
              <button
                type="button"
                onClick={openRecover}
                className="mt-3 w-full text-center text-sm text-accent hover:underline"
              >
                ¿Olvidaste tu contraseña? Recuperar contraseña
              </button>
            </div>

            {/* ── First-time activation ── */}
            <div className="mt-3 bg-surface-card rounded-card shadow-card overflow-hidden">
              <button
                type="button"
                onClick={() => setShowCodeSection((v) => !v)}
                className="w-full flex items-center justify-between px-5 py-3 text-left"
              >
                <span className="text-sm font-semibold text-muted">¿Primera vez? Activa tu cuenta</span>
                <ChevronDown
                  size={19}
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
                      className="flex-1 min-w-0 px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface font-mono tracking-widest text-center"
                    />
                    <button
                      type="submit"
                      disabled={!codeInput.trim()}
                      className="px-4 py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
                    >
                      <Hash size={18} />
                      Ir
                    </button>
                  </form>
                </div>
              )}
            </div>

            <p className="text-center text-sm text-slate-400 mt-3">
              ¿Eres docente?{' '}
              <Link to="/docente" className="text-accent hover:underline">Acceso docentes</Link>
            </p>

            <p className="text-center text-sm text-slate-500 mt-5 px-2">
              Tu maestro te otorgará tus datos de acceso.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
