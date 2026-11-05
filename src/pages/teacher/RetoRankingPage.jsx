// Reto Exprés · ranking en vivo del DOCENTE (etapa B, 5-nov-2026), en una ventana aparte de la proyección: se abre
// desde «Ranking en vivo» en la pantalla en vivo y es para la computadora del docente, no para el proyector.
//
// Lee por Firestore lo que las reglas le dejan (sesión, participantes, respuestas y la copia de la clave, que solo lee
// el docente dueño) y calcula el ranking con la MISMA regla del ranking del celular (rankingDocenteEnVivo): aciertos y
// puesto al instante con cada respuesta aceptada; con «Mostrar respuesta correcta» = No, las preguntas de verdadero/
// falso o de dos opciones se suman al terminar. No escribe nada: abrirla o cerrarla no cambia la competencia. Al
// terminar muestra el ranking final del registro definitivo (retoResultados).
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import TablaRankingReto from '../../components/reto/TablaRankingReto'
import { EsqueletoRetoRanking } from '../../components/esqueletos'
import { useRelojServidor } from '../../hooks/useTemporizadorVivo'
import { medirRelojServidor } from '../../utils/participacionVivoDb'
import { RETO_CFG, faseReto, filasRankingFinal, rankingDocenteEnVivo } from '../../utils/retoExpres'
import {
  escucharClavesReto, escucharParticipantesReto, escucharRespuestasReto, escucharResultadosReto, escucharSesionReto,
} from '../../utils/retoExpresDb'

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
  const [claves, setClaves] = useState(null)
  const [resultados, setResultados] = useState(null)
  const [t, setT] = useState(() => Date.now())

  useEffect(() => escucharSesionReto(codigo, setSesion, () => setSesion(null)), [codigo])
  useEffect(() => {
    if (!uid) return undefined
    const a = escucharParticipantesReto(codigo, uid, setParticipantes, () => {})
    const b = escucharRespuestasReto(codigo, uid, setRespuestas, () => {})
    const c = escucharClavesReto(codigo, (d) => setClaves(d?.claves || null), () => {})
    return () => { a(); b(); c() }
  }, [codigo, uid])
  const finalizada = sesion?.estado === 'finalizada'
  useEffect(() => (finalizada ? escucharResultadosReto(codigo, setResultados, () => {}) : undefined), [codigo, finalizada])
  // El cambio de pregunta (abre, cierra) depende del reloj, no de un dato nuevo: se recalcula cada medio segundo.
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

  const total = Number.isInteger(sesion.totalPreguntas) ? sesion.totalPreguntas : RETO_CFG.TOTAL_PREGUNTAS
  const porId = new Map(participantes.map((p) => [p.id, p]))
  const conAlias = sesion.modalidad === 'externo' || sesion.modoIdentidad === 'alias'
  const extra = conAlias ? (f) => porId.get(f.participanteId)?.nombre || null : null

  const fase = finalizada ? 'finalizada' : faseReto(sesion, t).fase
  let contenido
  if (finalizada) {
    contenido = !resultados
      ? <p className="text-base text-muted">Calculando resultados…</p>
      : resultados.sinResultados
        ? <p className="text-base text-muted">La competencia terminó antes de la primera pregunta: no hay clasificación.</p>
        : <TablaRankingReto filas={filasRankingFinal(resultados)} preguntas={resultados.realizadas || 0} cerradas={resultados.realizadas || 0} clave={(f) => f.participanteId} extra={extra} />
  } else if (!claves) {
    contenido = <p className="text-base text-muted">Cargando el ranking…</p>
  } else {
    const r = rankingDocenteEnVivo({ sesion, claves, participantes, respuestas, ahoraMs: t })
    contenido = (
      <TablaRankingReto filas={r.filas} preguntas={total} cerradas={r.cerradas} abierta={r.abierta} diferidas={r.diferidas}
        clave={(f) => f.participanteId} extra={extra} />
    )
  }

  return (
    <div data-esq="reto-ranking" className="min-h-dvh bg-surface px-4 py-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex-1 min-w-0 truncate text-xl font-semibold text-on-surface">Ranking en vivo · {sesion.titulo || 'Reto Exprés'}</h1>
          <Badge tone="accent">{ETIQUETA[fase] || fase}</Badge>
        </div>
        <p className="text-sm text-muted">Esta ventana es para ti: no la proyectes. Se actualiza sola con cada respuesta.</p>
        {contenido}
      </div>
    </div>
  )
}

