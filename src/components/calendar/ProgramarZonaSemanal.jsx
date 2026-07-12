import { useState, useMemo, useRef } from 'react'
import {
  X, Check, Plus, Minus, Trash2, Copy, Bell, BellOff, MapPin, AlertCircle, Play,
  ArrowLeft, Pencil,
} from 'lucide-react'
import { subjectDisplayName } from '../../utils/subjectName'
import {
  BLOQUE_COLORS, bloqueColor, ALARMA_SONIDOS, reproducirSonido,
  DIAS_SEMANA, addMinutesToTime, timeToMinutes,
} from '../../utils/horarioBloques'

const ROW_H = 52 // px por hora — igual que la vista Semana
const SNAP_MIN = 10 // los bloques se colocan/arrastran alineados a 10 min
const DIAS_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

// Un patrón colocado en la zona semanal:
//   { id, diaSemana, horaInicio, duracionMin, lugar, color, alarma }
// Al guardar, cada patrón se materializa en una instancia por cada semana del
// rango (ver generarBloques). 2 horas seguidas = 2 patrones = 2 unidades de BS.

let _pid = 0
function nuevoId() { return `p${++_pid}` }

function minsToTime(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function solapan(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

// Selector de hora que salta de 10 en 10 minutos (permite 07:50, 08:10, …).
function HoraStepper({ value, onChange, minMin, maxMin, step = SNAP_MIN }) {
  const cur = timeToMinutes(value)
  const btn = 'px-2 py-1.5 rounded border border-outline-variant text-accent hover:bg-accent-tint disabled:opacity-40 transition-colors'
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={() => onChange(minsToTime(Math.max(minMin, cur - step)))} disabled={cur <= minMin} className={btn} aria-label="−10 minutos">
        <Minus size={14} />
      </button>
      <span className="flex-1 text-center text-base font-semibold tabular-nums py-1.5 rounded border border-outline-variant bg-surface select-none">{value}</span>
      <button type="button" onClick={() => onChange(minsToTime(Math.min(maxMin, cur + step)))} disabled={cur >= maxMin} className={btn} aria-label="+10 minutos">
        <Plus size={14} />
      </button>
    </div>
  )
}

export default function ProgramarZonaSemanal({
  config,          // { asignaturaId, duracionMin, bloquesPorSemana, color, alarma }
  subjects,
  otrosBloques = [],   // bloques de OTRAS asignaturas (referencia de ocupación, tenues)
  initialPatrones = null,
  mode = 'crear',      // 'crear' | 'modificar'
  dayStart = 7,
  dayEnd = 20,
  numDays = 7,
  onCancel,
  onConfirm,           // (patrones) => void
}) {
  const { asignaturaId, duracionMin, bloquesPorSemana, color: colorDefault, alarma: alarmaDefault } = config
  const subj = subjects[asignaturaId]
  const esModificar = mode === 'modificar'

  const [patrones, setPatrones] = useState(() =>
    (initialPatrones || []).map(p => ({ id: nuevoId(), ...p })))
  const [placing, setPlacing] = useState(null)  // { diaSemana, horaInicio, count }
  const [editing, setEditing] = useState(null)  // id del patrón que se edita
  const [recienId, setRecienId] = useState(null) // último bloque duplicado (resaltado)
  const [confirmSalir, setConfirmSalir] = useState(false)

  const restantes = bloquesPorSemana - patrones.length
  const completo = patrones.length === bloquesPorSemana

  const hoursRange = useMemo(
    () => Array.from({ length: Math.max(1, dayEnd - dayStart) }, (_, i) => i + dayStart),
    [dayStart, dayEnd],
  )
  const gridH = hoursRange.length * ROW_H
  const gridCols = `3.5rem repeat(${numDays}, 1fr)`

  // Ocupación de OTRAS asignaturas, colapsada a la semana canónica (día + rango).
  const ocupadoOtros = useMemo(() => {
    const seen = new Set()
    const out = []
    otrosBloques.forEach(b => {
      const dia = b.diaSemana ?? ((new Date(b.fecha + 'T12:00:00').getDay() + 6) % 7)
      const s = timeToMinutes(b.horaInicio)
      const e = timeToMinutes(b.horaFin)
      const key = `${dia}-${s}-${e}-${b.asignaturaId}`
      if (seen.has(key)) return
      seen.add(key)
      out.push({ diaSemana: dia, start: s, end: e, asignaturaId: b.asignaturaId, color: b.color })
    })
    return out
  }, [otrosBloques])

  // Rangos ocupados en un día = otras asignaturas + patrones ya colocados
  // (opcionalmente excluyendo un patrón que se está moviendo/editando).
  function rangosOcupados(dia, excluirId = null) {
    const r = []
    ocupadoOtros.forEach(o => { if (o.diaSemana === dia) r.push([o.start, o.end]) })
    patrones.forEach(p => {
      if (p.id === excluirId || p.diaSemana !== dia) return
      const s = timeToMinutes(p.horaInicio)
      r.push([s, s + p.duracionMin])
    })
    return r
  }

  // ¿Cabe una corrida de `count` bloques de `dur` min a partir de `startMin`?
  function cabe(dia, startMin, count, dur, excluirId = null) {
    const end = startMin + count * dur
    if (startMin < dayStart * 60 || end > dayEnd * 60) return false
    return !rangosOcupados(dia, excluirId).some(([s, e]) => solapan(startMin, end, s, e))
  }

  // ── Colocar ────────────────────────────────────────────────────────────
  function abrirColocar(dia, hora) {
    if (restantes <= 0) return
    setEditing(null)
    setPlacing({ diaSemana: dia, horaInicio: hora, count: 1, lugar: '' })
  }

  function maxCountColocar(p) {
    if (!p) return 0
    const startMin = timeToMinutes(p.horaInicio)
    let n = 0
    while (n < restantes && cabe(p.diaSemana, startMin, n + 1, duracionMin)) n++
    return n
  }

  function confirmarColocar() {
    const p = placing
    const startMin = timeToMinutes(p.horaInicio)
    const count = Math.min(p.count, maxCountColocar(p))
    if (count < 1) return
    const nuevos = Array.from({ length: count }, (_, i) => ({
      id: nuevoId(),
      diaSemana: p.diaSemana,
      horaInicio: minsToTime(startMin + i * duracionMin),
      duracionMin,
      lugar: (p.lugar || '').trim(),
      color: colorDefault,
      // La alarma solo tiene sentido en el primer bloque de la corrida.
      alarma: i === 0 ? { ...alarmaDefault } : { ...alarmaDefault, activa: false },
    }))
    setPatrones(ps => [...ps, ...nuevos])
    setPlacing(null)
  }

  // ── Editar / mover / duplicar / borrar un patrón colocado ────────────────
  function updatePatron(id, patch) {
    setPatrones(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p))
  }
  function borrarPatron(id) {
    setPatrones(ps => ps.filter(p => p.id !== id))
    setEditing(null)
    if (recienId === id) setRecienId(null)
  }
  function duplicarPatron(id) {
    if (restantes <= 0) return
    const p = patrones.find(x => x.id === id)
    if (!p) return
    // Coloca la copia en la siguiente hora libre del mismo día.
    let startMin = timeToMinutes(p.horaInicio) + p.duracionMin
    while (startMin < dayEnd * 60 && !cabe(p.diaSemana, startMin, 1, p.duracionMin)) startMin += SNAP_MIN
    if (!cabe(p.diaSemana, startMin, 1, p.duracionMin)) return
    const nid = nuevoId()
    setPatrones(ps => [...ps, {
      ...p, id: nid, horaInicio: minsToTime(startMin),
      alarma: { ...p.alarma, activa: false },
    }])
    // El bloque nuevo queda resaltado y su editor abierto para ajustarlo.
    setRecienId(nid)
    setEditing(nid)
  }

  // ── Arrastrar para mover (cambia día y hora) ─────────────────────────────
  // Usa Pointer Capture: al presionar un bloque, ESE bloque recibe todos los
  // eventos del puntero hasta soltarlo, aunque el cursor salga de él. Así el
  // arrastre es a prueba de fallos y NUNCA afecta a la ventana (que no se
  // mueve); lo único que se mueve es el bloque.
  const colRefs = useRef([])
  const dragRef = useRef(null) // arrastre activo (no provoca re-render)
  const [drag, setDrag] = useState(null) // solo para dibujar el fantasma

  function startDrag(e, p) {
    if (e.button != null && e.button !== 0) return
    e.preventDefault()           // sin selección de texto ni arrastre nativo
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* no soportado */ }
    const rect = e.currentTarget.getBoundingClientRect()
    dragRef.current = {
      id: p.id, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      grabDX: e.clientX - rect.left, grabDY: e.clientY - rect.top,
      w: rect.width, h: rect.height, moved: false,
    }
    setDrag({ id: p.id, x: e.clientX, y: e.clientY, grabDX: e.clientX - rect.left, grabDY: e.clientY - rect.top, w: rect.width, h: rect.height, moved: false })
  }

  function onDragMove(e) {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5) d.moved = true
    setDrag(cur => cur && ({ ...cur, x: e.clientX, y: e.clientY, moved: d.moved }))
  }

  function onDragEnd(e) {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    dragRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    setDrag(null)
    const p = patrones.find(x => x.id === d.id)
    if (!p) return
    if (!d.moved) { setPlacing(null); setEditing(d.id); return } // clic → editar
    // Detecta la columna (día) bajo el cursor.
    const blockTop = e.clientY - d.grabDY
    let target = null
    colRefs.current.forEach((el, idx) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX < r.right) target = { idx, top: r.top }
    })
    if (target) {
      let mins = Math.round(((blockTop - target.top) / ROW_H * 60 + dayStart * 60) / SNAP_MIN) * SNAP_MIN
      mins = Math.max(dayStart * 60, Math.min(dayEnd * 60 - p.duracionMin, mins))
      if (cabe(target.idx, mins, 1, p.duracionMin, p.id)) {
        updatePatron(p.id, { diaSemana: target.idx, horaInicio: minsToTime(mins) })
      }
    }
  }

  // ── Salir / guardar ──────────────────────────────────────────────────────
  function intentarSalir() {
    if (patrones.length === 0) { onCancel?.(); return }
    setConfirmSalir(true)
  }
  function guardar() {
    if (!completo) return
    const ordenados = [...patrones].sort((a, b) =>
      a.diaSemana - b.diaSemana || timeToMinutes(a.horaInicio) - timeToMinutes(b.horaInicio))
    onConfirm?.(ordenados.map(({ id, ...rest }) => rest)) // eslint-disable-line no-unused-vars
  }

  function topPx(hora) {
    return (timeToMinutes(hora) - dayStart * 60) / 60 * ROW_H
  }

  const editP = editing ? patrones.find(p => p.id === editing) : null
  const inputCls = 'px-2.5 py-1.5 rounded border border-outline-variant text-sm bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'
  const bannerBg = esModificar ? '#fef3c7' : bloqueColor(colorDefault).bg + '66'

  return (
    <div
      className={`fixed inset-0 z-50 bg-surface-card flex flex-col ${esModificar ? 'ring-4 ring-amber-400 ring-inset' : ''}`}
    >
        {/* Banner de modo */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant flex-shrink-0" style={{ background: bannerBg }}>
          <button type="button" onClick={intentarSalir} className="p-1 text-muted hover:text-error rounded transition-colors" aria-label="Volver">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-on-surface truncate flex items-center gap-1.5">
              {esModificar && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500 text-white text-[10px] font-bold uppercase tracking-wide flex-shrink-0">
                  <Pencil size={10} /> Modificando
                </span>
              )}
              <span className="truncate">
                {esModificar ? 'Reacomodando' : 'Programando'} bloques de {subjectDisplayName(subj) || 'la asignatura'}
              </span>
            </p>
            <p className="text-xs text-muted">
              Toca un día para colocar · toca un bloque para editarlo · arrástralo para moverlo
            </p>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${completo ? 'bg-green-600 text-white' : 'bg-surface-card border border-outline-variant text-on-surface'}`}>
            {completo && <Check size={14} />}
            {patrones.length}/{bloquesPorSemana} colocados
          </div>
        </div>

        {/* Aviso cuando faltan bloques */}
        {!completo && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800 flex items-center gap-2 flex-shrink-0">
            <AlertCircle size={14} className="flex-shrink-0 text-amber-500" />
            Coloca {restantes} bloque{restantes === 1 ? '' : 's'} más para poder guardar.
          </div>
        )}

        {/* Rejilla semanal canónica */}
        <div className="overflow-auto flex-1">
          <div className="min-w-[620px]">
            {/* Cabecera de días */}
            <div className="grid border-b border-outline-variant sticky top-0 bg-surface-card z-10" style={{ gridTemplateColumns: gridCols }}>
              <div className="py-2 px-2" />
              {Array.from({ length: numDays }, (_, i) => (
                <div key={i} className="py-2 text-center text-xs border-l border-outline-variant">
                  <span className="block uppercase text-muted font-semibold">{DIAS_CORTO[i]}</span>
                </div>
              ))}
            </div>

            {/* Cuerpo: gutter de horas + columnas */}
            <div className="grid" style={{ gridTemplateColumns: gridCols }}>
              {/* Gutter horas */}
              <div className="relative" style={{ height: gridH }}>
                {hoursRange.map((hour, i) => (
                  <div key={hour} className="absolute left-0 right-0 px-2 text-xs text-muted" style={{ top: i * ROW_H }}>
                    {hour}:00
                  </div>
                ))}
              </div>

              {/* Columnas por día */}
              {Array.from({ length: numDays }, (_, dia) => {
                const otros = ocupadoOtros.filter(o => o.diaSemana === dia)
                const propios = patrones.filter(p => p.diaSemana === dia)
                return (
                  <div
                    key={dia}
                    ref={el => { colRefs.current[dia] = el }}
                    className="relative border-l border-outline-variant"
                    style={{ height: gridH }}
                  >
                    {/* Líneas horarias + zonas clicables */}
                    {hoursRange.map((hour, i) => (
                      <button
                        key={hour}
                        type="button"
                        onClick={() => abrirColocar(dia, `${String(hour).padStart(2, '0')}:00`)}
                        disabled={restantes <= 0}
                        className={`absolute left-0 right-0 border-b border-outline-variant transition-colors text-left ${restantes > 0 ? 'hover:bg-accent-tint cursor-pointer' : 'cursor-default'}`}
                        style={{ top: i * ROW_H, height: ROW_H }}
                        aria-label={`Colocar bloque el ${DIAS_SEMANA[dia]} a las ${String(hour).padStart(2, '0')}:00`}
                      />
                    ))}

                    {/* Bloques de otras asignaturas (tenues, no editables) */}
                    {otros.map((o, k) => {
                      const pal = bloqueColor(o.color)
                      const height = Math.max(18, (o.end - o.start) / 60 * ROW_H - 4)
                      const top = Math.max(0, Math.min((o.start - dayStart * 60) / 60 * ROW_H, gridH - height))
                      const osubj = subjects[o.asignaturaId]
                      return (
                        <div
                          key={`o${k}`}
                          className="absolute rounded-lg px-1.5 py-1 overflow-hidden pointer-events-none"
                          style={{
                            top, height, left: '2px', right: '2px',
                            background: pal.bg, color: pal.text, opacity: 0.35,
                            border: '1px dashed ' + pal.text + '55',
                          }}
                        >
                          <span className="block text-[10px] font-medium leading-tight truncate">
                            {subjectDisplayName(osubj) || 'Otra clase'}
                          </span>
                          <span className="block text-[10px] opacity-80 leading-tight">{minsToTime(o.start)}</span>
                        </div>
                      )
                    })}

                    {/* Bloques propios (colocados) */}
                    {propios.map(p => {
                      const pal = bloqueColor(p.color)
                      const height = Math.max(20, p.duracionMin / 60 * ROW_H - 4)
                      const top = Math.max(0, Math.min(topPx(p.horaInicio), gridH - height))
                      const horaFin = addMinutesToTime(p.horaInicio, p.duracionMin)
                      const isDragging = drag?.moved && drag.id === p.id
                      const esReciente = recienId === p.id
                      return (
                        <div
                          key={p.id}
                          onPointerDown={e => { e.stopPropagation(); startDrag(e, p) }}
                          onPointerMove={onDragMove}
                          onPointerUp={onDragEnd}
                          onPointerCancel={onDragEnd}
                          className="absolute rounded-lg px-1.5 py-1 text-left overflow-hidden shadow-sm ring-1 ring-black/10 hover:brightness-95 transition select-none cursor-grab active:cursor-grabbing"
                          style={{
                            top, height, left: '3px', right: '3px',
                            background: pal.bg, color: pal.text,
                            opacity: isDragging ? 0.3 : 1,
                            touchAction: 'none',
                            outline: editing === p.id ? `2px solid ${pal.text}`
                              : esReciente ? '2px dashed #d97706' : 'none',
                            boxShadow: esReciente ? '0 0 0 3px rgba(217,119,6,0.35)' : undefined,
                          }}
                        >
                          {esReciente && (
                            <span className="absolute top-0.5 right-0.5 text-[9px] font-bold px-1 rounded bg-amber-500 text-white">nuevo</span>
                          )}
                          <span className="block text-xs font-semibold leading-tight truncate">
                            {subjectDisplayName(subj)}
                          </span>
                          <span className="block text-[10px] opacity-80 leading-tight">{p.horaInicio}–{horaFin}</span>
                          {p.lugar && <span className="block text-[10px] opacity-70 leading-tight truncate">{p.lugar}</span>}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-outline-variant px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-muted flex-1">
            {completo
              ? <>Listo: se crearán las clases de <strong className="text-on-surface">{bloquesPorSemana}</strong> bloque(s) por semana en todo el rango.</>
              : <>Faltan <strong className="text-on-surface">{restantes}</strong> bloque(s).</>}
          </span>
          <button type="button" onClick={intentarSalir} className="px-3 py-2 text-sm text-muted rounded border border-outline-variant hover:bg-surface transition-colors">
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={!completo}
            className="px-4 py-2 bg-accent text-white rounded text-sm font-semibold disabled:opacity-60 flex items-center gap-2"
          >
            <Check size={15} /> {esModificar ? 'Guardar cambios' : 'Crear bloques'}
          </button>
        </div>

      {/* Fantasma que sigue al cursor mientras se arrastra */}
      {drag?.moved && (() => {
        const p = patrones.find(x => x.id === drag.id)
        if (!p) return null
        const pal = bloqueColor(p.color)
        return (
          <div
            className="fixed z-[65] rounded-lg px-1.5 py-1 shadow-lg pointer-events-none opacity-90"
            style={{
              left: drag.x - drag.grabDX, top: drag.y - drag.grabDY,
              width: drag.w, height: drag.h, background: pal.bg, color: pal.text,
            }}
          >
            <span className="block text-xs font-semibold leading-tight truncate">{subjectDisplayName(subj)}</span>
            <span className="block text-[10px] opacity-80 leading-tight">{p.horaInicio}–{addMinutesToTime(p.horaInicio, p.duracionMin)}</span>
          </div>
        )
      })()}

      {/* ── Popover: colocar bloque(s) ──────────────────────────────────── */}
      {placing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setPlacing(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card shadow-2xl w-full max-w-xs p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-on-surface text-sm">Colocar bloque</h3>
              <button type="button" onClick={() => setPlacing(null)} className="p-1 text-muted hover:text-error" aria-label="Cerrar"><X size={16} /></button>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted">Día</span>
              <select
                value={placing.diaSemana}
                onChange={e => setPlacing(p => ({ ...p, diaSemana: Number(e.target.value) }))}
                className={`${inputCls} w-full`}
              >
                {DIAS_SEMANA.slice(0, numDays).map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted">Hora de inicio</span>
              <HoraStepper
                value={placing.horaInicio}
                onChange={h => setPlacing(p => ({ ...p, horaInicio: h }))}
                minMin={dayStart * 60}
                maxMin={dayEnd * 60 - duracionMin}
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted">Lugar (opcional)</span>
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-muted flex-shrink-0" />
                <input
                  type="text" value={placing.lugar || ''}
                  onChange={e => setPlacing(p => ({ ...p, lugar: e.target.value }))}
                  placeholder="Aula, Centro de cómputo…"
                  className={`${inputCls} flex-1`}
                />
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted">Bloques seguidos (cada {duracionMin} min)</span>
              <input
                type="number" min={1} max={Math.max(1, restantes)}
                value={placing.count}
                onChange={e => setPlacing(p => ({ ...p, count: Math.max(1, Number(e.target.value) || 1) }))}
                className={`${inputCls} w-full`}
              />
              <p className="text-[11px] text-muted">Quedan {restantes} por colocar. 2 seguidos ocupan 2. El lugar se aplica a los que coloques aquí.</p>
            </div>
            {(() => {
              const max = maxCountColocar(placing)
              const invalido = max < 1
              const recortado = placing.count > max && max >= 1
              return (
                <>
                  {invalido && (
                    <p className="text-xs text-error flex items-center gap-1">
                      <AlertCircle size={13} /> Aquí se traslapa con un espacio ocupado o se sale del horario.
                    </p>
                  )}
                  {recortado && (
                    <p className="text-xs text-amber-600">Solo caben {max} aquí; se colocarán {max}.</p>
                  )}
                  <button
                    type="button"
                    onClick={confirmarColocar}
                    disabled={invalido}
                    className="w-full py-2 bg-accent text-white rounded text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    <Plus size={15} /> Colocar {Math.min(placing.count, Math.max(1, max))}
                  </button>
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* ── Popover: editar bloque colocado ─────────────────────────────── */}
      {editP && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setEditing(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card shadow-2xl w-full max-w-sm p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-on-surface text-sm">Editar bloque</h3>
              <button type="button" onClick={() => setEditing(null)} className="p-1 text-muted hover:text-error" aria-label="Cerrar"><X size={16} /></button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-xs text-muted">Día</span>
                <select
                  value={editP.diaSemana}
                  onChange={e => {
                    const dia = Number(e.target.value)
                    const s = timeToMinutes(editP.horaInicio)
                    if (cabe(dia, s, 1, editP.duracionMin, editP.id)) updatePatron(editP.id, { diaSemana: dia })
                  }}
                  className={`${inputCls} w-full`}
                >
                  {DIAS_SEMANA.slice(0, numDays).map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted">Hora de inicio</span>
                <HoraStepper
                  value={editP.horaInicio}
                  onChange={h => {
                    const s = timeToMinutes(h)
                    if (cabe(editP.diaSemana, s, 1, editP.duracionMin, editP.id)) updatePatron(editP.id, { horaInicio: h })
                  }}
                  minMin={dayStart * 60}
                  maxMin={dayEnd * 60 - editP.duracionMin}
                />
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-muted">Lugar (opcional)</span>
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-muted flex-shrink-0" />
                <input
                  type="text" value={editP.lugar}
                  onChange={e => updatePatron(editP.id, { lugar: e.target.value })}
                  placeholder="Aula, Centro de cómputo…"
                  className={`${inputCls} flex-1`}
                />
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-muted">Color</span>
              <div className="flex flex-wrap gap-2">
                {BLOQUE_COLORS.map(c => (
                  <button
                    key={c.id} type="button"
                    onClick={() => updatePatron(editP.id, { color: c.id })}
                    className={`w-6 h-6 rounded-full border-2 transition-all ${editP.color === c.id ? 'border-on-surface scale-110' : 'border-transparent'}`}
                    style={{ background: c.bg }} aria-label={c.label} data-tooltip={c.label}
                  />
                ))}
              </div>
            </div>

            {/* Alarma */}
            <div className="space-y-2 rounded-card border border-outline-variant p-2.5">
              <button
                type="button"
                onClick={() => updatePatron(editP.id, { alarma: { ...editP.alarma, activa: !editP.alarma.activa } })}
                className="flex items-center gap-2 text-sm font-medium text-on-surface"
              >
                {editP.alarma?.activa ? <Bell size={15} className="text-accent" /> : <BellOff size={15} className="text-muted" />}
                Alarma antes de la clase
              </button>
              {editP.alarma?.activa && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex gap-1.5">
                    <select
                      value={editP.alarma.sonido || 'campana'}
                      onChange={e => updatePatron(editP.id, { alarma: { ...editP.alarma, sonido: e.target.value } })}
                      className={`${inputCls} flex-1`}
                    >
                      {ALARMA_SONIDOS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                    <button type="button" onClick={() => reproducirSonido(editP.alarma.sonido || 'campana')} className="px-2 rounded border border-outline-variant text-accent hover:bg-accent-tint" aria-label="Probar">
                      <Play size={13} />
                    </button>
                  </div>
                  <input
                    type="number" min={0} max={120}
                    value={editP.alarma.minutosAntes ?? 10}
                    onChange={e => updatePatron(editP.id, { alarma: { ...editP.alarma, minutosAntes: Math.max(0, Number(e.target.value) || 0) } })}
                    className={`${inputCls} w-full`} placeholder="min antes"
                  />
                </div>
              )}
            </div>

            {/* Acciones: Borrar · Duplicar · Confirmar */}
            <div className="flex items-center gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => borrarPatron(editP.id)}
                className="flex items-center gap-1 px-2 py-1.5 text-xs text-error rounded border border-error/30 hover:bg-error/10 transition-colors"
              >
                <Trash2 size={13} /> Borrar
              </button>
              <button
                type="button"
                onClick={() => duplicarPatron(editP.id)}
                disabled={restantes <= 0}
                className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted rounded border border-outline-variant hover:text-accent hover:border-accent transition-colors disabled:opacity-60"
                data-tooltip={restantes <= 0 ? 'Ya no quedan bloques por colocar' : 'Copia en la hora siguiente'}
              >
                <Copy size={13} /> Duplicar
              </button>
              <button
                type="button"
                onClick={() => { setEditing(null); setRecienId(null) }}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-semibold text-white bg-accent rounded hover:bg-accent-hover transition-colors"
              >
                <Check size={13} /> Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmar salida con bloques colocados ─────────────────────── */}
      {confirmSalir && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setConfirmSalir(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card shadow-2xl w-full max-w-xs p-4 space-y-3">
            <h3 className="font-semibold text-on-surface text-sm">¿Salir sin guardar?</h3>
            <p className="text-sm text-muted">
              {completo
                ? 'Tienes los bloques listos pero no se han guardado.'
                : `Colocaste ${patrones.length} de ${bloquesPorSemana} bloques. Si sales ahora se perderán.`}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmSalir(false)} className="flex-1 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface">
                Seguir aquí
              </button>
              <button type="button" onClick={() => { setConfirmSalir(false); onCancel?.() }} className="flex-1 py-2 rounded bg-error text-white text-sm font-semibold">
                Salir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
