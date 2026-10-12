import { useState } from 'react'
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, X, FolderOpen } from 'lucide-react'
import ConfirmModal from './ConfirmModal'
import { Input, Button, IconButton } from './ui'
import { ICONO } from '../config/iconos'

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
      <Input
        label="Nombre de la sección"
        id="seccion-nombre"
        type="text"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        required
        maxLength={120}
      />
      <div>
        <label htmlFor="seccion-descripcion" className="block text-sm font-medium text-muted mb-1">
          Descripción <span className="text-hint font-normal">(opcional)</span>
        </label>
        <textarea
          id="seccion-descripcion"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={2}
          maxLength={400}
          className="w-full px-3 py-2 rounded-card border border-outline-variant text-sm bg-surface"
        />
      </div>
      <div className="flex gap-2">
        <Button className="flex-1" type="submit" disabled={guardando || !nombre.trim()}>
          {guardando ? 'Guardando…' : esNueva ? 'Crear sección' : 'Guardar'}
        </Button>
        <Button variant="secondary" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Button>
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
    <div className="rounded-card px-3 py-2" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-soft)' }}>
      <div className="flex items-start gap-2">
        <FolderOpen size={ICONO.sm} className="text-accent flex-shrink-0 mt-0.5" />
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
          <IconButton icon={ChevronUp} label="Subir sección" tooltip={false} onClick={() => onMover('up')} disabled={disabled || primera}
            data-tooltip="Subir sección" />
          <IconButton icon={ChevronDown} label="Bajar sección" tooltip={false} onClick={() => onMover('down')} disabled={disabled || ultima}
            data-tooltip="Bajar sección" />
          <IconButton icon={Pencil} label="Editar sección" tooltip={false} onClick={onEditar} disabled={disabled}
            data-tooltip="Editar sección" />
          <IconButton icon={Trash2} label="Eliminar sección" tooltip={false} onClick={onEliminar} disabled={disabled}
            data-tooltip="Eliminar sección" />
        </div>
      </div>
      {onAgregarReactivo && (
        <button type="button" onClick={onAgregarReactivo} disabled={disabled}
          className="mt-1.5 w-full flex items-center justify-center gap-1.5 py-2 rounded-full border border-dashed border-accent-soft text-accent text-xs font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-40 min-h-control-sm">
          <Plus size={ICONO.xs} /> Agregar reactivo a esta sección
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
      confirmIcon={<Trash2 size={ICONO.sm} />}
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
    <Button variant="outline-accent" fullWidth icon={Plus} onClick={onClick} disabled={disabled}>
       Agregar sección
    </Button>
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
        className="w-full px-3 py-2 rounded-full border border-outline-variant text-sm bg-surface"
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
    <IconButton icon={X} label="Cancelar" tooltip={false} onClick={onClick} />
  )
}
