import { useState } from 'react'
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../Toast'
import EFDateTimePicker from '../EFDateTimePicker'
import Spinner from '../Spinner'
import { X, Trash2, Copy } from 'lucide-react'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { refreshTeacherReminders } from '../../utils/localReminders'
import { subjectDisplayName } from '../../utils/subjectName'

export const EVENT_COLORS = [
  { id: 'slate',  bg: '#f1f5f9', text: '#475569', label: 'Gris' },
  { id: 'blue',   bg: '#dbeafe', text: '#1d4ed8', label: 'Azul' },
  { id: 'green',  bg: '#dcfce7', text: '#15803d', label: 'Verde' },
  { id: 'orange', bg: '#ffedd5', text: '#c2410c', label: 'Naranja' },
  { id: 'purple', bg: '#f3e8ff', text: '#7e22ce', label: 'Morado' },
  { id: 'rose',   bg: '#ffe4e6', text: '#be123c', label: 'Rojo' },
  { id: 'teal',   bg: '#ccfbf1', text: '#0d9488', label: 'Teal' },
]

export default function EventEditor({ event, defaultDate, subjects = [], onClose, onSaved, onDeleted }) {
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
    tipo: event?.tipo || 'personal',
    asignaturaId: event?.asignaturaId || '',
  })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // "Guardar cambios" se apaga sin cambios — compara contra `event`, que no
  // cambia mientras el modal sigue montado (lo abre/cierra el padre). Crear
  // siempre debe poder enviarse.
  const eventChanged = isNew || (
    form.titulo.trim() !== (event?.titulo || '') ||
    form.descripcion.trim() !== (event?.descripcion || '') ||
    form.notas.trim() !== (event?.notas || '') ||
    form.inicio !== (event?.inicio || '') ||
    form.fin !== (event?.fin || '') ||
    form.color !== (event?.color || 'blue') ||
    form.tipo !== (event?.tipo || 'personal') ||
    form.asignaturaId !== (event?.asignaturaId || '')
  )

  // Botón atrás físico (Android): si está pidiendo confirmación de borrado,
  // solo la cancela (no cierra todo el editor).
  useBackHandler(() => setConfirmDelete(false), confirmDelete)

  // Este componente solo se monta mientras está abierto (lo controla el padre).
  useScrollLock(true)

  // Personal y académico viven en colecciones DISTINTAS — ver el comentario
  // en firestore.rules sobre por qué `academicEvents` no puede ser solo un
  // campo `tipo` dentro de `events`: Firestore no puede autorizar un `list`
  // por asignaturaId si la regla depende de otro campo (docenteId/tipo) que
  // no es parte del filtro de la consulta.
  const collectionFor = (tipo) => (tipo === 'academico' ? 'academicEvents' : 'events')
  const originalCollection = event ? collectionFor(event.tipo || 'personal') : null

  async function handleSave(e) {
    e.preventDefault()
    if (!form.titulo.trim()) { toast('Escribe un título', 'error'); return }
    if (!form.inicio) { toast('Selecciona la fecha de inicio', 'error'); return }
    if (form.tipo === 'academico' && !form.asignaturaId) { toast('Elige la materia para el evento académico', 'error'); return }
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
        tipo: form.tipo,
        asignaturaId: form.tipo === 'academico' ? form.asignaturaId : null,
      }
      const targetCollection = collectionFor(form.tipo)
      if (isNew) {
        const ref = await addDoc(collection(db, targetCollection), { ...payload, createdAt: serverTimestamp() })
        onSaved?.({ id: ref.id, ...payload })
        toast('Evento creado')
      } else if (targetCollection === originalCollection) {
        await updateDoc(doc(db, targetCollection, event.id), payload)
        onSaved?.({ id: event.id, ...payload })
        toast('Evento actualizado')
      } else {
        // Cambió de tipo (personal ↔ académico): hay que moverlo de colección
        // — no hay una forma atómica de "renombrar" la colección de un doc.
        await deleteDoc(doc(db, originalCollection, event.id))
        const ref = await addDoc(collection(db, targetCollection), { ...payload, createdAt: serverTimestamp() })
        onSaved?.({ id: ref.id, ...payload })
        toast('Evento actualizado')
      }
      // Reprograma los recordatorios locales YA — si no, el aviso de "empieza
      // en X min" de este evento no se programa hasta el próximo login o
      // resume de la app (refreshTeacherReminders no se disparaba nunca al
      // crear/editar un evento, solo en esos otros momentos).
      refreshTeacherReminders(currentUser.uid)
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
      await deleteDoc(doc(db, originalCollection, event.id))
      onDeleted?.(event.id)
      toast('Evento eliminado')
      refreshTeacherReminders(currentUser.uid)
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
    if (form.tipo === 'academico' && !form.asignaturaId) { toast('Elige la materia para el evento académico', 'error'); return }
    setSaving(true)
    try {
      await addDoc(collection(db, collectionFor(form.tipo)), {
        titulo: form.titulo.trim(),
        descripcion: form.descripcion.trim(),
        notas: form.notas.trim(),
        inicio: form.inicio,
        fin: form.fin || form.inicio,
        color: form.color,
        docenteId: currentUser.uid,
        tipo: form.tipo,
        asignaturaId: form.tipo === 'academico' ? form.asignaturaId : null,
        createdAt: serverTimestamp(),
      })
      toast('Evento duplicado — arrástralo o edítalo para cambiar su horario')
      refreshTeacherReminders(currentUser.uid)
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
          {/* Color strip — pt-1: la bolita seleccionada crece (scale-110) y sin
              este espacio su borde superior se recortaba contra el borde del
              contenedor con scroll. */}
          <div className="flex gap-2 flex-wrap pt-1">
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

          <div className="space-y-1">
            <p className="text-xs text-muted font-medium">Tipo de evento</p>
            <div className="flex gap-1 bg-surface-container p-1 rounded-full">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, tipo: 'personal' }))}
                className={`flex-1 py-1.5 text-sm font-semibold rounded-full transition-colors ${
                  form.tipo === 'personal' ? 'bg-surface-card text-accent shadow-card' : 'text-muted hover:bg-accent-tint'
                }`}
              >
                Personal
              </button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, tipo: 'academico' }))}
                className={`flex-1 py-1.5 text-sm font-semibold rounded-full transition-colors ${
                  form.tipo === 'academico' ? 'bg-surface-card text-accent shadow-card' : 'text-muted hover:bg-accent-tint'
                }`}
              >
                Académico
              </button>
            </div>
            {form.tipo === 'academico' && (
              <>
                <p className="text-xs text-muted">Los alumnos de esta materia lo verán en su Agenda.</p>
                <select
                  value={form.asignaturaId}
                  onChange={e => setForm(f => ({ ...f, asignaturaId: e.target.value }))}
                  required
                  className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                >
                  <option value="">Elige una materia…</option>
                  {subjects.map(s => (
                    <option key={s.id} value={s.id}>{subjectDisplayName(s)}</option>
                  ))}
                </select>
              </>
            )}
          </div>

          <input
            type="text"
            value={form.titulo}
            onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
            placeholder="Título del evento"
            /* Sin autoFocus: en Android (edge-to-edge) enfocar un input y abrir
               el teclado justo al montar el modal deja el WebView con un
               frame en blanco hasta que algo más fuerza un repintado (p. ej.
               el botón físico de atrás) — bug conocido de Chromium/WebView
               con edge-to-edge + insets del teclado cambiando a mitad de la
               animación de entrada del modal. */
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
            <button type="submit" disabled={saving || !eventChanged}
              className="flex-1 py-2 bg-accent text-white font-semibold rounded text-sm disabled:opacity-60 flex items-center justify-center gap-2">
              {saving ? <Spinner size="sm" /> : isNew ? 'Crear evento' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
