// Reto Exprés · competencias jugadas de un reto (etapa 4): abrir la que sigue en curso, ver los resultados de cada una y
// borrar una sesión (como la tachita de «Sesiones» de Participación en vivo). Nada se borra solo: solo lo que el docente
// borra aquí (o al borrar el reto); el servidor limpia sus participantes, respuestas y resultados.
// Etapa 5: en un reto de inscritos calificable, «Resultados» permite aplicar la competencia como calificación.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3, Play, Trash2 } from 'lucide-react'
import { Badge, Button, IconButton, Modal } from '../ui'
import Spinner from '../Spinner'
import ConfirmModal from '../ConfirmModal'
import { useToast } from '../Toast'
import ResultadosRetoDocente from './ResultadosRetoDocente'
import PanelCalificacionReto from './PanelCalificacionReto'
import { esCalificable } from '../../utils/retoExpres'
import { borrarSesionReto, escucharParticipantesReto, escucharResultadosReto } from '../../utils/retoExpresDb'

const ESTADO = { espera: 'En sala de espera', en_curso: 'En curso', finalizada: 'Terminada' }
const fecha = (ms) => (Number.isFinite(ms)
  ? new Date(ms).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  : '')

function ResultadosModal({ sesion, actividad, docenteId, onClose }) {
  const [resultados, setResultados] = useState(undefined)
  const [participantes, setParticipantes] = useState([])
  useEffect(() => {
    const a = escucharResultadosReto(sesion.codigo, setResultados, () => setResultados(null))
    const b = escucharParticipantesReto(sesion.codigo, docenteId, setParticipantes, () => {})
    return () => { a(); b() }
  }, [sesion.codigo, docenteId])
  return (
    <Modal open onClose={onClose} title={`Resultados · ${fecha(sesion.creadaMs)}`} size="lg">
      {resultados === undefined ? <div className="flex justify-center py-6"><Spinner /></div>
        : resultados ? (
          <div className="space-y-4">
            <ResultadosRetoDocente resultados={resultados} sesion={sesion} participantes={participantes} />
            {esCalificable(actividad?.reto) && !resultados.sinResultados && (
              <PanelCalificacionReto actividad={actividad} resultados={resultados} participantes={participantes} />
            )}
          </div>
        ) : <p className="text-base text-muted">Esta competencia todavía no tiene resultados.</p>}
    </Modal>
  )
}

export default function HistorialRetoSesiones({ activityId, actividad, docenteId, sesiones, onCambio }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [viendo, setViendo] = useState(null)
  const [borrando, setBorrando] = useState(null)
  const [trabajando, setTrabajando] = useState(false)

  async function borrar() {
    setTrabajando(true)
    try {
      await borrarSesionReto(borrando.codigo)
      toast('Competencia borrada')
      setBorrando(null)
      onCambio?.()
    } catch (e) {
      toast(e.message || 'No se pudo borrar', 'error')
    } finally {
      setTrabajando(false)
    }
  }

  if (!sesiones.length) return <p className="text-sm text-muted">Todavía no has jugado este reto.</p>
  return (
    <>
      <ul className="divide-y divide-outline-variant">
        {sesiones.map((s) => (
          <li key={s.codigo} className="flex flex-wrap items-center gap-2 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-base text-on-surface">{fecha(s.creadaMs)}</p>
              <p className="text-xs text-hint">Código {s.codigo}</p>
            </div>
            <Badge tone={s.estado === 'finalizada' ? 'neutral' : 'accent'}>{ESTADO[s.estado] || s.estado}</Badge>
            {s.estado === 'finalizada'
              ? <Button variant="secondary" size="sm" icon={BarChart3} onClick={() => setViendo(s)}>Resultados</Button>
              : <Button size="sm" icon={Play} onClick={() => navigate(`/reto/${activityId}/en-vivo/${s.codigo}`)}>Abrir</Button>}
            <IconButton icon={Trash2} label={`Borrar la competencia del ${fecha(s.creadaMs)}`} onClick={() => setBorrando(s)} />
          </li>
        ))}
      </ul>
      {viendo && <ResultadosModal sesion={viendo} actividad={actividad} docenteId={docenteId} onClose={() => setViendo(null)} />}
      {borrando && (
        <ConfirmModal danger busy={trabajando} title="Borrar competencia" confirmLabel="Borrar" onConfirm={borrar} onCancel={() => setBorrando(null)}
          message={`Se borran sus participantes, respuestas y resultados${borrando.estado !== 'finalizada' ? ', y la competencia termina para quienes estén dentro' : ''}. El reto, sus preguntas y las calificaciones ya aplicadas no cambian. No se puede deshacer.`} />
      )}
    </>
  )
}
