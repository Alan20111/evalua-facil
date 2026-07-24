import EFDateTimePicker from './EFDateTimePicker'
import { formatLongDate as formatLong } from '../utils/dateRange'

// Un día después de 'YYYY-MM-DD' (aritmética en local time para evitar el
// desfase de un día que da parsear como UTC).
export function addOneDay(dateStr) {
  if (!dateStr) return ''
  const d = new Date(`${dateStr}T00:00:00`)
  if (isNaN(d)) return ''
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Fuerza inicio[0]=fechaInicio y fin[last]=fechaFin antes de guardar. */
export function normalizeParcialesFechas(fechaInicio, fechaFin, numParciales, arr) {
  const rows = Array.from({ length: numParciales }, (_, i) => arr?.[i] || { inicio: '', fin: '' })
  rows[0] = { ...rows[0], inicio: fechaInicio }
  rows[rows.length - 1] = { ...rows[rows.length - 1], fin: fechaFin }
  return rows
}

/**
 * Fechas de inicio/fin por parcial, encadenadas: el inicio del primer
 * parcial siempre es el inicio del curso (no editable); el inicio de los
 * demás parciales es automático (día siguiente al fin del anterior); y el
 * fin del último parcial siempre es el fin del curso (no editable). Solo
 * los fines de los parciales que no son el último los elige el docente,
 * y no puede elegir una fecha anterior o igual al inicio de ese parcial.
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

  return (
    <div>
      <p className="block text-sm font-medium text-muted mb-1">Fechas por parcial</p>
      <div className="w-full rounded border border-outline-variant divide-y divide-outline-variant overflow-hidden">
        {rows.map((row, i) => {
          const isFirst = i === 0
          const isLast = i === numParciales - 1
          const inicio = isFirst ? fechaInicio : (row.inicio || '')
          const fin = isLast ? fechaFin : (row.fin || '')
          return (
            <div key={i} className="p-2.5 bg-surface">
              <p className="text-xs font-semibold text-slate-500 mb-1.5">Parcial {i + 1}</p>
              <div className="space-y-2">
                <div>
                  <span className="block text-xs text-slate-500 mb-1">Inicio</span>
                  {isFirst ? (
                    <div className="w-full px-3 py-2 rounded border border-outline-variant bg-surface-variant text-sm text-slate-500">
                      {formatLong(inicio) || '—'}
                    </div>
                  ) : (
                    <div className="w-full px-3 py-2 rounded border border-outline-variant bg-surface-variant text-sm text-slate-500">
                      {formatLong(inicio) || '— (se define al elegir el fin del parcial anterior)'}
                    </div>
                  )}
                </div>
                <div>
                  <span className="block text-xs text-slate-500 mb-1">Fin</span>
                  {isLast ? (
                    <div className="w-full px-3 py-2 rounded border border-outline-variant bg-surface-variant text-sm text-slate-500">
                      {formatLong(fin) || '—'}
                    </div>
                  ) : (
                    <EFDateTimePicker
                      mode="date"
                      value={fin}
                      onChange={(v) => setFin(i, v)}
                      minDateTime={inicio ? addOneDay(inicio) : undefined}
                      disabled={!inicio}
                    />
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
