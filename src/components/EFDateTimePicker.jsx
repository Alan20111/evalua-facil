import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Calendar, Check, X } from 'lucide-react'
import { useScrollLock } from '../hooks/useScrollLock'

// ── Constants ──────────────────────────────────────────────────────────────────
const DIAS_HEADER = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

// 12-hour wheel: starts at 12 so 12→1→2→...→11 wraps naturally
const HOURS   = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const MINUTES = Array.from({ length: 60 }, (_, i) => i)
const AMPM    = ['am', 'pm']
const ITEM_H  = 30   // px per wheel row
const ANIM_MS = 200  // wheel animation duration

// ── Inject keyframes once ──────────────────────────────────────────────────────
const STYLE_ID = 'ef-dtp-styles'
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return
  const s = document.createElement('style')
  s.id = STYLE_ID
  s.textContent = `
@keyframes ef-pop-in {
  from { opacity:0; transform:scale(.95) translateY(-6px); }
  to   { opacity:1; transform:scale(1)   translateY(0);   }
}
@keyframes ef-pop-in-up {
  from { opacity:0; transform:scale(.95) translateY(6px); }
  to   { opacity:1; transform:scale(1)   translateY(0);  }
}
@keyframes ef-slide-l {
  from { opacity:0; transform:translateX(20px); }
  to   { opacity:1; transform:translateX(0);    }
}
@keyframes ef-slide-r {
  from { opacity:0; transform:translateX(-20px); }
  to   { opacity:1; transform:translateX(0);     }
}
.ef-noscroll { scrollbar-width: none; -ms-overflow-style: none; }
.ef-noscroll::-webkit-scrollbar { display: none; }
.ef-pop-in    { animation: ef-pop-in    .18s cubic-bezier(.22,1,.36,1) both; }
.ef-pop-in-up { animation: ef-pop-in-up .18s cubic-bezier(.22,1,.36,1) both; }
.ef-slide-l   { animation: ef-slide-l   .16s ease both; }
.ef-slide-r   { animation: ef-slide-r   .16s ease both; }
`
  document.head.appendChild(s)
}

