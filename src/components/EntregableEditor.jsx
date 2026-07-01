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

  async function handleSave(e) {
    e.preventDefault()
    const tiposArchivo = normalizeFileTypeKeys(form.tiposArchivo)
    if (tiposArchivo.includes(CUSTOM_FILE_TYPE) && parseCustomExts(form.extensionesCustom).length === 0) {
      toast('Escribe al menos una extensión para "Personalizado"', 'error'); return
    }
    if (!htmlToPlainText(form.instrucciones)) {
      toast('Escribe las instrucciones de la actividad', 'error'); return
    }
    // Backend validation: fechaLimite must be strictly after the effective publish datetime
    const effectivePublishAt =
      form.visibilidadMode === 'show'      ? toIsoNow() :
      form.visibilidadMode === 'published' ? (form.publishedAt || null) :
      form.visibilidadMode === 'schedule'  ? (form.publishAt || null) :
      null
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
      // Determine publishedAt for this save
      const newPublishedAt =
        form.visibilidadMode === 'show'      ? toIsoNow() :
        form.visibilidadMode === 'published' ? (form.publishedAt || null) :
        null  // schedule/hide clears it
      const payload = {
        nombre: form.nombre.trim(),
        categoria: categoria || 'entregable',
        maxCalif: 10,
        instrucciones: sanitizeHtml(form.instrucciones),
        archivosAdjuntos: [...existingFiles, ...uploaded],
        fechaLimite: form.fechaLimite || null,
        tiposArchivo,
        extensionesCustom: tiposArchivo.includes(CUSTOM_FILE_TYPE) ? (form.extensionesCustom || '').trim() : '',
        oculta: form.visibilidadMode === 'schedule' || form.visibilidadMode === 'hide',
        publishAt: form.visibilidadMode === 'schedule' ? (form.publishAt || null) : null,
        publishedAt: newPublishedAt,
      }
      if (isNew) {
        const orden = existingActivities.filter((a) => a.parcial === parcial).length + 1
        const ref = await addDoc(collection(db, 'activities'), {
          ...payload, tipo: 'archivo', parcial, orden,
          asignaturaId: subjectId, docenteId, createdAt: serverTimestamp(),
        })
        onActivityCreated?.({ id: ref.id, ...payload, tipo: 'archivo', parcial, orden, asignaturaId: subjectId, docenteId })
        toast('Actividad creada')
      } else {
        await updateDoc(doc(db, 'activities', activityId), payload)
        onActivityUpdated?.({ id: activityId, ...payload })
        toast('Actividad actualizada')
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
          <button onClick={onClose} className="p-2 -ml-2 rounded hover:bg-white/10 transition-colors flex-shrink-0">
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
                onModeChange={(mode) => setForm((f) => ({
                  ...f, visibilidadMode: mode,
                  publishAt: mode === 'schedule' ? f.publishAt : '',
                  fechaLimite: mode === 'hide' ? '' : f.fechaLimite,
                }))}
                onPublishAtChange={(v) => setForm((f) => ({ ...f, publishAt: v }))}
              />
            </div>

            {form.visibilidadMode !== 'hide' && (
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Fecha límite (opcional)</label>
                {form.visibilidadMode === 'show' ? (
                  <p className="text-xs text-slate-400 px-1">Guarda primero para establecer la fecha de publicación y luego podrás asignar una fecha límite.</p>
                ) : form.visibilidadMode === 'schedule' && !form.publishAt ? (
                  <p className="text-xs text-slate-400 px-1">Primero elige la fecha de publicación arriba.</p>
                ) : (
                  <EFDateTimePicker
                    mode="datetime"
                    value={form.fechaLimite}
                    onChange={v => setForm(f => ({ ...f, fechaLimite: v }))}
                    placeholder="Sin fecha límite…"
                    clearable
                    minDateTime={
                      form.visibilidadMode === 'published' ? (form.publishedAt || undefined) :
                      form.visibilidadMode === 'schedule'  ? (form.publishAt  || undefined) :
                      undefined
                    }
                  />
                )}
              </div>
            )}
          </div>

          <button type="submit" disabled={saving}
            className="w-full py-3 bg-accent text-white font-semibold rounded-card disabled:opacity-60 flex items-center justify-center gap-2">
            {saving ? <Spinner size="sm" /> : isNew ? <Plus size={18} /> : <Pencil size={18} />}
            {saving ? 'Guardando…' : isNew ? 'Crear actividad' : 'Guardar cambios'}
          </button>
          <div className="h-6" />
        </form>
      </div>
    </div>
  )
}
