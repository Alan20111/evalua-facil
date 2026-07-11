import { useState, useEffect } from 'react'
import { collection, query, where, getDocs, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import { ArrowLeft, Plus, Pencil, Trash2, Eye, EyeOff, ClipboardList, Check } from 'lucide-react'
import RubricaEditor from './RubricaEditor'
import RubricaTable from './RubricaTable'

// Banco de rúbricas del docente: elegir una para la actividad, crear nuevas,
// editarlas o eliminarlas. Pantalla completa sobre el editor de entregables
// (z-[60] > z-50); el editor de rúbricas va encima (z-[70]).
export default function RubricaPicker({ docenteId, onClose, onSelect }) {
  const toast = useToast()
  const [rubricas, setRubricas] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)      // null | 'new' | rubrica del banco
  const [previewId, setPreviewId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // `loading` ya inicia en true y load() solo corre al montar — sin setState
  // síncrono aquí (react-hooks/set-state-in-effect).
  async function load() {
    try {
      const snap = await getDocs(query(collection(db, 'bancoRubricas'), where('docenteId', '==', docenteId)))
      setRubricas(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0))
      )
    } catch (err) {
      toast('Error al cargar tu banco de rúbricas: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Carga única al montar — mismo patrón de carga que el resto de la app
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { load() }, [])

  async function handleDelete(id) {
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'bancoRubricas', id))
      setRubricas((prev) => prev.filter((r) => r.id !== id))
      setConfirmDeleteId(null)
      toast('Rúbrica eliminada del banco — las actividades que ya la usaban no cambian')
    } catch (err) {
      toast('Error al eliminar: ' + err.message, 'error')
    } finally {
      setDeleting(false)
    }
  }

  // Al crear una rúbrica desde aquí, lo natural es usarla de inmediato en la
  // actividad; al editar una existente solo se refresca la lista.
  function handleSaved(saved) {
    if (editing === 'new') {
      onSelect(saved)
    } else {
      setRubricas((prev) => prev.map((r) => (r.id === saved.id ? { ...r, ...saved } : r)))
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-surface overflow-y-auto">
      <header className="sticky top-0 z-10 bg-accent text-white shadow-lg">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={onClose} aria-label="Volver" className="p-2 -ml-2 rounded hover:bg-white/10 transition-colors flex-shrink-0">
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white/70 uppercase tracking-wide">Rúbrica de evaluación</p>
            <h1 className="text-2xl font-extrabold text-white truncate">Mi banco de rúbricas</h1>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-3">
        <button type="button" onClick={() => setEditing('new')}
          className="w-full py-3 bg-accent text-white font-semibold rounded-card flex items-center justify-center gap-2 hover:bg-accent-hover transition-colors">
          <Plus size={18} /> Crear nueva rúbrica
        </button>

        {loading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : rubricas.length === 0 ? (
          <div className="bg-surface-card rounded-card shadow-card p-10 text-center">
            <ClipboardList size={32} className="text-slate-300 mx-auto mb-3" />
            <p className="text-muted text-sm">
              Aún no tienes rúbricas guardadas. Crea la primera y podrás
              reutilizarla en cualquier actividad entregable.
            </p>
          </div>
        ) : (
          rubricas.map((r) => (
            <div key={r.id} className="bg-surface-card rounded-card shadow-card overflow-hidden">
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-on-surface truncate">{r.titulo}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {r.criterios?.length} criterios · {r.niveles?.length} niveles · se califica sobre 10
                    </p>
                    {r.descripcion && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{r.descripcion}</p>}
                  </div>
                  <button type="button" onClick={() => onSelect(r)}
                    className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-hover transition-colors">
                    <Check size={16} /> Usar
                  </button>
                </div>
                <div className="flex items-center gap-1 mt-2">
                  <button type="button" onClick={() => setPreviewId(previewId === r.id ? null : r.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-muted hover:text-accent rounded hover:bg-[var(--accent-tint)] transition-colors">
                    {previewId === r.id ? <EyeOff size={14} /> : <Eye size={14} />}
                    {previewId === r.id ? 'Ocultar' : 'Vista previa'}
                  </button>
                  <button type="button" onClick={() => setEditing(r)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-muted hover:text-accent rounded hover:bg-[var(--accent-tint)] transition-colors">
                    <Pencil size={14} /> Editar
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteId(r.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-muted hover:text-red-600 rounded hover:bg-red-50 transition-colors">
                    <Trash2 size={14} /> Eliminar
                  </button>
                </div>
                {confirmDeleteId === r.id && (
                  <div className="mt-2 rounded border border-red-200 bg-red-50 p-3 space-y-2">
                    <p className="text-sm text-red-700">
                      ¿Eliminar <strong>{r.titulo}</strong> de tu banco? Las actividades
                      que ya la usan conservan su copia y no se afectan.
                    </p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setConfirmDeleteId(null)} disabled={deleting}
                        className="flex-1 py-1.5 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors">
                        Cancelar
                      </button>
                      <button type="button" onClick={() => handleDelete(r.id)} disabled={deleting}
                        className="flex-1 py-1.5 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors">
                        {deleting ? 'Eliminando…' : 'Eliminar'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {previewId === r.id && (
                <div className="border-t border-outline-variant p-3 bg-surface">
                  <RubricaTable rubrica={r} />
                </div>
              )}
            </div>
          ))
        )}
        <div className="h-6" />
      </div>

      {editing && (
        <RubricaEditor
          initial={editing === 'new' ? null : editing}
          docenteId={docenteId}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
