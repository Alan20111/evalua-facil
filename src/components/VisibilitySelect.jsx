import EFDateTimePicker from './EFDateTimePicker'
import { formatHora12FromDate } from '../utils/formatHora'
import { nowIsoLocal as toIsoNowLocal } from '../utils/nowIso'

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
  return `${String(d.getDate()).padStart(2,'0')} ${MESES_CORTO[d.getMonth()]} ${d.getFullYear()} · ${formatHora12FromDate(d)}`
}

export default function VisibilitySelect({ mode, publishAt, publishedAt, wasScheduled = false, isDraft = false, onModeChange, onPublishAtChange }) {
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
        <span className="text-base" style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }}>✓</span>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>Publicada</p>
          {publishedLabel
            ? <p className="text-xs mt-0.5" style={{ color: 'var(--accent)' }}>{publishedLabel}</p>
            : <p className="text-xs mt-0.5 opacity-70" style={{ color: 'var(--accent)' }}>Fecha de publicación no disponible</p>
          }
          {mode === 'hide' && (
            <p className="text-xs mt-0.5 text-muted">Actualmente oculta para estudiantes (usa el ojito para mostrarla)</p>
          )}
          <p className="text-xs mt-0.5 text-muted">Tus cambios se guardarán sin afectar la fecha de publicación original</p>
        </div>
      </div>
    )
  }

  // Editing an activity that was already scheduled (not yet published):
  // republishing/hiding make no sense — only allow moving the scheduled date.
  if (wasScheduled) {
    return (
      <div className="rounded border"
        style={{ borderColor: 'var(--accent)', background: 'var(--accent-light)' }}>
        <div className="p-3">
          <p className="text-sm font-medium text-on-surface">Reprogramar publicación</p>
          <p className="text-xs text-muted">Modifica la fecha y hora en que se publicará</p>
        </div>
        <div className="px-3 pb-3">
          <EFDateTimePicker
            mode="datetime"
            headerLabel="Fecha y hora de publicación"
            value={publishAt}
            onChange={onPublishAtChange}
            placeholder="Elegir fecha de publicación…"
            clearable={false}
            defaultTime="07:00"
            minDateTime={toIsoNowLocal()}
          />
        </div>
      </div>
    )
  }

  // New content: publish immediately or schedule. No "hide" option here —
  // drafts are saved with the "Guardar como borrador" button, and
  // showing/hiding an existing item is the eye icon's job on the card.
  return (
    <div className="space-y-2">
      {/* Editing a saved draft: "Borrador" is a selectable option — the
          teacher may only be reviewing/editing and not want to publish yet */}
      {isDraft ? (
        <label className="flex items-center gap-2 p-3 rounded border cursor-pointer transition-colors hover:bg-[var(--accent-tint)]"
          aria-label="Borrador"
          style={{ borderColor: mode === 'hide' ? 'var(--accent)' : '#e2e8f0', background: mode === 'hide' ? 'var(--accent-light)' : '' }}>
          <input type="radio" name="visibilidad" checked={mode === 'hide'}
            onChange={() => onModeChange('hide')}
            className="accent-[var(--accent)]" />
          <div>
            <p className="text-sm font-medium text-on-surface">Borrador</p>
            <p className="text-xs text-muted">Sigue oculta para estudiantes, sin publicar</p>
          </div>
        </label>
      ) : mode === 'hide' && (
        <div className="p-3 rounded border" style={{ borderColor: '#e2e8f0', background: 'var(--surface-container)' }}>
          <p className="text-sm font-medium text-on-surface">Borrador</p>
          <p className="text-xs text-muted">Oculta para estudiantes. Publícala eligiendo una opción abajo, guárdala de nuevo como borrador, o usa el ojito en la asignatura.</p>
        </div>
      )}
      <label className="flex items-center gap-2 p-3 rounded border cursor-pointer transition-colors hover:bg-[var(--accent-tint)]"
        aria-label="Publicar ahora"
        style={{ borderColor: mode === 'show' ? 'var(--accent)' : '#e2e8f0', background: mode === 'show' ? 'var(--accent-light)' : '' }}>
        <input type="radio" name="visibilidad" checked={mode === 'show'}
          onChange={() => onModeChange('show')}
          className="accent-[var(--accent)]" />
        <div>
          <p className="text-sm font-medium text-on-surface">Publicar ahora</p>
          <p className="text-xs text-muted">Se publica de inmediato al guardar</p>
        </div>
      </label>
      {/* Radio + date picker share one bordered container so they read as
          a single option, not two separate rows */}
      <div className="rounded border transition-colors"
        style={{ borderColor: mode === 'schedule' ? 'var(--accent)' : '#e2e8f0', background: mode === 'schedule' ? 'var(--accent-light)' : '' }}>
        <label className="flex items-center gap-2 p-3 cursor-pointer hover:bg-[var(--accent-tint)] rounded"
          aria-label="Programar publicación">
          <input type="radio" name="visibilidad" checked={mode === 'schedule'}
            onChange={() => onModeChange('schedule')}
            className="accent-[var(--accent)]" />
          <div>
            <p className="text-sm font-medium text-on-surface">Programar publicación</p>
            <p className="text-xs text-muted">Se activa automáticamente en la fecha y hora elegidas</p>
          </div>
        </label>
        {mode === 'schedule' && (
          <div className="px-3 pb-3">
            <EFDateTimePicker
              mode="datetime"
              headerLabel="Fecha y hora de publicación"
              value={publishAt}
              onChange={onPublishAtChange}
              placeholder="Elegir fecha de publicación…"
              clearable={false}
              defaultTime="07:00"
              minDateTime={toIsoNowLocal()}
            />
          </div>
        )}
      </div>
    </div>
  )
}
