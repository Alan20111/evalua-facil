import { valorNivel, totalRubrica, RUBRICA_TOTAL } from '../../utils/rubrica'

// Tabla de rúbrica para CALIFICAR (panel del docente al evaluar): mismo
// formato que el editor — columna Num, criterio, un botón por nivel en cada
// renglón y la columna PUNTOS a la derecha con los puntos que suma ese
// renglón; debajo de la columna, la calificación obtenida.
export default function RubricaGradeTable({ rubrica, seleccion = null, onSelect, disabled = false }) {
  if (!rubrica?.criterios?.length) return null
  const { niveles, criterios } = rubrica
  const total = totalRubrica(rubrica, seleccion)
  const faltan = criterios.filter((_, i) => seleccion?.[i] == null).length

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ minWidth: `${44 + 150 + niveles.length * 130 + 110}px` }}>
        <thead>
          <tr>
            <th className="w-9 px-1 py-2 border border-outline-variant bg-surface-container text-xs font-semibold text-muted align-bottom">Num</th>
            <th className="text-left align-bottom px-3 py-2 text-xs font-semibold text-muted border border-outline-variant bg-surface-container w-40">
              Criterio
            </th>
            {niveles.map((nv, ni) => (
              <th key={ni} className="px-3 py-2 text-center border border-outline-variant bg-[var(--accent-light)]">
                <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>{nv.nombre}</p>
                <p className="text-[11px] font-normal text-muted">{valorNivel(nv)} puntos</p>
              </th>
            ))}
            <th className="px-2 py-2 text-center border border-outline-variant bg-[var(--accent-light)] w-28">
              <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>PUNTOS</p>
            </th>
          </tr>
        </thead>
        <tbody>
          {criterios.map((c, ci) => {
            const sel = seleccion?.[ci]
            return (
              <tr key={ci}>
                <td className="border border-outline-variant bg-surface-container text-center text-xs text-muted align-middle">{ci + 1}</td>
                <th scope="row" className="text-left align-top px-3 py-2 border border-outline-variant bg-surface-container">
                  <p className="text-sm font-semibold text-on-surface">{c.nombre}</p>
                </th>
                {niveles.map((_, ni) => {
                  const marcado = sel === ni
                  return (
                    <td key={ni} className={`align-top border border-outline-variant p-0 ${marcado ? 'bg-[var(--accent-light)]' : 'bg-surface-card'}`}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onSelect(ci, ni)}
                        className={`w-full h-full text-left px-3 py-2 transition-colors disabled:cursor-not-allowed ${marcado ? '' : 'hover:bg-[var(--accent-tint)]'}`}
                      >
                        <p className={`text-sm leading-snug whitespace-pre-wrap ${marcado ? 'text-on-surface' : 'text-muted'}`}>
                          {c.descriptores?.[ni] || <span className="italic text-slate-400">—</span>}
                        </p>
                        <p className={`text-sm font-bold mt-1.5 ${marcado ? '' : 'text-slate-400'}`} style={marcado ? { color: 'var(--accent)' } : undefined}>
                          {c.puntos?.[ni]} pts
                        </p>
                      </button>
                    </td>
                  )
                })}
                {/* Puntos que suma este renglón (el nivel marcado) */}
                <td className="border border-outline-variant bg-surface-card text-center align-middle px-2 py-2">
                  {sel != null ? (
                    <p className="text-base font-bold" style={{ color: 'var(--accent)' }}>{c.puntos?.[sel]} pts</p>
                  ) : (
                    <p className="text-xs text-slate-400 italic">Elige un nivel</p>
                  )}
                </td>
              </tr>
            )
          })}
          {/* Debajo de los puntos: la calificación obtenida */}
          <tr>
            <td colSpan={2 + niveles.length} className="border border-outline-variant bg-surface-container px-3 py-2 text-right text-sm font-bold text-on-surface">
              Calificación
            </td>
            <td className="border border-outline-variant text-center align-middle px-2 py-2" style={{ background: 'var(--accent-light)' }}>
              {total != null ? (
                <p className="text-xl font-bold leading-none" style={{ color: 'var(--accent)' }}>
                  {total}<span className="text-xs text-muted font-normal"> / {RUBRICA_TOTAL}</span>
                </p>
              ) : (
                <p className="text-xs text-slate-400">Faltan {faltan} criterio{faltan !== 1 ? 's' : ''}</p>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
