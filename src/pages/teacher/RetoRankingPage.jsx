// Reto Exprés · ranking en vivo del DOCENTE en una ventana aparte (etapa B, 5-nov-2026). Desde el 6-nov-2026 el ranking
// se consulta dentro de la pantalla en vivo (panel lateral) y ya no se enlaza aquí; esta ruta se conserva para quien la
// tenga abierta. El cálculo y la tabla viven en RankingDocenteEnVivo (el mismo componente del panel). No escribe nada.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import RankingDocenteEnVivo from '../../components/reto/RankingDocenteEnVivo'
import { EsqueletoRetoRanking } from '../../components/esqueletos'
import { useRelojServidor } from '../../hooks/useTemporizadorVivo'
import { medirRelojServidor } from '../../utils/participacionVivoDb'
import { faseReto } from '../../utils/retoExpres'
import { escucharParticipantesReto, escucharRespuestasReto, escucharSesionReto } from '../../utils/retoExpresDb'

const ETIQUETA = {
  espera: 'Sala de espera', preparando: 'Prepárense', abierta: 'Respondiendo', pausada: 'En pausa',
  clasificacion: 'Clasificación', terminada: 'Terminó', finalizada: 'Resultados finales',
}

export default function RetoRankingPage() {
  const { codigo } = useParams()
  const { currentUser } = useAuth()
  const uid = currentUser?.uid
  const { ahora } = useRelojServidor({ muestrear: medirRelojServidor })
  const [sesion, setSesion] = useState(undefined) // undefined = cargando; null = no existe
  const [participantes, setParticipantes] = useState([])
  const [respuestas, setRespuestas] = useState([])
  const [t, setT] = useState(() => Date.now())

  useEffect(() => escucharSesionReto(codigo, setSesion, () => setSesion(null)), [codigo])
  useEffect(() => {
    if (!uid) return undefined
    const a = escucharParticipantesReto(codigo, uid, setParticipantes, () => {})
    const b = escucharRespuestasReto(codigo, uid, setRespuestas, () => {})
    return () => { a(); b() }
  }, [codigo, uid])
  useEffect(() => {
    const id = setInterval(() => setT(ahora()), 500)
    return () => clearInterval(id)
  }, [ahora])

  if (sesion === undefined) return <EsqueletoRetoRanking />
  if (!sesion || sesion.docenteId !== uid) {
    return (
      <div data-esq="reto-ranking" className="min-h-dvh bg-surface px-4 py-6">
        <p className="text-base text-muted">Esta competencia ya no existe.</p>
      </div>
    )
  }

  const fase = sesion.estado === 'finalizada' ? 'finalizada' : faseReto(sesion, t).fase
  return (
    <div data-esq="reto-ranking" className="min-h-dvh bg-surface px-4 py-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex-1 min-w-0 truncate text-xl font-semibold text-on-surface">Ranking en vivo · {sesion.titulo || 'Reto Exprés'}</h1>
          <Badge tone="accent">{ETIQUETA[fase] || fase}</Badge>
        </div>
        <p className="text-sm text-muted">Esta ventana es para ti: no la proyectes. Se actualiza sola con cada respuesta.</p>
        <RankingDocenteEnVivo sesion={sesion} codigo={codigo} participantes={participantes} respuestas={respuestas} ahoraMs={t} />
      </div>
    </div>
  )
}
