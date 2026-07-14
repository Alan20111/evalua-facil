import { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from './Toast'
import EFDateTimePicker from './EFDateTimePicker'
import SearchInput from './SearchInput'
import { matchesStudentSearch } from '../utils/studentSearch'
import { nowIsoLocal } from '../utils/nowIso'
import { useBackHandler } from '../hooks/useBackHandler'

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

  // Physical Android back button: this modal is only mounted while its parent
  // renders it (open), so it mirrors the Cancelar button unconditionally.
  useBackHandler(onClose, true)

  function toggleStudent(id) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  async function save() {
    if (!date) { toast('Elige la nueva fecha y hora', 'error'); return }
    if (date <= nowIsoLocal()) { toast('La fecha límite no puede ser en el pasado', 'error'); return }
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
      <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => !saving && onClose()} aria-label="Cerrar" />
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
          <p className="block text-sm font-medium text-muted mb-1">Nueva fecha y hora límite</p>
          <EFDateTimePicker mode="datetime" value={date} onChange={setDate} clearable={false} minDateTime={nowIsoLocal()} />

          {mode === 'todos' && (
            <p className="text-xs text-slate-400 mt-2">
              Se aplicará a <strong>todo el grupo</strong> y se reabrirá la actividad si estaba cerrada.
              Al llegar esta fecha y hora, las entregas se cerrarán otra vez automáticamente
              (según la casilla "Cerrar entregas en la fecha y hora programada").
            </p>
          )}

          {mode === 'algunos' && (
            <div className="mt-3">
              <div className="mb-2">
                <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nombre o número de lista…" />
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
                {selected.size} seleccionado{selected.size !== 1 ? 's' : ''} — podrán entregar hasta esta
                fecha; al pasar, se cerrará también para ellos.
              </p>
              <div className="mt-2">
                <label htmlFor="motivo-extension" className="block text-sm font-medium text-muted mb-1">Motivo <span className="text-slate-400">(opcional)</span></label>
                <textarea id="motivo-extension" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
                  placeholder="Ej.: Falta justificada por duelo familiar"
                  className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
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
            className="flex-1 py-2 bg-accent text-white text-sm font-semibold rounded disabled:opacity-60 transition-colors">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
