import { useEffect, useState } from 'react'
import { collection, query, where, getDocs, doc, serverTimestamp } from 'firebase/firestore'
import { addDoc, updateDoc, deleteDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { Plus, MoreVertical, Pencil, Trash2, Megaphone } from 'lucide-react'
import { AVISO_TIPOS, avisoTipoInfo, formatAvisoFecha } from '../../utils/avisos'

const EMPTY_FORM = { id: null, tipo: null, titulo: '', mensaje: '' }

export default function AvisosTab({ subjectId, docenteId, canCreate = true, onBlockedCreate }) {
  const toast = useToast()
  const [avisos, setAvisos] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)

  const [step, setStep] = useState(null) // null | 'picker' | 'form'
  const [modalMode, setModalMode] = useState('create')
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [openMenuId, setOpenMenuId] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useBackHandler(() => (deleteConfirm ? setDeleteConfirm(null) : setStep(null)), step != null || !!deleteConfirm)
  useScrollLock(step != null || !!deleteConfirm)

  async function loadAvisos() {
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'avisos'), where('asignaturaId', '==', subjectId)))
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => a.activo !== false)
        // Más reciente primero — orden en memoria porque este proyecto no usa
        // orderBy en Firestore (ver CLAUDE.md).
        .sort((a, b) => (b.fechaCreacion?.seconds ?? 0) - (a.fechaCreacion?.seconds ?? 0))
      setAvisos(list)
      setLoaded(true)
    } catch (err) {
      toast('Error al cargar avisos: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAvisos() }, [subjectId])

  function openAdd() {
    if (!canCreate) { onBlockedCreate?.(); return }
    setModalMode('create')
    setForm(EMPTY_FORM)
    setStep('picker')
  }

  function pickTipo(tipoDef) {
    setForm({ id: null, tipo: tipoDef.key, titulo: tipoDef.titulo, mensaje: '' })
    setStep('form')
  }

  function openEdit(aviso) {
    setOpenMenuId(null)
    setModalMode('edit')
    setForm({ id: aviso.id, tipo: aviso.tipo, titulo: aviso.titulo, mensaje: aviso.mensaje })
    setStep('form')
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.titulo.trim()) { toast('Escribe un título', 'error'); return }
    if (!form.mensaje.trim()) { toast('Escribe un mensaje', 'error'); return }
    setSaving(true)
    try {
      if (modalMode === 'create') {
        await addDoc(collection(db, 'avisos'), {
          asignaturaId: subjectId,
          docenteId,
          titulo: form.titulo.trim(),
          mensaje: form.mensaje.trim(),
          tipo: form.tipo,
          activo: true,
          fechaCreacion: serverTimestamp(),
          fechaActualizacion: serverTimestamp(),
        })
        toast('Aviso publicado')
      } else {
        await updateDoc(doc(db, 'avisos', form.id), {
          titulo: form.titulo.trim(),
          mensaje: form.mensaje.trim(),
          fechaActualizacion: serverTimestamp(),
        })
        toast('Aviso actualizado')
      }
      setStep(null)
      await loadAvisos()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'avisos', deleteConfirm.id))
      setDeleteConfirm(null)
      await loadAvisos()
      toast('Aviso eliminado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="px-4 py-2 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted leading-relaxed">
          Comunicados para todo el grupo — sin respuestas ni comentarios, solo para informar.
        </p>
        <button type="button" onClick={openAdd}
          data-tooltip={canCreate ? 'Nuevo aviso' : 'Activa tu suscripción mensual para publicar avisos'}
          className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors disabled:opacity-50">
          <Plus size={16} /> Nuevo aviso
        </button>
      </div>

      {!loaded || loading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : avisos.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-sm flex flex-col items-center gap-2">
          <Megaphone size={28} className="text-slate-300" />
          Aún no hay avisos en esta asignatura
        </div>
      ) : (
        <div className="space-y-1.5">
          {avisos.map((a) => {
            const info = avisoTipoInfo(a.tipo)
            return (
              <div key={a.id} className="bg-surface-card border border-outline-variant rounded-card shadow-card px-3 py-2.5">
                <div className="flex items-start gap-3">
                  <span className="text-xl leading-none flex-shrink-0 mt-0.5" aria-hidden="true">{info.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-on-surface truncate">{a.titulo}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{formatAvisoFecha(a.fechaCreacion)}</p>
                    <p className="text-sm text-on-surface mt-1.5 whitespace-pre-wrap line-clamp-3">{a.mensaje}</p>
                  </div>
                  <div className="relative flex-shrink-0">
                    <button type="button" onClick={() => setOpenMenuId((id) => (id === a.id ? null : a.id))}
                      aria-label="Más opciones" data-tooltip="Más opciones"
                      className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors">
                      <MoreVertical size={18} />
                    </button>
                    {openMenuId === a.id && (
                      <>
                        <button type="button" className="fixed inset-0 z-30 cursor-default" aria-label="Cerrar menú" onClick={() => setOpenMenuId(null)} />
                        <div className="absolute right-0 top-full mt-1 z-40 bg-surface-card border border-outline-variant rounded-card shadow-lg py-1 min-w-[140px]">
                          <button type="button" onClick={() => openEdit(a)}
                            className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-on-surface hover:bg-[var(--accent-tint)]">
                            <Pencil size={14} /> Editar
                          </button>
                          <button type="button" onClick={() => { setOpenMenuId(null); setDeleteConfirm(a) }}
                            className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
                            <Trash2 size={14} /> Eliminar
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Nuevo / editar aviso ── */}
      {step && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setStep(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-lg rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[90vh] overflow-y-auto">
            {step === 'picker' ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold">¿Qué deseas comunicar?</h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {AVISO_TIPOS.map((t) => (
                    <button key={t.key} type="button" onClick={() => pickTipo(t)}
                      className="flex flex-col items-center gap-1.5 p-4 rounded-card border border-outline-variant hover:border-accent hover:bg-[var(--accent-tint)] transition-colors text-center">
                      <span className="text-2xl" aria-hidden="true">{t.emoji}</span>
                      <span className="text-sm font-medium text-on-surface">{t.label}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <form onSubmit={handleSave}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">{modalMode === 'create' ? 'Nuevo aviso' : 'Editar aviso'}</h3>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-on-surface mb-1">Título</label>
                    <input type="text" value={form.titulo} onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
                      className="w-full px-3 py-2 border border-outline-variant rounded-card bg-surface text-sm" autoFocus />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-on-surface mb-1">Mensaje</label>
                    <textarea value={form.mensaje} onChange={(e) => setForm((f) => ({ ...f, mensaje: e.target.value }))}
                      rows={5} className="w-full px-3 py-2 border border-outline-variant rounded-card bg-surface text-sm resize-none" />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-5">
                  <button type="button" onClick={() => setStep(null)}
                    className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
                    Cancelar
                  </button>
                  <button type="submit" disabled={saving}
                    className="px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors disabled:opacity-50">
                    {saving ? 'Guardando…' : modalMode === 'create' ? 'Publicar' : 'Guardar'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Confirmación de borrado ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setDeleteConfirm(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-lg font-semibold mb-2">¿Deseas eliminar este aviso?</h3>
            <p className="text-sm text-muted mb-4">&ldquo;<strong>{deleteConfirm.titulo}</strong>&rdquo; se eliminará permanentemente.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 transition-colors disabled:opacity-50">
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
