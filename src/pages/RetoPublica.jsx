// Reto Exprés · acceso por QR o enlace (/r/:codigo). Sin cuenta en un reto EXTERNO (el servidor entrega un token a este
// navegador). Si el reto es de INSCRITOS, el servidor exige la sesión del estudiante: con la sesión iniciada se juega
// aquí mismo; sin ella, la pantalla pide iniciar sesión.
import { useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ParticipanteReto from '../components/reto/ParticipanteReto'

export default function RetoPublica() {
  const { codigo } = useParams()
  const { currentUser } = useAuth()
  // Solo una cuenta de estudiante se presenta al servidor; en un reto externo el servidor ignora cualquier sesión.
  const estudiante = typeof currentUser?.email === 'string' && currentUser.email.endsWith('@evalua.local')
  return (
    <div className="min-h-dvh bg-surface">
      <p className="text-center text-xs font-semibold tracking-wide text-hint pt-3">Evalúa Fácil · Reto Exprés</p>
      <ParticipanteReto codigo={String(codigo || '').toUpperCase()} conSesion={estudiante} />
    </div>
  )
}
