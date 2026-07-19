import { Check, X } from 'lucide-react'
import { valorNivel, esCotejo, COTEJO_NIVEL, RUBRICA_TOTAL } from '../../utils/rubrica'

// Tabla presentacional de una LISTA DE COTEJO — 3 columnas (Num, Criterio,
// Nivel de desempeño con sus puntos). Si viene `seleccion` (ya calificado),
// marca cada criterio como cumplido (✓, suma sus puntos) o no (✗, 0).
function CotejoTable({ rubrica, seleccion }) {
  const graded = Array.isArray(seleccion)
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ minWidth: '340px' }}>
        <thead>
          <tr>
            <th className="w-9 px-1 py-2 border border-outline-variant bg-surface-container text-xs font-semibold text-muted align-bottom">Num</th>
            <th className="text-left align-bottom px-3 py-2 text-xs font-semibold text-muted border border-outline-variant bg-surface-container">Criterio</th>
            <th className="px-3 py-2 text-center border border-outline-variant bg-[var(--accent-light)] w-40">
              <p className="text-sm font-bold text-accent">{COTEJO_NIVEL}</p>
              <p className="text-[11px] font-normal text-muted">Máximo {RUBRICA_TOTAL} puntos</p>
            </th>
          </tr>
        </thead>
        <tbody>
          {rubrica.criterios.map((c, ci) => {
            const cumple = graded ? seleccion[ci] === 0 : null
            return (
              <tr key={ci}>
                <td className="border border-outline-variant bg-surface-container text-center text-xs text-muted align-middle">{ci + 1}</td>
                <th scope="row" className="text-left align-top px-3 py-2 border border-outline-variant bg-surface-container">
                  <p className="text-sm font-semibold text-on-surface">{c.nombre}</p>
                </th>
                <td className="border border-outline-variant text-center align-middle px-2 py-2">
                  {graded ? (
                    <span className={`inline-flex items-center gap-1 text-sm font-bold ${cumple ? 'text-emerald-600' : 'text-red-500'}`}>
                      {cumple ? <Check size={15} /> : <X size={15} />}
                      {cumple ? `${c.puntos?.[0]} pts` : '0 pts'}
                    </span>
                  ) : (
                    <span className="text-sm font-bold text-accent">{c.puntos?.[0]} pts</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Tabla de rúbrica — presentacional. La usan la vista previa del docente y la
// vista del alumno (antes de entregar y, ya calificado, con su resultado
// resaltado vía `seleccion`). Si recibe `onSelect`, las celdas son botones
// (modo calificación en pantallas anchas).
export default function RubricaTable({ rubrica, seleccion = null, onSelect = null, disabled = false }) {
  if (!rubrica?.criterios?.length) return null
  if (esCotejo(rubrica)) return <CotejoTable rubrica={rubrica} seleccion={seleccion} />
  const { niveles, criterios } = rubrica

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ minWidth: `${44 + 140 + niveles.length * 130}px` }}>
        <thead>
          <tr>
            <th className="w-9 px-1 py-2 border border-outline-variant bg-surface-container text-xs font-semibold text-muted align-bottom">Num</th>
            <th className="text-left align-bottom px-3 py-2 text-xs font-semibold text-muted border border-outline-variant bg-surface-container w-36">
              Criterio
            </th>
            {niveles.map((nv, ni) => (
              <th key={ni} className="px-3 py-2 text-center border border-outline-variant bg-[var(--accent-light)]">
                <p className="text-sm font-bold text-accent">{nv.nombre}</p>
                <p className="text-[11px] font-normal text-muted">{valorNivel(nv)} puntos</p>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {criterios.map((c, ci) => (
            <tr key={ci}>
              <td className="border border-outline-variant bg-surface-container text-center text-xs text-muted align-middle">{ci + 1}</td>
              {/* Solo el nombre del criterio — sin puntos en esta columna */}
              <th scope="row" className="text-left align-top px-3 py-2 border border-outline-variant bg-surface-container">
                <p className="text-sm font-semibold text-on-surface">{c.nombre}</p>
              </th>
              {niveles.map((_, ni) => {
                const sel = seleccion?.[ci] === ni
                const inner = (
                  <>
                    <p className={`text-sm leading-snug whitespace-pre-wrap ${sel ? 'text-on-surface' : 'text-muted'}`}>
                      {c.descriptores?.[ni] || <span className="italic text-slate-400">—</span>}
                    </p>
                    <p className={`text-sm font-bold mt-1.5 ${sel ? 'text-accent' : 'text-slate-400'}`}>
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
