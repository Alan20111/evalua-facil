import { useState, useMemo } from 'react'
import { useToast } from '../Toast'
import EFDateTimePicker from '../EFDateTimePicker'
import { subjectDisplayName } from '../../utils/subjectName'
import { Bell, BellOff, Play, ArrowRight, CalendarPlus, Pencil, Trash2 } from 'lucide-react'
import { BLOQUE_COLORS, ALARMA_SONIDOS, reproducirSonido } from '../../utils/horarioBloques'

// Ventana de configuración de una programación (paso 1 de 2).
//
//  - mode 'crear':      se elige la asignatura y todos los parámetros.
//  - mode 'modificar':  la asignatura ya está fija (no se elige); el docente
//                       puede cambiar fechas, duración, bloques/semana, color y
//                       alarma de TODA la asignatura (útil p. ej. para recolorear
//                       todos sus bloques de una vez).
//
// Los días de asueto ya NO se definen aquí: se administran globalmente desde el
// botón "Días de asueto" del calendario.

export default function ProgramarBloquesModal({
  subjects, subjectsDisponibles = null, mode = 'crear', initial = null, subjectName = '',
  onClose, onContinue, onDeleteAll,
}) {
  const toast = useToast()
  const esModificar = mode === 'modificar'

  const [asignaturaId, setAsignaturaId] = useState(initial?.asignaturaId || '')
  const [fechaInicio, setFechaInicio] = useState(initial?.fechaInicio || '')
  const [fechaFin, setFechaFin] = useState(initial?.fechaFin || '')
  const [duracionMin, setDuracionMin] = useState(initial?.duracionMin || 60)
  const [bloquesPorSemana, setBloquesPorSemana] = useState(initial?.bloquesPorSemana || 1)
  const [color, setColor] = useState(initial?.color || 'blue')
  const [alarma, setAlarma] = useState(initial?.alarma || { activa: false, sonido: 'campana', minutosAntes: 10 })
  const [confirmDel, setConfirmDel] = useState(false)

  // En modo "crear" solo se listan asignaturas SIN programar.
  const subjectList = useMemo(
    () => (subjectsDisponibles || Object.values(subjects)).slice().sort((a, b) =>
      subjectDisplayName(a).localeCompare(subjectDisplayName(b))),
    [subjects, subjectsDisponibles],
  )
  const sinDisponibles = !esModificar && subjectList.length === 0

  function handleContinue() {
    if (!esModificar && !asignaturaId) { toast('Selecciona una asignatura', 'error'); return }
    if (!fechaInicio || !fechaFin) { toast('Indica la fecha de inicio y de finalización', 'error'); return }
    if (fechaFin < fechaInicio) { toast('La fecha de finalización debe ser posterior a la de inicio', 'error'); return }
    if (!duracionMin || duracionMin < 5) { toast('La duración debe ser de al menos 5 minutos', 'error'); return }
    if (!bloquesPorSemana || bloquesPorSemana < 1) { toast('Indica cuántos bloques por semana', 'error'); return }
    onContinue?.({
      asignaturaId, fechaInicio, fechaFin,
      duracionMin, bloquesPorSemana, color, alarma,
    })
  }

  const label = (txt) => <label className="text-xs font-semibold text-muted uppercase tracking-wide">{txt}</label>
  const inputCls = 'px-2.5 py-1.5 rounded border border-outline-variant text-sm bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={`bg-surface-card rounded-t-card md:rounded-card shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col ${esModificar ? 'ring-4 ring-amber-400 ring-inset' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-outline-variant flex-shrink-0"
          style={esModificar ? { background: '#fef3c7' } : undefined}>
          <div className="flex items-center gap-2 min-w-0">
            {esModificar ? <Pencil size={18} className="text-amber-600" /> : <CalendarPlus size={18} className="text-accent" />}
            <h2 className="font-semibold text-on-surface truncate">
              {esModificar ? `Modificar bloques de ${subjectName}` : 'Programar bloques de clase por asignatura'}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1 text-muted hover:text-error rounded transition-colors">
            <ArrowRight size={18} className="rotate-90 md:rotate-0 hidden" />
            <span className="text-xl leading-none">×</span>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-5">

          {/* Asignatura */}
          {esModificar ? (
            <div className="space-y-1.5">
              {label('Asignatura')}
              <div className="px-2.5 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface font-medium">
                {subjectName}
              </div>
              <p className="text-xs text-muted">Estás modificando toda esta asignatura. Al guardar se reemplazan sus bloques.</p>
            </div>
          ) : sinDisponibles ? (
            <div className="rounded-card border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Ya no hay asignaturas por programar: todas tienen su programación.
              Para cambiar una, usa <strong>Modificar bloques</strong>; si quieres reprogramarla
              desde cero, ábrela en Modificar y borra su programación.
            </div>
          ) : (
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
          )}

          {!sinDisponibles && <>

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
                showShortcuts={false}
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
                showShortcuts={false}
              />
            </div>
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
            {esModificar
              ? 'En el siguiente paso reacomodas los bloques en la semana.'
              : `En el siguiente paso colocarás estos ${bloquesPorSemana} bloque(s) en los días y horas de la semana.`}
          </p>

          {/* Color */}
          <div className="space-y-1.5">
            {label(esModificar ? 'Color de los bloques' : 'Color de los bloques (por defecto)')}
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
            {esModificar && (
              <p className="text-xs text-muted">Si cambias el color aquí, se aplica a todos los bloques de la asignatura.</p>
            )}
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
            {esModificar && alarma.activa && (
              <p className="text-xs text-muted">La alarma se aplica al primer bloque de cada día (los seguidos no suenan en plena clase).</p>
            )}
          </div>

          {/* Borrar toda la programación (solo al modificar) */}
          {esModificar && (
            <div className="pt-1 border-t border-outline-variant">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide pt-3 pb-1.5">Zona de riesgo</p>
              {confirmDel ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-card bg-error/10 border border-error/30">
                  <span className="text-xs text-error flex-1">
                    ¿Borrar TODA la programación de {subjectName}? La asignatura quedará libre para programarse de nuevo.
                  </span>
                  <button type="button" onClick={() => setConfirmDel(false)} className="text-xs text-muted px-2 py-1">Cancelar</button>
                  <button type="button" onClick={() => onDeleteAll?.(initial?.asignaturaId)} className="text-xs bg-error text-white rounded px-2.5 py-1 font-medium">Borrar</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDel(true)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-card text-sm text-error border border-error/30 hover:bg-error/10 transition-colors"
                >
                  <Trash2 size={15} /> Borrar toda la programación de esta asignatura
                </button>
              )}
            </div>
          )}

          </>}
        </div>

        {/* Footer */}
        <div className="border-t border-outline-variant px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-muted flex-1">{sinDisponibles ? '' : 'Paso 1 de 2 · configuración'}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm text-muted rounded border border-outline-variant hover:bg-surface transition-colors"
          >
            {sinDisponibles ? 'Cerrar' : 'Cancelar'}
          </button>
          {!sinDisponibles && (
            <button
              type="button"
              onClick={handleContinue}
              className={`px-4 py-2 text-white rounded text-sm font-semibold flex items-center gap-2 ${esModificar ? 'bg-amber-600 hover:bg-amber-700' : 'bg-accent hover:bg-accent-hover'}`}
            >
              Continuar <ArrowRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
