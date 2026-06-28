import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth'
import { auth } from '../../firebase'
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

  useEffect(() => {
    if (!oobCode) {
      navigate('/docente', { replace: true })
      return
    }
    verifyPasswordResetCode(auth, oobCode)
      .then((userEmail) => { setEmail(userEmail); setStatus('valid') })
      .catch(() => setStatus('invalid'))
  }, [oobCode, navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    if (password.length < 6) { toast('Mínimo 6 caracteres', 'error'); return }
    if (password !== confirmPassword) { toast('Las contraseñas no coinciden', 'error'); return }
    setSaving(true)
    try {
      await confirmPasswordReset(auth, oobCode, password)
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
          <div className="w-16 h-16 rounded-card bg-blue-600 flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-on-surface">Restablecer contraseña</h1>
        </div>

        <div className="bg-surface-card rounded-card shadow-card p-6">
          {status === 'verifying' && (
            <div className="flex justify-center py-6"><Spinner /></div>
          )}

          {status === 'invalid' && (
            <div className="text-center space-y-4">
              <p className="text-sm text-muted leading-relaxed">
                Este enlace ya no es válido o ya fue utilizado. Solicita uno nuevo desde la pantalla de inicio de sesión.
              </p>
              <Link
                to="/docente"
                className="inline-block w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors"
              >
                Ir a iniciar sesión
              </Link>
            </div>
          )}

          {status === 'valid' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Correo electrónico</label>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="w-full px-4 py-3 rounded border border-outline-variant text-sm bg-surface text-muted"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Nueva contraseña</label>
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className="w-full px-4 py-3 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface"
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Confirmar contraseña</label>
                <PasswordInput
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full px-4 py-3 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface"
                  placeholder="Repite la contraseña"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? <Spinner size="sm" /> : null}
                {saving ? 'Guardando…' : 'Guardar nueva contraseña'}
              </button>
            </form>
          )}

          {status === 'done' && (
            <div className="text-center space-y-4">
              <CheckCircle2 size={40} className="text-emerald-500 mx-auto" />
              <p className="text-sm font-medium text-on-surface">
                Tu contraseña ha sido actualizada correctamente.
              </p>
              <button
                type="button"
                onClick={() => navigate('/docente')}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors"
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
