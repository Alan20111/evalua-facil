import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmailAuthProvider, linkWithCredential } from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useToast } from '../../components/Toast'
import PasswordInput from '../../components/PasswordInput'
import { ShieldCheck } from 'lucide-react'
import { useBackHandler } from '../../hooks/useBackHandler'
import { ICONO } from '../../config/iconos'
import { Button } from '../../components/ui'

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

  // Botón físico de Android: hace lo mismo que "Lo haré después" — poner
  // contraseña es opcional, así que atrás no puede dejar al docente atorado
  // aquí (la única salida era cerrar la app).
  useBackHandler(handleSkip)

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span aria-hidden="true" className="size-20 rounded-full bg-accent flex items-center justify-center mx-auto mb-3 animate-aparece motion-reduce:animate-none">
  <ShieldCheck size={ICONO.xl} className="text-white" />
</span>
          <h1 className="text-2xl font-bold text-on-surface">Protege el acceso a tu cuenta</h1>
          <p className="text-muted text-sm mt-2">
            Además de ingresar con Google, podrás acceder desde cualquier computadora utilizando tu correo
            electrónico y una contraseña, sin necesidad de iniciar sesión con tu cuenta de Google.
          </p>
        </div>

        <div className="bg-surface-card rounded-card shadow-card p-5">
          <form onSubmit={handleSubmit} className="space-y-3">
            <PasswordInput
              label="Crear contraseña"
              id="protect-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
            <PasswordInput
              label="Confirmar contraseña"
              id="protect-confirm-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
            <Button type="submit" size="lg" fullWidth busy={loading}>
              {loading ? 'Guardando…' : 'Crear contraseña'}
            </Button>
          </form>
        </div>

        <Button variant="quiet" fullWidth className="mt-4" onClick={handleSkip}>
          Lo haré después
        </Button>
      </div>
    </div>
  )
}
