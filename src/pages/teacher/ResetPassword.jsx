import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import {
  confirmPasswordReset,
  fetchSignInMethodsForEmail,
  signInWithEmailAndPassword,
  verifyPasswordResetCode,
} from 'firebase/auth'
import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { GraduationCap, CheckCircle2 } from 'lucide-react'
import PasswordInput from '../../components/PasswordInput'

// Action-handler for Firebase's password-reset email links. actionCodeSettings.url
// (set in Login.jsx) is used by Firebase's OWN hosted reset page as its "continue"
// link — there's no Console access from this repo to redirect the email link
// straight here, so this route can be reached two different ways:
//   1) With a real oobCode — e.g. if the link ever points here directly. We verify
//      and confirm it ourselves: same account, same UID, no new user created.
//   2) With NO oobCode — the normal case, reached after Firebase's hosted page has
//      already completed the reset itself and the teacher clicked its "Continue"
//      button. There's nothing left to verify here, so we just send them to the
//      login screen — never show an "invalid link" error for this case.
export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const oobCode = searchParams.get('oobCode')
  const navigate = useNavigate()
  const toast = useToast()

  const [status, setStatus] = useState('verifying') // verifying | valid | invalid | done
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  // True when this link is being used to add a password to a Google-only
  // account ("Acceso desde otra computadora"), not a regular password reset
  // — detected from the account's sign-in methods before the new password
  // is set. Drives the stricter validation and the dual-access copy below.
  const [isGoogleLinking, setIsGoogleLinking] = useState(false)

  useEffect(() => {
    if (!oobCode) {
      navigate('/docente', { replace: true })
      return
    }
    verifyPasswordResetCode(auth, oobCode)
      .then(async (userEmail) => {
        setEmail(userEmail)
        try {
          const normalized = userEmail.trim().toLowerCase()
          const [usersSnap, methods] = await Promise.all([
            getDocs(query(collection(db, 'users'), where('email', '==', normalized))),
            fetchSignInMethodsForEmail(auth, normalized).catch(() => []),
          ])
          const profile = usersSnap.docs[0]?.data()
          const hasLocalPassword = profile?.hasLocalPassword === true || methods.includes('password')
          const confirmedGoogle = profile?.provider === 'google' || methods.includes('google.com')
          setIsGoogleLinking(confirmedGoogle && !hasLocalPassword)
        } catch {
          setIsGoogleLinking(false)
        }
        setStatus('valid')
      })
      .catch(() => setStatus('invalid'))
  }, [oobCode, navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    if (isGoogleLinking) {
      if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        toast('Mínimo 8 caracteres, con al menos una letra y un número', 'error')
        return
      }
    } else if (password.length < 6) {
      toast('Mínimo 6 caracteres', 'error')
      return
    }
    if (password !== confirmPassword) { toast('Las contraseñas no coinciden', 'error'); return }
    setSaving(true)
    try {
      await confirmPasswordReset(auth, oobCode, password)
      if (isGoogleLinking) {
        const result = await signInWithEmailAndPassword(auth, email, password)
        await updateDoc(doc(db, 'users', result.user.uid), { hasLocalPassword: true })
      }
      setStatus('done')
    } catch (err) {
      toast(
        err.code === 'auth/expired-action-code' || err.code === 'auth/invalid-action-code'
          ? 'Este enlace ya no es válido. Solicita uno nuevo.'
          : 'Error: ' + err.message,
        'error'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-card bg-accent flex items-center justify-center mx-auto mb-3">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-on-surface">
            {isGoogleLinking ? 'Crear contraseña' : 'Restablecer contraseña'}
          </h1>
        </div>

        <div className="bg-surface-card rounded-card shadow-card p-5">
          {status === 'verifying' && (
            <div className="flex justify-center py-6"><Spinner /></div>
          )}

          {status === 'invalid' && (
            <div className="text-center space-y-3">
              <p className="text-sm text-muted leading-relaxed">
                Este enlace ya no es válido o ya fue utilizado. Solicita uno nuevo desde la pantalla de inicio de sesión.
              </p>
              <Link
                to="/docente"
                className="inline-block w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors"
              >
                Ir a iniciar sesión
              </Link>
            </div>
          )}

          {status === 'valid' && (
            <form onSubmit={handleSubmit} className="space-y-3">
              {isGoogleLinking && (
                <>
                  <p className="text-sm text-muted leading-relaxed">
                    Tu cuenta usa Google para iniciar sesión. Crea una contraseña para poder entrar también desde cualquier computadora sin usar Google.
                  </p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Haber abierto este enlace en tu correo ya confirmó que eres tú. Ahora puedes escribir tu propia contraseña con total seguridad.
                  </p>
                </>
              )}
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Correo electrónico</label>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="w-full px-4 py-2.5 rounded border border-outline-variant text-sm bg-surface text-muted"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Nueva contraseña</label>
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={isGoogleLinking ? 8 : 6}
                  autoComplete="new-password"
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder={isGoogleLinking ? 'Mínimo 8 caracteres, con letra y número' : 'Mínimo 6 caracteres'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Confirmar contraseña</label>
                <PasswordInput
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface"
                  placeholder="Repite la contraseña"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? <Spinner size="sm" /> : null}
                {saving ? 'Guardando…' : (isGoogleLinking ? 'Guardar y entrar' : 'Guardar nueva contraseña')}
              </button>
            </form>
          )}

          {status === 'done' && isGoogleLinking && (
            <div className="text-center space-y-3">
              <CheckCircle2 size={40} className="text-emerald-500 mx-auto" />
              <p className="text-base font-semibold text-on-surface">¡Listo!</p>
              <p className="text-sm text-muted leading-relaxed text-left">
                Tu contraseña ha sido creada correctamente.
                <br /><br />
                A partir de ahora podrás iniciar sesión de dos formas:
              </p>
              <ul className="text-sm text-muted leading-relaxed text-left list-disc pl-5">
                <li>Continuar con Google.</li>
                <li>Correo electrónico y contraseña.</li>
              </ul>
              <p className="text-sm font-medium text-amber-600 leading-relaxed">
                Anótala o guárdala en tu administrador de contraseñas, ya que no volverá a mostrarse.
              </p>
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors"
              >
                Entrar a Evalúa Fácil
              </button>
            </div>
          )}

          {status === 'done' && !isGoogleLinking && (
            <div className="text-center space-y-3">
              <CheckCircle2 size={40} className="text-emerald-500 mx-auto" />
              <p className="text-sm font-medium text-on-surface">
                Tu contraseña ha sido actualizada correctamente.
              </p>
              <button
                type="button"
                onClick={() => navigate('/docente')}
                className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors"
              >
                Ir a iniciar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
