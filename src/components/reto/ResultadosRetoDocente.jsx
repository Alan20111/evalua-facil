// Reto Exprés · resultados de UNA sesión para el docente (etapa 4): el registro definitivo que guardó el servidor
// (retoResultados) más lo que el docente ya puede leer (participantes, para ver el nombre real detrás de un alias).
// `proyectable`: versión para la pantalla del salón — solo los 10 primeros lugares y nunca el nombre real.
import { RETO_CFG } from '../../utils/retoExpres'

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
  const filas = proyectable ? clasificacion.filter((f) => f.posicion <= RETO_CFG.TOP_CLASIFICACION) : clasificacion
  const total = clasificacion.length

  if (proyectable) {
    return (
      <ol className="w-full max-w-3xl mx-auto space-y-2">
        {filas.map((f) => (
          <li key={f.participanteId} className="flex items-center gap-4 bg-surface-card rounded-card shadow-card px-5 py-3">
            <span className="w-12 text-right text-3xl font-bold text-accent tabular-nums">{f.posicion}</span>
            <span className="flex-1 min-w-0 truncate text-3xl font-semibold text-on-surface">{f.nombreVisible}</span>
            <span className="text-2xl tabular-nums text-muted">{f.aciertos} / {resultados.realizadas}</span>
          </li>
        ))}
      </ol>
    )
  }

  const preguntas = (sesion?.preguntas || []).slice(0, resultados.realizadas || 0)
  const porPregunta = preguntas.map((q, i) => {
    let aciertos = 0
    let respondidas = 0
    for (const f of clasificacion) {
      const d = resultados.detalle?.[f.participanteId]?.[i]
      if (d?.opcionSeleccionada != null) respondidas++
      if (d?.acerto) aciertos++
    }
    return { q, i, aciertos, respondidas }
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
            {porPregunta.map(({ q, i, aciertos, respondidas }) => (
              <li key={q.id} className="text-sm">
                <p className="text-on-surface break-words">{i + 1}. {q.enunciado}</p>
                <p className="text-muted">{porcentaje(aciertos, total)}% acertó · {respondidas} de {total} respondieron</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
