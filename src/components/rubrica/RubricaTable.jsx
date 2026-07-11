import { valorNivel } from '../../utils/rubrica'

// Tabla de rúbrica — presentacional. La usan la vista previa del docente y la
// vista del alumno (antes de entregar y, ya calificado, con su resultado
// resaltado vía `seleccion`). Si recibe `onSelect`, las celdas son botones
// (modo calificación en pantallas anchas).
export default function RubricaTable({ rubrica, seleccion = null, onSelect = null, disabled = false }) {
  if (!rubrica?.criterios?.length) return null
  const { niveles, criterios } = rubrica

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ minWidth: `${140 + niveles.length * 130}px` }}>
        <thead>
          <tr>
            <th className="text-left align-bottom px-3 py-2 text-xs font-semibold text-muted border border-outline-variant bg-surface-container w-36">
              Criterio
            </th>
            {niveles.map((nv, ni) => (
              <th key={ni} className="px-3 py-2 text-center border border-outline-variant bg-[var(--accent-light)]">
                <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>{nv.nombre}</p>
                <p className="text-[11px] font-normal text-muted">{valorNivel(nv)} puntos</p>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {criterios.map((c, ci) => (
            <tr key={ci}>
              <th scope="row" className="text-left align-top px-3 py-2 border border-outline-variant bg-surface-container">
                <p className="text-sm font-semibold text-on-surface">{c.nombre}</p>
                <p className="text-[11px] font-normal text-muted mt-0.5">{c.peso} pts</p>
              </th>
              {niveles.map((_, ni) => {
                const sel = seleccion?.[ci] === ni
                const inner = (
                  <>
                    <p className={`text-xs leading-snug whitespace-pre-wrap ${sel ? 'text-on-surface' : 'text-muted'}`}>
                      {c.descriptores?.[ni] || <span className="italic text-slate-400">—</span>}
                    </p>
                    <p className={`text-xs font-bold mt-1.5 ${sel ? '' : 'text-slate-400'}`} style={sel ? { color: 'var(--accent)' } : undefined}>
                      {c.puntos?.[ni]} pts
                    </p>
                  </>
                )
                return (
                  <td
                    key={ni}
                    className={`align-top border border-outline-variant p-0 ${sel ? 'bg-[var(--accent-light)]' : 'bg-surface-card'}`}
                  >
                    {onSelect ? (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onSelect(ci, ni)}
                        className={`w-full h-full text-left px-3 py-2 transition-colors disabled:cursor-not-allowed ${
                          sel ? '' : 'hover:bg-[var(--accent-tint)]'
                        }`}
                      >
                        {inner}
                      </button>
                    ) : (
                      <div className="px-3 py-2">{inner}</div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
