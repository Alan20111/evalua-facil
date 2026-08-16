import { X } from 'lucide-react'
import Spinner from './Spinner'
import Modal from './ui/Modal'

// Modal de confirmación genérico — antes esta misma estructura (fondo,
// título, mensaje, Cancelar/Confirmar, X para cerrar) estaba copiada a mano
// en Layout.jsx (cerrar sesión), Profile.jsx (confirmaciones varias) y
// NotificationSettings.jsx (borrar notificación de la Bitácora).
//
// Etapa 1 (componentización): ahora el envoltorio (wrapper + backdrop canónico
// + panel centrado) lo aporta ui/Modal; este componente solo define el
// contenido de confirmación, idéntico a antes (título text-base, X propia
// arriba-derecha, botones Cancelar/Confirmar — su migración a ui/Button es de
// la Etapa 2).
export default function ConfirmModal({
  title, message, confirmLabel = 'Confirmar', confirmingLabel = 'Procesando…',
  confirmIcon = null, danger = false, busy = false, onConfirm, onCancel, showClose = true,
}) {
  return (
    <Modal open onClose={onCancel} variant="centered" size="sm" padding="p-4" busy={busy} ariaLabel={title}>
      {showClose && (
        <button type="button" onClick={() => !busy && onCancel()} aria-label="Cerrar"
          className="absolute top-4 right-4 p-3 -m-1 text-slate-400 hover:text-muted rounded">
          <X size={20} />
        </button>
      )}
      <h3 className={`text-base font-semibold text-on-surface mb-2 ${showClose ? 'pr-6' : 'mb-1'}`}>{title}</h3>
      <p className="text-sm text-muted mb-4 leading-relaxed">{message}</p>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={busy}
          className="flex-1 py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
          Cancelar
        </button>
        <button type="button" onClick={onConfirm} disabled={busy}
          className={`flex-1 py-2 rounded text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-accent hover:bg-accent-hover'}`}>
          {busy ? <Spinner size="sm" /> : confirmIcon}
          {busy ? confirmingLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
