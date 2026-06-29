import { useState } from 'react'
import { fetchSignInMethodsForEmail, sendPasswordResetEmail } from 'firebase/auth'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { X, CheckCircle2 } from 'lucide-react'
import Spinner from './Spinner'

// "Acceso desde otra computadora" — lets a teacher who normally signs in
// with Google add a password without ever being signed in on this device.
// Firebase Auth gives no client-side way to set a password for an account
// you're not authenticated as, so identity is proven the standard secure
// way: a password-reset email (confirmPasswordReset, handled by
// ResetPassword.jsx) rather than a form filled in right here.
//
// Existence/provider checks use Firestore's `users` collection (where the
// account's `provider`/`hasLocalPassword` fields live — see
// utils/teacherAccount.js) as the source of truth, not only
// fetchSignInMethodsForEmail: that Auth-only lookup can come back empty
// under Firebase's email-enumeration protection, which previously caused a
// real Google account to be reported as "no existe". Auth's result is
// still used to refine the message when Firestore's fields are missing
// (legacy accounts created before this field existed) — but it can never
// by itself produce a false "account doesn't exist".
export default function LinkAccountModal({ onClose }) {
  const [email, setEmail] = useState('')
  const [step, setStep] = useState('email') // email | sent
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleContinue(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const normalized = email.trim().toLowerCase()
    try {
      const [usersSnap, methods] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('email', '==', normalized))),
        fetchSignInMethodsForEmail(auth, normalized).catch(() => []),
      ])
      const profile = usersSnap.docs[0]?.data()

      if (!profile) {
        setError('No existe una cuenta registrada con ese correo electrónico.')
        return
      }

      const hasLocalPassword = profile.hasLocalPassword === true || methods.includes('password')
      if (hasLocalPassword) {
        setError('Esta cuenta ya tiene una contraseña. Inicia sesión normalmente con tu correo y contraseña.')
        return
      }

      // Only block as "not Google" when we have positive evidence of it —
      // a legacy account with no `provider` field and an inconclusive Auth
      // lookup must default to letting the teacher continue, never to a
      // false negative.
      const confirmedNonGoogle = profile.provider === 'password' || (methods.length > 0 && !methods.includes('google.com'))
      if (confirmedNonGoogle) {
        setError('Esta cuenta no fue registrada con Google. Inicia sesión con tu contraseña habitual.')
        return
      }

      await sendPasswordResetEmail(auth, normalized, {
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
              Escribe el mismo correo con el que te registraste mediante Google para crear una contraseña y poder iniciar sesión sin utilizar Google. Solo tendrás que hacerlo una vez.
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
