// Visibility radio-group (Mostrar ahora / Ocultar / Programar) shared by any
// content type that needs the oculta/publishAt fields — activities first,
// now also support materials. Extracted so both forms read from one place:
// any future tweak (copy, a new mode, the schedule input) changes once.
import DateTimePicker from './DateTimePicker'

export default function VisibilitySelect({ mode, publishAt, onModeChange, onPublishAtChange }) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 p-3 rounded border cursor-pointer transition-colors hover:bg-[var(--accent-tint)]"
        style={{ borderColor: mode === 'show' ? 'var(--accent)' : '#e2e8f0', background: mode === 'show' ? 'var(--accent-light)' : '' }}>
        <input type="radio" name="visibilidad" checked={mode === 'show'}
          onChange={() => onModeChange('show')}
          className="accent-[var(--accent)]" />
        <div>
          <p className="text-sm font-medium text-on-surface">Mostrar ahora</p>
          <p className="text-xs text-muted">Visible para estudiantes de inmediato</p>
        </div>
      </label>
      <label className="flex items-center gap-2 p-3 rounded border cursor-pointer transition-colors hover:bg-[var(--accent-tint)]"
        style={{ borderColor: mode === 'hide' ? 'var(--accent)' : '#e2e8f0', background: mode === 'hide' ? 'var(--accent-light)' : '' }}>
        <input type="radio" name="visibilidad" checked={mode === 'hide'}
          onChange={() => onModeChange('hide')}
          className="accent-[var(--accent)]" />
        <div>
          <p className="text-sm font-medium text-on-surface">Ocultar</p>
          <p className="text-xs text-muted">Solo tú lo ves, hasta que lo muestres o programes</p>
        </div>
      </label>
      <label className="flex items-center gap-2 p-3 rounded border cursor-pointer transition-colors hover:bg-[var(--accent-tint)]"
        style={{ borderColor: mode === 'schedule' ? 'var(--accent)' : '#e2e8f0', background: mode === 'schedule' ? 'var(--accent-light)' : '' }}>
        <input type="radio" name="visibilidad" checked={mode === 'schedule'}
          onChange={() => onModeChange('schedule')}
          className="accent-[var(--accent)]" />
        <div>
          <p className="text-sm font-medium text-on-surface">Programar</p>
          <p className="text-xs text-muted">Se activa automáticamente en una fecha</p>
        </div>
      </label>
      {mode === 'schedule' && (
        <DateTimePicker
          value={publishAt}
          onChange={onPublishAtChange}
          placeholder="Elegir fecha de publicación"
        />
      )}
    </div>
  )
}
