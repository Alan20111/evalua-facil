// Participación en vivo · acceso EXTERNO (/p/:codigo). Sin cuenta ni inicio de sesión: quien tenga el
// enlace o el QR puede participar, incluso un estudiante inscrito (su cuenta NO se asocia: el servidor
// ignora cualquier sesión en esta modalidad). Solo muestra la pregunta activa de esta sesión.
import { useParams } from 'react-router-dom'
import ParticipanteVivo from '../components/participacion/ParticipanteVivo'

export default function ParticipacionPublica() {
  const { codigo } = useParams()
  return (
    <div className="min-h-dvh bg-surface">
      <p className="text-center text-xs font-semibold tracking-wide text-hint pt-3">Evalúa Fácil · Participación en vivo</p>
      <ParticipanteVivo codigo={String(codigo || '').toUpperCase()} conSesion={false} />
    </div>
  )
}
