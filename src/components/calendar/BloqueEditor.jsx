import { useState } from 'react'
import { collection, doc, addDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import EFDateTimePicker from '../EFDateTimePicker'
import Spinner from '../Spinner'
import { subjectDisplayName } from '../../utils/subjectName'
import { X, Trash2, Check, MapPin, Bell, BellOff, Play, Copy } from 'lucide-react'
import {
  BLOQUE_COLORS, ALARMA_SONIDOS, reproducirSonido,
  addMinutesToTime, timeToMinutes,
} from '../../utils/horarioBloques'
import { useScrollLock } from '../../hooks/useScrollLock'

const HORAS_INICIO = Array.from({ length: 33 }, (_, i) => {
  const h = 6 + Math.floor(i / 2)
  const m = i % 2 ? '30' : '00'
  return `${String(h).padStart(2, '0')}:${m}`
})

const FIRESTORE_BATCH_LIMIT = 450

async function deleteIds(ids) {
  for (let i = 0; i < ids.length; i += FIRESTORE_BATCH_LIMIT) {
    const batch = writeBatch(db)
    ids.slice(i, i + FIRESTORE_BATCH_LIMIT).forEach(id => batch.delete(doc(db, 'horarioBloques', id)))
    await batch.commit()
  }
}

export default function BloqueEditor({ bloque, bloques, subjects, onClose, onUpdated, onDeleted }) {
  const toast = useToast()
  const subj = subjects[bloque.asignaturaId]

  // Duración de una hora/bloque, deducida del bloque original.
  const durUnit = Math.max(
    5,
    Math.round((timeToMinutes(bloque.horaFin) - timeToMinutes(bloque.horaInicio)) / Math.max(1, bloque.horas || 1)),
  )

  const [form, setForm] = useState({
    fecha: bloque.fecha,
    horaInicio: bloque.horaInicio,
    horas: bloque.horas || 1,
    lugar: bloque.lugar || '',
    color: bloque.color || 'blue',
    alarma: { activa: false, sonido: 'campana', minutosAntes: 10, ...(bloque.alarma || {}) },
  })
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null) // 'uno' | 'posteriores' | 'todos' | 'asignatura'

  // Este componente solo se monta mientras está abierto (lo controla el padre).
  useScrollLock(true)

  const pal = BLOQUE_COLORS.find(c => c.id === form.color) || BLOQUE_COLORS[0]
  const horaFin = addMinutesToTime(form.horaInicio, Math.max(1, form.horas) * durUnit)

  async function handleSave() {
    setSaving(true)
    try {
      const diaSemana = (new Date(form.fecha + 'T12:00:00').getDay() + 6) % 7
      const patch = {
        fecha: form.fecha,
        diaSemana,
        horaInicio: form.horaInicio,
        horaFin,
        horas: Math.max(1, form.horas),
        lugar: form.lugar.trim(),
        color: form.color,
        alarma: form.alarma,
        movido: true,
      }
      await updateDoc(doc(db, 'horarioBloques', bloque.id), patch)
      onUpdated?.({ ...bloque, ...patch })
      toast('Bloque actualizado')
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // Duplicar: crea una copia del bloque (con lo que está en pantalla) que
  // queda inmediatamente DESPUÉS de este, en el mismo día — dos rectángulos
  // seguidos. Conserva programacionId para que "eliminar programación" y los
  // movimientos en cadena lo incluyan.
  async function handleDuplicate() {
    setSaving(true)
    try {
      const diaSemana = (new Date(form.fecha + 'T12:00:00').getDay() + 6) % 7
      const durTotal = Math.max(1, form.horas) * durUnit
      await addDoc(collection(db, 'horarioBloques'), {
        docenteId: bloque.docenteId,
        programacionId: bloque.programacionId || null,
        asignaturaId: bloque.asignaturaId,
        fecha: form.fecha,
        diaSemana,
        horaInicio: horaFin,
        horaFin: addMinutesToTime(horaFin, durTotal),
        horas: Math.max(1, form.horas),
        lugar: form.lugar.trim(),
        color: form.color,
        // La alarma del duplicado sonaría en plena clase anterior — apagada.
        alarma: { ...form.alarma, activa: false },
        movido: true,
        createdAt: serverTimestamp(),
      })
      toast('Bloque duplicado — quedó justo después de este')
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  function idsFor(modo) {
    if (modo === 'uno') return [bloque.id]
    if (modo === 'posteriores') {
      return bloques
        .filter(b => b.programacionId === bloque.programacionId &&
          (b.fecha > bloque.fecha || (b.fecha === bloque.fecha && b.horaInicio >= bloque.horaInicio)))
        .map(b => b.id)
    }
    if (modo === 'todos') {
      return bloques.filter(b => b.programacionId === bloque.programacionId).map(b => b.id)
    }
    // asignatura
    return bloques.filter(b => b.asignaturaId === bloque.asignaturaId).map(b => b.id)
  }

  async function handleDelete(modo) {
    const ids = idsFor(modo)
    setSaving(true)
    try {
      await deleteIds(ids)
      onDeleted?.(ids)
      toast(ids.length === 1 ? 'Bloque eliminado' : `${ids.length} bloques eliminados`)
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const label = (t) => <span className="text-xs text-muted">{t}</span>
  const inputCls = 'px-2.5 py-1.5 rounded border border-outline-variant text-sm bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'

  const DEL_OPTS = [
    { id: 'uno', label: 'Solo este bloque' },
    { id: 'posteriores', label: 'Este bloque y los posteriores' },
    { id: 'todos', label: 'Todos los bloques de esta programación' },
    { id: 'asignatura', label: 'Toda la asignatura programada' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 border-none cursor-default"
        onClick={onClose}
        aria-label="Cerrar"
      />
      <div className="relative bg-surface-card rounded-t-card md:rounded-card shadow-2xl w-full max-w-md max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-outline-variant flex-shrink-0">
          <div className="min-w-0">
            <h2 className="font-semibold text-on-surface truncate">{subjectDisplayName(subj) || 'Bloque de clase'}</h2>
            <p className="text-xs text-muted">Editar bloque</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1 text-muted hover:text-error rounded transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          <div className="space-y-1">
            {label('Fecha')}
            <EFDateTimePicker mode="date" value={form.fecha} onChange={v => setForm(f => ({ ...f, fecha: v }))} clearable={false} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              {label('Hora de inicio')}
              <select value={form.horaInicio} onChange={e => setForm(f => ({ ...f, horaInicio: e.target.value }))} className={`${inputCls} w-full`}>
                {HORAS_INICIO.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              {label('Horas/bloques')}
              <input type="number" min={1} max={12} value={form.horas}
                onChange={e => setForm(f => ({ ...f, horas: Math.max(1, Number(e.target.value) || 1) }))}
                className={`${inputCls} w-full`} />
            </div>
          </div>
          <p className="text-xs text-muted">Termina a las <strong>{horaFin}</strong></p>

          <div className="space-y-1">
            {label('Lugar')}
            <div className="flex items-center gap-2">
              <MapPin size={15} className="text-muted flex-shrink-0" />
              <input type="text" value={form.lugar} onChange={e => setForm(f => ({ ...f, lugar: e.target.value }))}
                placeholder="Aula, Centro de cómputo…" className={`${inputCls} flex-1`} />
            </div>
          </div>

          <div className="space-y-1">
            {label('Color')}
            <div className="flex flex-wrap gap-2">
              {BLOQUE_COLORS.map(c => (
                <button key={c.id} type="button" onClick={() => setForm(f => ({ ...f, color: c.id }))}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${form.color === c.id ? 'border-on-surface scale-110' : 'border-transparent'}`}
                  style={{ background: c.bg }} data-tooltip={c.label} aria-label={c.label} />
              ))}
            </div>
          </div>

          {/* Alarma */}
          <div className="space-y-2 rounded-card border border-outline-variant p-3">
            <button type="button" onClick={() => setForm(f => ({ ...f, alarma: { ...f.alarma, activa: !f.alarma.activa } }))}
              className="flex items-center gap-2 text-sm font-medium text-on-surface">
              {form.alarma.activa ? <Bell size={16} className="text-accent" /> : <BellOff size={16} className="text-muted" />}
              Alarma
            </button>
            {form.alarma.activa && (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex gap-1.5">
                  <select value={form.alarma.sonido} onChange={e => setForm(f => ({ ...f, alarma: { ...f.alarma, sonido: e.target.value } }))} className={`${inputCls} flex-1`}>
                    {ALARMA_SONIDOS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                  <button type="button" onClick={() => reproducirSonido(form.alarma.sonido)} className="px-2 rounded border border-outline-variant text-accent hover:bg-accent-tint" aria-label="Probar">
                    <Play size={14} />
                  </button>
                </div>
                <input type="number" min={0} max={120} value={form.alarma.minutosAntes}
                  onChange={e => setForm(f => ({ ...f, alarma: { ...f.alarma, minutosAntes: Math.max(0, Number(e.target.value) || 0) } }))}
                  className={`${inputCls} w-full`} placeholder="min antes" />
              </div>
            )}
          </div>

          {/* Eliminar */}
          <div className="pt-1 border-t border-outline-variant">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide pt-2 pb-1.5">Eliminar</p>
            <div className="space-y-1">
              {DEL_OPTS.map(opt => (
                confirmDel === opt.id ? (
                  <div key={opt.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-error/10 border border-error/30">
                    <span className="text-xs text-error flex-1">
                      {opt.id === 'asignatura'
                        ? `¿Eliminar TODOS los bloques de ${subjectDisplayName(subj) || 'esta asignatura'}? (${idsFor(opt.id).length})`
                        : `¿Confirmas? Se eliminarán ${idsFor(opt.id).length} bloque(s).`}
                    </span>
                    <button type="button" onClick={() => setConfirmDel(null)} className="text-xs text-muted px-2 py-1">Cancelar</button>
                    <button type="button" onClick={() => handleDelete(opt.id)} disabled={saving} className="text-xs bg-error text-white rounded px-2 py-1 font-medium">Eliminar</button>
                  </div>
                ) : (
                  <button key={opt.id} type="button" onClick={() => setConfirmDel(opt.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-sm text-on-surface hover:bg-error/10 hover:text-error transition-colors text-left">
                    <Trash2 size={14} className="flex-shrink-0" /> {opt.label}
                    <span className="ml-auto text-xs text-muted">{idsFor(opt.id).length}</span>
                  </button>
                )
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-outline-variant px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <span className="w-6 h-6 rounded-full flex-shrink-0" style={{ background: pal.bg, border: `1px solid ${pal.text}33` }} />
          <button type="button" onClick={handleDuplicate} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-muted rounded border border-outline-variant hover:text-accent hover:border-accent transition-colors disabled:opacity-60"
            data-tooltip="Crea una copia justo después de este bloque">
            <Copy size={14} /> Duplicar
          </button>
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-muted rounded border border-outline-variant hover:bg-surface transition-colors">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-accent text-white rounded text-sm font-semibold disabled:opacity-60 flex items-center gap-2">
            {saving ? <Spinner size="sm" /> : <><Check size={15} /> Guardar</>}
          </button>
        </div>
      </div>
    </div>
  )
}
