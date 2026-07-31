import { useState } from 'react'
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../Toast'
import EFDateTimePicker from '../EFDateTimePicker'
import Spinner from '../Spinner'
import { X, Trash2 } from 'lucide-react'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { EVENT_COLORS } from '../calendar/EventEditor'

// Evento Personal del Estudiante — completamente privado, solo lo ve quien lo
// crea (colección `studentEvents`, ver firestore.rules: alumnoId == auth.uid).
// Mismo patrón que el EventEditor del docente, simplificado: sin recordatorios
// locales todavía (queda para cuando se integre con las notificaciones del
// alumno) y sin duplicar — un estudiante crea pocos eventos a la vez.
export default function StudentEventEditor({ event, defaultDate, onClose, onSaved, onDeleted }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const isNew = !event?.id

  const [form, setForm] = useState({
    titulo: event?.titulo || '',
    descripcion: event?.descripcion || '',
    inicio: event?.inicio || defaultDate || '',
    fin: event?.fin || '',
    color: event?.color || 'purple',
  })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useBackHandler(() => setConfirmDelete(false), confirmDelete)
  useScrollLock(true)

  async function handleSave(e) {
    e.preventDefault()
    if (!form.titulo.trim()) { toast('Escribe un título', 'error'); return }
    if (!form.inicio) { toast('Selecciona la fecha', 'error'); return }
    setSaving(true)
    try {
      const payload = {
        titulo: form.titulo.trim(),
        descripcion: form.descripcion.trim(),
        inicio: form.inicio,
        fin: form.fin || form.inicio,
        color: form.color,
        alumnoId: currentUser.uid,
      }
      if (isNew) {
        const ref = await addDoc(collection(db, 'studentEvents'), { ...payload, createdAt: serverTimestamp() })
        onSaved?.({ id: ref.id, ...payload })
        toast('Evento creado')
      } else {
        await updateDoc(doc(db, 'studentEvents', event.id), payload)
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
      await deleteDoc(doc(db, 'studentEvents', event.id))
      onDeleted?.(event.id)
      toast('Evento eliminado')
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={onClose} aria-label="Cerrar" />
      <div className="relative bg-surface-card rounded-card shadow-2xl w-full max-w-sm max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <h2 className="font-semibold text-on-surface">{isNew ? 'Nuevo evento personal' : 'Editar evento'}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1 text-muted hover:text-error rounded transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave} className="px-4 pb-4 space-y-3 overflow-y-auto flex-1">
          <div className="flex gap-2 flex-wrap pt-1">
            {EVENT_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setForm((f) => ({ ...f, color: c.id }))}
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
            onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
            placeholder="Título (ej. Estudiar para examen)"
            required
            className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
          />

          <textarea
            value={form.descripcion}
            onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
            placeholder="Descripción (opcional)"
            rows={2}
            className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-none"
          />

          <div className="space-y-1">
            <p className="text-xs text-muted font-medium">Fecha y hora</p>
            <EFDateTimePicker
              mode="datetime"
              value={form.inicio}
              onChange={(v) => setForm((f) => ({ ...f, inicio: v, fin: f.fin && f.fin < v ? v : f.fin }))}
              placeholder="Fecha y hora"
              clearable={false}
            />
          </div>

          <div className="flex gap-2 pt-1">
            {!isNew && (
              confirmDelete ? (
                <button type="button" onClick={handleDelete} disabled={saving} className="px-3 py-2 bg-error text-white rounded text-sm font-medium">
                  Confirmar eliminación
                </button>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className="p-2 text-muted hover:text-error rounded transition-colors" data-tooltip="Eliminar" aria-label="Eliminar">
                  <Trash2 size={18} />
                </button>
              )
            )}
            <button type="submit" disabled={saving} className="flex-1 py-2 bg-accent text-white font-semibold rounded text-sm disabled:opacity-60 flex items-center justify-center gap-2">
              {saving ? <Spinner size="sm" /> : isNew ? 'Crear evento' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
