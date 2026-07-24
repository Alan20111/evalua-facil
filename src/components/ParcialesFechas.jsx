import EFDateTimePicker from './EFDateTimePicker'

// Un día después de 'YYYY-MM-DD' (aritmética en local time para evitar el
// desfase de un día que da parsear como UTC).
function addOneDay(dateStr) {
  if (!dateStr) return ''
  const d = new Date(`${dateStr}T00:00:00`)
  if (isNaN(d)) return ''
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Fechas de inicio/fin por parcial, encadenadas: el inicio de cada parcial
 * (excepto el primero) es automático (día siguiente al fin del anterior),
 * y el fin del último parcial es automático (= fin del curso). Solo el
 * inicio del primer parcial y el fin de los parciales intermedios/primero
 * los elige el docente.
 *
 * `value` es un array de { inicio, fin } de longitud `numParciales`.
 */
export default function ParcialesFechas({ fechaInicio, fechaFin, numParciales, value, onChange }) {
  if (!fechaInicio || !fechaFin || !numParciales) return null

  const rows = Array.from({ length: numParciales }, (_, i) => value?.[i] || { inicio: '', fin: '' })

  function setFin(i, fin) {
    const next = rows.map((r) => ({ ...r }))
    next[i] = { ...next[i], fin }
    // Encadena: el inicio del siguiente parcial es el día después de este fin.
    if (i + 1 < next.length) next[i + 1] = { ...next[i + 1], inicio: addOneDay(fin) }
    // El fin del último parcial siempre es el fin del curso.
    next[next.length - 1] = { ...next[next.length - 1], fin: fechaFin }
    onChange(next)
  }

  function setPrimerInicio(inicio) {
    const next = rows.map((r) => ({ ...r }))
    next[0] = { ...next[0], inicio }
    onChange(next)
  }

  return (
    <div>
      <p className="block text-sm font-medium text-muted mb-1">Fechas por parcial</p>
      <div className="space-y-2">
        {rows.map((row, i) => {
          const isFirst = i === 0
          const isLast = i === numParciales - 1
          const inicio = isFirst ? (row.inicio || fechaInicio) : (row.inicio || '')
          const fin = isLast ? fechaFin : (row.fin || '')
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 w-6 flex-shrink-0">P{i + 1}</span>
              <div className="flex-1">
                {isFirst ? (
                  <EFDateTimePicker mode="date" value={inicio} onChange={setPrimerInicio} />
                ) : (
                  <div className="w-full px-3 py-2 rounded border border-outline-variant bg-surface-variant text-sm text-slate-500">
                    {inicio || '—'}
                  </div>
                )}
              </div>
              <span className="text-slate-400 text-xs">a</span>
              <div className="flex-1">
                {isLast ? (
                  <div className="w-full px-3 py-2 rounded border border-outline-variant bg-surface-variant text-sm text-slate-500">
                    {fin || '—'}
                  </div>
                ) : (
                  <EFDateTimePicker mode="date" value={fin} onChange={(v) => setFin(i, v)} />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
