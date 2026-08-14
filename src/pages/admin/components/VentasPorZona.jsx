import { useMemo, useState } from 'react'
import MexicoMap from '../../../components/admin/MexicoMap'
import { planDe } from '../../../utils/situacionSuscripcion'
import municipioCoords from '../../../data/municipioCoords.json'

// "Docentes" cuenta a todos los registrados en ese estado — de dónde viene
// la base. "Con pago" cuenta solo a quien tiene un plan de 1-6 meses vigente
// (no prueba, no cortesía) — de dónde vienen las ventas reales. Ver memoria
// project-ventas-por-zona: el objetivo es saber en qué zonas se dan las
// ventas, no solo dónde hay cuentas.
const METRICAS = {
  docentes: { etiqueta: 'docentes registrados', calcular: () => 1 },
  pagos: { etiqueta: 'con suscripción de pago', calcular: (t, subsMap) => {
    const sub = subsMap[t.id]
    return planDe(sub).clave.startsWith('mes_') ? 1 : 0
  } },
}

export default function VentasPorZona({ stats }) {
  const [metrica, setMetrica] = useState('docentes')

  const subsMap = useMemo(
    () => Object.fromEntries((stats?.subscriptions || []).map((s) => [s.id, s])),
    [stats?.subscriptions]
  )

  // Docentes registrados antes del 2026-07-25 no traen `estado` — se cuentan
  // aparte, no se les inventa una zona.
  const { porEstado, porMunicipio, sinEstado, sinMunicipio, totalConEstado } = useMemo(() => {
    const teachers = stats?.teachers || []
    const accEstado = {}
    const accMunicipio = {} // clave "estado|municipio" -> valor
    let sin = 0
    let sinMuni = 0
    let total = 0
    const calc = METRICAS[metrica].calcular
    for (const t of teachers) {
      const valor = calc(t, subsMap)
      if (!t.estado) {
        sin += valor
        continue
      }
      accEstado[t.estado] = (accEstado[t.estado] || 0) + valor
      total += valor
      if (!t.municipio) {
        sinMuni += valor
        continue
      }
      const clave = `${t.estado}|${t.municipio}`
      accMunicipio[clave] = (accMunicipio[clave] || 0) + valor
    }
    return { porEstado: accEstado, porMunicipio: accMunicipio, sinEstado: sin, sinMunicipio: sinMuni, totalConEstado: total }
  }, [stats?.teachers, subsMap, metrica])

  const ranking = useMemo(
    () => Object.entries(porEstado).sort((a, b) => b[1] - a[1]),
    [porEstado]
  )

  const marcadores = useMemo(
    () =>
      Object.entries(porMunicipio)
        .map(([clave, valor]) => {
          const coords = municipioCoords[clave]
          if (!coords) return null
          const municipio = clave.split('|')[1]
          return { clave, lat: coords.lat, lng: coords.lng, aprox: !!coords.approx, valor, etiqueta: municipio }
        })
        .filter(Boolean),
    [porMunicipio]
  )

  if (!stats) return null

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {Object.entries(METRICAS).map(([id]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMetrica(id)}
            className={`px-3 py-1.5 rounded text-sm font-semibold transition-colors ${
              metrica === id
                ? 'bg-accent text-white'
                : 'bg-surface-card text-muted border border-outline-variant hover:bg-[var(--accent-tint)]'
            }`}
          >
            {id === 'docentes' ? 'Docentes registrados' : 'Con suscripción de pago'}
          </button>
        ))}
      </div>

      <div className="bg-surface-card rounded-card shadow-card p-4">
        <MexicoMap marcadores={marcadores} etiqueta={METRICAS[metrica].etiqueta} />
        {sinMunicipio > 0 && (
          <p className="text-xs text-muted mt-2">
            + {sinMunicipio} con estado pero sin municipio registrado (no aparecen como marcador).
          </p>
        )}
      </div>

      <div className="bg-surface-card rounded-card shadow-card p-4">
        <h3 className="font-semibold text-on-surface mb-3">Ranking por estado</h3>
        {ranking.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay docentes con estado registrado.</p>
        ) : (
          <div className="space-y-1.5">
            {ranking.map(([estado, valor]) => {
              const pct = totalConEstado > 0 ? Math.round((valor / totalConEstado) * 100) : 0
              return (
                <div key={estado} className="flex items-center gap-2 text-sm">
                  <span className="w-40 flex-shrink-0 truncate text-on-surface">{estado}</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-10 text-right text-muted flex-shrink-0">{valor}</span>
                </div>
              )
            })}
          </div>
        )}
        {sinEstado > 0 && (
          <p className="text-xs text-muted mt-3">
            + {sinEstado} sin estado registrado (cuentas de antes del 25-jul-2026, no se les asigna zona a ciegas).
          </p>
        )}
      </div>
    </div>
  )
}
