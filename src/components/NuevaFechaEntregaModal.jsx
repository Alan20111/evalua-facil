import { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from './Toast'
import { Search } from 'lucide-react'
import EFDateTimePicker from './EFDateTimePicker'
import { matchesStudentSearch } from '../utils/studentSearch'

// Shared by ActivityPage (grading view) and SubjectPage (activity editor):
// extends a group's deadline, or gives specific students their own extension.
// onSaved receives { mode: 'todos', date } or { mode: 'algunos', date, motivo, ids }
// so each caller can merge the result into its own activity/activities state.
export default function NuevaFechaEntregaModal({ activityId, students, onClose, onSaved }) {
  const toast = useToast()
  const [mode, setMode] = useState('todos')
  const [date, setDate] = useState('')
  const [motivo, setMotivo] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [saving, setSaving] = useState(false)

  function toggleStudent(id) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  async function save() {
    if (!date) { toast('Elige la nueva fecha y hora', 'error'); return }
    if (mode === 'algunos' && selected.size === 0) {
      toast('Selecciona al menos un estudiante', 'error'); return
    }
    setSaving(true)
    try {
      if (mode === 'todos') {
        await updateDoc(doc(db, 'activities', activityId), { fechaLimite: date, cerradaManual: false })
        onSaved({ mode, date })
        toast('Nueva fecha de entrega para todo el grupo')
      } else {
        const motivoTrim = motivo.trim()
        const ids = [...selected]
        const patch = {}
        ids.forEach((id) => {
          patch[`extensiones.${id}`] = date
          patch[`extensionesMotivo.${id}`] = motivoTrim
        })
        await updateDoc(doc(db, 'activities', activityId), patch)
        onSaved({ mode, date, motivo: motivoTrim, ids })
        toast(`Nueva fecha para ${ids.length} estudiante${ids.length !== 1 ? 's' : ''}`)
      }
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => !saving && onClose()} />
      <div className="relative bg-surface-card w-[calc(100%-2rem)] max-w-md rounded-card p-4 shadow-2xl max-h-[90vh] flex flex-col">
        <h3 className="text-lg font-semibold text-center text-on-surface">Nueva fecha de entrega</h3>
        <div className="flex gap-2 mt-3 flex-shrink-0">
          <button type="button" onClick={() => setMode('todos')}
            className={`flex-1 py-2 rounded text-sm font-medium border transition-colors ${mode === 'todos' ? 'border-accent bg-[var(--accent-tint)] text-accent' : 'border-outline-variant text-muted hover:border-accent'}`}>
            Para todos
          </button>
          <button type="button" onClick={() => setMode('algunos')}
            className={`flex-1 py-2 rounded text-sm font-medium border transition-colors ${mode === 'algunos' ? 'border-accent bg-[var(--accent-tint)] text-accent' : 'border-outline-variant text-muted hover:border-accent'}`}>
            Para algunos
          </button>
        </div>

        <div className="mt-3 overflow-auto">
          <label className="block text-sm font-medium text-muted mb-1">Nueva fecha y hora límite</label>
          <EFDateTimePicker mode="datetime" value={date} onChange={setDate} clearable={false} />

          {mode === 'todos' && (
            <p className="text-xs text-slate-400 mt-2">
              Se aplicará a <strong>todo el grupo</strong> y se reabrirá la actividad si estaba cerrada.
            </p>
          )}

          {mode === 'algunos' && (
            <div className="mt-3">
              <div className="relative mb-2">
                <Search size={15} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nombre o número de lista…"
                  className="w-full pl-8 pr-3 py-2 rounded border border-outline-variant text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
              <div className="border border-outline-variant rounded max-h-52 overflow-auto divide-y divide-outline-variant">
                {students.filter((s) => !search.trim() || matchesStudentSearch(s, search)).map((s) => (
                  <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-[var(--accent-tint)]">
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleStudent(s.id)}
                      className="w-4 h-4 accent-[var(--accent)] flex-shrink-0" />
                    <span className="w-5 text-xs text-slate-500 text-right flex-shrink-0">{s.orden}</span>
                    <span className="truncate">{s.apellidoPaterno} {s.apellidoMaterno} {s.nombre}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {selected.size} seleccionado{selected.size !== 1 ? 's' : ''}
              </p>
              <div className="mt-2">
                <label className="block text-sm font-medium text-muted mb-1">Motivo <span className="text-slate-400">(opcional)</span></label>
                <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
                  placeholder="Ej.: Falta justificada por duelo familiar"
                  className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface resize-none focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-4 flex-shrink-0">
          <button type="button" onClick={onClose} disabled={saving}
            className="flex-1 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors">
            Cancelar
          </button>
          <button type="button" onClick={save}
            disabled={saving || !date || (mode === 'algunos' && selected.size === 0)}
            className="flex-1 py-2 bg-accent text-white text-sm font-semibold rounded disabled:opacity-50 transition-colors">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
