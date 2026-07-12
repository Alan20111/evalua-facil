import { useState, useMemo } from 'react'
import { useToast } from '../Toast'
import EFDateTimePicker from '../EFDateTimePicker'
import { subjectDisplayName } from '../../utils/subjectName'
import { X, Plus, Bell, BellOff, Play, ArrowRight, CalendarPlus } from 'lucide-react'
import { BLOQUE_COLORS, ALARMA_SONIDOS, reproducirSonido } from '../../utils/horarioBloques'

// Ventana simplificada: recoge SOLO la configuración general de la programación.
// La colocación de cada bloque (día, hora, lugar) se hace después en la zona
// semanal (ProgramarZonaSemanal). El color y la alarma de aquí son los valores
// POR DEFECTO de cada bloque; se pueden ajustar bloque a bloque al colocarlos.

export default function ProgramarBloquesModal({ subjects, onClose, onContinue }) {
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

  const subjectList = useMemo(
    () => Object.values(subjects).sort((a, b) =>
      subjectDisplayName(a).localeCompare(subjectDisplayName(b))),
    [subjects],
  )

  function addAsueto() {
    if (!nuevoAsueto || diasAsueto.includes(nuevoAsueto)) { setNuevoAsueto(''); return }
    setDiasAsueto(a => [...a, nuevoAsueto].sort())
    setNuevoAsueto('')
  }
  function removeAsueto(fecha) {
    setDiasAsueto(a => a.filter(f => f !== fecha))
  }

  function handleContinue() {
    if (!asignaturaId) { toast('Selecciona una asignatura', 'error'); return }
    if (!fechaInicio || !fechaFin) { toast('Indica la fecha de inicio y de finalización', 'error'); return }
    if (fechaFin < fechaInicio) { toast('La fecha de finalización debe ser posterior a la de inicio', 'error'); return }
    if (!duracionMin || duracionMin < 5) { toast('La duración debe ser de al menos 5 minutos', 'error'); return }
    if (!bloquesPorSemana || bloquesPorSemana < 1) { toast('Indica cuántos bloques por semana', 'error'); return }
    onContinue?.({
      asignaturaId, fechaInicio, fechaFin, diasAsueto,
      duracionMin, bloquesPorSemana, color, alarma,
    })
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
            <h2 className="font-semibold text-on-surface">Programar bloques de clase por asignatura</h2>
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
                type="number" min={1} max={20}
                value={bloquesPorSemana}
                onChange={e => setBloquesPorSemana(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                className={`${inputCls} w-full`}
              />
            </div>
          </div>
          <p className="text-xs text-muted -mt-3">
            En el siguiente paso colocarás estos {bloquesPorSemana} bloque(s) en los días y horas de la semana.
          </p>

          {/* Color por defecto */}
          <div className="space-y-1.5">
            {label('Color de los bloques (por defecto)')}
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

          {/* Alarma por defecto */}
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
        </div>

        {/* Footer */}
        <div className="border-t border-outline-variant px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-muted flex-1">Paso 1 de 2 · configuración</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm text-muted rounded border border-outline-variant hover:bg-surface transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleContinue}
            className="px-4 py-2 bg-accent text-white rounded text-sm font-semibold flex items-center gap-2"
          >
            Continuar <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
