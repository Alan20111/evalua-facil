import EFDateTimePicker from './EFDateTimePicker'

function toIsoNow() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Shared publication scheduler — same three-way choice for "Publicar resultados"
// (calificación) and "Publicar respuestas". Kept as one component so both blocks
// stay identical in look and behavior, in EvaluacionManager AND EvaluacionEditor.
//
// Modes: 'inmediato' (visible as soon as the student finishes), 'ahora'
// (published the moment the teacher saves the config — the flag flips on save),
// 'fecha' (visible from a specific datetime). Legacy value 'manual' is shown
// as 'ahora' by the caller.
export default function PublicacionScheduler({ id, label, hint, mode, fecha, onModeChange, onFechaChange }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-muted mb-1">{label}</label>
      <select id={id} value={mode || 'inmediato'} onChange={(e) => onModeChange(e.target.value)}
        className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface-container">
        <option value="inmediato">Inmediatamente al terminar</option>
        <option value="ahora">Ahora (guardar para que se publique)</option>
        <option value="fecha">En una fecha específica</option>
      </select>
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
      {mode === 'ahora' && (
        <p className="text-xs text-accent mt-1">Se publicará en cuanto guardes la configuración.</p>
      )}
      {mode === 'fecha' && (
        <div className="mt-2">
          <EFDateTimePicker
            mode="datetime"
            headerLabel={`Fecha y hora — ${label}`}
            value={fecha || ''}
            onChange={onFechaChange}
            minDateTime={toIsoNow()}
            placeholder="Elegir fecha de publicación…"
            clearable={false}
          />
        </div>
      )}
    </div>
  )
}
