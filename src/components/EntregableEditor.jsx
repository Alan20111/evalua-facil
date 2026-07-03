import { useState } from 'react'
import { collection, doc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from './Toast'
import Spinner from './Spinner'
import VisibilitySelect from './VisibilitySelect'
import RichTextEditor from './RichTextEditor'
import FileTypeSelect from './FileTypeSelect'
import { uploadToCloudinary } from '../utils/cloudinary'
import { sanitizeHtml, toRichHtml, htmlToPlainText } from '../utils/sanitizeHtml'
import { DEFAULT_FILE_TYPE, CUSTOM_FILE_TYPE, normalizeFileTypeKeys, parseCustomExts } from '../config/fileTypes'
import { ArrowLeft, Plus, Pencil, X } from 'lucide-react'
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

// Full-screen editor for Entregable activities (file submission / mark-complete).
// Mirrors the visual pattern of EvaluacionEditor so all activity creation/editing
// feels consistent regardless of type.
export default function EntregableEditor({
  activityId,         // null = new, string = editing existing
  parcial,
  categoria,          // 'entregable' or legacy value
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

  const [form, setForm] = useState(initialForm || {
    nombre: '', instrucciones: '', fechaLimite: '',
    tiposArchivo: [DEFAULT_FILE_TYPE], extensionesCustom: '',
    oculta: false, publishAt: '', publishedAt: '', visibilidadMode: 'show',
  })
  const [existingFiles, setExistingFiles] = useState(initialExistingFiles || [])
  const [newFiles, setNewFiles] = useState([])
  const [saving, setSaving] = useState(false)

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
    if (!htmlToPlainText(form.instrucciones)) {
      toast('Escribe las instrucciones de la actividad', 'error'); return
    }
    // Effective mode: a non-draft save of a never-published hidden activity
    // means PUBLISH NOW — keeping it draft is the explicit secondary button.
    const mode = !asDraft && form.visibilidadMode === 'hide' && !form.publishedAt
      ? 'show' : form.visibilidadMode
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
        fechaLimite: form.fechaLimite || null,
        tiposArchivo,
        extensionesCustom: tiposArchivo.includes(CUSTOM_FILE_TYPE) ? (form.extensionesCustom || '').trim() : '',
        oculta: asDraft || mode === 'schedule' || mode === 'hide',
        publishAt: !asDraft && mode === 'schedule' ? (form.publishAt || null) : null,
        publishedAt: newPublishedAt,
      }
      if (isNew) {
        const orden = existingActivities.filter((a) => a.parcial === parcial).length + 1
        const ref = await addDoc(collection(db, 'activities'), {
          ...payload, tipo: 'archivo', parcial, orden,
          asignaturaId: subjectId, docenteId, createdAt: serverTimestamp(),
        })
        onActivityCreated?.({ id: ref.id, ...payload, tipo: 'archivo', parcial, orden, asignaturaId: subjectId, docenteId })
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

  const tipoLabel = { actividad: 'Entregable', tarea: 'Entregable', entregable: 'Entregable' }[categoria] || 'Entregable'

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
            <h1 className="font-bold text-white truncate">{form.nombre || `${isNew ? 'Nueva actividad' : 'Editar actividad'}`}</h1>
          </div>
          {activityLabel && <span className="text-xs text-white/60 flex-shrink-0">{activityLabel}</span>}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Nombre de la actividad</label>
              <input type="text" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                required autoFocus placeholder="Ej: Tarea 1, Proyecto final"
                className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted mb-1">Instrucciones</label>
              <RichTextEditor
                value={form.instrucciones}
                onChange={(html) => setForm((f) => ({ ...f, instrucciones: html }))}
                placeholder="Describe la tarea para tus estudiantes…"
                attachments={[
                  ...existingFiles,
                  ...newFiles.map((f) => ({ nombre: f.name, tamano: f.size })),
                ]}
                onAttachFiles={addFiles}
                onRemoveAttachment={removeFile}
              />
            </div>

            <p className="text-sm text-muted">Calificación máxima: <span className="font-semibold text-on-surface">10</span></p>

            <div>
              <FileTypeSelect
                value={form.tiposArchivo}
                onChange={(v) => setForm((f) => ({ ...f, tiposArchivo: v }))}
                customExts={form.extensionesCustom}
                onCustomChange={(v) => setForm((f) => ({ ...f, extensionesCustom: v }))}
              />
            </div>
          </div>

          <div className="bg-surface-card rounded-card shadow-card p-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-muted mb-2">Visibilidad</label>
              <VisibilitySelect
                mode={form.visibilidadMode}
                publishAt={form.publishAt}
                publishedAt={form.publishedAt}
                wasScheduled={!isNew && !!initialForm?.publishAt && !initialForm?.publishedAt}
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

            {(form.visibilidadMode !== 'hide' || form.publishedAt) && (
              <div>
                <label className="block text-sm font-medium text-muted mb-1">{form.fechaLimite ? 'Modificar fecha límite' : 'Fecha límite (opcional)'}</label>
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
            )}
          </div>

          <button type="submit" disabled={saving || (!wasDraft && !isDirty)}
            className="w-full py-3 bg-accent text-white font-semibold rounded-card disabled:opacity-60 flex items-center justify-center gap-2">
            {saving ? <Spinner size="sm" /> : isNew ? <Plus size={18} /> : <Pencil size={18} />}
            {saving ? 'Guardando…' : isNew ? 'Crear actividad' : wasDraft ? 'Guardar y publicar' : 'Guardar cambios'}
          </button>
          {!form.publishedAt && (
            <button type="button" onClick={(e) => handleSave(e, true)} disabled={saving || (wasDraft && !isDirty)}
              className="w-full py-2.5 border border-accent text-accent font-medium rounded-card hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
              {wasDraft ? 'Guardar cambios del borrador sin publicar' : 'Guardar como borrador'}
            </button>
          )}
          {!isNew && (
            // With no changes, exiting is the natural action — it takes the primary style
            <button type="button" onClick={onClose} disabled={saving}
              className={`w-full py-2.5 font-medium rounded-card transition-colors disabled:opacity-60 ${(!isDirty && !wasDraft)
                ? 'bg-accent text-white font-semibold hover:bg-accent-hover'
                : 'border border-outline-variant text-muted hover:bg-surface-container'}`}>
              Salir sin guardar cambios
            </button>
          )}
          <div className="h-6" />
        </form>
      </div>
    </div>
  )
}
