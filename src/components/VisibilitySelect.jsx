import EFDateTimePicker from './EFDateTimePicker'

// Visibility radio-group (Publicar ahora / Ocultar / Programar) shared by any
// content type that needs the oculta/publishAt fields — activities first,
// now also support materials. Extracted so both forms read from one place:
// any future tweak (copy, a new mode, the schedule input) changes once.
//
// Modes:
//   'show'      — new activity; will publish now when saved (sets publishedAt)
//   'published' — existing activity already published; shows real date, not re-selectable
//   'hide'      — hidden (oculta=true)
//   'schedule'  — scheduled for a future date (publishAt picker shown)
//
// NOTE: The eye icon (ocultar/mostrar) is a VISIBILITY-ONLY toggle and NEVER
// modifies publishedAt. This component handles PUBLICATION (show/schedule),
// not visibility toggling — those are handled by hideActivity/showMaterialNow.

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

export default function VisibilitySelect({ mode, publishAt, publishedAt, wasScheduled = false, onModeChange, onPublishAtChange }) {
  const publishedLabel = formatPublishedAt(publishedAt)

  // Editing an already-published activity: publication is a done fact.
  // No options here at all — republishing, hiding or scheduling make no
  // sense in the edit form (show/hide lives in the eye icon on the card).
  // Saving simply keeps the current state; fecha límite stays editable
  // in the parent form.
  if (mode === 'published' || publishedAt) {
    return (
      <div className="flex items-start gap-3 p-3 rounded border"
        style={{ borderColor: 'var(--accent)', background: 'var(--accent-light)' }}>
        <span style={{ color: 'var(--accent)', marginTop: 2, fontSize: 16, flexShrink: 0 }}>✓</span>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>Publicada</p>
          {publishedLabel
            ? <p className="text-xs mt-0.5" style={{ color: 'var(--accent)' }}>{publishedLabel}</p>
            : <p className="text-xs mt-0.5 opacity-70" style={{ color: 'var(--accent)' }}>Fecha de publicación no disponible</p>
          }
          {mode === 'hide' && (
            <p className="text-xs mt-0.5 text-muted">Actualmente oculta para estudiantes (usa el ojito para mostrarla)</p>
          )}
          <p className="text-xs mt-0.5 text-muted">Tus cambios se guardan sin afectar la publicación</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* "Publicar ahora" only for non-published activities — sets publishedAt on save */}
      <label className="flex items-center gap-2 p-3 rounded border cursor-pointer transition-colors hover:bg-[var(--accent-tint)]"
        style={{ borderColor: mode === 'show' ? 'var(--accent)' : '#e2e8f0', background: mode === 'show' ? 'var(--accent-light)' : '' }}>
        <input type="radio" name="visibilidad" checked={mode === 'show'}
          onChange={() => onModeChange('show')}
          className="accent-[var(--accent)]" />
        <div>
          <p className="text-sm font-medium text-on-surface">Publicar ahora</p>
          <p className="text-xs text-muted">Se publica de inmediato al guardar</p>
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
          <p className="text-sm font-medium text-on-surface">{wasScheduled ? 'Reprogramar publicación' : 'Programar publicación'}</p>
          <p className="text-xs text-muted">{wasScheduled ? 'Modifica la fecha y hora en que se publicará' : 'Se activa automáticamente en la fecha y hora elegidas'}</p>
        </div>
      </label>
      {mode === 'schedule' && (
        <EFDateTimePicker
          mode="datetime"
          headerLabel="Fecha y hora de publicación"
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
