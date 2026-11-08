// La Ruleta del Destino · ESTUDIANTE INSCRITO (fases 4 y 5, individual). Entra desde la lista de actividades de su
// asignatura; el servidor comprueba su sesión, su inscripción y que la ruleta esté disponible (api/_lib/ruletaPartida.js).
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../../components/ui'
import PartidaRuleta from '../../components/ruleta/PartidaRuleta'

export default function RuletaAlumnoPage() {
  const { activityId } = useParams()
  const navigate = useNavigate()
  return (
    <div className="min-h-dvh bg-surface">
      <div className="px-3 pt-3">
        <Button variant="quiet" size="sm" icon={ArrowLeft} onClick={() => navigate(-1)}>Volver</Button>
      </div>
      <PartidaRuleta actividadId={activityId} />
    </div>
  )
}
