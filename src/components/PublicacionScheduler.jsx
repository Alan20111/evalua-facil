import EFDateTimePicker from './EFDateTimePicker'
import Select from './ui/Select'
import { nowIsoLocal as toIsoNow } from '../utils/nowIso'

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
      <Select
        id={id}
        label={label}
        value={mode || 'inmediato'}
        onChange={onModeChange}
        options={[
          { value: 'inmediato', label: 'Inmediatamente al terminar' },
          { value: 'ahora', label: 'Ahora (guardar para que se publique)' },
          { value: 'fecha', label: 'En una fecha específica' },
          { value: 'nunca', label: 'No publicar' },
        ]}
      />
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
      {mode === 'nunca' && (
        <p className="text-xs text-muted mt-1">
          El estudiante no lo verá. Tú sí: en Resultados tienes todo, y puedes cambiar esto cuando quieras.
        </p>
      )}
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
