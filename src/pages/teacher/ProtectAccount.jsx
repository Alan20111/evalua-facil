import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmailAuthProvider, linkWithCredential } from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import PasswordInput from '../../components/PasswordInput'
import { ShieldCheck } from 'lucide-react'

// Shown once right after a teacher's first Google sign-in (see App.jsx's
// ProtectedTeacher gate, driven by utils/authLinking.needsPasswordSetup).
// Adds a password credential to the SAME Firebase user via linkWithCredential
// — never creates a second account — so the teacher can log in from a school
// computer without using their Google session there.
export default function ProtectAccount() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  async function handleSubmit(e) {
    e.preventDefault()
    if (password !== confirmPassword) { toast('Las contraseñas no coinciden', 'error'); return }
    if (password.length < 6) { toast('Mínimo 6 caracteres', 'error'); return }
    setLoading(true)
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, password)
      await linkWithCredential(auth.currentUser, credential)
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { hasLocalPassword: true })
      toast('Listo — ya puedes entrar también con tu correo y contraseña')
      navigate('/dashboard')
    } catch (err) {
      toast(
        err.code === 'auth/requires-recent-login'
          ? 'Por seguridad, vuelve a iniciar sesión con Google e intenta de nuevo'
          : 'Error: ' + err.message,
        'error'
      )
    } finally {
      setLoading(false)
    }
  }

  function handleSkip() {
    sessionStorage.setItem('protectAccountSkipped', '1')
    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-card bg-accent flex items-center justify-center mx-auto mb-3">
            <ShieldCheck size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-on-surface">Protege el acceso a tu cuenta</h1>
          <p className="text-muted text-sm mt-2">
            Además de ingresar con Google, podrás acceder desde cualquier computadora utilizando tu correo
            electrónico y una contraseña, sin necesidad de iniciar sesión con tu cuenta de Google.
          </p>
        </div>

        <div className="bg-surface-card rounded-card shadow-card p-5">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="protect-password" className="block text-sm font-medium text-muted mb-1">Crear contraseña</label>
              <PasswordInput
                id="protect-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface-container"
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div>
              <label htmlFor="protect-confirm-password" className="block text-sm font-medium text-muted mb-1">Confirmar contraseña</label>
              <PasswordInput
                id="protect-confirm-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface-container"
                placeholder="Repite la contraseña"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? <Spinner size="sm" /> : null}
              {loading ? 'Guardando…' : 'Crear contraseña'}
            </button>
          </form>
        </div>

        <button
          type="button"
          onClick={handleSkip}
          className="block w-full text-center text-sm text-muted hover:underline mt-6"
        >
          Lo haré después
        </button>
      </div>
    </div>
  )
}
