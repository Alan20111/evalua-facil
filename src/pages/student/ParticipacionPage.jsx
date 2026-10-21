// Participación en vivo · GRUPO INSCRITO. El estudiante entra desde la lista de actividades de su
// asignatura; el servidor verifica su sesión y su inscripción (api/_lib/vivo.js) y liga su respuesta
// a su inscripción.
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../../components/ui'
import ParticipanteVivo from '../../components/participacion/ParticipanteVivo'

export default function StudentParticipacionPage() {
  const { activityId } = useParams()
  const navigate = useNavigate()
  return (
    <div className="min-h-dvh bg-surface">
      <div className="px-3 pt-3">
        <Button variant="quiet" size="sm" icon={ArrowLeft} onClick={() => navigate(-1)}>Volver</Button>
      </div>
      <ParticipanteVivo actividadId={activityId} conSesion />
    </div>
  )
}
