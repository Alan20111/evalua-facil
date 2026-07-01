import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Calendar, Check, X } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────
const DIAS_HEADER = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

// ── Keyframes (injected once into <head>) ─────────────────────────────────────
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

// ── Pure helpers ──────────────────────────────────────────────────────────────
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
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function toIsoDatetime(d) {
  return `${toIsoDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDisplay(d, mode) {
  if (!d) return null
  const jsDay = d.getDay()
  const dayName = DIAS_SEMANA[(jsDay + 6) % 7]
  const dateStr = `${dayName} ${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()} de ${d.getFullYear()}`
  if (mode === 'date') return { date: dateStr, time: null }
  let h = d.getHours()
  const ap = h < 12 ? 'a.m.' : 'p.m.'
  h = h % 12 || 12
  return {
    date: dateStr,
    time: `${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`,
  }
}

function buildGrid(viewDate) {
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const startOffset = (firstDay.getDay() + 6) % 7
  const start = new Date(year, month, 1 - startOffset)
  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    cells.push(d)
  }
  return cells
}

function isSameDay(a, b) {
  if (!a || !b) return false
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function getNextMonday() {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? 1 : (8 - day) % 7 || 7
  d.setDate(d.getDate() + diff)
  return d
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function EFDateTimePicker({
  value = '',
  onChange,
  mode = 'datetime',  // 'date' | 'datetime'
  placeholder,
  disabled = false,
  clearable = true,
  className = '',
}) {
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)

  const [open, setOpen] = useState(false)
  const [openUpward, setOpenUpward] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, maxH: 530 })

  const parsed = useMemo(() => parseValue(value, mode), [value, mode])

  // Draft = uncommitted selection inside the picker
  const [draft, setDraft] = useState(null)
  const [viewDate, setViewDate] = useState(() => {
    const src = parseValue(value, mode)
    return src ? new Date(src.getFullYear(), src.getMonth(), 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  })
  const [slideDir, setSlideDir] = useState(null)
  const [slideKey, setSlideKey] = useState(0)

  // Time (24h "HH:MM" string for <input type="time">)
  const [timeStr, setTimeStr] = useState('08:00')

  // ── Open / position ─────────────────────────────────────────────────────────
  const computePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const PAD = 8
    const W = 328

    const spaceBelow = vh - rect.bottom - PAD
    const spaceAbove = rect.top - PAD
    const idealH = mode === 'datetime' ? 430 : 340
    const goUp = spaceBelow < idealH && spaceAbove > spaceBelow

    // maxH = actual available space in the chosen direction, capped at idealH
    const maxH = Math.min(idealH, goUp ? spaceAbove : spaceBelow)

    // Clamp left so the popover never bleeds past right or left edge
    const left = Math.max(PAD, Math.min(rect.left, vw - W - PAD))

    const top = goUp
      ? rect.top - maxH - 4
      : rect.bottom + 4

    setOpenUpward(goUp)
    setPos({ top, left, maxH })
  }, [mode])

  function openPicker() {
    if (disabled) return
    ensureStyles()
    const src = parsed
    setDraft(src || null)
    setViewDate(src ? new Date(src.getFullYear(), src.getMonth(), 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1))
    if (mode === 'datetime' && src) {
      setTimeStr(`${String(src.getHours()).padStart(2, '0')}:${String(src.getMinutes()).padStart(2, '0')}`)
    } else if (mode === 'datetime') {
      setTimeStr('08:00')
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

  // ── Click-outside / Escape ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    function onDown(e) {
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

  // ── Calendar navigation ─────────────────────────────────────────────────────
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

  // ── Day/time helpers ────────────────────────────────────────────────────────
  function applyTimeToDraft(base, hhmm) {
    const d = base ? new Date(base) : new Date()
    if (!base) d.setHours(0, 0, 0, 0)
    const [hh, mm] = hhmm.split(':').map(Number)
    d.setHours(hh, mm, 0, 0)
    return d
  }

  function selectDay(d) {
    const base = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const next = mode === 'datetime' ? applyTimeToDraft(base, timeStr) : base
    setDraft(next)
  }

  function handleTimeChange(hhmm) {
    setTimeStr(hhmm)
    setDraft(prev => applyTimeToDraft(prev || new Date(), hhmm))
  }

  // ── Shortcuts ───────────────────────────────────────────────────────────────
  const todayD = new Date()
  const shortcuts = useMemo(() => {
    const t = new Date()
    const tm = new Date(t); tm.setDate(t.getDate() + 1)
    const d3 = new Date(t); d3.setDate(t.getDate() + 3)
    return [
      { label: 'Hoy', d: t },
      { label: 'Mañana', d: tm },
      { label: '3 días', d: d3 },
      { label: 'Próx. lunes', d: getNextMonday() },
    ]
  }, [])

  function applyShortcut(d) {
    const base = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const next = mode === 'datetime' ? applyTimeToDraft(base, timeStr) : base
    setDraft(next)
    setViewDate(new Date(next.getFullYear(), next.getMonth(), 1))
  }

  // ── Confirm / Clear ─────────────────────────────────────────────────────────
  function confirm() {
    if (!draft) { onChange(''); setOpen(false); return }
    onChange(mode === 'date' ? toIsoDate(draft) : toIsoDatetime(draft))
    setOpen(false)
  }
  function clear() { onChange(''); setOpen(false) }

  // ── Calendar grid ───────────────────────────────────────────────────────────
  const grid = useMemo(() => buildGrid(viewDate), [viewDate])
  const display = formatDisplay(parsed, mode)
  const draftDisplay = formatDisplay(draft, mode)
  const placeholderText = placeholder || (mode === 'date' ? 'Seleccionar fecha…' : 'Seleccionar fecha y hora…')

  // ── Popover ─────────────────────────────────────────────────────────────────
  const popoverStyle = {
    position: 'fixed',
    top: pos.top,
    left: pos.left,
    width: 328,
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

  const popover = open && createPortal(
    <>
      <div
        ref={popoverRef}
        className={openUpward ? 'ef-pop-in-up' : 'ef-pop-in'}
        style={popoverStyle}
      >
      {/* Header */}
      <div style={{
        background: 'color-mix(in srgb, var(--accent) 10%, var(--surface-card))',
        borderBottom: '1px solid color-mix(in srgb, var(--accent) 15%, transparent)',
        padding: '11px 14px 9px',
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
          <p style={{ fontSize: 13, color: 'var(--outline)', fontStyle: 'italic', margin: 0 }}>
            Sin selección
          </p>
        )}
      </div>

      {/* Scrollable body — header + footer are sticky, this middle section scrolls */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

      {/* Shortcuts */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '9px 12px 4px' }}>
        {shortcuts.map(({ label, d }) => (
          <button
            key={label}
            type="button"
            onClick={() => applyShortcut(d)}
            style={{
              padding: '3px 10px',
              borderRadius: 999,
              border: 'none',
              background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
              color: 'var(--accent)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background .12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 20%, transparent)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 12%, transparent)' }}
          >
            {label}
          </button>
        ))}
        {clearable && (
          <button
            type="button"
            onClick={clear}
            style={{
              padding: '3px 10px',
              borderRadius: 999,
              border: 'none',
              background: 'var(--surface-container)',
              color: 'var(--on-surface-variant)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background .12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-dim)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-container)' }}
          >
            Sin límite
          </button>
        )}
      </div>

      {/* Calendar */}
      <div style={{ padding: '4px 10px 8px' }}>
        {/* Month nav */}
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

        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 2 }}>
          {DIAS_HEADER.map((d, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--outline)', padding: '2px 0' }}>
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
              const isSel = isSameDay(d, draft)
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
                    background: isSel ? 'var(--accent)' : isToday ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
                    color: isSel ? '#fff' : !inMonth ? 'var(--outline-variant)' : 'var(--on-surface)',
                    outline: isToday && !isSel ? '2px solid color-mix(in srgb, var(--accent) 35%, transparent)' : 'none',
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

      {/* Time selector */}
      {mode === 'datetime' && (
        <div style={{ borderTop: '1px solid var(--outline-variant)', padding: '10px 14px 12px' }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 7 }}>
            Hora
          </p>
          <input
            type="time"
            value={timeStr}
            onChange={e => e.target.value && handleTimeChange(e.target.value)}
            style={{
              width: '100%',
              fontSize: 14,
              fontWeight: 500,
              padding: '7px 12px',
              borderRadius: 8,
              border: '1px solid var(--outline-variant)',
              background: 'var(--surface)',
              color: 'var(--on-surface)',
              cursor: 'pointer',
              outline: 'none',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
            onFocus={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent)' }}
            onBlur={e => { e.target.style.borderColor = 'var(--outline-variant)'; e.target.style.boxShadow = 'none' }}
          />
        </div>
      )}

      </div>{/* end scrollable body */}

      {/* Footer */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 12px 10px', borderTop: '1px solid var(--outline-variant)', alignItems: 'center' }}>
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
          style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, transition: 'background .12s' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-hover)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)' }}
        >
          <Check size={13} />
          Confirmar
        </button>
      </div>
    </div>
    </>,
    document.body
  )

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
              <span style={{ color: 'var(--on-surface)', fontWeight: 500, textTransform: 'capitalize' }}>{display.date}</span>
              {display.time && (
                <span style={{ color: 'var(--on-surface-variant)', marginLeft: 8, fontSize: 'var(--fs-xs, 0.75rem)' }}>{display.time}</span>
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
