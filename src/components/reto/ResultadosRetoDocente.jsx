// Reto Exprés · resultados de UNA sesión para el docente (etapa 4): el registro definitivo que guardó el servidor
// (retoResultados) más lo que el docente ya puede leer (participantes, para ver el nombre real detrás de un alias).
// `proyectable`: versión para la pantalla del salón — solo los 10 primeros lugares y nunca el nombre real.
import { Medal } from 'lucide-react'
import { RETO_CFG, filasRankingFinal, textoTiempoReto } from '../../utils/retoExpres'
import { ICONO } from '../../config/iconos'
import TablaRankingReto from './TablaRankingReto'

const ESTILO_PODIO = ['text-amber-700', 'text-slate-500', 'text-orange-800']

/**
 * Clasificación para la pantalla del salón (alias o nombre visible, nunca el nombre real), con los 3 primeros lugares
 * destacados (4-nov-2026). La usan el final y la clasificación provisional entre preguntas (`limite` = cuántos lugares).
 */
export function ClasificacionProyectada({ clasificacion = [], realizadas, limite = RETO_CFG.TOP_CLASIFICACION }) {
  const filas = clasificacion.filter((f) => f.posicion <= limite)
  return (
    <ol className="w-full max-w-3xl mx-auto space-y-2">
      {filas.map((f) => {
        const podio = f.posicion <= 3
        return (
          <li key={f.participanteId} className={`flex items-center gap-4 bg-surface-card rounded-card shadow-card px-5 ${podio ? 'py-4 ring-2 ring-accent-light' : 'py-3'}`}>
            <span className={`w-20 flex-shrink-0 inline-flex items-center justify-end gap-1 text-3xl font-bold tabular-nums ${podio ? ESTILO_PODIO[f.posicion - 1] : 'text-accent'}`}>
              {podio && <Medal size={ICONO.xl} aria-hidden="true" />}{f.posicion}
            </span>
            <span className={`flex-1 min-w-0 truncate font-semibold text-on-surface ${podio ? 'text-4xl' : 'text-3xl'}`}>{f.nombreVisible}</span>
            {/* Versión 2: tiempo acumulado en respuestas correctas (desempata a iguales aciertos). */}
            {Number.isInteger(f.tiempoDecimas) && <span className="text-2xl tabular-nums text-muted">{textoTiempoReto(f.tiempoDecimas)}</span>}
            <span className="text-2xl tabular-nums text-muted">{f.aciertos} / {realizadas}</span>
          </li>
        )
      })}
    </ol>
  )
}

function porcentaje(n, total) {
  return total ? Math.round((n / total) * 100) : 0
}

