import { useState } from 'react'
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../Toast'
import EFDateTimePicker from '../EFDateTimePicker'
import Spinner from '../Spinner'
import { X, Trash2, Copy } from 'lucide-react'
import { useBackHandler } from '../../hooks/useBackHandler'

export const EVENT_COLORS = [
  { id: 'slate',  bg: '#f1f5f9', text: '#475569', label: 'Gris' },
  { id: 'blue',   bg: '#dbeafe', text: '#1d4ed8', label: 'Azul' },
  { id: 'green',  bg: '#dcfce7', text: '#15803d', label: 'Verde' },
  { id: 'orange', bg: '#ffedd5', text: '#c2410c', label: 'Naranja' },
  { id: 'purple', bg: '#f3e8ff', text: '#7e22ce', label: 'Morado' },
  { id: 'rose',   bg: '#ffe4e6', text: '#be123c', label: 'Rojo' },
  { id: 'teal',   bg: '#ccfbf1', text: '#0d9488', label: 'Teal' },
]

export default function EventEditor({ event, defaultDate, onClose, onSaved, onDeleted }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const isNew = !event?.id

  const [form, setForm] = useState({
    titulo: event?.titulo || '',
    descripcion: event?.descripcion || '',
    notas: event?.notas || '',
    inicio: event?.inicio || defaultDate || '',
    fin: event?.fin || '',
    color: event?.color || 'blue',
  })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Botón atrás físico (Android): si está pidiendo confirmación de borrado,
  // solo la cancela (no cierra todo el editor).
  useBackHandler(() => setConfirmDelete(false), confirmDelete)

  async function handleSave(e) {
    e.preventDefault()
    if (!form.titulo.trim()) { toast('Escribe un título', 'error'); return }
    if (!form.inicio) { toast('Selecciona la fecha de inicio', 'error'); return }
    setSaving(true)
    try {
      const payload = {
        titulo: form.titulo.trim(),
        descripcion: form.descripcion.trim(),
        notas: form.notas.trim(),
        inicio: form.inicio,
        fin: form.fin || form.inicio,
        color: form.color,
        docenteId: currentUser.uid,
      }
      if (isNew) {
        const ref = await addDoc(collection(db, 'events'), { ...payload, createdAt: serverTimestamp() })
        onSaved?.({ id: ref.id, ...payload })
        toast('Evento creado')
      } else {
        await updateDoc(doc(db, 'events', event.id), payload)
        onSaved?.({ id: event.id, ...payload })
        toast('Evento actualizado')
      }
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setSaving(true)
    try {
      await deleteDoc(doc(db, 'events', event.id))
      onDeleted?.(event.id)
      toast('Evento eliminado')
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // Duplicar: crea una copia con lo que está en pantalla (mismo horario) —
  // el docente después la arrastra o la edita para acomodarla.
  async function handleDuplicate() {
    if (!form.titulo.trim() || !form.inicio) { toast('Completa el título y el inicio para duplicar', 'error'); return }
    setSaving(true)
    try {
      await addDoc(collection(db, 'events'), {
        titulo: form.titulo.trim(),
        descripcion: form.descripcion.trim(),
        notas: form.notas.trim(),
        inicio: form.inicio,
        fin: form.fin || form.inicio,
        color: form.color,
        docenteId: currentUser.uid,
        createdAt: serverTimestamp(),
      })
      toast('Evento duplicado — arrástralo o edítalo para cambiar su horario')
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 border-none cursor-default"
        onClick={onClose}
        aria-label="Cerrar"
      />
      <div className="relative bg-surface-card rounded-card shadow-2xl w-full max-w-sm max-h-[90vh] flex flex-col">
        {/* Encabezado fijo: no se desplaza aunque el teclado empuje el campo
            enfocado hacia arriba (el body con overflow-y-auto es lo único
            que se desplaza). */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <h2 className="font-semibold text-on-surface">{isNew ? 'Nuevo evento' : 'Editar evento'}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1 text-muted hover:text-error rounded transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave} className="px-4 pb-4 space-y-3 overflow-y-auto flex-1">
          {/* Color strip */}
          <div className="flex gap-2 flex-wrap">
            {EVENT_COLORS.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => setForm(f => ({ ...f, color: c.id }))}
                className={`w-6 h-6 rounded-full border-2 transition-all ${form.color === c.id ? 'border-on-surface scale-110' : 'border-transparent'}`}
                style={{ background: c.bg }}
                data-tooltip={c.label}
                aria-label={c.label}
              />
            ))}
          </div>

          <input
            type="text"
            value={form.titulo}
            onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
            placeholder="Título del evento"
            /* autofocus: primer campo del modal, abierto con intención de escribir */
            autoFocus
            required
            className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
          />

          <textarea
            value={form.descripcion}
            onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
            placeholder="Descripción (opcional)"
            rows={2}
            className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-none"
          />

          <div className="space-y-1">
            <label htmlFor="event-notas" className="text-xs text-muted font-medium">Notas</label>
            <textarea
              id="event-notas"
              value={form.notas}
              onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
              placeholder="Escribe aquí tus notas del evento; se quedan guardadas"
              rows={3}
              className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-y"
            />
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted font-medium">Inicio</p>
            <EFDateTimePicker
              mode="datetime"
              value={form.inicio}
              onChange={v => setForm(f => ({ ...f, inicio: v, fin: f.fin && f.fin < v ? v : f.fin }))}
              placeholder="Fecha y hora de inicio"
              clearable={false}
            />
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted font-medium">Fin (opcional)</p>
            <EFDateTimePicker
              mode="datetime"
              value={form.fin}
              onChange={v => setForm(f => ({ ...f, fin: v }))}
              placeholder="Fecha y hora de fin (opcional)"
              clearable
            />
          </div>

          <div className="flex gap-2 pt-1">
            {!isNew && (
              confirmDelete ? (
                <button type="button" onClick={handleDelete} disabled={saving}
                  className="px-3 py-2 bg-error text-white rounded text-sm font-medium">
                  Confirmar eliminación
                </button>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)}
                  className="p-2 text-muted hover:text-error rounded transition-colors" data-tooltip="Eliminar" aria-label="Eliminar">
                  <Trash2 size={18} />
                </button>
              )
            )}
            {!isNew && !confirmDelete && (
              <button type="button" onClick={handleDuplicate} disabled={saving}
                className="p-2 text-muted hover:text-accent rounded transition-colors" data-tooltip="Duplicar" aria-label="Duplicar">
                <Copy size={18} />
              </button>
            )}
            <button type="submit" disabled={saving}
              className="flex-1 py-2 bg-accent text-white font-semibold rounded text-sm disabled:opacity-60 flex items-center justify-center gap-2">
              {saving ? <Spinner size="sm" /> : isNew ? 'Crear evento' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
