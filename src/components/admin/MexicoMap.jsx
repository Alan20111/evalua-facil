import { useState } from 'react'
import mexicoStatesPaths from '../../data/mexicoStatesPaths.json'

const { width, height, states } = mexicoStatesPaths

// Escala de azules por intensidad — mismo azul que el resto de la UI de
// docente/admin (ver CLAUDE.md: blue only, nunca índigo). 5 escalones fijos
// en vez de un gradiente continuo: con pocos estados con datos, un gradiente
// suave es casi indistinguible a simple vista.
const ESCALA = ['#eff6ff', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a']

function colorPara(valor, max) {
  if (!valor || max <= 0) return '#f1f5f9' // sin datos — gris neutro
  const ratio = valor / max
  if (ratio <= 0.05) return ESCALA[0]
  if (ratio <= 0.25) return ESCALA[1]
  if (ratio <= 0.5) return ESCALA[2]
  if (ratio <= 0.8) return ESCALA[3]
  return ESCALA[4]
}

// `valores`: { [nombreEstado]: number }. Los nombres deben coincidir con las
// claves de mexicoStatesPaths.json (mismos nombres que users.estado, ver
// project-ventas-por-zona en memoria — el catálogo de CP ya los normaliza).
export default function MexicoMap({ valores, etiqueta = 'docentes' }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(0, ...Object.values(valores || {}))

  return (
    <div className="flex flex-col md:flex-row gap-4 items-start">
      <div className="relative flex-shrink-0 w-full md:w-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full md:w-[420px] h-auto">
          {Object.entries(states).map(([nombre, d]) => {
            const valor = valores?.[nombre] || 0
            return (
              <path
                key={nombre}
                d={d}
                fill={colorPara(valor, max)}
                stroke="#fff"
                strokeWidth="1"
                onMouseEnter={() => setHover({ nombre, valor })}
                onMouseLeave={() => setHover(null)}
                className="cursor-pointer transition-opacity hover:opacity-80"
              />
            )
          })}
        </svg>
        {hover && (
          <div className="absolute top-2 left-2 bg-surface-card shadow-card rounded-card px-3 py-1.5 text-sm pointer-events-none">
            <p className="font-semibold text-on-surface">{hover.nombre}</p>
            <p className="text-muted">{hover.valor} {etiqueta}</p>
          </div>
        )}
      </div>
      <div className="flex md:flex-col gap-2 flex-wrap">
        <p className="text-xs text-muted w-full md:w-auto mb-1">Intensidad ({etiqueta})</p>
        {ESCALA.map((c, i) => (
          <div key={c} className="flex items-center gap-1.5 text-xs text-muted">
            <span className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ background: c }} />
            {i === 0 ? 'Poco' : i === ESCALA.length - 1 ? 'Mucho' : ''}
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <span className="w-3.5 h-3.5 rounded-sm flex-shrink-0 bg-slate-100" />
          Sin datos
        </div>
      </div>
    </div>
  )
}
