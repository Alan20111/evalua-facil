import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Calendar, Check, X } from 'lucide-react'

// ── Constants ──────────────────────────────────────────────────────────────────
const DIAS_HEADER = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

// 12-hour wheel: starts at 12 so 12→1→2→...→11 wraps naturally
const HOURS   = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const MINUTES = [0, 15, 30, 45]
const AMPM    = ['AM', 'PM']
const ITEM_H  = 40   // px per wheel row
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
  const dateStr = `${dayName} ${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()} de ${d.getFullYear()}`
  if (mode === 'date') return { date: dateStr, time: null }
  const h = d.getHours()
  const h12 = h % 12 || 12
  const ap = h < 12 ? 'a.m.' : 'p.m.'
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
  const [h, m] = (hhmm || '08:00').split(':').map(Number)
  const ampmIdx = h < 12 ? 0 : 1
  const h12 = h % 12 || 12
  const hourIdx = HOURS.indexOf(h12)
  const snapped = m < 8 ? 0 : m < 23 ? 15 : m < 38 ? 30 : m < 53 ? 45 : 0
  const minIdx = MINUTES.indexOf(snapped)
  return {
    hourIdx: hourIdx >= 0 ? hourIdx : 0,
    minIdx: minIdx >= 0 ? minIdx : 0,
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

// ── WheelPicker ────────────────────────────────────────────────────────────────
// Renders an infinite scroll wheel (iOS-style).
// selectedIdx: index into `items` array for the currently selected value.
// onChange(newIdx): called when selection changes.
// The wheel renders 7 items, the 4th being the selected one (centered in 5 visible).
// Normal transform: translateY(-ITEM_H) → items [idx-2..idx+2] fill the 5-row viewport.
function WheelPicker({ items, selectedIdx, onChange, label, formatItem }) {
  const n          = items.length
  const listRef    = useRef(null)
  const wrapRef    = useRef(null)
  const animRef    = useRef(false)   // true while an animation is in flight
  const dragRef    = useRef(null)    // active drag state

  // Apply transform directly on the DOM node to avoid React re-renders during animation
  const setTransform = useCallback((y, animated) => {
    const el = listRef.current
    if (!el) return
    el.style.transition = animated
      ? `transform ${ANIM_MS}ms cubic-bezier(0.22,1,0.36,1)`
      : 'none'
    el.style.transform = `translateY(${y}px)`
  }, [])

  const resetTransform = useCallback(() => setTransform(-ITEM_H, false), [setTransform])

  // Step: delta=+1 moves to next item (scroll down), delta=-1 to previous.
  const step = useCallback((delta) => {
    if (animRef.current) return
    animRef.current = true
    // Animate: move the list opposite to delta (next item comes from below when delta=+1)
    setTransform(-(1 + delta) * ITEM_H, true)
    setTimeout(() => {
      const newIdx = ((selectedIdx + delta) % n + n) % n
      onChange(newIdx)
      // Reset transform in the same frame as the new render to avoid flash
      requestAnimationFrame(() => {
        resetTransform()
        animRef.current = false
      })
    }, ANIM_MS)
  }, [selectedIdx, n, onChange, setTransform, resetTransform])

  // Wheel event — non-passive so we can preventDefault and block popup scroll
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

  // Pointer drag (works for mouse and touch via Pointer Events API)
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
      // Snap to the nearest item with a short inertia-like settle
      setTransform(-ITEM_H - steps * ITEM_H, true)
      setTimeout(() => {
        const newIdx = ((selectedIdx + steps) % n + n) % n
        onChange(newIdx)
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

  // Keyboard: arrow keys, Home, End
  const onKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown')  { e.preventDefault(); step(1) }
    else if (e.key === 'ArrowUp')    { e.preventDefault(); step(-1) }
    else if (e.key === 'Home')       { e.preventDefault(); onChange(0) }
    else if (e.key === 'End')        { e.preventDefault(); onChange(n - 1) }
    else if (e.key === 'PageDown')   { e.preventDefault(); step(1) }
    else if (e.key === 'PageUp')     { e.preventDefault(); step(-1) }
  }, [step, onChange, n])

  // Sync transform when selectedIdx changes externally (shortcuts, open picker)
  useEffect(() => {
    if (!animRef.current) resetTransform()
  }, [selectedIdx, resetTransform])

  // Build 7 rendered items: [idx-3 .. idx+3], all wrapped mod n
  const rendered = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const offset  = i - 3
      const itemIdx = ((selectedIdx + offset) % n + n) % n
      return { key: i, offset, value: items[itemIdx], itemIdx }
    }), [selectedIdx, items, n])

  const fmt = (v) => {
    if (formatItem) return formatItem(v)
    return typeof v === 'number' ? String(v).padStart(2, '0') : String(v)
  }

  return (
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
        height: ITEM_H * 5,
        overflow: 'hidden',
        cursor: 'ns-resize',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        outline: 'none',
        flex: 1,
        touchAction: 'none',
      }}
    >
      {/* Center-item highlight band */}
      <div style={{
        position: 'absolute',
        top: ITEM_H * 2,
        left: 4,
        right: 4,
        height: ITEM_H,
        background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
        borderRadius: 8,
        pointerEvents: 'none',
        zIndex: 0,
      }} />

      {/* Scrolling item list */}
      <div
        ref={listRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          willChange: 'transform',
          transform: `translateY(${-ITEM_H}px)`,
        }}
      >
        {rendered.map(({ key, offset, value, itemIdx }) => {
          const isSelected = offset === 0
          const dist = Math.abs(offset)
          return (
            <div
              key={key}
              role="option"
              aria-selected={isSelected}
              onClick={() => {
                if (offset === 0) return
                if (Math.abs(offset) === 1) step(offset)
                else onChange(itemIdx)
              }}
              style={{
                height: ITEM_H,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: isSelected ? 18 : dist === 1 ? 15 : 12,
                fontWeight: isSelected ? 700 : 400,
                color: isSelected
                  ? 'var(--accent)'
                  : dist === 1
                    ? 'var(--on-surface-variant)'
                    : 'var(--outline-variant)',
                cursor: offset !== 0 ? 'pointer' : 'default',
                position: 'relative',
                zIndex: 1,
                letterSpacing: isSelected ? '0.02em' : 0,
              }}
            >
              {fmt(value)}
            </div>
          )
        })}
      </div>

      {/* Gradient fade — top and bottom fade to card background */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `linear-gradient(to bottom,
          var(--surface-card) 0%,
          color-mix(in srgb, var(--surface-card) 55%, transparent) 22%,
          transparent 38%,
          transparent 62%,
          color-mix(in srgb, var(--surface-card) 55%, transparent) 78%,
          var(--surface-card) 100%)`,
        pointerEvents: 'none',
        zIndex: 2,
      }} />
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
  // minDateTime accepted but not enforced (future enhancement)
  // eslint-disable-next-line no-unused-vars
  minDateTime,
}) {
  const triggerRef  = useRef(null)
  const popoverRef  = useRef(null)

  const [open, setOpen]           = useState(false)
  const [openUpward, setOpenUpward] = useState(false)
  const [pos, setPos]             = useState({ top: 0, left: 0, maxH: 560 })

  const parsed = useMemo(() => parseValue(value, mode), [value, mode])

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
  const [hourIdx, setHourIdx] = useState(0)   // index into HOURS=[12,1,2,...,11]
  const [minIdx,  setMinIdx]  = useState(2)   // index into MINUTES=[0,15,30,45]; default=30
  const [ampmIdx, setAmpmIdx] = useState(0)   // 0=AM, 1=PM

  // ── Open / position ────────────────────────────────────────────────────────
  const computePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect   = triggerRef.current.getBoundingClientRect()
    const vw     = window.innerWidth
    const vh     = window.innerHeight
    const PAD    = 8
    const W      = 330
    const idealH = mode === 'datetime' ? 540 : 360
    const spaceBelow = vh - rect.bottom - PAD
    const spaceAbove = rect.top - PAD
    const goUp   = spaceBelow < idealH && spaceAbove > spaceBelow
    const maxH   = Math.min(idealH, goUp ? spaceAbove : spaceBelow)
    const left   = Math.max(PAD, Math.min(rect.left, vw - W - PAD))
    const top    = goUp ? rect.top - maxH - 4 : rect.bottom + 4
    setOpenUpward(goUp)
    setPos({ top, left, maxH, W })
  }, [mode])

  function openPicker() {
    if (disabled) return
    ensureStyles()
    const src = parsed
    setDraft(src ? new Date(src.getFullYear(), src.getMonth(), src.getDate()) : null)
    setViewDate(src
      ? new Date(src.getFullYear(), src.getMonth(), 1)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    )
    if (mode === 'datetime') {
      const hhmm = src
        ? `${String(src.getHours()).padStart(2, '0')}:${String(src.getMinutes()).padStart(2, '0')}`
        : '08:00'
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
    setDraft(new Date(d.getFullYear(), d.getMonth(), d.getDate()))
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
    const dateStr = `${dayName} ${draft.getDate()} de ${MESES[draft.getMonth()].toLowerCase()} de ${draft.getFullYear()}`
    if (mode === 'date') return { date: dateStr, time: null }
    const h12 = HOURS[hourIdx]
    const mm  = MINUTES[minIdx]
    const ap  = ampmIdx === 0 ? 'a.m.' : 'p.m.'
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
    top: pos.top,
    left: pos.left,
    width: W,
    zIndex: 9999,
    background: 'var(--surface-card)',
    borderRadius: 14,
    boxShadow: '0 8px 40px rgba(0,0,0,.16), 0 2px 8px rgba(0,0,0,.08)',
    border: '1px solid var(--outline-variant)',
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
      style={{
        padding: '3px 10px',
        borderRadius: 999,
        border: 'none',
        background: isAccent
          ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
          : 'var(--surface-container)',
        color: isAccent ? 'var(--accent)' : 'var(--on-surface-variant)',
        fontSize: 11,
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
        padding: '10px 14px 8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <Calendar size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--accent)' }}>
            {mode === 'date' ? 'Fecha seleccionada' : 'Fecha y hora'}
          </span>
        </div>
        {draftDisplay ? (
          <>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', textTransform: 'capitalize', margin: 0 }}>
              {draftDisplay.date}
            </p>
            {draftDisplay.time && (
              <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>
                {draftDisplay.time}
              </p>
            )}
          </>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--outline)', fontStyle: 'italic', margin: 0 }}>Sin selección</p>
        )}
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

        {/* Shortcuts */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '9px 12px 4px' }}>
          {shortcuts.map(({ label, d }) => chip(label, () => applyShortcut(d)))}
          {clearable && chip('Sin límite', clear, false)}
        </div>

        {/* Calendar */}
        <div style={{ padding: '4px 10px 8px' }}>
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
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface)' }}>
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
              <div key={i} style={{
                textAlign: 'center',
                fontSize: 10,
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
              {grid.map((d, i) => {
                const inMonth = d.getMonth() === viewDate.getMonth()
                const isToday = isSameDay(d, todayD)
                const isSel   = isSameDay(d, draft)
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => selectDay(d)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: 32,
                      borderRadius: '50%',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: isSel || isToday ? 700 : 400,
                      background: isSel
                        ? 'var(--accent)'
                        : isToday
                          ? 'color-mix(in srgb, var(--accent) 14%, transparent)'
                          : 'transparent',
                      color: isSel
                        ? '#fff'
                        : !inMonth
                          ? 'var(--outline-variant)'
                          : 'var(--on-surface)',
                      outline: isToday && !isSel
                        ? '2px solid color-mix(in srgb, var(--accent) 35%, transparent)'
                        : 'none',
                      outlineOffset: -2,
                      transition: 'background .1s',
                      margin: '0 1px',
                    }}
                    onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 18%, transparent)' }}
                    onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = isToday ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent' }}
                  >
                    {d.getDate()}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── Time wheels ── */}
        {mode === 'datetime' && (
          <div style={{ borderTop: '1px solid var(--outline-variant)', padding: '10px 14px 4px' }}>
            <p style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--outline)',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              marginBottom: 4,
            }}>
              Hora
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              <WheelPicker
                items={HOURS}
                selectedIdx={hourIdx}
                onChange={setHourIdx}
                label="Hora"
                formatItem={v => String(v).padStart(2, '0')}
              />
              <div style={{
                fontSize: 22,
                fontWeight: 200,
                color: 'var(--on-surface-variant)',
                paddingBottom: 4,
                flexShrink: 0,
                width: 18,
                textAlign: 'center',
              }}>:</div>
              <WheelPicker
                items={MINUTES}
                selectedIdx={minIdx}
                onChange={setMinIdx}
                label="Minutos"
                formatItem={v => String(v).padStart(2, '0')}
              />
              <div style={{ width: 12, flexShrink: 0 }} />
              <WheelPicker
                items={AMPM}
                selectedIdx={ampmIdx}
                onChange={setAmpmIdx}
                label="AM o PM"
                formatItem={v => v}
              />
            </div>
          </div>
        )}

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
            style={{ padding: '6px 10px', borderRadius: 7, border: 'none', background: 'transparent', color: 'var(--outline)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
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
          style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--outline-variant)', background: 'transparent', color: 'var(--on-surface-variant)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-container)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={confirm}
          style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-hover)' }}
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
        onClick={openPicker}
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
              <span style={{ color: 'var(--on-surface)', fontWeight: 500, textTransform: 'capitalize' }}>
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
            tabIndex={-1}
            onClick={e => { e.stopPropagation(); onChange('') }}
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
