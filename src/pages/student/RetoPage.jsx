// Reto Exprés · ESTUDIANTE INSCRITO (D1). Entra desde la lista de actividades de su asignatura: el servidor comprueba su
// sesión y su inscripción y le encuentra la competencia por la actividad (api/_lib/reto.js · codigoPorActividad).
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../../components/ui'
import ParticipanteReto from '../../components/reto/ParticipanteReto'

export default function StudentRetoPage() {
  const { activityId } = useParams()
  const navigate = useNavigate()
  return (
    <div className="min-h-dvh bg-surface">
      <div className="px-3 pt-3">
        <Button variant="quiet" size="sm" icon={ArrowLeft} onClick={() => navigate(-1)}>Volver</Button>
      </div>
      <ParticipanteReto actividadId={activityId} conSesion />
    </div>
  )
}