export default function ResultadosRetoDocente({ resultados, sesion, participantes = [], proyectable = false }) {
  if (!resultados) return null
  if (resultados.sinResultados) {
    return <p className="text-base text-muted">La competencia terminó antes de la primera pregunta: no hay clasificación.</p>
  }
  const porId = new Map(participantes.map((p) => [p.id, p]))
  const conAlias = sesion?.modoIdentidad === 'alias'
  const clasificacion = resultados.clasificacion || []
  const total = clasificacion.length

  if (proyectable) return <ClasificacionProyectada clasificacion={clasificacion} realizadas={resultados.realizadas} />

  // Orden aleatorio (6-nov-2026): por pregunta ORIGINAL y sobre quienes la recibieron (con terminación anticipada no
  // todos reciben las mismas). Sin orden aleatorio, como siempre: las realizadas, en orden.
  const aleatorio = resultados.aleatorio === true && Array.isArray(resultados.columnas)
  const preguntas = aleatorio
    ? resultados.columnas.map((i) => ({ q: sesion?.preguntas?.[i], i })).filter((x) => x.q)
    : (sesion?.preguntas || []).slice(0, resultados.realizadas || 0).map((q, i) => ({ q, i }))
  const porPregunta = preguntas.map(({ q, i }) => {
    let aciertos = 0
    let respondidas = 0
    let recibieron = 0
    for (const f of clasificacion) {
      const d = aleatorio
        ? (resultados.detalle?.[f.participanteId] || []).find((x) => x?.indice === i)
        : resultados.detalle?.[f.participanteId]?.[i]
      if (!d) continue
      recibieron++
      if (d.opcionSeleccionada != null) respondidas++
      if (d.acerto) aciertos++
    }
    return { q, i, aciertos, respondidas, recibieron: aleatorio ? recibieron : total }
  })
  const descartadas = resultados.descartadas || {}
  const deInterrumpida = Number(descartadas.noRealizada) || 0
  const otrasDescartadas = (Number(descartadas.fueraDeTiempo) || 0) + (Number(descartadas.duplicadas) || 0) + (Number(descartadas.desconocidas) || 0)
  const nRetirados = (resultados.expulsados || []).length
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {resultados.realizadas} de {RETO_CFG.TOTAL_PREGUNTAS} preguntas realizadas · {plural(total, 'participante', 'participantes')}
        {nRetirados > 0 && ` · ${plural(nRetirados, 'retirado', 'retirados')}`}
        {deInterrumpida > 0 && ` · ${plural(deInterrumpida, 'respuesta', 'respuestas')} de la pregunta interrumpida (no cuenta)`}
        {otrasDescartadas > 0 && ` · ${plural(otrasDescartadas, 'respuesta fuera de tiempo no contó', 'respuestas fuera de tiempo no contaron')}`}
      </p>
      <section aria-labelledby="res-clasif">
        <h3 id="res-clasif" className="text-base font-semibold text-on-surface mb-2">Clasificación</h3>
        {/* Versión 2 (etapa B): tabla con aciertos y tiempo total (sin columnas por pregunta desde el 7-nov-2026); las de antes, la lista de siempre. */}
        {resultados.criterio === 'aciertos_tiempo' ? (
          <TablaRankingReto filas={filasRankingFinal(resultados)}
            clave={(f) => f.participanteId} extra={conAlias ? (f) => porId.get(f.participanteId)?.nombre || null : null} />
        ) : (
        <ol className="space-y-1">
          {clasificacion.map((f) => {
            const p = porId.get(f.participanteId)
            return (
              <li key={f.participanteId} className="flex items-center gap-3 text-base">
                <span className="w-8 text-right font-semibold text-accent tabular-nums">{f.posicion}</span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-on-surface">{f.nombreVisible}</span>
                  {conAlias && p?.nombre && <span className="block truncate text-xs text-hint">{p.nombre}</span>}
                </span>
                <span className="tabular-nums text-on-surface">{f.aciertos}</span>
                <span className="w-24 text-right text-xs text-hint">{f.respondidas} respondidas</span>
              </li>
            )
          })}
        </ol>
        )}
      </section>
      {(resultados.expulsados || []).length > 0 && (
        <section aria-labelledby="res-exp">
          <h3 id="res-exp" className="text-base font-semibold text-on-surface mb-1">Retirados por el docente</h3>
          <p className="text-sm text-muted">{resultados.expulsados.map((f) => f.nombreVisible).join(', ')}</p>
        </section>
      )}
      {porPregunta.length > 0 && (
        <section aria-labelledby="res-preg">
          <h3 id="res-preg" className="text-base font-semibold text-on-surface mb-2">Por pregunta</h3>
          <ol className="space-y-2">
            {porPregunta.map(({ q, i, aciertos, respondidas, recibieron }) => (
              <li key={q.id} className="text-sm">
                <p className="text-on-surface break-words">{i + 1}. {q.enunciado}</p>
                <p className="text-muted">{porcentaje(aciertos, recibieron)}% acertó · {respondidas} de {recibieron} respondieron{aleatorio && recibieron !== total ? ` (la recibieron ${recibieron} de ${total})` : ''}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
