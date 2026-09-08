import { useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../../firebase'
import Spinner from '../../components/Spinner'
import { studentEmail } from '../../utils/generate'
import { Hash, ChevronDown } from 'lucide-react'
import EFLogo from '../../components/EFLogo'
import PasswordInput from '../../components/PasswordInput'
import { useBackHandler } from '../../hooks/useBackHandler'
import { apiUrl } from '../../utils/apiBase'

export default function StudentLogin() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Manual access-code entry for first-time activation
  const [showCodeSection, setShowCodeSection] = useState(false)
  const [codeInput, setCodeInput] = useState('')

  // Self-service password recovery
  const [showResetSection, setShowResetSection] = useState(false)
  const [resetUsername, setResetUsername] = useState('')
  const [resetNewPwd, setResetNewPwd] = useState('')
  const [resetConfirmPwd, setResetConfirmPwd] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetLoading, setResetLoading] = useState(false)

  const navigate = useNavigate()
  const submitting = useRef(false) // guards against double-submit (rapid taps)
  const submittingReset = useRef(false)

  // En modo login no se registra nada: cae al fallback global de "presiona de nuevo para salir".
  useBackHandler(null, false)

  const handleLogin = async (e) => {
    e.preventDefault()
    if (submitting.current) return
    setError(''); submitting.current = true; setLoading(true)
    try {
      // El estudiante entra SOLO con el usuario que le dio su maestro. Nunca
      // con un correo: el correo de recuperación es un dato aparte, no una
      // segunda llave (ver Profile.jsx del estudiante). Si escribe un correo
      // aquí es porque se confundió, y hay que decírselo con todas sus letras
      // en vez de dejarlo intentando.
      if (username.includes('@')) {
        setError('Tu usuario no es un correo. Es el que te dio tu maestro (por ejemplo ABCD).')
        return
      }
      const resp = await fetch(apiUrl('/api/student/lookup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })
      if (!resp.ok) {
        if (resp.status === 429) {
          setError('Demasiadas solicitudes. Espera un momento y vuelve a intentar.')
        } else {
          setError('Error al verificar el usuario. Intenta de nuevo.')
        }
        return
      }
      const lookupData = await resp.json()
      const stuDocs = lookupData.students || []
      if (stuDocs.length === 0) {
        setError('Usuario no encontrado. Verifica tu username, o usa "¿Primera vez? Activa tu cuenta" más abajo.')
        return
      }
      const uname = stuDocs[0].username

      // A username can repeat across schools, so each school is a different account/email.
      // For already-activated accounts, try sign-in against each school's email — the correct
      // password authenticates exactly one of them.
      const activatedSchools = [...new Set(stuDocs.filter((d) => d.cuentaExiste).map((d) => d.escuelaId))]
      if (activatedSchools.length > 0) {
        let signedInEscuelaId = null
        for (const esc of activatedSchools) {
          try {
            await signInWithEmailAndPassword(auth, studentEmail(uname, esc), password)
            signedInEscuelaId = esc
            break
          } catch { /* wrong password for this school — try the next */ }
        }
        if (!signedInEscuelaId) {
          setError('Contraseña incorrecta. Si el maestro ya restableció tu acceso, usa "¿Olvidaste tu contraseña?" más abajo.')
          return
        }
        // Si el alumno entró con la contraseña de reset (activado: false),
        // el backup path lo lleva a Perfil para que establezca una contraseña.
        const conReset = stuDocs.find((d) => d.escuelaId === signedInEscuelaId && !d.activado)
        if (conReset) {
          navigate('/alumno/perfil', { state: { debeEstablecerContrasena: true } })
        } else {
          navigate('/alumno/dashboard')
        }
        return
      }

      // No activated account yet: this form is only for students who already
      // activated. First-time access happens exclusively via "¿Primera vez?
      // Activa tu cuenta" below (código/QR/link) → /activate/:code.
      setError('Todavía no activas tu cuenta. Usa "¿Primera vez? Activa tu cuenta" más abajo.')
      setShowCodeSection(true)
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setError('Contraseña incorrecta. Si el maestro ya restableció tu acceso, usa "¿Olvidaste tu contraseña?" más abajo.')
      } else {
        setError('Error al iniciar sesión. Intenta de nuevo.')
      }
    } finally {
      submitting.current = false
      setLoading(false)
    }
  }

  const handleRecover = async (e) => {
    e.preventDefault()
    if (submittingReset.current) return
    setResetError('')
    if (resetNewPwd.length < 8) {
      setResetError('La nueva contraseña debe tener al menos 8 caracteres')
      return
    }
    if (resetNewPwd !== resetConfirmPwd) {
      setResetError('Las contraseñas nuevas no coinciden')
      return
    }
    submittingReset.current = true; setResetLoading(true)
    try {
      const resp = await fetch(apiUrl('/api/student/recover-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: resetUsername.trim(),
          newPassword: resetNewPwd,
        }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        setResetError(data.error || 'Error al restablecer la contraseña')
        return
      }
      // Autenticar con la nueva contraseña y entrar al dashboard.
      await signInWithEmailAndPassword(auth, data.email, resetNewPwd)
      navigate('/alumno/dashboard')
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setResetError('No se pudo autenticar con la nueva contraseña. Intenta de nuevo.')
      } else {
        setResetError('Error: ' + err.message)
      }
    } finally {
      submittingReset.current = false
      setResetLoading(false)
    }
  }

  const handleActivateWithCode = (e) => {
    e.preventDefault()
    const code = codeInput.trim().toUpperCase()
    if (!code) return
    navigate(`/activate/${code}`)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 bg-surface">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <EFLogo className="mx-auto w-52 sm:w-60 h-auto mb-3" />
          <h1 className="text-2xl font-bold text-on-surface">Acceso Estudiantes</h1>
        </div>

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
              <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2.5">
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
        </div>

        {/* ── Password recovery ── */}
        <div className="mt-3 bg-surface-card rounded-card shadow-card overflow-hidden">
          <button
            type="button"
            onClick={() => {
              const opening = !showResetSection
              setShowResetSection(opening)
              if (opening && username && !resetUsername) setResetUsername(username)
            }}
            className="w-full flex items-center justify-between px-5 py-3 text-left"
          >
            <span className="text-sm font-semibold text-muted">¿Olvidaste tu contraseña? Restablécela</span>
            <ChevronDown
              size={19}
              className={`text-slate-400 transition-transform duration-200 ${showResetSection ? 'rotate-180' : ''}`}
            />
          </button>

          {showResetSection && (
            <div className="px-5 pb-5 border-t border-outline-variant pt-4">
              <p className="text-xs text-muted mb-3 leading-relaxed">
                Tu maestro debe haber pulsado &ldquo;Restablecer contraseña&rdquo; primero.
                Luego introduce tu usuario y la nueva contraseña que quieres usar.
              </p>
              <form onSubmit={handleRecover} className="space-y-3">
                <div>
                  <label htmlFor="recover-username" className="block text-sm font-medium text-muted mb-1">Username</label>
                  <input
                    id="recover-username"
                    type="text"
                    value={resetUsername}
                    onChange={(e) => { setResetUsername(e.target.value); setResetError('') }}
                    required
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
                  <label htmlFor="recover-new-pwd" className="block text-sm font-medium text-muted mb-1">Nueva contraseña</label>
                  <PasswordInput
                    id="recover-new-pwd"
                    value={resetNewPwd}
                    onChange={(e) => { setResetNewPwd(e.target.value); setResetError('') }}
                    required
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                    placeholder="Mínimo 8 caracteres"
                  />
                </div>
                <div>
                  <label htmlFor="recover-confirm-pwd" className="block text-sm font-medium text-muted mb-1">Confirmar nueva contraseña</label>
                  <PasswordInput
                    id="recover-confirm-pwd"
                    value={resetConfirmPwd}
                    onChange={(e) => { setResetConfirmPwd(e.target.value); setResetError('') }}
                    required
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                    placeholder="Repite la nueva contraseña"
                  />
                </div>
                {resetError && (
                  <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2.5">
                    {resetError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {resetLoading ? <Spinner size="sm" /> : null}
                  {resetLoading ? 'Restableciendo…' : 'Restablecer contraseña'}
                </button>
              </form>
            </div>
          )}
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
                <strong>MUY IMPORTANTE:</strong>
                <br />
                1. Asegúrate de que tu Maestro(a) te haya agregado a su grupo
                <br />
                2. Pídele que te comparta tu nombre de usuario
                <br />
                3. Pídele el <strong>Código de su Asignatura</strong> e ingrésalo AQUÍ:
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
        <p className="text-center text-sm text-muted mt-2 px-2">
          ¿Eres Docente?{' '}
          <Link to="/docente" className="text-accent font-semibold hover:underline">Entra aquí</Link>
        </p>
      </div>
    </div>
  )
}
