import { useState } from 'react'
import { collection, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import { X, Plus, Trash2 } from 'lucide-react'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectColors } from '../../utils/subjectPalette'

const DIAS = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']
const HORAS = Array.from({ length: 29 }, (_, i) => {
  const h = Math.floor(i / 2) + 7
  const m = i % 2 === 0 ? '00' : '30'
  return `${String(h).padStart(2, '0')}:${m}`
})

export default function HorarioEditor({ horario, subjects, onClose, onSaved, onDeleted }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState({ diaSemana: 0, horaInicio: '07:00', horaFin: '08:00', asignaturaId: '', aula: '' })
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const subjectList = Object.values(subjects).sort((a, b) =>
    (a.nombre || '').localeCompare(b.nombre || '')
  )

  async function handleAdd(e) {
    e.preventDefault()
    if (!form.asignaturaId) { toast('Selecciona una asignatura', 'error'); return }
    if (form.horaInicio >= form.horaFin) { toast('La hora de fin debe ser mayor a la de inicio', 'error'); return }
    setSaving(true)
    try {
      const payload = {
        docenteId: currentUser.uid,
        diaSemana: form.diaSemana,
        horaInicio: form.horaInicio,
        horaFin: form.horaFin,
        asignaturaId: form.asignaturaId,
        aula: form.aula.trim(),
        createdAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'horario'), payload)
      onSaved?.({ id: ref.id, ...payload })
      setForm({ diaSemana: 0, horaInicio: '07:00', horaFin: '08:00', asignaturaId: '', aula: '' })
      setShowForm(false)
      toast('Bloque agregado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    try {
      await deleteDoc(doc(db, 'horario', id))
      onDeleted?.(id)
      toast('Bloque eliminado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  const byDay = DIAS.map((_, i) => ({
    label: DIAS[i],
    blocks: horario
      .filter(h => h.diaSemana === i)
      .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio)),
  }))

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-surface-card rounded-t-card md:rounded-card shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-outline-variant flex-shrink-0">
          <h2 className="font-semibold text-on-surface">Mi Horario</h2>
          <button type="button" onClick={onClose} className="p-1 text-muted hover:text-error rounded transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {byDay.map(({ label, blocks }) => (
            <div key={label}>
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">{label}</p>
              {blocks.length === 0 ? (
                <p className="text-xs text-slate-400 pl-2">Sin clases</p>
              ) : (
                <div className="space-y-1">
                  {blocks.map(b => {
                    const subj = subjects[b.asignaturaId]
                    const pal = subjectColors(subj)
                    return (
                      <div
                        key={b.id}
                        className="flex items-center gap-2 px-3 py-1.5 rounded text-sm"
                        style={{ background: pal.bg, color: pal.text }}
                      >
                        <span className="font-medium flex-1 truncate">
                          {subjectDisplayName(subj) || 'Sin asignatura'}
                          {b.aula && <span className="font-normal opacity-70"> · {b.aula}</span>}
                        </span>
                        <span className="text-xs opacity-80 flex-shrink-0">{b.horaInicio}–{b.horaFin}</span>
                        <button
                          type="button"
                          onClick={() => handleDelete(b.id)}
                          className="p-0.5 rounded hover:opacity-70 transition-opacity flex-shrink-0"
                          data-tooltip="Eliminar"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="border-t border-outline-variant px-4 py-3 flex-shrink-0">
          {showForm ? (
            <form onSubmit={handleAdd} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={form.diaSemana}
                  onChange={e => setForm(f => ({ ...f, diaSemana: Number(e.target.value) }))}
                  className="px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface"
                >
                  {DIAS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
                <select
                  value={form.asignaturaId}
                  onChange={e => setForm(f => ({ ...f, asignaturaId: e.target.value }))}
                  className="px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface"
                >
                  <option value="">Asignatura…</option>
                  {subjectList.map(s => (
                    <option key={s.id} value={s.id}>{subjectDisplayName(s)}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={form.horaInicio}
                  onChange={e => setForm(f => ({ ...f, horaInicio: e.target.value }))}
                  className="px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface"
                >
                  {HORAS.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <select
                  value={form.horaFin}
                  onChange={e => setForm(f => ({ ...f, horaFin: e.target.value }))}
                  className="px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface"
                >
                  {HORAS.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <input
                  type="text"
                  value={form.aula}
                  onChange={e => setForm(f => ({ ...f, aula: e.target.value }))}
                  placeholder="Aula"
                  className="px-2 py-1.5 rounded border border-outline-variant text-sm bg-surface"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-3 py-1.5 text-sm text-muted rounded border border-outline-variant hover:bg-surface transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-1.5 bg-accent text-white rounded text-sm font-medium disabled:opacity-60 flex items-center justify-center gap-1"
                >
                  {saving ? <Spinner size="sm" /> : <><Plus size={14} /> Agregar</>}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 text-accent hover:text-accent-hover text-sm font-medium transition-colors"
            >
              <Plus size={16} /> Agregar bloque de clase
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
