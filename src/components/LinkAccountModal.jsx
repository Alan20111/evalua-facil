import { useState } from 'react'
import { fetchSignInMethodsForEmail, sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../firebase'
import { X, CheckCircle2 } from 'lucide-react'
import Spinner from './Spinner'

// "Acceso desde otra computadora" — lets a teacher who normally signs in
// with Google add a password without ever being signed in on this device.
// Firebase Auth gives no client-side way to set a password for an account
// you're not authenticated as, so identity is proven the standard secure
// way: a password-reset email (confirmPasswordReset, handled by
// ResetPassword.jsx) rather than a form filled in right here.
export default function LinkAccountModal({ onClose }) {
  const [email, setEmail] = useState('')
  const [step, setStep] = useState('email') // email | sent
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleContinue(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const trimmed = email.trim()
    try {
      const methods = await fetchSignInMethodsForEmail(auth, trimmed)
      if (methods.length === 0) {
        setError('No existe una cuenta registrada con ese correo electrónico.')
        return
      }
      if (methods.includes('password')) {
        setError('Esta cuenta ya utiliza una contraseña. Inicia sesión normalmente con tu correo y contraseña.')
        return
      }
      await sendPasswordResetEmail(auth, trimmed, {
        url: `${window.location.origin}/reset-password`,
      })
      setStep('sent')
    } catch {
      setError('No se pudo validar el correo. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-surface-card w-full max-w-sm rounded-card p-5 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-on-surface rounded"
        >
          <X size={18} />
        </button>

        {step === 'email' && (
          <>
            <h3 className="text-lg font-semibold text-on-surface mb-1 pr-6">Acceso desde otra computadora</h3>
            <p className="text-sm text-muted mb-4 leading-relaxed">
              Si normalmente inicias sesión con Google, puedes crear una contraseña para ingresar desde cualquier computadora sin utilizar Google. Solo tendrás que hacerlo una vez.
            </p>
            <form onSubmit={handleContinue} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Correo electrónico</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm bg-surface"
                  placeholder="nombre@correo.com"
                />
              </div>
              {error && <p className="text-sm text-red-600 leading-relaxed">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading ? <Spinner size="sm" /> : null}
                {loading ? 'Validando…' : 'Continuar'}
              </button>
            </form>
          </>
        )}

        {step === 'sent' && (
          <div className="text-center space-y-3">
            <CheckCircle2 size={40} className="text-emerald-500 mx-auto" />
            <p className="text-sm font-medium text-on-surface">Revisa tu correo</p>
            <p className="text-sm text-muted leading-relaxed">
              Te enviamos un enlace a <strong>{email.trim()}</strong> para crear tu contraseña. Ábrelo desde esta misma computadora para continuar.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors"
            >
              Entendido
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
