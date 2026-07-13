import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import Spinner from '../../components/Spinner'
import { studentEmail, usernameCandidates } from '../../utils/generate'
import { Hash, ChevronDown, ArrowLeft, KeyRound } from 'lucide-react'
import EFLogo from '../../components/EFLogo'
import PasswordInput from '../../components/PasswordInput'

export default function StudentLogin() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Manual access-code entry for first-time activation
  const [showCodeSection, setShowCodeSection] = useState(false)
  const [codeInput, setCodeInput] = useState('')

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

  const handleLogin = async (e) => {
    e.preventDefault()
    if (submitting.current) return
    setError(''); submitting.current = true; setLoading(true)
    try {
      // Legacy codes are UPPERCASE, new ones lowercase — search both
      const snaps = await Promise.all(usernameCandidates(username).map((u) =>
        getDocs(query(collection(db, 'students'), where('username', '==', u)))
      ))
      const stuDocs = snaps.flatMap((s) => s.docs)
      if (stuDocs.length === 0) {
        setError('Usuario no encontrado. Verifica tu username, o usa "¿Primera vez? Activa tu cuenta" más abajo.')
        return
      }
      const docs = stuDocs.map((d) => ({ id: d.id, ...d.data() }))
      const uname = docs[0].username // stored canonical form

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

      // No activated account yet: this form is only for students who already
      // activated. First-time access happens exclusively via "¿Primera vez?
      // Activa tu cuenta" below (código/QR/link) → /activate/:code, which asks
      // for the subject's access code AND makes it explicit they're choosing a
      // new password there — no ambiguity about "is this a login or a signup".
      setError('Todavía no activas tu cuenta. Usa "¿Primera vez? Activa tu cuenta" más abajo.')
      setShowCodeSection(true)
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

  function openRecover() {
    setMode('recover')
    setRecoverStep('username')
    setRecoverUsername(username.trim())
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
      if (!recoverUsername.trim()) return
      const snaps = await Promise.all(usernameCandidates(recoverUsername).map((u) =>
        getDocs(query(collection(db, 'students'), where('username', '==', u)))
      ))
      const found = snaps.flatMap((s) => s.docs)
      if (found.length === 0) {
        setRecoverError('Usuario no encontrado. Verifica tu username con tu maestro.')
        return
      }
      const docs = found.map((d) => ({ id: d.id, ...d.data() }))
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
          <EFLogo className="mx-auto w-52 sm:w-60 h-auto mb-3" />
          <h1 className="text-2xl font-bold text-on-surface">
            {mode === 'recover' ? 'Recuperar contraseña' : 'Acceso Estudiantes'}
          </h1>
        </div>

        {mode === 'recover' ? (
          /* ── Recovery ── */
          <div className="bg-surface-card rounded-card shadow-card p-5">
            {recoverStep === 'username' ? (
              <form onSubmit={handleRecoverFind} className="space-y-3">
                <p className="text-sm text-muted">
                  Tu maestro debe <strong>habilitar la recuperación</strong> antes de que puedas elegir
                  una nueva contraseña. Escribe tu username:
                </p>
                <div>
                  <label htmlFor="recover-username" className="block text-sm font-medium text-muted mb-1">Username</label>
                  <input
                    id="recover-username"
                    type="text"
                    value={recoverUsername}
                    onChange={(e) => { setRecoverUsername(e.target.value); setRecoverError('') }}
                    required
                    // autoFocus intencional: primer campo de este paso (recuperar contraseña por username),
                    // se muestra una sola vez por sesión — no es un modal reabrible.
                    autoFocus
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface font-mono tracking-wide text-center text-lg"
                    placeholder="Ej: mendez.enrique"
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
                  <label htmlFor="recover-nueva-password" className="block text-sm font-medium text-muted mb-1">Nueva contraseña</label>
                  <PasswordInput
                    id="recover-nueva-password"
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setRecoverError('') }}
                    required
                    // autoFocus intencional: primer campo de este paso (elegir nueva contraseña),
                    // se muestra una sola vez por sesión — no es un modal reabrible.
                    autoFocus
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
                <div>
                  <label htmlFor="recover-confirmar-password" className="block text-sm font-medium text-muted mb-1">Confirmar contraseña</label>
                  <PasswordInput
                    id="recover-confirmar-password"
                    value={confirmNewPassword}
                    onChange={(e) => { setConfirmNewPassword(e.target.value); setRecoverError('') }}
                    required
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
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
                  <label htmlFor="login-username" className="block text-sm font-medium text-muted mb-1">Username</label>
                  <input
                    id="login-username"
                    type="text"
                    value={username}
                    onChange={(e) => { setUsername(e.target.value); setError('') }}
                    required
                    // autoFocus intencional: primer campo del formulario de login,
                    // pantalla de entrada única — no es un modal reabrible.
                    autoFocus
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface font-mono tracking-wide text-center text-lg"
                    placeholder="Ej: mendez.enrique"
                    maxLength={40}
                  />
                </div>
                <div>
                  <label htmlFor="login-password" className="block text-sm font-medium text-muted mb-1">Contraseña</label>
                  <PasswordInput
                    id="login-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError('') }}
                    required
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
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
                      className="flex-1 min-w-0 px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface font-mono tracking-widest text-center"
                    />
                    <button
                      type="submit"
                      disabled={!codeInput.trim()}
                      className="px-4 py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center gap-1.5 flex-shrink-0"
                    >
                      <Hash size={18} />
                      Ir
                    </button>
                  </form>
                </div>
              )}
            </div>

            <p className="text-center text-sm text-slate-500 mt-5 px-2">
              Tu maestro te otorgará tus datos de acceso.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
