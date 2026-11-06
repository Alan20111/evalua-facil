// Reto Exprés · ranking en vivo del DOCENTE (etapa B, 5-nov-2026; dentro de la pantalla en vivo desde el 6-nov-2026).
// Lo usan el panel lateral de la pantalla en vivo (RetoEnVivoPage) y la ventana aparte de antes (RetoRankingPage, que se
// conserva para quien la tenga abierta).
//
// Calcula con la MISMA regla del ranking del celular (rankingDocenteEnVivo): aciertos y puesto al instante con cada
// respuesta aceptada; con «Mostrar respuesta correcta» = No, las preguntas de verdadero/falso o de dos opciones se suman
// al terminar. Recibe la sesión, los participantes y las respuestas que la pantalla ya escucha; solo él escucha la copia
// de la clave (y solo mientras está montado) y, al terminar, el registro definitivo. No escribe nada.
import { useEffect, useMemo, useState } from 'react'
import TablaRankingReto from './TablaRankingReto'
import { filasRankingFinal, rankingDocenteEnVivo } from '../../utils/retoExpres'
import { escucharClavesReto, escucharResultadosReto } from '../../utils/retoExpresDb'

// El cambio de pregunta depende del reloj: basta recalcular cada medio segundo aunque la pantalla avance más seguido.
const PASO_MS = 500

export default function RankingDocenteEnVivo({ sesion, codigo, participantes = [], respuestas = [], ahoraMs }) {
  const [claves, setClaves] = useState(null)
  const [resultados, setResultados] = useState(null)
  const finalizada = sesion?.estado === 'finalizada'
  useEffect(() => escucharClavesReto(codigo, (d) => setClaves(d?.claves || null), () => {}), [codigo])
  useEffect(() => (finalizada ? escucharResultadosReto(codigo, setResultados, () => {}) : undefined), [codigo, finalizada])

  const paso = Math.floor((ahoraMs || 0) / PASO_MS)
  const vivo = useMemo(
    () => (finalizada || !claves || !sesion ? null : rankingDocenteEnVivo({ sesion, claves, participantes, respuestas, ahoraMs: paso * PASO_MS })),
    [finalizada, claves, sesion, participantes, respuestas, paso],
  )

  const porId = new Map(participantes.map((p) => [p.id, p]))
  const conAlias = sesion?.modalidad === 'externo' || sesion?.modoIdentidad === 'alias'
  const extra = conAlias ? (f) => porId.get(f.participanteId)?.nombre || null : null

  if (finalizada) {
    if (!resultados) return <p className="text-base text-muted">Calculando resultados…</p>
    if (resultados.sinResultados) return <p className="text-base text-muted">La competencia terminó antes de la primera pregunta: no hay clasificación.</p>
    return <TablaRankingReto filas={filasRankingFinal(resultados)} clave={(f) => f.participanteId} extra={extra} />
  }
  if (!vivo) return <p className="text-base text-muted">Cargando el ranking…</p>
  return (
    <TablaRankingReto filas={vivo.filas} abierta={vivo.abierta} diferidas={vivo.diferidas} clave={(f) => f.participanteId} extra={extra} />
  )
}
