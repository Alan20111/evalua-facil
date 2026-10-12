import { useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, signOut } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { auth } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import { useBackHandler } from '../hooks/useBackHandler'
import Modal from './ui/Modal'
import PasswordInput from './PasswordInput'
import GoogleIcon from './GoogleIcon'
import { reauthenticateWithGoogle, googleErrorInfo } from '../utils/googleAuth'
import { sendAccountDeletedEmail } from '../utils/accountEmails'
import { apiUrl } from '../utils/apiBase'
import { Input, Button } from './ui'
import { ICONO } from '../config/iconos'

// Eliminar la cuenta de forma definitiva.
//
// Tres cerrojos, en este orden: leer qué se pierde, escribir ELIMINAR a mano
// y volver a autenticarse. El último es el que de verdad protege — sin él,
// cualquiera que encuentre la sesión abierta en una computadora del plantel
// podría borrarle el trabajo del año a un docente.
//
// Lo pesado (borrar cientos de documentos y la cuenta de Auth) lo hace
// /api/account/delete: ver ahí por qué no puede vivir en el navegador.
const PALABRA = 'ELIMINAR'

const LO_QUE_SE_PIERDE = [
  'Tus asignaturas y sus estudiantes',
  'Actividades, entregas y calificaciones',
  'Asistencias y tu horario',
  'Tus bancos de reactivos y rúbricas',
  'Tu suscripción y tu historial de pagos',
]

export default function EliminarCuentaModal({ onClose }) {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [palabra, setPalabra] = useState('')
  const [password, setPassword] = useState('')
  const [borrando, setBorrando] = useState(false)

  useBackHandler(() => { if (!borrando) onClose() })

  // Quien entró con Google no tiene contraseña que pedirle: se reautentica
  // volviendo a pasar por Google.
  const conPassword = currentUser?.providerData?.some((p) => p.providerId === 'password')
  const palabraLista = palabra.trim().toUpperCase() === PALABRA
  const puedeSeguir = palabraLista && (!conPassword || password.length > 0)

  async function eliminar() {
    if (!puedeSeguir) return
    setBorrando(true)
    try {
      // 1. Confirmar identidad. Si esto falla no se tocó nada.
      try {
        if (conPassword) {
          await reauthenticateWithCredential(
            currentUser,
            EmailAuthProvider.credential(currentUser.email, password)
          )
        } else {
          await reauthenticateWithGoogle(currentUser)
        }
      } catch (err) {
        if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
          toast('Contraseña incorrecta', 'error')
        } else {
          const { cancelled, message } = googleErrorInfo(err)
          if (!cancelled) toast(message || 'No pudimos confirmar tu identidad', 'error')
        }
        setBorrando(false)
        return
      }

      // 2. El correo va ANTES de borrar: después ya no hay sesión desde la
      // cual mandarlo. Si el envío falla no se detiene la eliminación — el
      // docente la pidió, y dejarlo a medias por un correo sería peor.
      const email = currentUser.email
      await sendAccountDeletedEmail({ email }).catch(() => {})

      // 3. El borrado real.
      const token = await currentUser.getIdToken()
      const res = await fetch(apiUrl('/api/account/delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirmacion: PALABRA }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No se pudo eliminar la cuenta')

      // La cuenta de Auth ya no existe; cerrar sesión aquí solo limpia lo que
      // quedó guardado en este navegador.
      await signOut(auth).catch(() => {})
      navigate('/', { replace: true })
      toast('Tu cuenta fue eliminada. Te mandamos un correo de confirmación.')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
      setBorrando(false)
    }
  }

  return (
    <Modal open onClose={onClose} variant="centered" size="sm" busy={borrando} title="Eliminar mi cuenta">
      <div className="rounded border border-red-200 bg-red-50 p-3 mb-3">
        <p className="flex items-start gap-2 text-sm font-semibold text-red-700">
          <AlertTriangle size={ICONO.md} className="flex-shrink-0 mt-0.5" />
          Esto no se puede deshacer. Se borra para siempre:
        </p>
        <ul className="mt-2 ml-1 space-y-0.5">
          {LO_QUE_SE_PIERDE.map((linea) => (
            <li key={linea} className="text-sm text-red-700">• {linea}</li>
          ))}
        </ul>
      </div>

      <p className="text-sm text-muted mb-3">
        Tus estudiantes perderán el acceso a sus calificaciones. Si solo quieres dejar de pagar,
        cancela tu suscripción en <strong>Mi plan</strong> — eso no borra nada.
      </p>

      <div className="space-y-3">
        <div>
          <label htmlFor="eliminar-palabra" className="block text-xs font-medium text-muted mb-1">
            Escribe <strong>{PALABRA}</strong> para continuar
          </label>
          <Input
            id="eliminar-palabra"
            type="text"
            value={palabra}
            onChange={(e) => setPalabra(e.target.value)}
            autoComplete="off"
          />
        </div>

        {conPassword ? (
          <PasswordInput
            label="Confirma tu contraseña"
            id="eliminar-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted">
            <GoogleIcon />
            Te pediremos confirmar con Google antes de borrar.
          </p>
        )}
      </div>

      <div className="flex gap-2 mt-4">
        <Button variant="secondary" className="flex-1" onClick={onClose} disabled={borrando}>
          Mejor no
        </Button>
        <Button variant="danger" icon={Trash2} busy={borrando} className="flex-1" onClick={eliminar} disabled={borrando || !puedeSeguir}>
          
          {borrando ? 'Eliminando…' : 'Eliminar para siempre'}
        </Button>
      </div>
    </Modal>
  )
}
