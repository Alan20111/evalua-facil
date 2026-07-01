import EFDateTimePicker from './EFDateTimePicker'

// Visibility radio-group (Mostrar ahora / Ocultar / Programar) shared by any
// content type that needs the oculta/publishAt fields — activities first,
// now also support materials. Extracted so both forms read from one place:
// any future tweak (copy, a new mode, the schedule input) changes once.
//
// Modes:
//   'show'      — new activity; will publish now when saved
//   'published' — existing activity already published; shows real date, not re-selectable
//   'hide'      — hidden
//   'schedule'  — scheduled for a future date (publishAt picker shown)

const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function formatPublishedAt(str) {
  if (!str) return null
  const d = new Date(str)
  if (isNaN(d.getTime())) return null
  const h = d.getHours(), m = d.getMinutes()
  const h12 = h % 12 || 12
  const ap = h < 12 ? 'a.m.' : 'p.m.'
  return `${String(d.getDate()).padStart(2,'0')} ${MESES_CORTO[d.getMonth()]} ${d.getFullYear()} · ${String(h12).padStart(2,'0')}:${String(m).padStart(2,'0')} ${ap}`
}

export default function VisibilitySelect({ mode, publishAt, publishedAt, onModeChange, onPublishAtChange }) {
  const publishedLabel = formatPublishedAt(publishedAt)

  // When the activity is already published, show a different UI:
  // a read-only info block + "Ocultar" and "Programar" options (no "Mostrar ahora")
  if (mode === 'published') {
    return (
      <div className="space-y-2">
        {/* Published info card */}
        <div className="flex items-start gap-3 p-3 rounded border"
          style={{ borderColor: 'var(--accent)', background: 'var(--accent-light)' }}>
          <span style={{ color: 'var(--accent)', marginTop: 2, fontSize: 16, flexShrink: 0 }}>✓</span>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>Publicada</p>
            {publishedLabel
              ? <p className="text-xs mt-0.5" style={{ color: 'var(--accent)' }}>{publishedLabel}</p>
              : <p className="text-xs mt-0.5 opacity-70" style={{ color: 'var(--accent)' }}>Fecha de publicación no disponible</p>
            }
          </div>
        </div>

        {/* Available mode changes */}
        <label className="flex items-center gap-2 p-3 rounded border cursor-pointer transition-colors hover:bg-[var(--accent-tint)]"
          style={{ borderColor: '#e2e8f0' }}>
          <input type="radio" name="visibilidad" checked={false}
            onChange={() => onModeChange('hide')}
            className="accent-[var(--accent)]" />
          <div>
            <p className="text-sm font-medium text-on-surface">Ocultar</p>
            <p className="text-xs text-muted">Solo tú lo ves, hasta que lo muestres o programes</p>
          </div>
        </label>
        <label className="flex items-center gap-2 p-3 rounded border cursor-pointer transition-colors hover:bg-[var(--accent-tint)]"
          style={{ borderColor: '#e2e8f0' }}>
          <input type="radio" name="visibilidad" checked={false}
            onChange={() => onModeChange('schedule')}
            className="accent-[var(--accent)]" />
          <div>
            <p className="text-sm font-medium text-on-surface">Reprogramar publicación</p>
            <p className="text-xs text-muted">Elige una nueva fecha y hora de publicación</p>
          </div>
        </label>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* "Mostrar ahora" only for non-published activities */}
      <label className="flex items-center gap-2 p-3 rounded border cursor-pointer transition-colors hover:bg-[var(--accent-tint)]"
        style={{ borderColor: mode === 'show' ? 'var(--accent)' : '#e2e8f0', background: mode === 'show' ? 'var(--accent-light)' : '' }}>
        <input type="radio" name="visibilidad" checked={mode === 'show'}
          onChange={() => onModeChange('show')}
          className="accent-[var(--accent)]" />
        <div>
          <p className="text-sm font-medium text-on-surface">Mostrar ahora</p>
          <p className="text-xs text-muted">Visible para estudiantes al guardar</p>
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
        <EFDateTimePicker
          mode="datetime"
          value={publishAt}
          onChange={onPublishAtChange}
          placeholder="Elegir fecha de publicación…"
          clearable={false}
          defaultTime="07:00"
        />
      )}
    </div>
  )
}
