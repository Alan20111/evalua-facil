import { useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, signOut } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { auth } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import { useBackHandler } from '../hooks/useBackHandler'
import Modal from './ui/Modal'
import Spinner from './Spinner'
import PasswordInput from './PasswordInput'
import { apiUrl } from '../utils/apiBase'

// Eliminar la cuenta de un estudiante que ya no está inscrito en ninguna
// asignatura. La pantalla ni siquiera ofrece este modal mientras le quede
// una — ver Profile.jsx del estudiante y api/student/delete.js, que vuelve a
// comprobarlo del lado del servidor.
//
// Se pide la contraseña aunque aquí ya no haya calificaciones que perder:
// estos chavos entran desde computadoras compartidas del plantel, y una
// sesión olvidada no debería alcanzar para borrarle la cuenta a nadie.
const PALABRA = 'ELIMINAR'

export default function EliminarCuentaAlumnoModal({ photoURL, onClose }) {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [palabra, setPalabra] = useState('')
  const [password, setPassword] = useState('')
  const [borrando, setBorrando] = useState(false)

  useBackHandler(() => { if (!borrando) onClose() })

  const puedeSeguir = palabra.trim().toUpperCase() === PALABRA && password.length > 0

  async function eliminar() {
    if (!puedeSeguir) return
    setBorrando(true)
    try {
      try {
        await reauthenticateWithCredential(
          currentUser,
          EmailAuthProvider.credential(currentUser.email, password)
        )
      } catch (err) {
        const malaClave = err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password'
        toast(malaClave ? 'La contraseña no es correcta' : 'No pudimos confirmar tu identidad', 'error')
        setBorrando(false)
        return
      }

      const token = await currentUser.getIdToken()
      const res = await fetch(apiUrl('/api/student/delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        // Sin inscripciones, el servidor ya no tiene de dónde leer la foto
        // para borrarla de Cloudinary: se la manda la pantalla, que sí la trae.
        body: JSON.stringify({ confirmacion: PALABRA, photoURL: photoURL || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No se pudo eliminar la cuenta')

      await signOut(auth).catch(() => {})
      navigate('/alumno', { replace: true })
      toast('Tu cuenta fue eliminada.')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
      setBorrando(false)
    }
  }

  return (
    <Modal open onClose={onClose} variant="centered" size="sm" busy={borrando} title="Eliminar mi cuenta">
      <div className="rounded border border-red-200 bg-red-50 p-3 mb-3">
        <p className="flex items-start gap-2 text-sm font-semibold text-red-700">
          <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
          Esto no se puede deshacer.
        </p>
        <p className="text-sm text-red-700 mt-1">
          Se borran tu usuario, tu foto y tus notificaciones. Ya no vas a poder entrar con esta cuenta.
        </p>
      </div>

      <p className="text-sm text-muted mb-3">
        Si algún maestro vuelve a inscribirte, te va a dar un usuario nuevo y empiezas de cero.
      </p>

      <div className="space-y-3">
        <div>
          <label htmlFor="alumno-eliminar-palabra" className="block text-xs font-medium text-muted mb-1">
            Escribe <strong>{PALABRA}</strong> para continuar
          </label>
          <input
            id="alumno-eliminar-palabra"
            type="text"
            value={palabra}
            onChange={(e) => setPalabra(e.target.value)}
            autoComplete="off"
            className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
            placeholder={PALABRA}
          />
        </div>
        <div>
          <label htmlFor="alumno-eliminar-password" className="block text-xs font-medium text-muted mb-1">
            Confirma tu contraseña
          </label>
          <PasswordInput
            id="alumno-eliminar-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
            placeholder="••••••••"
          />
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <button type="button" onClick={onClose} disabled={borrando}
          className="flex-1 py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
          Mejor no
        </button>
        <button type="button" onClick={eliminar} disabled={borrando || !puedeSeguir}
          className="flex-1 py-2 rounded bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
          {borrando ? <Spinner size="sm" /> : <Trash2 size={17} />}
          {borrando ? 'Eliminando…' : 'Eliminar para siempre'}
        </button>
      </div>
    </Modal>
  )
}
