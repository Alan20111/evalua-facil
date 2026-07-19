import { useState, useEffect } from 'react'
import { collection, query, where, getDocs, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import { ArrowLeft, Plus, Pencil, Trash2, Eye, EyeOff, ClipboardList, ListChecks, Copy, Check, ChevronRight } from 'lucide-react'
import RubricaEditor from './RubricaEditor'
import ListaCotejoEditor from './ListaCotejoEditor'
import RubricaTable from './RubricaTable'
import { esCotejo } from '../../utils/rubrica'
import { subjectDisplayName } from '../../utils/subjectName'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { IS_NATIVE_APP } from '../../utils/platform'

// Banco de rúbricas del docente: elegir una para la actividad, crear nuevas,
// editarlas o eliminarlas. Pantalla completa sobre el editor de entregables
// (z-[60] > z-50); el editor de rúbricas va encima (z-[70]).
export default function RubricaPicker({ docenteId, subjectId, onClose, onSelect }) {
  const toast = useToast()
  const [rubricas, setRubricas] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)      // null | 'new' | 'new-cotejo' | rubrica del banco
  const [previewId, setPreviewId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // "Traer de otra asignatura": elegir una asignatura y luego una rúbrica/cotejo
  // usada en sus actividades. Al elegirla se aplica igual que "Usar".
  const [importOpen, setImportOpen] = useState(false)
  const [importSubjects, setImportSubjects] = useState([])
  const [importSrc, setImportSrc] = useState(null)   // asignatura origen elegida
  const [importRubricas, setImportRubricas] = useState([])
  const [importLoading, setImportLoading] = useState(false)

  // Physical Android back button — closes the "eliminar rúbrica" confirmation,
  // mirroring its own Cancelar button.
  useBackHandler(() => setConfirmDeleteId(null), !!confirmDeleteId)

  async function openImport() {
    setImportOpen(true); setImportSrc(null); setImportRubricas([]); setImportLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'subjects'), where('docenteId', '==', docenteId)))
      const subs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.id !== subjectId)
        .sort((a, b) => subjectDisplayName(a).localeCompare(subjectDisplayName(b), 'es'))
      setImportSubjects(subs)
    } catch (err) {
      toast('Error al cargar asignaturas: ' + err.message, 'error')
    } finally {
      setImportLoading(false)
    }
  }

  async function pickImportSubject(sub) {
    setImportSrc(sub); setImportRubricas([]); setImportLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', sub.id)))
      // Rúbricas/cotejos ÚNICOS usados en las actividades de esa asignatura
      const seen = new Set()
      const found = []
      snap.docs.map((d) => d.data()).forEach((a) => {
        if (!a.rubrica?.criterios?.length) return
        const key = `${a.rubrica.tipo || 'rubrica'}|${(a.rubrica.titulo || '').trim().toLowerCase()}`
        if (seen.has(key)) return
        seen.add(key)
        found.push(a.rubrica)
      })
      found.sort((a, b) => (a.titulo || '').localeCompare(b.titulo || '', 'es'))
      setImportRubricas(found)
    } catch (err) {
      toast('Error al cargar las rúbricas de esa asignatura: ' + err.message, 'error')
    } finally {
      setImportLoading(false)
    }
  }

  // Este componente solo se monta mientras está abierto (lo controla el padre).
  useScrollLock(true)

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
    if (editing === 'new' || editing === 'new-cotejo') {
      onSelect(saved)
    } else {
      setRubricas((prev) => prev.map((r) => (r.id === saved.id ? { ...r, ...saved } : r)))
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-surface overflow-y-auto">
      <header className="sticky top-0 z-10 bg-accent text-white shadow-lg safe-top">
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
        {/* Crear rúbricas / listas de cotejo nuevas o traer de otra asignatura: solo web */}
        {!IS_NATIVE_APP && (
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button type="button" onClick={() => setEditing('new')}
                className="w-full py-3 bg-accent text-white font-semibold rounded-card flex items-center justify-center gap-2 hover:bg-accent-hover transition-colors">
                <Plus size={18} /> Crear nueva rúbrica
              </button>
              <button type="button" onClick={() => setEditing('new-cotejo')}
                className="w-full py-3 border-2 border-accent text-accent font-semibold rounded-card flex items-center justify-center gap-2 hover:bg-[var(--accent-tint)] transition-colors">
                <ListChecks size={18} /> Crear lista de cotejo
              </button>
            </div>
            <button type="button" onClick={openImport}
              className="w-full py-2.5 border border-dashed border-outline text-muted font-medium rounded-card flex items-center justify-center gap-2 hover:border-accent hover:text-accent transition-colors">
              <Copy size={16} /> Traer una rúbrica o lista de cotejo de otra asignatura
            </button>
          </div>
        )}

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
                      {esCotejo(r)
                        ? `${r.criterios?.length} criterios · lista de cotejo · sobre 10`
                        : `${r.criterios?.length} criterios · ${r.niveles?.length} niveles · se califica sobre 10`}
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
                  {/* Editar/eliminar rúbricas del banco: solo en la web */}
                  {!IS_NATIVE_APP && (
                    <>
                      <button type="button" onClick={() => setEditing(r)}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-muted hover:text-accent rounded hover:bg-[var(--accent-tint)] transition-colors">
                        <Pencil size={14} /> Editar
                      </button>
                      <button type="button" onClick={() => setConfirmDeleteId(r.id)}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-muted hover:text-red-600 rounded hover:bg-red-50 transition-colors">
                        <Trash2 size={14} /> Eliminar
                      </button>
                    </>
                  )}
                </div>
                {confirmDeleteId === r.id && (
                  <div className="mt-2 rounded border border-red-200 bg-red-50 p-3 space-y-2">
                    <p className="text-sm text-red-700">
                      ¿Eliminar <strong>{r.titulo}</strong> de tu banco? Las actividades
                      que ya la usan conservan su copia y no se afectan.
                    </p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setConfirmDeleteId(null)} disabled={deleting}
                        className="flex-1 py-1.5 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors disabled:opacity-60">
                        Cancelar
                      </button>
                      <button type="button" onClick={() => handleDelete(r.id)} disabled={deleting}
                        className="flex-1 py-1.5 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 transition-colors">
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
        <div className="h-6 safe-bottom" />
      </div>

      {/* Traer de otra asignatura — paso 1: elegir asignatura; paso 2: elegir rúbrica/cotejo */}
      {importOpen && (
        <div className="fixed inset-0 z-[65] bg-surface overflow-y-auto">
          <header className="sticky top-0 z-10 bg-accent text-white shadow-lg safe-top">
            <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
              <button type="button" onClick={() => (importSrc ? setImportSrc(null) : setImportOpen(false))}
                aria-label="Volver" className="p-2 -ml-2 rounded hover:bg-white/10 transition-colors flex-shrink-0">
                <ArrowLeft size={22} />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/70 uppercase tracking-wide">Traer de otra asignatura</p>
                <h1 className="text-xl font-extrabold text-white truncate">
                  {importSrc ? subjectDisplayName(importSrc) : 'Elige la asignatura'}
                </h1>
              </div>
            </div>
          </header>
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-2">
            {importLoading ? (
              <div className="flex justify-center py-16"><Spinner size="lg" /></div>
            ) : !importSrc ? (
              importSubjects.length === 0 ? (
                <div className="bg-surface-card rounded-card shadow-card p-10 text-center">
                  <ClipboardList size={32} className="text-slate-300 mx-auto mb-3" />
                  <p className="text-muted text-sm">No tienes otras asignaturas de dónde traer.</p>
                </div>
              ) : (
                importSubjects.map((s) => (
                  <button key={s.id} type="button" onClick={() => pickImportSubject(s)}
                    className="w-full flex items-center gap-3 bg-surface-card rounded-card shadow-card p-4 text-left hover:bg-[var(--accent-tint)] transition-colors">
                    <ClipboardList size={18} className="text-accent flex-shrink-0" />
                    <span className="flex-1 min-w-0 font-semibold text-on-surface truncate">{subjectDisplayName(s)}</span>
                    <ChevronRight size={18} className="text-slate-400 flex-shrink-0" />
                  </button>
                ))
              )
            ) : importRubricas.length === 0 ? (
              <div className="bg-surface-card rounded-card shadow-card p-10 text-center">
                <ClipboardList size={32} className="text-slate-300 mx-auto mb-3" />
                <p className="text-muted text-sm">Esta asignatura no tiene rúbricas ni listas de cotejo en sus actividades.</p>
              </div>
            ) : (
              importRubricas.map((r, i) => (
                <div key={`${i}-${r.titulo}`} className="bg-surface-card rounded-card shadow-card p-4 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-on-surface truncate">{r.titulo}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {esCotejo(r)
                        ? `${r.criterios?.length} criterios · lista de cotejo · sobre 10`
                        : `${r.criterios?.length} criterios · ${r.niveles?.length} niveles · se califica sobre 10`}
                    </p>
                  </div>
                  <button type="button" onClick={() => onSelect(r)}
                    className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-hover transition-colors">
                    <Check size={16} /> Usar
                  </button>
                </div>
              ))
            )}
            <div className="h-6 safe-bottom" />
          </div>
        </div>
      )}

      {editing && (
        (editing === 'new-cotejo' || esCotejo(editing)) ? (
          <ListaCotejoEditor
            initial={editing === 'new-cotejo' ? null : editing}
            docenteId={docenteId}
            onClose={() => setEditing(null)}
            onSaved={handleSaved}
          />
        ) : (
          <RubricaEditor
            initial={editing === 'new' ? null : editing}
            docenteId={docenteId}
            onClose={() => setEditing(null)}
            onSaved={handleSaved}
          />
        )
      )}
    </div>
  )
}