// ── Pure helpers ───────────────────────────────────────────────────────────────
function parseValue(value, mode) {
  if (!value) return null
  if (mode === 'date') {
    const parts = value.split('-').map(Number)
    if (parts.length < 3) return null
    const d = new Date(parts[0], parts[1] - 1, parts[2])
    return isNaN(d.getTime()) ? null : d
  }
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

function toIsoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toIsoDatetime(d) {
  return `${toIsoDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDisplay(d, mode) {
  if (!d) return null
  const dayName = DIAS_SEMANA[(d.getDay() + 6) % 7]
  const dateStr = `${dayName} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`
  if (mode === 'date') return { date: dateStr, time: null }
  const h = d.getHours()
  const h12 = h % 12 || 12
  const ap = h < 12 ? 'am' : 'pm'
  return {
    date: dateStr,
    time: `${String(h12).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`,
  }
}

function buildGrid(viewDate) {
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const startOffset = (firstDay.getDay() + 6) % 7
  const start = new Date(year, month, 1 - startOffset)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

function isSameDay(a, b) {
  return a && b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function getNextMonday() {
  const d = new Date()
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 1 ? 7 : (8 - day) % 7 || 7))
  return d
}

function getEndOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

// 24h string → wheel indices
function h24ToWheels(hhmm) {
  const [h, m] = (hhmm || '23:59').split(':').map(Number)
  const ampmIdx = h < 12 ? 0 : 1
  const h12 = h % 12 || 12
  const hourIdx = HOURS.indexOf(h12)
  return {
    hourIdx: hourIdx >= 0 ? hourIdx : 0,
    minIdx: m,
    ampmIdx,
  }
}

// Wheel indices → 24h string
function wheelsToH24(hourIdx, minIdx, ampmIdx) {
  const h12 = HOURS[hourIdx]
  const mm  = MINUTES[minIdx]
  const h24 = h12 % 12 + ampmIdx * 12
  return `${String(h24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// ── HoldButton ─────────────────────────────────────────────────────────────────
// Button that fires on click, and repeats while held down
function HoldButton({ onPress, label }) {
  const holdRef = useRef(null)
  const [pressing, setPressing] = useState(false)

  const startHold = useCallback(() => {
    setPressing(true)
    onPress()
    let count = 0
    holdRef.current = setInterval(() => {
      count++
      if (count >= 3) onPress()
    }, 100)
  }, [onPress])

  const stopHold = useCallback(() => {
    setPressing(false)
    if (holdRef.current) {
      clearInterval(holdRef.current)
      holdRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (holdRef.current) clearInterval(holdRef.current)
    }
  }, [])

  return (
    <button
      type="button"
      onMouseDown={startHold}
      onMouseUp={stopHold}
      onMouseLeave={stopHold}
      onTouchStart={startHold}
      onTouchEnd={stopHold}
      className="text-base"
      style={{
        padding: '4px 2px',
        border: 'none',
        background: pressing ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
        cursor: 'pointer',
        color: pressing ? 'var(--accent)' : 'var(--on-surface-variant)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 300,
        height: 20,
        transition: 'all .08s',
        borderRadius: 4,
      }}
    >
      {label}
    </button>
  )
}

// ── WheelPicker ────────────────────────────────────────────────────────────────
// Scroll wheel with explicit −/+ buttons that support click-and-hold.
// Shows 3 items (selected ± 1). Buttons sit above/below the wheel.
// disabledIndices: Set<number> — items that cannot be selected; snaps past them.
// onChange(newIdx, delta): delta is the signed number of steps the user moved,
// so the parent can carry the movement into adjacent units (real-clock cascade);
// absolute jumps (Home/End) pass delta=undefined.
function WheelPicker({ items, selectedIdx, onChange, label, formatItem, disabledIndices = new Set() }) {
  const n               = items.length
  const listRef         = useRef(null)
  const wrapRef         = useRef(null)
  const animRef         = useRef(false)
  const dragRef         = useRef(null)
  const holdRef         = useRef(null)
  const selectedIdxRef  = useRef(selectedIdx)
  useEffect(() => { selectedIdxRef.current = selectedIdx }, [selectedIdx])

  const setTransform = useCallback((y, animated) => {
    const el = listRef.current
    if (!el) return
    el.style.transition = animated
      ? `transform ${ANIM_MS}ms cubic-bezier(0.22,1,0.36,1)`
      : 'none'
    el.style.transform = `translateY(${y}px)`
  }, [])

  const resetTransform = useCallback(() => setTransform(-ITEM_H, false), [setTransform])

  const nearestValid = useCallback((from, dir = 1) => {
    for (let i = 0; i < n; i++) {
      const candidate = ((from + dir * i) % n + n) % n
      if (!disabledIndices.has(candidate)) return candidate
    }
    return from
  }, [n, disabledIndices])

  const step = useCallback((delta) => {
    if (animRef.current) return
    animRef.current = true
    setTransform(-(1 + delta) * ITEM_H, true)
    setTimeout(() => {
      const raw = ((selectedIdx + delta) % n + n) % n
      const newIdx = nearestValid(raw, delta > 0 ? 1 : -1)
      onChange(newIdx, delta)
      requestAnimationFrame(() => {
        resetTransform()
        animRef.current = false
      })
    }, ANIM_MS)
  }, [selectedIdx, n, onChange, setTransform, resetTransform, nearestValid])

  // Reads from ref to avoid stale closure inside setInterval
  const stepRaw = useCallback((delta) => {
    const cur = selectedIdxRef.current
    const raw = ((cur + delta) % n + n) % n
    onChange(nearestValid(raw, delta > 0 ? 1 : -1), delta)
  }, [n, nearestValid, onChange])

  const stopHold = useCallback(() => {
    clearTimeout(holdRef.current)
    clearInterval(holdRef.current)
    holdRef.current = null
  }, [])

  const startHold = useCallback((delta) => {
    if (animRef.current) return
    step(delta)
    holdRef.current = setTimeout(() => {
      holdRef.current = setInterval(() => stepRaw(delta), 150)
    }, 380)
  }, [step, stepRaw])

  useEffect(() => stopHold, [stopHold])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (!animRef.current) step(e.deltaY > 0 ? 1 : -1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [step])

  const onPointerDown = useCallback((e) => {
    if (e.button > 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startY: e.clientY, dy: 0 }
    animRef.current = true
  }, [])

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current) return
    const dy = e.clientY - dragRef.current.startY
    dragRef.current.dy = dy
    setTransform(-ITEM_H + dy, false)
  }, [setTransform])

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return
    const dy    = dragRef.current.dy
    const steps = -Math.round(dy / ITEM_H)
    dragRef.current = null
    if (steps !== 0) {
      setTransform(-ITEM_H - steps * ITEM_H, true)
      setTimeout(() => {
        const raw = ((selectedIdx + steps) % n + n) % n
        const newIdx = nearestValid(raw, steps > 0 ? 1 : -1)
        onChange(newIdx, steps)
        requestAnimationFrame(() => {
          resetTransform()
          animRef.current = false
        })
      }, ANIM_MS)
    } else {
      setTransform(-ITEM_H, true)
      setTimeout(() => { animRef.current = false }, ANIM_MS)
    }
  }, [selectedIdx, n, onChange, setTransform, resetTransform])

  const onKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown')  { e.preventDefault(); step(1) }
    else if (e.key === 'ArrowUp')  { e.preventDefault(); step(-1) }
    else if (e.key === 'Home')     { e.preventDefault(); onChange(0) }
    else if (e.key === 'End')      { e.preventDefault(); onChange(n - 1) }
    else if (e.key === 'PageDown') { e.preventDefault(); step(1) }
    else if (e.key === 'PageUp')   { e.preventDefault(); step(-1) }
  }, [step, onChange, n])

  useEffect(() => {
    if (!animRef.current) resetTransform()
  }, [selectedIdx, resetTransform])

  // 5 rendered items (offsets -2..+2); 3-item viewport shows -1, 0, +1
  const rendered = useMemo(() =>
    Array.from({ length: 5 }, (_, i) => {
      const offset  = i - 2
      const itemIdx = ((selectedIdx + offset) % n + n) % n
      return { key: i, offset, value: items[itemIdx], itemIdx }
    }), [selectedIdx, items, n])

  const fmt = (v) => {
    if (formatItem) return formatItem(v)
    return typeof v === 'number' ? String(v).padStart(2, '0') : String(v)
  }

  const navBtnStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: 32, border: 'none', background: 'transparent',
    cursor: 'pointer', color: 'var(--accent)',
    fontWeight: 300, lineHeight: 1,
    userSelect: 'none', WebkitUserSelect: 'none', borderRadius: 6,
    flexShrink: 0,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', flex: 1 }}>

      {/* − button */}
      <button
        type="button"
        className="text-sm"
        style={navBtnStyle}
        onMouseDown={() => startHold(-1)}
        onMouseUp={stopHold}
        onMouseLeave={stopHold}
        onTouchStart={e => { e.preventDefault(); startHold(-1) }}
        onTouchEnd={stopHold}
        onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 10%, transparent)' }}
      >
        −
      </button>

      {/* Scroll wheel — 3-item viewport */}
      <div
        ref={wrapRef}
        role="listbox"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'relative',
          height: ITEM_H * 3,
          overflow: 'hidden',
          cursor: 'ns-resize',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          outline: 'none',
          touchAction: 'none',
        }}
      >
        {/* Center-item highlight */}
        <div style={{
          position: 'absolute',
          top: ITEM_H * 1,
          left: 2,
          right: 2,
          height: ITEM_H,
          background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
          borderRadius: 8,
          pointerEvents: 'none',
          zIndex: 0,
        }} />

        {/* Scrolling list */}
        <div
          ref={listRef}
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0,
            willChange: 'transform',
            transform: `translateY(${-ITEM_H}px)`,
          }}
        >
          {rendered.map(({ key, offset, value, itemIdx }) => {
            const isSelected = offset === 0
            const isDisabled = disabledIndices.has(itemIdx)
            return (
              <div
                key={key}
                role="option"
                aria-selected={isSelected}
                aria-disabled={isDisabled}
                tabIndex={isDisabled ? -1 : 0}
                onClick={() => {
                  if (offset === 0 || isDisabled) return
                  step(offset)
                }}
                onKeyDown={e => {
                  if ((e.key === 'Enter' || e.key === ' ') && offset !== 0 && !isDisabled) {
                    e.preventDefault()
                    step(offset)
                  }
                }}
                className="text-xs"
                style={{
                  height: ITEM_H,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: isSelected ? 700 : 400,
                  color: isDisabled
                    ? 'var(--outline-variant)'
                    : isSelected ? 'var(--accent)' : 'var(--on-surface-variant)',
                  opacity: isDisabled ? 0.35 : isSelected ? 1 : 0.6,
                  textDecoration: isDisabled ? 'line-through' : 'none',
                  cursor: offset !== 0 && !isDisabled ? 'pointer' : 'default',
                  position: 'relative', zIndex: 1,
                  letterSpacing: isSelected ? '0.02em' : 0,
                }}
              >
                {fmt(value)}
              </div>
            )
          })}
        </div>

        {/* Gradient fade */}
        <div style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(to bottom,
            var(--surface-card) 0%,
            color-mix(in srgb, var(--surface-card) 40%, transparent) 28%,
            transparent 42%,
            transparent 58%,
            color-mix(in srgb, var(--surface-card) 40%, transparent) 72%,
            var(--surface-card) 100%)`,
          pointerEvents: 'none', zIndex: 2,
        }} />
      </div>

      {/* + button */}
      <button
        type="button"
        className="text-sm"
        style={navBtnStyle}
        onMouseDown={() => startHold(1)}
        onMouseUp={stopHold}
        onMouseLeave={stopHold}
        onTouchStart={e => { e.preventDefault(); startHold(1) }}
        onTouchEnd={stopHold}
        onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 10%, transparent)' }}
      >
        +
      </button>

    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function EFDateTimePicker({
  value = '',
  onChange,
  mode = 'datetime',   // 'date' | 'datetime'
  placeholder,
  disabled = false,
  clearable = true,
  className = '',
  minDateTime,
  defaultTime = '23:59',  // HH:MM 24h — used when opening with no existing value
  defaultDate,             // YYYY-MM-DD — calendar opens here when no value is set
  headerLabel,             // e.g. "Fecha y hora de publicación" — popup header caption
  showShortcuts = true,    // atajos Hoy/Mañana/En 3 días/Próx. semana/Fin de mes
}) {
  const triggerRef  = useRef(null)
  const popoverRef  = useRef(null)

  const [open, setOpen]           = useState(false)
  const [openUpward, setOpenUpward] = useState(false)
  const [pos, setPos]             = useState({ top: 0, left: 0, maxH: 560 })

  // Sin esto, arrastrar el dedo sobre el popover (o su scroll interno al
  // llegar al límite) también mueve la página de fondo en Android.
  useScrollLock(open)

  const parsed = useMemo(() => parseValue(value, mode), [value, mode])

  // Full minDateTime as Date object (for hour/minute comparisons)
  const minFull = useMemo(() => {
    if (!minDateTime) return null
    return parseValue(minDateTime, 'datetime')
  }, [minDateTime])

  // Normalize minDateTime to midnight so we can compare date-only
  const minDateOnly = useMemo(() => {
    if (!minFull) return null
    return new Date(minFull.getFullYear(), minFull.getMonth(), minFull.getDate())
  }, [minFull])

  // Draft: only the date portion. Time comes from wheel indices.
  const [draft, setDraft]       = useState(null)
  const [viewDate, setViewDate] = useState(() => {
    const src = parseValue(value, mode)
    return src
      ? new Date(src.getFullYear(), src.getMonth(), 1)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  })
  const [slideDir, setSlideDir] = useState(null)
  const [slideKey, setSlideKey] = useState(0)

  // Wheel state (12-hour)
  const [hourIdx, setHourIdx] = useState(11)  // index into HOURS=[12,1,...,11]; 11=11h
  const [minIdx,  setMinIdx]  = useState(59)  // index into MINUTES=[0..59]; default=59
  const [ampmIdx, setAmpmIdx] = useState(1)   // 0=AM, 1=PM; default=PM

  // Live mirror of the wheel state. Hold-to-repeat wheels fire from an interval
  // whose callbacks are created once, so they must read fresh values from here.
  const timeRef = useRef({ hourIdx, minIdx, ampmIdx })
  useEffect(() => { timeRef.current = { hourIdx, minIdx, ampmIdx } })

  // Real-clock cascade: the three wheels behave as one clock. A step on any
  // wheel converts to total minutes-of-day and decomposes back, so movement
  // carries into adjacent units — 09:59 +1min → 10:00, 09:00 −1min → 08:59,
  // and crossing 11:59↔12:00 flips am/pm (also when stepping the hour wheel).
  // Wraps at midnight without touching the selected date.
  const applyTimeDelta = useCallback((unit, newIdx, delta) => {
    if (delta == null) {  // absolute jump (Home/End) — no cascade
      if (unit === 'hour') setHourIdx(newIdx)
      else if (unit === 'min') setMinIdx(newIdx)
      else setAmpmIdx(newIdx)
      return
    }
    const { hourIdx: hi, minIdx: mi, ampmIdx: ai } = timeRef.current
    const h24 = HOURS[hi] % 12 + ai * 12
    const factor = unit === 'min' ? 1 : unit === 'hour' ? 60 : 720
    const total = ((h24 * 60 + mi + delta * factor) % 1440 + 1440) % 1440
    const nh24 = Math.floor(total / 60)
    setAmpmIdx(nh24 < 12 ? 0 : 1)
    setHourIdx(HOURS.indexOf(nh24 % 12 || 12))
    setMinIdx(total % 60)
  }, [])

  const onHourWheel = useCallback((idx, delta) => applyTimeDelta('hour', idx, delta), [applyTimeDelta])
  const onMinWheel  = useCallback((idx, delta) => applyTimeDelta('min', idx, delta), [applyTimeDelta])
  const onAmpmWheel = useCallback((idx, delta) => applyTimeDelta('ampm', idx, delta), [applyTimeDelta])

  // ── Disabled wheel indices (same day as minFull) ─────────────────────────────
  const disabledAmpmIndices = useMemo(() => {
    if (!minFull || !draft || !isSameDay(draft, minFull)) return new Set()
    // If minDateTime is PM, AM (index 0) is disabled
    return minFull.getHours() >= 12 ? new Set([0]) : new Set()
  }, [minFull, draft])

  const disabledHourIndices = useMemo(() => {
    if (!minFull || !draft || !isSameDay(draft, minFull)) return new Set()
    const minH24  = minFull.getHours()
    const minAmpm = minH24 >= 12 ? 1 : 0
    if (ampmIdx < minAmpm) return new Set(HOURS.map((_, i) => i)) // whole AM section is before PM
    if (ampmIdx > minAmpm) return new Set()                        // PM selected, min is AM: no restriction
    // Same period: disable indices whose hour comes before minH12 in the wheel.
    // If min minute is 59, the min hour itself has no valid minute left — disable it too.
    const minH12 = minH24 % 12 || 12
    const minPos = HOURS.indexOf(minH12)
    const cutoff = minFull.getMinutes() === 59 ? minPos + 1 : minPos
    return new Set(HOURS.reduce((acc, _, i) => { if (i < cutoff) acc.push(i); return acc }, []))
  }, [minFull, draft, ampmIdx])

  const disabledMinIndices = useMemo(() => {
    if (!minFull || !draft || !isSameDay(draft, minFull)) return new Set()
    const minH24    = minFull.getHours()
    const curH24    = HOURS[hourIdx] % 12 + ampmIdx * 12
    if (curH24 !== minH24) return new Set()
    // Strictly after: the minute equal to minDateTime is also invalid
    const minM = minFull.getMinutes()
    const s = new Set()
    for (let i = 0; i <= minM && i < 60; i++) s.add(i)
    return s
  }, [minFull, draft, hourIdx, ampmIdx])

  // ── Snap effects: when a wheel lands on a disabled index, advance to nearest valid ──
  useEffect(() => {
    if (!disabledAmpmIndices.size || !disabledAmpmIndices.has(ampmIdx)) return
    for (let i = 0; i < AMPM.length; i++) {
      const c = (ampmIdx + i) % AMPM.length
      if (!disabledAmpmIndices.has(c)) { setAmpmIdx(c); break }
    }
  }, [ampmIdx, disabledAmpmIndices]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!disabledHourIndices.size || !disabledHourIndices.has(hourIdx)) return
    for (let i = 0; i < HOURS.length; i++) {
      const c = (hourIdx + i) % HOURS.length
      if (!disabledHourIndices.has(c)) { setHourIdx(c); break }
    }
  }, [hourIdx, disabledHourIndices]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!disabledMinIndices.size || !disabledMinIndices.has(minIdx)) return
    // Snap to the first valid minute — one past the min (strictly after)
    const minM = minFull ? minFull.getMinutes() : 0
    setMinIdx(minM + 1 < 60 ? minM + 1 : 0)
  }, [minIdx, disabledMinIndices]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Open / position ────────────────────────────────────────────────────────
  const computePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect   = triggerRef.current.getBoundingClientRect()
    const vw     = window.innerWidth
    const vh     = window.innerHeight
    const PAD    = 8
    // El ancho ideal se topa al ancho real de la pantalla: casi ningún
    // celular Android tiene 390px+ de viewport, así que sin este tope el
    // popover se salía por la derecha y el overflow:hidden del contenedor
    // recortaba la columna de HORA (o incluso el calendario).
    const idealW = mode === 'datetime' ? 390 : 310
    const W      = Math.min(idealW, vw - PAD * 2)
    const idealH = mode === 'datetime' ? 460 : 360
    // Right edge of popup aligned with right edge of the field — keeps the
    // left side of the form (labels + values below) visible
    const left = Math.max(PAD, Math.min(rect.right - W, vw - W - PAD))
    // Preferred: ABOVE the field, bottom edge sitting just above the row that
    // opened it — never covers the inputs below. Anchored via `bottom` so the
    // popup hugs the row regardless of its actual content height.
    const spaceAbove = rect.top - PAD
    if (spaceAbove >= 280) {
      setOpenUpward(true)
      // Slight overlap over the trigger row so the popup sits as low as possible
      setPos({ bottom: vh - rect.top - 10, top: undefined, left, maxH: Math.min(idealH, spaceAbove), W })
      return
    }
    // Fallback: below the field (not enough room above)
    const spaceBelow = vh - rect.bottom - PAD
    setOpenUpward(false)
    setPos({ top: rect.bottom + 4, bottom: undefined, left, maxH: Math.min(idealH, spaceBelow), W })
  }, [mode])

  function openPicker() {
    if (disabled) return
    ensureStyles()
    const src = parsed
    // When no existing value, use defaultDate as the initial calendar selection
    const defD = !src && defaultDate ? parseValue(defaultDate, 'date') : null
    const anchorDate = src
      ? new Date(src.getFullYear(), src.getMonth(), src.getDate())
      : defD
        ? new Date(defD.getFullYear(), defD.getMonth(), defD.getDate())
        : null
    setDraft(anchorDate)
    setViewDate(anchorDate
      ? new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    )
    if (mode === 'datetime') {
      const hhmm = src
        ? `${String(src.getHours()).padStart(2, '0')}:${String(src.getMinutes()).padStart(2, '0')}`
        : defaultTime
      const { hourIdx: hi, minIdx: mi, ampmIdx: ai } = h24ToWheels(hhmm)
      setHourIdx(hi)
      setMinIdx(mi)
      setAmpmIdx(ai)
    }
    computePos()
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    window.addEventListener('scroll', computePos, true)
    window.addEventListener('resize', computePos)
    return () => {
      window.removeEventListener('scroll', computePos, true)
      window.removeEventListener('resize', computePos)
    }
  }, [open, computePos])

  // Click-outside / Escape
  useEffect(() => {
    if (!open) return
    const onKey  = (e) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e) => {
      if (popoverRef.current?.contains(e.target)) return
      if (triggerRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  // ── Calendar ───────────────────────────────────────────────────────────────
  function prevMonth() {
    setSlideDir('right')
    setSlideKey(k => k + 1)
    setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  }
  function nextMonth() {
    setSlideDir('left')
    setSlideKey(k => k + 1)
    setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  }

  function selectDay(d) {
    const dn = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    if (minDateOnly && dn < minDateOnly) return
    setDraft(dn)
  }

  // ── Shortcuts ──────────────────────────────────────────────────────────────
  const todayD = new Date()
  const shortcuts = useMemo(() => {
    const t  = new Date()
    const tm = new Date(t); tm.setDate(t.getDate() + 1)
    const d3 = new Date(t); d3.setDate(t.getDate() + 3)
    return [
      { label: 'Hoy',           d: t },
      { label: 'Mañana',        d: tm },
      { label: 'En 3 días',     d: d3 },
      { label: 'Próx. semana',  d: getNextMonday() },
      { label: 'Fin de mes',    d: getEndOfMonth() },
    ]
  }, [])

  function applyShortcut(d) {
    setDraft(new Date(d.getFullYear(), d.getMonth(), d.getDate()))
    setViewDate(new Date(d.getFullYear(), d.getMonth(), 1))
  }

  // ── Confirm / Clear ────────────────────────────────────────────────────────
  function confirm() {
    if (!draft) { onChange(''); setOpen(false); return }
    if (mode === 'date') {
      onChange(toIsoDate(draft))
    } else {
      const h24 = HOURS[hourIdx] % 12 + ampmIdx * 12
      const mm  = MINUTES[minIdx]
      const d   = new Date(draft)
      d.setHours(h24, mm, 0, 0)
      onChange(toIsoDatetime(d))
    }
    setOpen(false)
  }
  function clear() { onChange(''); setOpen(false) }

  // ── Display text ───────────────────────────────────────────────────────────
  // Build draft display using wheel state for the time part
  const draftDisplay = useMemo(() => {
    if (!draft) return null
    const dayName = DIAS_SEMANA[(draft.getDay() + 6) % 7]
    const dateStr = `${dayName} ${draft.getDate()} de ${MESES[draft.getMonth()]} de ${draft.getFullYear()}`
    if (mode === 'date') return { date: dateStr, time: null }
    const h12 = HOURS[hourIdx]
    const mm  = MINUTES[minIdx]
    const ap  = ampmIdx === 0 ? 'am' : 'pm'
    return {
      date: dateStr,
      time: `${String(h12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${ap}`,
    }
  }, [draft, mode, hourIdx, minIdx, ampmIdx])

  const display       = formatDisplay(parsed, mode)
  const placeholderText = placeholder || (mode === 'date' ? 'Seleccionar fecha…' : 'Seleccionar fecha y hora…')

  // ── Calendar grid ──────────────────────────────────────────────────────────
  const grid = useMemo(() => buildGrid(viewDate), [viewDate])

  // ── Popover ────────────────────────────────────────────────────────────────
  const W = pos.W || 330
  const popoverStyle = {
    position: 'fixed',
    // Anchored by bottom when opening above (hugs the trigger row), by top otherwise
    top: pos.bottom != null ? 'auto' : pos.top,
    bottom: pos.bottom != null ? pos.bottom : 'auto',
    left: pos.left,
    width: W,
    zIndex: 9999,
    background: 'var(--surface-card)',
    // Esquinas menos redondeadas y borde bien visible — antes usaba
    // --radius-card (pensada para tarjetas grandes) y --outline-variant
    // (gris muy pálido, casi imperceptible a 1px).
    borderRadius: '0.5rem',
    boxShadow: '0 8px 40px rgba(0,0,0,.16), 0 2px 8px rgba(0,0,0,.08)',
    border: '1.5px solid var(--outline, #717785)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: pos.maxH,
  }

  const chip = (label, onClick, isAccent = true) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      className="text-xs"
      style={{
        padding: '3px 10px',
        borderRadius: 999,
        border: 'none',
        background: isAccent
          ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
          : 'var(--surface-container)',
        color: isAccent ? 'var(--accent)' : 'var(--on-surface-variant)',
        fontWeight: 600,
        cursor: 'pointer',
        lineHeight: '1.5',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = isAccent
          ? 'color-mix(in srgb, var(--accent) 22%, transparent)'
          : 'var(--surface-dim)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = isAccent
          ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
          : 'var(--surface-container)'
      }}
    >
      {label}
    </button>
  )

  const popover = open && createPortal(
    <div
      ref={popoverRef}
      className={openUpward ? 'ef-pop-in-up' : 'ef-pop-in'}
      style={popoverStyle}
    >
      {/* ── Accent header ── */}
      <div style={{
        background: 'color-mix(in srgb, var(--accent) 10%, var(--surface-card))',
        borderBottom: '1px solid color-mix(in srgb, var(--accent) 15%, transparent)',
        padding: '6px 14px 5px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 1 }}>
          <Calendar size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span className="text-xs" style={{ fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>
            {headerLabel || (mode === 'date' ? 'Fecha seleccionada' : 'Fecha y hora')}
          </span>
        </div>
        <p className="text-xs" style={{ fontWeight: 600, color: 'var(--on-surface)', margin: 0 }}>
          {draftDisplay
            ? <>{draftDisplay.date}{draftDisplay.time && <span style={{ fontWeight: 500, color: 'var(--on-surface-variant)' }}> – {draftDisplay.time}</span>}</>
            : <span style={{ color: 'var(--outline)', fontStyle: 'italic', fontWeight: 400 }}>Sin selección</span>}
        </p>
      </div>

      {/* ── Scrollable body — scrollbar hidden; idealH sized so nothing clips ── */}
      <div className="ef-noscroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

        {/* Shortcuts */}
        {showShortcuts && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '9px 12px 4px' }}>
            {shortcuts
              .filter(({ d }) => !minDateOnly || new Date(d.getFullYear(), d.getMonth(), d.getDate()) >= minDateOnly)
              .map(({ label, d }) => chip(label, () => applyShortcut(d)))}
          </div>
        )}

        {/* Calendar + Time wheels side by side */}
        <div style={{ display: 'flex' }}>

        {/* Left: Calendar */}
        <div style={{ flex: 1, minWidth: 0, padding: '4px 10px 8px' }}>
          {/* Month navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <button
              type="button"
              onClick={prevMonth}
              style={{ padding: '4px 6px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--on-surface-variant)', display: 'flex' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-container)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs" style={{ fontWeight: 700, color: 'var(--on-surface)' }}>
              {MESES[viewDate.getMonth()]} {viewDate.getFullYear()}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              style={{ padding: '4px 6px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--on-surface-variant)', display: 'flex' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-container)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Day headers — gray background strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
            {DIAS_HEADER.map((d, i) => (
              <div key={d} className="text-xs" style={{
                textAlign: 'center',
                fontWeight: 600,
                color: 'var(--on-surface-variant)',
                padding: '3px 0',
                background: 'var(--surface-container)',
                borderRadius: i === 0 ? '4px 0 0 4px' : i === 6 ? '0 4px 4px 0' : 0,
              }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div key={slideKey} className={slideDir === 'left' ? 'ef-slide-l' : slideDir === 'right' ? 'ef-slide-r' : ''}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px 0' }}>
              {grid.map((d) => {
                const inMonth    = d.getMonth() === viewDate.getMonth()
                const isToday    = isSameDay(d, todayD)
                const isSel      = isSameDay(d, draft)
                const dn         = new Date(d.getFullYear(), d.getMonth(), d.getDate())
                // Strictly after min: if min falls at 11:59 pm, that whole day has
                // no selectable time left in datetime mode — disable it too
                const noSlotLeft = mode === 'datetime' && minFull &&
                  dn.getTime() === minDateOnly?.getTime() &&
                  minFull.getHours() === 23 && minFull.getMinutes() === 59
                const isDisabled = (minDateOnly && dn < minDateOnly) || noSlotLeft
                return (
                  <button
                    key={toIsoDate(d)}
                    type="button"
                    onClick={() => selectDay(d)}
                    disabled={isDisabled}
                    className="text-xs"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: 28,
                      borderRadius: '50%',
                      border: 'none',
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      fontWeight: isSel || isToday ? 700 : 400,
                      background: isSel
                        ? 'var(--accent)'
                        : isToday
                          ? 'color-mix(in srgb, var(--accent) 14%, transparent)'
                          : 'transparent',
                      color: isSel
                        ? '#fff'
                        : isDisabled
                          ? 'var(--outline-variant)'
                          : !inMonth
                            ? 'var(--outline-variant)'
                            : 'var(--on-surface)',
                      opacity: isDisabled ? 0.4 : 1,
                      outline: isToday && !isSel
                        ? '2px solid color-mix(in srgb, var(--accent) 35%, transparent)'
                        : 'none',
                      outlineOffset: -2,
                      transition: 'background .1s',
                      margin: '0 1px',
                    }}
                    onMouseEnter={e => { if (!isSel && !isDisabled) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 18%, transparent)' }}
                    onMouseLeave={e => { if (!isSel && !isDisabled) e.currentTarget.style.background = isToday ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent' }}
                  >
                    {d.getDate()}
                  </button>
                )
              })}
            </div>
          </div>
        </div>{/* end calendar column */}

        {/* Right: Time wheels + buttons */}
        {mode === 'datetime' && (
          <div style={{
            width: 132,
            flexShrink: 0,
            borderLeft: '1px solid var(--outline-variant)',
            display: 'flex',
            flexDirection: 'column',
            padding: '8px 4px 6px',
          }}>
            <p className="text-xs" style={{
              fontWeight: 700,
              color: 'var(--outline)',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              marginBottom: 2,
              textAlign: 'center',
            }}>
              Hora
            </p>
            {/* alignItems:stretch so the colon div can center itself vertically */}
            <div style={{ display: 'flex', alignItems: 'stretch', flex: 1 }}>
              <WheelPicker
                items={HOURS}
                selectedIdx={hourIdx}
                onChange={onHourWheel}
                label="Hora"
                formatItem={v => String(v).padStart(2, '0')}
                disabledIndices={disabledHourIndices}
              />
              <div className="text-xs" style={{
                flexShrink: 0,
                width: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 200,
                color: 'var(--on-surface-variant)',
              }}>:</div>
              <WheelPicker
                items={MINUTES}
                selectedIdx={minIdx}
                onChange={onMinWheel}
                label="Minutos"
                formatItem={v => String(v).padStart(2, '0')}
                disabledIndices={disabledMinIndices}
              />
              <div style={{ width: 3, flexShrink: 0 }} />
              <WheelPicker
                items={AMPM}
                selectedIdx={ampmIdx}
                onChange={onAmpmWheel}
                label="AM o PM"
                formatItem={v => v}
                disabledIndices={disabledAmpmIndices}
              />
            </div>
          </div>
        )}

        </div>{/* end flex row */}

      </div>{/* end scrollable body */}

      {/* ── Footer ── */}
      <div style={{
        display: 'flex',
        gap: 6,
        padding: '8px 12px 10px',
        borderTop: '1px solid var(--outline-variant)',
        alignItems: 'center',
      }}>
        {clearable && (
          <button
            type="button"
            onClick={clear}
            className="text-xs"
            style={{ padding: '6px 10px', borderRadius: 'var(--radius, 0.5rem)', border: 'none', background: 'transparent', color: 'var(--outline)', fontWeight: 500, cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-container)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            Borrar
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs"
          style={{ padding: '6px 12px', borderRadius: 'var(--radius, 0.5rem)', border: '1px solid var(--outline-variant)', background: 'transparent', color: 'var(--on-surface-variant)', fontWeight: 500, cursor: 'pointer' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-container)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!draft}
          className="text-xs"
          style={{ padding: '6px 14px', borderRadius: 'var(--radius, 0.5rem)', border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: draft ? 'pointer' : 'not-allowed', opacity: draft ? 1 : 0.5, display: 'flex', alignItems: 'center', gap: 5 }}
          onMouseEnter={e => { if (draft) e.currentTarget.style.background = 'var(--accent-hover)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)' }}
        >
          <Check size={13} />
          Confirmar
        </button>
      </div>
    </div>,
    document.body
  )

  // ── Trigger button ─────────────────────────────────────────────────────────
  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => (open ? setOpen(false) : openPicker())}
        disabled={disabled}
        className={className}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '7px 12px',
          borderRadius: 'var(--radius, 0.5rem)',
          border: '1px solid var(--outline-variant)',
          background: 'var(--surface)',
          width: '100%',
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'border-color .12s',
          fontSize: 'var(--fs-sm, 0.875rem)',
        }}
        onMouseEnter={e => { if (!disabled) e.currentTarget.style.borderColor = 'var(--accent)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--outline-variant)' }}
        onFocus={e => { if (!disabled) e.currentTarget.style.borderColor = 'var(--accent)' }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--outline-variant)' }}
      >
        <Calendar size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {display ? (
            <>
              <span style={{ color: 'var(--on-surface)', fontWeight: 500 }}>
                {display.date}
              </span>
              {display.time && (
                <span style={{ color: 'var(--on-surface-variant)', marginLeft: 8, fontSize: 'var(--fs-xs, 0.75rem)' }}>
                  {display.time}
                </span>
              )}
            </>
          ) : (
            <span style={{ color: 'var(--outline)' }}>{placeholderText}</span>
          )}
        </span>
        {value && clearable && (
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); onChange('') }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onChange('')
              }
            }}
            style={{ display: 'flex', padding: 2, borderRadius: 4, color: 'var(--outline)', cursor: 'pointer', flexShrink: 0, transition: 'color .1s' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ef4444' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--outline)' }}
          >
            <X size={13} />
          </span>
        )}
      </button>
      {popover}
    </>
  )
}
