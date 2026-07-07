import { useState } from 'react'
import { collection, doc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from './Toast'
import Spinner from './Spinner'
import VisibilitySelect from './VisibilitySelect'
import RichTextEditor from './RichTextEditor'
import FileTypeSelect from './FileTypeSelect'
import { uploadToCloudinary } from '../utils/cloudinary'
import { sanitizeHtml, htmlToPlainText } from '../utils/sanitizeHtml'
import { DEFAULT_FILE_TYPE, CUSTOM_FILE_TYPE, normalizeFileTypeKeys, parseCustomExts } from '../config/fileTypes'
import { ArrowLeft, Plus, Pencil } from 'lucide-react'
import EFDateTimePicker from './EFDateTimePicker'

const MAX_ATTACH = 15 * 1024 * 1024

function toIsoNow() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

// Returns ISO datetime string for "now + 2 hours", used as smart default for scheduled publication
function computeScheduleDefault() {
  const d = new Date(Date.now() + 2 * 60 * 60 * 1000)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

// Full-screen editor for Entregable activities (file submission / mark-complete)
// and Observación activities (no student submission — the teacher observes and
// grades directly: actitud, exposición, participación…). Mirrors the visual
// pattern of EvaluacionEditor so all activity creation/editing feels consistent.
export default function EntregableEditor({
  activityId,         // null = new, string = editing existing
  parcial,
  categoria,          // 'entregable', 'observacion' or legacy value
  subjectId,
  docenteId,
  existingActivities,
  activityLabel,      // e.g. "1.3" — null when creating new
  onClose,
  onActivityCreated,
  onActivityUpdated,
  initialForm,        // pre-filled when editing
  initialExistingFiles,
  contextLine,        // e.g. "Cultura digital I - 1A — Profe Kike Méndez"
}) {
  const toast = useToast()
  const isNew = !activityId
  // Observación: no file submission → file types and deadline don't apply,
  // and instructions are optional (the name alone often says it all).
  const isObservacion = categoria === 'observacion'

  const [form, setForm] = useState(initialForm || {
    nombre: '', instrucciones: '', fechaLimite: '',
    tiposArchivo: [DEFAULT_FILE_TYPE], extensionesCustom: '',
    oculta: false, publishAt: '', publishedAt: '', visibilidadMode: 'show',
    cerrarEntregasEnFecha: true,
  })
  const [existingFiles, setExistingFiles] = useState(initialExistingFiles || [])
  const [newFiles, setNewFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [showNewDeadline, setShowNewDeadline] = useState(false)
  const [newFechaLimite, setNewFechaLimite] = useState('')

  // Editing a saved draft: primary button becomes "Guardar y publicar" and
  // the secondary keeps it as a draft.
  const wasDraft = !isNew && !!initialForm && initialForm.oculta && !initialForm.publishedAt && !initialForm.publishAt

  // Dirty check: save buttons stay disabled while nothing changed. Publishing
  // a draft is an action by itself, so "Guardar y publicar" ignores it.
  const isDirty = isNew
    || JSON.stringify(form) !== JSON.stringify(initialForm)
    || newFiles.length > 0
    || existingFiles.length !== (initialExistingFiles || []).length

  function addFiles(files) {
    const tooBig = files.find((f) => f.size > MAX_ATTACH)
    if (tooBig) { toast(`"${tooBig.name}" supera el máximo de 15 MB`, 'error'); return }
    setNewFiles((prev) => [...prev, ...files])
  }

  function removeFile(index) {
    if (index < existingFiles.length) {
      setExistingFiles((prev) => prev.filter((_, i) => i !== index))
    } else {
      setNewFiles((prev) => prev.filter((_, i) => i !== index - existingFiles.length))
    }
  }

  // asDraft: save hidden with NO publication — a borrador. It only becomes
  // published when the teacher publishes it (here or via the card's eye icon).
  async function handleSave(e, asDraft = false) {
    e.preventDefault()
    const tiposArchivo = normalizeFileTypeKeys(form.tiposArchivo)
    if (tiposArchivo.includes(CUSTOM_FILE_TYPE) && parseCustomExts(form.extensionesCustom).length === 0) {
      toast('Escribe al menos una extensión para "Personalizado"', 'error'); return
    }
    if (!isObservacion && !htmlToPlainText(form.instrucciones)) {
      toast('Escribe las instrucciones de la actividad', 'error'); return
    }
    // Effective mode: a non-draft save of a never-published hidden activity
    // means PUBLISH NOW — keeping it draft is the explicit secondary button.
    const mode = !asDraft && form.visibilidadMode === 'hide' && !form.publishedAt
      ? 'show' : form.visibilidadMode
    // A scheduled publication must be in the future
    if (!asDraft && mode === 'schedule') {
      if (!form.publishAt) { toast('Elige la fecha y hora de publicación', 'error'); return }
      if (form.publishAt <= toIsoNow()) {
        toast('La fecha de publicación programada debe ser posterior a este momento', 'error'); return
      }
    }
    // Backend validation: fechaLimite must be strictly after the effective publish datetime
    const effectivePublishAt = asDraft ? null :
      mode === 'show'      ? toIsoNow() :
      mode === 'published' ? (form.publishedAt || null) :
      mode === 'schedule'  ? (form.publishAt || null) :
      (form.publishedAt || null)  // hide: published-then-hidden still validates vs original date
    if (form.fechaLimite && effectivePublishAt) {
      if (form.fechaLimite <= effectivePublishAt) {
        toast('La fecha límite debe ser posterior a la fecha de publicación', 'error'); return
      }
    }

    setSaving(true)
    try {
      const uploaded = await Promise.all(
        newFiles.map(async (file) => ({
          url: await uploadToCloudinary(file, 'evalua-facil/instrucciones-adjuntos'),
          nombre: file.name, tamano: file.size,
        }))
      )
      // Determine publishedAt for this save — once set it is permanent:
      // hiding a published activity keeps the original publication date
      const newPublishedAt =
        !asDraft && mode === 'show' ? toIsoNow() : (form.publishedAt || null)
      const payload = {
        nombre: form.nombre.trim(),
        categoria: categoria || 'entregable',
        maxCalif: 10,
        instrucciones: sanitizeHtml(form.instrucciones),
        archivosAdjuntos: [...existingFiles, ...uploaded],
        fechaLimite: isObservacion ? null : (form.fechaLimite || null),
        tiposArchivo,
        extensionesCustom: tiposArchivo.includes(CUSTOM_FILE_TYPE) ? (form.extensionesCustom || '').trim() : '',
        oculta: asDraft || mode === 'schedule' || mode === 'hide',
        publishAt: !asDraft && mode === 'schedule' ? (form.publishAt || null) : null,
        publishedAt: newPublishedAt,
        cerrarEntregasEnFecha: isObservacion ? null : (form.cerrarEntregasEnFecha ?? true),
      }
      const tipo = isObservacion ? 'observacion' : 'archivo'
      if (isNew) {
        const orden = existingActivities.filter((a) => a.parcial === parcial).length + 1
        const ref = await addDoc(collection(db, 'activities'), {
          ...payload, tipo, parcial, orden,
          asignaturaId: subjectId, docenteId, createdAt: serverTimestamp(),
        })
        onActivityCreated?.({ id: ref.id, ...payload, tipo, parcial, orden, asignaturaId: subjectId, docenteId })
        toast(asDraft ? 'Borrador guardado — oculto para estudiantes' : 'Actividad creada')
      } else {
        await updateDoc(doc(db, 'activities', activityId), payload)
        onActivityUpdated?.({ id: activityId, ...payload })
        toast(asDraft ? 'Borrador guardado — oculto para estudiantes' : wasDraft && mode === 'show' ? 'Actividad publicada para estudiantes' : 'Actividad actualizada')
      }
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const tipoLabel = { actividad: 'Entregable', tarea: 'Entregable', entregable: 'Entregable', observacion: 'Observación' }[categoria] || 'Entregable'

  return (
    <div className="fixed inset-0 z-50 bg-surface overflow-y-auto">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-accent text-white shadow-lg">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={onClose} className="p-2 -ml-2 rounded hover:bg-white/10 transition-colors flex-shrink-0">
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            {contextLine && <p className="text-xl font-bold text-white truncate">{contextLine}</p>}
            <p className="text-xs text-white/70 uppercase tracking-wide">{tipoLabel} — Parcial {parcial}</p>
            {/* Big name + number (only published activities have a label; drafts don't) */}
            <h1 className="text-2xl font-extrabold text-white truncate flex items-baseline gap-2">
              {activityLabel && <span className="text-white/90">{activityLabel}</span>}
              <span className="truncate">{form.nombre || `${isNew ? 'Nueva actividad' : 'Editar actividad'}`}</span>
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Nombre de la actividad</label>
              <input type="text" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                required autoFocus
                placeholder={isObservacion ? 'Ej: Actitud, Exposición de tema, Participación' : 'Ej: Tarea 1, Proyecto final'}
                className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted mb-1">
                Instrucciones{isObservacion && <span className="text-slate-400 font-normal"> (opcional)</span>}
              </label>
              <RichTextEditor
                value={form.instrucciones}
                onChange={(html) => setForm((f) => ({ ...f, instrucciones: html }))}
                placeholder={isObservacion ? 'Describe qué vas a observar y cómo lo calificas…' : 'Describe la tarea para tus estudiantes…'}
                attachments={[
                  ...existingFiles,
                  ...newFiles.map((f) => ({ nombre: f.name, tamano: f.size })),
                ]}
                onAttachFiles={addFiles}
                onRemoveAttachment={removeFile}
              />
            </div>

            <p className="text-sm text-muted">Calificación máxima: <span className="font-semibold text-on-surface">10</span></p>

            {!isObservacion && (
              <div>
                <FileTypeSelect
                  value={form.tiposArchivo}
                  onChange={(v) => setForm((f) => ({ ...f, tiposArchivo: v }))}
                  customExts={form.extensionesCustom}
                  onCustomChange={(v) => setForm((f) => ({ ...f, extensionesCustom: v }))}
                />
              </div>
            )}
          </div>

          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-muted mb-2">Visibilidad</label>
              <VisibilitySelect
                mode={form.visibilidadMode}
                publishAt={form.publishAt}
                publishedAt={form.publishedAt}
                wasScheduled={!isNew && !!initialForm?.publishAt && !initialForm?.publishedAt}
                isDraft={wasDraft}
                onModeChange={(mode) => setForm((f) => ({
                  ...f, visibilidadMode: mode,
                  // 9.1: auto-fill publishAt with now+2h when switching to schedule for the first time
                  publishAt: mode === 'schedule' ? (f.publishAt || computeScheduleDefault()) : '',
                  // hiding a never-published draft clears the deadline; a published
                  // activity keeps it (hide is temporary, deadline still applies)
                  fechaLimite: mode === 'hide' && !f.publishedAt ? '' : f.fechaLimite,
                }))}
                onPublishAtChange={(v) => setForm((f) => ({ ...f, publishAt: v }))}
              />
            </div>

            {!isObservacion && (form.visibilidadMode !== 'hide' || form.publishedAt) && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">{form.fechaLimite ? 'Fecha límite de entrega' : 'Fecha límite (opcional)'}</label>
                  {form.visibilidadMode === 'schedule' && !form.publishAt ? (
                    <p className="text-xs text-slate-400 px-1">Primero elige la fecha de publicación arriba.</p>
                  ) : (
                    <EFDateTimePicker
                      mode="datetime"
                      headerLabel="Fecha y hora límite"
                      value={form.fechaLimite}
                      onChange={v => setForm(f => ({ ...f, fechaLimite: v }))}
                      placeholder="Sin fecha límite…"
                      clearable
                      defaultTime="23:59"
                      defaultDate={
                        // 9.2: open on publish date when no fechaLimite yet; fall back to today
                        (form.publishAt || form.publishedAt || '').split('T')[0] || undefined
                      }
                      minDateTime={
                        form.visibilidadMode === 'schedule' ? (form.publishAt || undefined) :
                        (form.publishedAt || undefined)
                      }
                    />
                  )}
                </div>

                {form.fechaLimite && (
                  <div className="flex items-start gap-3 p-3 bg-slate-50 rounded border border-outline-variant">
                    <input
                      type="checkbox"
                      id="cerrarEntregasEnFecha"
                      checked={form.cerrarEntregasEnFecha ?? true}
                      onChange={(e) => setForm(f => ({ ...f, cerrarEntregasEnFecha: e.target.checked }))}
                      className="mt-1"
                      data-tooltip="Desactivar para recibir tarde"
                    />
                    <label htmlFor="cerrarEntregasEnFecha" className="text-sm font-medium text-on-surface cursor-pointer flex-1">
                      Cerrar entregas en la fecha y hora programada
                      <span data-tooltip="Desactivar para recibir tarde" className="text-muted text-xs block mt-0.5">Desactivar para recibir entregas retrasadas</span>
                    </label>
                  </div>
                )}

                {form.fechaLimite && (
                  !showNewDeadline ? (
                    <button
                      type="button"
                      onClick={() => setShowNewDeadline(true)}
                      className="w-full py-2 text-sm border border-accent text-accent rounded hover:bg-[var(--accent-tint)] transition-colors"
                    >
                      Nueva fecha límite de entrega
                    </button>
                  ) : (
                    <div className="space-y-2 p-3 bg-slate-50 rounded border border-accent">
                      <label className="block text-sm font-medium text-on-surface">Cambiar a una nueva fecha límite</label>
                      <EFDateTimePicker
                        mode="datetime"
                        headerLabel="Nueva fecha y hora límite"
                        value={newFechaLimite}
                        onChange={setNewFechaLimite}
                        placeholder="Selecciona la nueva fecha…"
                        clearable={false}
                        defaultTime="23:59"
                        minDateTime={form.fechaLimite}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowNewDeadline(false)
                            setNewFechaLimite('')
                          }}
                          className="flex-1 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (newFechaLimite) {
                              setForm(f => ({ ...f, fechaLimite: newFechaLimite }))
                              setShowNewDeadline(false)
                              setNewFechaLimite('')
                            }
                          }}
                          disabled={!newFechaLimite}
                          className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-50 transition-colors"
                        >
                          Confirmar
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {wasDraft && form.visibilidadMode === 'hide' ? (
            // Draft with "Borrador" selected: the only save action keeps it as draft
            <button type="button" onClick={(e) => handleSave(e, true)} disabled={saving || !isDirty}
              className="w-full py-3 bg-accent text-white font-semibold rounded-card disabled:opacity-60 flex items-center justify-center gap-2">
              {saving ? <Spinner size="sm" /> : <Pencil size={18} />}
              {saving ? 'Guardando…' : 'Guardar borrador y salir'}
            </button>
          ) : (
            <>
              <button type="submit" disabled={saving || (!wasDraft && !isDirty)}
                className="w-full py-3 bg-accent text-white font-semibold rounded-card disabled:opacity-60 flex items-center justify-center gap-2">
                {saving ? <Spinner size="sm" /> : isNew ? <Plus size={18} /> : <Pencil size={18} />}
                {saving ? 'Guardando…' : isNew ? 'Crear actividad' : wasDraft ? (form.visibilidadMode === 'schedule' ? 'Guardar con la fecha programada' : 'Guardar y publicar ahora') : 'Guardar cambios'}
              </button>
              {!form.publishedAt && !wasDraft && (
                <button type="button" onClick={(e) => handleSave(e, true)} disabled={saving}
                  className="w-full py-2.5 border border-accent text-accent font-medium rounded-card hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                  Guardar como borrador
                </button>
              )}
            </>
          )}
          {!isNew && (
            // With no changes, exiting is the natural action — it takes the primary style
            <button type="button" onClick={onClose} disabled={saving}
              className={`w-full py-2.5 font-medium rounded-card transition-colors disabled:opacity-60 ${(!isDirty && (!wasDraft || form.visibilidadMode === 'hide'))
                ? 'bg-accent text-white font-semibold hover:bg-accent-hover'
                : 'border border-outline-variant text-muted hover:bg-surface-container'}`}>
              {isDirty ? 'Salir sin guardar cambios' : 'Salir'}
            </button>
          )}
          <div className="h-6" />
        </form>
      </div>
    </div>
  )
}
