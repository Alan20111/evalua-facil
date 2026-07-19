import { Check } from 'lucide-react'
import { valorNivel, totalRubrica, esCotejo, RUBRICA_TOTAL } from '../../utils/rubrica'

// Calificar una LISTA DE COTEJO: cada criterio es una casilla. Marcada (cumple)
// suma sus puntos; vacía (no cumple) suma 0. onSelect(ci, 0) marca, onSelect(ci,
// null) desmarca — mismo canal que la rúbrica (índice de nivel / null).
function CotejoGradeTable({ rubrica, seleccion, onSelect, disabled }) {
  const { criterios } = rubrica
  const total = totalRubrica(rubrica, seleccion) ?? 0
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ minWidth: '360px' }}>
        <thead>
          <tr>
            <th className="w-9 px-1 py-2 border border-outline-variant bg-surface-container text-xs font-semibold text-muted align-bottom">Num</th>
            <th className="text-left align-bottom px-3 py-2 text-xs font-semibold text-muted border border-outline-variant bg-surface-container">Criterio</th>
            <th className="px-2 py-2 text-center border border-outline-variant bg-accent-light w-24"><p className="text-sm font-bold text-accent">¿Cumple?</p></th>
            <th className="px-2 py-2 text-center border border-outline-variant bg-accent-light w-24"><p className="text-sm font-bold text-accent">PUNTOS</p></th>
          </tr>
        </thead>
        <tbody>
          {criterios.map((c, ci) => {
            const cumple = seleccion?.[ci] === 0
            return (
              <tr key={ci}>
                <td className="border border-outline-variant bg-surface-container text-center text-xs text-muted align-middle">{ci + 1}</td>
                <th scope="row" className="text-left align-top px-3 py-2 border border-outline-variant bg-surface-container">
                  <p className="text-sm font-semibold text-on-surface">{c.nombre}</p>
                  <p className="text-xs text-muted mt-0.5">Vale {c.puntos?.[0]} pts si cumple</p>
                </th>
                <td className="border border-outline-variant text-center align-middle px-2 py-2 bg-surface-card">
                  <button type="button" disabled={disabled} onClick={() => onSelect(ci, cumple ? null : 0)}
                    aria-pressed={cumple} aria-label={`Marcar "${c.nombre}" como cumplido`}
                    className={`inline-flex items-center justify-center w-8 h-8 rounded border-2 transition-colors disabled:cursor-not-allowed ${
                      cumple ? 'bg-accent border-accent text-white' : 'border-outline-variant text-transparent hover:border-accent'
                    }`}>
                    <Check size={18} />
                  </button>
                </td>
                <td className="border border-outline-variant text-center align-middle px-2 py-2 bg-surface-card">
                  <p className={`text-base font-bold ${cumple ? 'text-accent' : 'text-slate-400'}`}>{cumple ? c.puntos?.[0] : 0} pts</p>
                </td>
              </tr>
            )
          })}
          <tr>
            <td colSpan={3} className="border border-outline-variant bg-surface-container px-3 py-2 text-right text-sm font-bold text-on-surface">Calificación</td>
            <td className="border border-outline-variant text-center align-middle px-2 py-2 bg-accent-light">
              <p className="text-xl font-bold leading-none text-accent">
                {total}<span className="text-xs text-muted font-normal"> / {RUBRICA_TOTAL}</span>
              </p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// Tabla de rúbrica para CALIFICAR (panel del docente al evaluar): mismo
// formato que el editor — columna Num, criterio, un botón por nivel en cada
// renglón y la columna PUNTOS a la derecha con los puntos que suma ese
// renglón; debajo de la columna, la calificación obtenida.
export default function RubricaGradeTable({ rubrica, seleccion = null, onSelect, disabled = false }) {
  if (!rubrica?.criterios?.length) return null
  if (esCotejo(rubrica)) return <CotejoGradeTable rubrica={rubrica} seleccion={seleccion} onSelect={onSelect} disabled={disabled} />
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
              <th key={ni} className="px-3 py-2 text-center border border-outline-variant bg-accent-light">
                <p className="text-sm font-bold text-accent">{nv.nombre}</p>
                <p className="text-[11px] font-normal text-muted">{valorNivel(nv)} puntos</p>
              </th>
            ))}
            <th className="px-2 py-2 text-center border border-outline-variant bg-accent-light w-28">
              <p className="text-sm font-bold text-accent">PUNTOS</p>
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
                        <p className={`text-sm font-bold mt-1.5 ${marcado ? 'text-accent' : 'text-slate-400'}`}>
                          {c.puntos?.[ni]} pts
                        </p>
                      </button>
                    </td>
                  )
                })}
                {/* Puntos que suma este renglón (el nivel marcado) */}
                <td className="border border-outline-variant bg-surface-card text-center align-middle px-2 py-2">
                  {sel != null ? (
                    <p className="text-base font-bold text-accent">{c.puntos?.[sel]} pts</p>
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
            <td className="border border-outline-variant text-center align-middle px-2 py-2 bg-accent-light">
              {total != null ? (
                <p className="text-xl font-bold leading-none text-accent">
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
