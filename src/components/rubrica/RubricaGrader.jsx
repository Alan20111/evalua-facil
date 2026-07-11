import { totalRubrica, RUBRICA_TOTAL } from '../../utils/rubrica'

// Calificador con rúbrica para el panel de evaluación del docente (columna
// angosta): un bloque por criterio con un botón por nivel. Tocar un nivel lo
// selecciona; el total se calcula solo cuando todos los criterios tienen nivel.
export default function RubricaGrader({ rubrica, seleccion, onChange, disabled = false }) {
  if (!rubrica?.criterios?.length) return null
  const total = totalRubrica(rubrica, seleccion)
  const faltan = rubrica.criterios.filter((_, i) => seleccion?.[i] == null).length

  return (
    <div className="rounded border border-outline-variant overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between gap-2" style={{ background: 'var(--accent-light)' }}>
        <p className="text-sm font-semibold truncate" style={{ color: 'var(--accent)' }}>
          Rúbrica: {rubrica.titulo}
        </p>
        <p className="text-sm font-bold flex-shrink-0" style={{ color: 'var(--accent)' }}>
          {total != null ? `${total} / ${RUBRICA_TOTAL}` : `Faltan ${faltan}`}
        </p>
      </div>
      <div className="divide-y divide-outline-variant">
        {rubrica.criterios.map((c, ci) => {
          const sel = seleccion?.[ci]
          return (
            <div key={ci} className="px-3 py-2">
              <p className="text-xs font-semibold text-on-surface">
                {c.nombre} <span className="font-normal text-slate-400">({c.peso} pts)</span>
              </p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {rubrica.niveles.map((nv, ni) => (
                  <button
                    type="button"
                    key={ni}
                    disabled={disabled}
                    onClick={() => onChange(ci, ni)}
                    className={`px-2 py-1 rounded border text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                      sel === ni
                        ? 'bg-accent text-white border-accent'
                        : 'bg-surface border-outline-variant text-muted hover:border-accent hover:text-accent'
                    }`}
                  >
                    {nv.nombre} · {c.puntos?.[ni]}
                  </button>
                ))}
              </div>
              {/* Descriptor del nivel elegido — recuerda al docente qué está premiando */}
              {sel != null && c.descriptores?.[sel] && (
                <p className="text-[11px] text-muted mt-1 leading-snug">{c.descriptores[sel]}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
