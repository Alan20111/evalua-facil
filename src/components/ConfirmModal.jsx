import { X } from 'lucide-react'
import { Button, IconButton, Modal } from './ui'

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
  confirmIcon = null, danger = false, busy = false, onConfirm, onCancel, showClose = true, z = 50,
}) {
  return (
    <Modal open onClose={onCancel} variant="centered" size="sm" padding="p-4" busy={busy} z={z} ariaLabel={title}>
      {showClose && (
        <IconButton icon={X} label="Cerrar" tooltip={false} onClick={() => !busy && onCancel()} className="absolute top-2 right-2" />
      )}
      <h3 className={`text-base font-semibold text-on-surface mb-2 ${showClose ? 'pr-10' : 'mb-1'}`}>{title}</h3>
      <p className="text-sm text-muted mb-4 leading-relaxed">{message}</p>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} className="flex-1" onClick={onConfirm} busy={busy}>
          {!busy && confirmIcon}
          {busy ? confirmingLabel : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
