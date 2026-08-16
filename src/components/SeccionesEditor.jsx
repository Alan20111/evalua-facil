import { useState } from 'react'
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, X, FolderOpen } from 'lucide-react'
import ConfirmModal from './ConfirmModal'

// Piezas de interfaz de las SECCIONES de una evaluación, compartidas por los
// dos lugares donde se arman los reactivos: EvaluacionEditor (pantalla
// completa) y la pestaña Preguntas de EvaluacionManager. Los dos ya tenían su
// propia copia del formulario de reactivos; lo de secciones se escribe UNA vez
// y se usa en los dos.
//
// Aquí solo vive la presentación: quién guarda, en qué documento y cómo se
// reordena lo deciden los editores (ver useSecciones más abajo, que es la parte
// compartida de esa lógica).

// Formulario de una sección — nombre obligatorio, descripción opcional.
export function SeccionForm({ inicial, onGuardar, onCancelar, guardando }) {
  const [nombre, setNombre] = useState(inicial?.nombre || '')
  const [descripcion, setDescripcion] = useState(inicial?.descripcion || '')
  const esNueva = !inicial?.id

  function submit(e) {
    e.preventDefault()
    if (!nombre.trim()) return
    onGuardar({ nombre: nombre.trim(), descripcion: descripcion.trim() })
  }

  return (
    <form onSubmit={submit} className="rounded-card border-2 p-3 space-y-2" style={{ borderColor: 'var(--accent)', background: 'var(--accent-light)' }}>
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>
        {esNueva ? 'Nueva sección' : 'Editando sección'}
      </p>
      <div>
        <label htmlFor="seccion-nombre" className="block text-sm font-medium text-muted mb-1">Nombre de la sección</label>
        <input
          id="seccion-nombre"
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          maxLength={120}
          placeholder="Ej. Comprensión lectora"
          className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface"
        />
      </div>
      <div>
        <label htmlFor="seccion-descripcion" className="block text-sm font-medium text-muted mb-1">
          Descripción <span className="text-slate-400 font-normal">(opcional)</span>
        </label>
        <textarea
          id="seccion-descripcion"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={2}
          maxLength={400}
          placeholder="Qué se evalúa en esta sección"
          className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface"
        />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={guardando || !nombre.trim()}
          className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold disabled:opacity-60">
          {guardando ? 'Guardando…' : esNueva ? 'Crear sección' : 'Guardar'}
        </button>
        <button type="button" onClick={onCancelar} disabled={guardando}
          className="px-4 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors">
          Cancelar
        </button>
      </div>
    </form>
  )
}

// Encabezado de una sección dentro de la lista de reactivos: su nombre, su
// descripción y sus acciones (subir/bajar, editar, eliminar, agregar reactivo
// aquí). `total` es cuántos reactivos tiene, para que se vea de un vistazo.
export function SeccionHeader({
  seccion, total, primera, ultima,
  onMover, onEditar, onEliminar, onAgregarReactivo, disabled,
}) {
  return (
    <div className="rounded-card px-3 py-2" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent)' }}>
      <div className="flex items-start gap-2">
        <FolderOpen size={17} className="text-accent flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-on-surface break-words">
            {seccion.nombre}
            <span className="ml-1.5 text-xs font-normal text-muted">
              ({total} {total === 1 ? 'reactivo' : 'reactivos'})
            </span>
          </p>
          {seccion.descripcion && (
            <p className="text-xs text-muted mt-0.5 break-words whitespace-pre-wrap">{seccion.descripcion}</p>
          )}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button type="button" onClick={() => onMover('up')} disabled={disabled || primera}
            aria-label="Subir sección" data-tooltip="Subir sección"
            className="p-2 text-slate-400 hover:text-accent rounded disabled:opacity-40">
            <ChevronUp size={16} />
          </button>
          <button type="button" onClick={() => onMover('down')} disabled={disabled || ultima}
            aria-label="Bajar sección" data-tooltip="Bajar sección"
            className="p-2 text-slate-400 hover:text-accent rounded disabled:opacity-40">
            <ChevronDown size={16} />
          </button>
          <button type="button" onClick={onEditar} disabled={disabled}
            aria-label="Editar sección" data-tooltip="Editar sección"
            className="p-2 text-slate-400 hover:text-accent rounded disabled:opacity-40">
            <Pencil size={15} />
          </button>
          <button type="button" onClick={onEliminar} disabled={disabled}
            aria-label="Eliminar sección" data-tooltip="Eliminar sección"
            className="p-2 text-slate-400 hover:text-error rounded disabled:opacity-40">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {onAgregarReactivo && (
        <button type="button" onClick={onAgregarReactivo} disabled={disabled}
          className="mt-1.5 w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-dashed border-accent text-accent text-xs font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-40">
          <Plus size={14} /> Agregar reactivo a esta sección
        </button>
      )}
    </div>
  )
}

// Confirmación de borrado: lo que de verdad importa es qué pasa con sus
// reactivos, y la respuesta es que NO se borran — se quedan fuera de toda
// sección. Borrar un contenedor no debe borrar el trabajo que hay dentro.
export function ConfirmarBorrarSeccion({ seccion, total, borrando, onConfirm, onCancel }) {
  return (
    <ConfirmModal
      title={`¿Eliminar la sección “${seccion.nombre}”?`}
      message={total > 0
        ? `Sus ${total} ${total === 1 ? 'reactivo' : 'reactivos'} NO se borran: quedan fuera de toda sección y los puedes mover a otra cuando quieras.`
        : 'La sección está vacía, no se pierde ningún reactivo.'}
      confirmLabel="Eliminar sección"
      confirmingLabel="Eliminando…"
      confirmIcon={<Trash2 size={16} />}
      danger
      busy={borrando}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}

// Botón "+ Agregar sección" — el punto de entrada de toda la funcionalidad.
export function BotonAgregarSeccion({ onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="w-full flex items-center justify-center gap-1.5 py-2 rounded border border-accent text-accent text-sm font-medium hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
      <Plus size={15} /> Agregar sección
    </button>
  )
}

// Selector de sección dentro del formulario de un reactivo — para moverlo de
// una sección a otra sin tener que borrarlo y volverlo a crear. Solo aparece si
// el instrumento tiene al menos una sección.
export function SelectorSeccion({ id, secciones, valor, onChange }) {
  if (!secciones.length) return null
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-muted mb-1">Sección</label>
      <select
        id={id}
        value={valor || ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface"
      >
        <option value="">Sin sección</option>
        {secciones.map((s) => (
          <option key={s.id} value={s.id}>{s.nombre}</option>
        ))}
      </select>
    </div>
  )
}

// Cerrar el formulario de sección desde el encabezado de la lista.
export function CerrarFormulario({ onClick }) {
  return (
    <button type="button" onClick={onClick} aria-label="Cancelar" className="p-2 text-slate-400 hover:text-muted rounded">
      <X size={18} />
    </button>
  )
}
