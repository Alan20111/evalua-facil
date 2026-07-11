import { useState, useMemo } from 'react'
import { collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../Toast'
import EFDateTimePicker from '../EFDateTimePicker'
import Spinner from '../Spinner'
import { subjectDisplayName } from '../../utils/subjectName'
import {
  X, Plus, Trash2, Copy, MoreVertical, Bell, BellOff, Play, Check, CalendarPlus,
} from 'lucide-react'
import {
  BLOQUE_COLORS, ALARMA_SONIDOS, reproducirSonido,
  generarBloques, DIAS_SEMANA, addMinutesToTime,
} from '../../utils/horarioBloques'

// Horas de inicio seleccionables: 06:00 – 22:00 cada 30 min.
const HORAS_INICIO = Array.from({ length: 33 }, (_, i) => {
  const h = 6 + Math.floor(i / 2)
  const m = i % 2 ? '30' : '00'
  return `${String(h).padStart(2, '0')}:${m}`
})

const LUGARES = [
  { id: 'aula', label: 'Aula' },
  { id: 'computo', label: 'Centro de cómputo' },
  { id: 'otro', label: 'Otro' },
]

// Convierte los campos de lugar de un patrón en la cadena final que se guarda.
function patronLugar(p) {
  if (p.lugarTipo === 'computo') return 'Centro de cómputo'
  if (p.lugarTipo === 'otro') return (p.lugarDetalle || '').trim()
  const d = (p.lugarDetalle || '').trim()
  return d ? `Aula ${d}` : 'Aula'
}

function nuevoPatron(defaults = {}) {
  return {
    diaSemana: defaults.diaSemana ?? 0,
    lugarTipo: 'aula',
    lugarDetalle: '',
    horas: 1,
    horaInicio: defaults.horaInicio || '07:00',
  }
}

const FIRESTORE_BATCH_LIMIT = 450

export default function ProgramarBloquesModal({
  subjects, defaultDia, defaultHora, onClose, onSaved,
}) {
  const { currentUser } = useAuth()
  const toast = useToast()

  const [asignaturaId, setAsignaturaId] = useState('')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')
  const [diasAsueto, setDiasAsueto] = useState([])
  const [nuevoAsueto, setNuevoAsueto] = useState('')
  const [duracionMin, setDuracionMin] = useState(60)
  const [bloquesPorSemana, setBloquesPorSemana] = useState(1)
  const [color, setColor] = useState('blue')
  const [alarma, setAlarma] = useState({ activa: false, sonido: 'campana', minutosAntes: 10 })
  const [patrones, setPatrones] = useState([
    nuevoPatron({ diaSemana: defaultDia, horaInicio: defaultHora }),
  ])
  const [menuAbierto, setMenuAbierto] = useState(null)
  const [saving, setSaving] = useState(false)

  const subjectList = useMemo(
    () => Object.values(subjects).sort((a, b) =>
      subjectDisplayName(a).localeCompare(subjectDisplayName(b))),
    [subjects],
  )

  const pal = BLOQUE_COLORS.find(c => c.id === color) || BLOQUE_COLORS[0]
  const completo = patrones.length === bloquesPorSemana

  // Al cambiar "Bloques por semana", la lista de bloques se iguala a ese
  // número automáticamente (agrega o recorta) — después el docente puede
  // agregar o quitar a mano si quiere que sea diferente.
  function changeBloquesPorSemana(n) {
    setBloquesPorSemana(n)
    setPatrones(ps => {
      if (ps.length === n) return ps
      if (ps.length < n) {
        return [
          ...ps,
          ...Array.from({ length: n - ps.length }, () =>
            nuevoPatron({ diaSemana: defaultDia, horaInicio: defaultHora })),
        ]
      }
      return ps.slice(0, n)
    })
  }

  // Previsualización: cuántos bloques generaría la configuración actual.
  const previewCount = useMemo(() => {
    if (!fechaInicio || !fechaFin || !patrones.length) return 0
    return generarBloques({
      fechaInicio, fechaFin, diasAsueto, duracionMin,
      patrones: patrones.map(p => ({ ...p, lugar: patronLugar(p) })),
      color, alarma,
    }).length
  }, [fechaInicio, fechaFin, diasAsueto, duracionMin, patrones, color, alarma])

  // ── Patrón helpers ──────────────────────────────────────────────────────
  function updatePatron(idx, patch) {
    setPatrones(ps => ps.map((p, i) => i === idx ? { ...p, ...patch } : p))
  }
  // Agregar/duplicar no se bloquea al llegar a "Bloques por semana": ese
  // número marca el default pero se permite que la lista sea diferente.
  function addPatron() {
    setPatrones(ps => [...ps, nuevoPatron({ diaSemana: defaultDia, horaInicio: defaultHora })])
  }
  function duplicarPatron(idx) {
    setMenuAbierto(null)
    setPatrones(ps => {
      const copia = { ...ps[idx] }
      const next = [...ps]
      next.splice(idx + 1, 0, copia)
      return next
    })
  }
  function eliminarPatron(idx) {
    setMenuAbierto(null)
    setPatrones(ps => ps.length <= 1 ? ps : ps.filter((_, i) => i !== idx))
  }

  // ── Asuetos ─────────────────────────────────────────────────────────────
  function addAsueto() {
    if (!nuevoAsueto || diasAsueto.includes(nuevoAsueto)) { setNuevoAsueto(''); return }
    setDiasAsueto(a => [...a, nuevoAsueto].sort())
    setNuevoAsueto('')
  }
  function removeAsueto(fecha) {
    setDiasAsueto(a => a.filter(f => f !== fecha))
  }

  // ── Guardar ──────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!asignaturaId) { toast('Selecciona una asignatura', 'error'); return }
    if (!fechaInicio || !fechaFin) { toast('Indica la fecha de inicio y de finalización', 'error'); return }
    if (fechaFin < fechaInicio) { toast('La fecha de finalización debe ser posterior a la de inicio', 'error'); return }
    if (!duracionMin || duracionMin < 5) { toast('La duración debe ser de al menos 5 minutos', 'error'); return }
    if (!patrones.length) { toast('Agrega al menos un bloque de clase', 'error'); return }
    if (patrones.some(p => p.lugarTipo === 'otro' && !(p.lugarDetalle || '').trim())) {
      toast('Escribe el lugar del bloque marcado como "Otro"', 'error'); return
    }

    const bloques = generarBloques({
      fechaInicio, fechaFin, diasAsueto, duracionMin,
      patrones: patrones.map(p => ({ ...p, lugar: patronLugar(p) })),
      color, alarma,
    })
    if (bloques.length === 0) {
      toast('Con esas fechas y días no se generó ningún bloque. Revisa el rango y los días elegidos.', 'error')
      return
    }

    setSaving(true)
    try {
      const programacionId = crypto.randomUUID()
      const meta = {
        docenteId: currentUser.uid,
        programacionId,
        asignaturaId,
        createdAt: serverTimestamp(),
      }
      const created = []
      // Firestore limita cada batch a 500 escrituras: dividimos por lotes.
      for (let i = 0; i < bloques.length; i += FIRESTORE_BATCH_LIMIT) {
        const batch = writeBatch(db)
        const slice = bloques.slice(i, i + FIRESTORE_BATCH_LIMIT)
        slice.forEach(b => {
          const ref = doc(collection(db, 'horarioBloques'))
          const payload = { ...b, ...meta }
          batch.set(ref, payload)
          created.push({ id: ref.id, ...b, docenteId: currentUser.uid, programacionId, asignaturaId })
        })
        await batch.commit()
      }
      onSaved?.(created)
      toast(`Se programaron ${created.length} bloques de clase`)
      onClose()
    } catch (err) {
      toast('Error al guardar: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const label = (txt) => <label className="text-xs font-semibold text-muted uppercase tracking-wide">{txt}</label>
  const inputCls = 'px-2.5 py-1.5 rounded border border-outline-variant text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-accent'

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-surface-card rounded-t-card md:rounded-card shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-outline-variant flex-shrink-0">
          <div className="flex items-center gap-2">
            <CalendarPlus size={18} className="text-accent" />
            <h2 className="font-semibold text-on-surface">Crear bloques de clases por asignatura</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1 text-muted hover:text-error rounded transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-5">

          {/* Asignatura */}
          <div className="space-y-1.5">
            {label('Asignatura')}
            <select
              value={asignaturaId}
              onChange={e => setAsignaturaId(e.target.value)}
              className={`${inputCls} w-full`}
            >
              <option value="">Elige una asignatura…</option>
              {subjectList.map(s => (
                <option key={s.id} value={s.id}>{subjectDisplayName(s)}</option>
              ))}
            </select>
          </div>

          {/* Rango de fechas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              {label('Fecha de inicio')}
              <EFDateTimePicker
                mode="date"
                value={fechaInicio}
                onChange={v => { setFechaInicio(v); if (fechaFin && fechaFin < v) setFechaFin('') }}
                placeholder="Desde…"
                clearable={false}
              />
            </div>
            <div className="space-y-1.5">
              {label('Fecha de finalización')}
              <EFDateTimePicker
                mode="date"
                value={fechaFin}
                onChange={setFechaFin}
                minDateTime={fechaInicio ? `${fechaInicio}T00:00` : undefined}
                placeholder="Hasta…"
                clearable={false}
              />
            </div>
          </div>

          {/* Días de asueto */}
          <div className="space-y-1.5">
            {label('Días de asueto (opcional)')}
            <p className="text-xs text-muted">En estas fechas no se crearán bloques de clase.</p>
            <div className="flex gap-2 items-stretch">
              <div className="flex-1">
                <EFDateTimePicker
                  mode="date"
                  value={nuevoAsueto}
                  onChange={setNuevoAsueto}
                  minDateTime={fechaInicio ? `${fechaInicio}T00:00` : undefined}
                  placeholder="Agregar día de asueto…"
                  clearable
                />
              </div>
              <button
                type="button"
                onClick={addAsueto}
                disabled={!nuevoAsueto}
                className="px-3 rounded border border-outline-variant text-sm text-accent hover:bg-accent-tint disabled:opacity-40 transition-colors flex items-center gap-1"
              >
                <Plus size={14} /> Añadir
              </button>
            </div>
            {diasAsueto.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {diasAsueto.map(f => {
                  const d = new Date(f + 'T12:00:00')
                  return (
                    <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface border border-outline-variant text-xs text-on-surface">
                      {d.getDate()}/{d.getMonth() + 1}/{d.getFullYear()}
                      <button type="button" onClick={() => removeAsueto(f)} className="text-muted hover:text-error" aria-label="Quitar">
                        <X size={12} />
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
          </div>

          {/* Duración + bloques por semana */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              {label('Duración por hora/bloque (min)')}
              <input
                type="number" min={5} step={5}
                value={duracionMin}
                onChange={e => setDuracionMin(Number(e.target.value))}
                className={`${inputCls} w-full`}
              />
            </div>
            <div className="space-y-1.5">
              {label('Bloques por semana')}
              <input
                type="number" min={1} max={7}
                value={bloquesPorSemana}
                onChange={e => changeBloquesPorSemana(Math.max(1, Math.min(7, Number(e.target.value) || 1)))}
                className={`${inputCls} w-full`}
              />
            </div>
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            {label('Color de los bloques')}
            <div className="flex flex-wrap gap-2">
              {BLOQUE_COLORS.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColor(c.id)}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${color === c.id ? 'border-on-surface scale-110' : 'border-transparent'}`}
                  style={{ background: c.bg }}
                  data-tooltip={c.label}
                  aria-label={c.label}
                />
              ))}
            </div>
          </div>

          {/* Alarma */}
          <div className="space-y-2 rounded-card border border-outline-variant p-3">
            <button
              type="button"
              onClick={() => setAlarma(a => ({ ...a, activa: !a.activa }))}
              className="flex items-center gap-2 text-sm font-medium text-on-surface"
            >
              {alarma.activa ? <Bell size={16} className="text-accent" /> : <BellOff size={16} className="text-muted" />}
              Alarma antes de la clase
              <span className={`ml-1 text-xs px-2 py-0.5 rounded-full ${alarma.activa ? 'bg-accent text-white' : 'bg-surface text-muted border border-outline-variant'}`}>
                {alarma.activa ? 'Activada' : 'Desactivada'}
              </span>
            </button>
            {alarma.activa && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  {label('Sonido')}
                  <div className="flex gap-2">
                    <select
                      value={alarma.sonido}
                      onChange={e => setAlarma(a => ({ ...a, sonido: e.target.value }))}
                      className={`${inputCls} flex-1`}
                    >
                      {ALARMA_SONIDOS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => reproducirSonido(alarma.sonido)}
                      className="px-2.5 rounded border border-outline-variant text-accent hover:bg-accent-tint transition-colors"
                      data-tooltip="Probar sonido"
                      aria-label="Probar sonido"
                    >
                      <Play size={14} />
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {label('Minutos antes')}
                  <input
                    type="number" min={0} max={120}
                    value={alarma.minutosAntes}
                    onChange={e => setAlarma(a => ({ ...a, minutosAntes: Math.max(0, Number(e.target.value) || 0) }))}
                    className={`${inputCls} w-full`}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Patrones (bloques por semana) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              {label(`Bloques de la semana (${patrones.length}/${bloquesPorSemana})`)}
              {completo && (
                <span className="inline-flex items-center gap-1 text-xs text-green-700">
                  <Check size={13} /> Ya están los {bloquesPorSemana} bloques
                </span>
              )}
            </div>

            {patrones.map((p, idx) => (
              <div key={idx} className="rounded-card border border-outline-variant p-3 space-y-2 relative" style={{ background: pal.bg + '55' }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold" style={{ color: pal.text }}>Bloque {idx + 1}</span>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setMenuAbierto(menuAbierto === idx ? null : idx)}
                      className="p-1 rounded hover:bg-black/5 text-muted"
                      aria-label="Opciones del bloque"
                    >
                      <MoreVertical size={16} />
                    </button>
                    {menuAbierto === idx && (
                      <div className="absolute right-0 top-7 z-10 bg-surface-card border border-outline-variant rounded-card shadow-lg py-1 w-40 text-sm">
                        <button type="button" onClick={() => duplicarPatron(idx)} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent-tint text-on-surface">
                          <Copy size={14} /> Duplicar
                        </button>
                        <button type="button" onClick={() => eliminarPatron(idx)} disabled={patrones.length <= 1} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent-tint text-error disabled:opacity-40">
                          <Trash2 size={14} /> Eliminar
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <span className="text-xs text-muted">Día</span>
                    <select
                      value={p.diaSemana}
                      onChange={e => updatePatron(idx, { diaSemana: Number(e.target.value) })}
                      className={`${inputCls} w-full`}
                    >
                      {DIAS_SEMANA.map((d, i) => <option key={i} value={i}>{d}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted">Hora de inicio</span>
                    <select
                      value={p.horaInicio}
                      onChange={e => updatePatron(idx, { horaInicio: e.target.value })}
                      className={`${inputCls} w-full`}
                    >
                      {HORAS_INICIO.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted">Horas/bloques seguidos</span>
                    <input
                      type="number" min={1} max={12}
                      value={p.horas}
                      onChange={e => updatePatron(idx, { horas: Math.max(1, Number(e.target.value) || 1) })}
                      className={`${inputCls} w-full`}
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted">Lugar (opcional)</span>
                    <select
                      value={p.lugarTipo}
                      onChange={e => updatePatron(idx, { lugarTipo: e.target.value })}
                      className={`${inputCls} w-full`}
                    >
                      {LUGARES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                    </select>
                  </div>
                </div>
                {(p.lugarTipo === 'aula' || p.lugarTipo === 'otro') && (
                  <input
                    type="text"
                    value={p.lugarDetalle}
                    onChange={e => updatePatron(idx, { lugarDetalle: e.target.value })}
                    placeholder={p.lugarTipo === 'aula' ? 'Número o nombre del aula (opcional)' : 'Escribe el lugar'}
                    className={`${inputCls} w-full`}
                  />
                )}
                <p className="text-xs text-muted">
                  Termina a las <strong>{addMinutesToTime(p.horaInicio || '07:00', Math.max(1, Number(p.horas) || 1) * duracionMin)}</strong>
                </p>
              </div>
            ))}

            <button
              type="button"
              onClick={addPatron}
              className="w-full py-2 rounded-card border border-dashed border-outline-variant text-sm text-accent hover:bg-accent-tint transition-colors flex items-center justify-center gap-1.5"
            >
              <Plus size={15} /> Agregar bloque
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-outline-variant px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-muted flex-1">
            {previewCount > 0
              ? <>Se crearán <strong className="text-on-surface">{previewCount}</strong> bloques</>
              : 'Completa la configuración'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm text-muted rounded border border-outline-variant hover:bg-surface transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-accent text-white rounded text-sm font-semibold disabled:opacity-60 flex items-center gap-2"
          >
            {saving ? <Spinner size="sm" /> : <><Check size={15} /> Programar bloques</>}
          </button>
        </div>
      </div>
    </div>
  )
}
