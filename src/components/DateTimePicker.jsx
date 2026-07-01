import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Calendar, X, Check } from 'lucide-react'

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const WEEK_DAYS = ['Lu','Ma','Mi','Ju','Vi','Sá','Do']
const HOURS = [1,2,3,4,5,6,7,8,9,10,11,12]
const MINUTES = [0,5,10,15,20,25,30,35,40,45,50,55]

function pad(n) { return String(n).padStart(2,'0') }

function parseValue(val) {
  if (!val) return null
  const m = val.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!m) return null
  const year = +m[1], month = +m[2] - 1, day = +m[3]
  let h = +m[4], minute = +m[5]
  const ampm = h >= 12 ? 'pm' : 'am'
  if (h === 0) h = 12
  else if (h > 12) h -= 12
  return { year, month, day, hour: h, minute, ampm }
}

function toValue(d) {
  let h = d.hour
  if (d.ampm === 'am') { if (h === 12) h = 0 }
  else { if (h !== 12) h += 12 }
  return `${d.year}-${pad(d.month + 1)}-${pad(d.day)}T${pad(h)}:${pad(d.minute)}`
}

// Convert 12-hr + ampm to 24-hr
function to24(hour, ampm) {
  if (ampm === 'am') return hour === 12 ? 0 : hour
  return hour === 12 ? 12 : hour + 12
}

function getCalendarCells(year, month) {
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrev = new Date(year, month, 0).getDate()
  const cells = []
  for (let i = firstDow - 1; i >= 0; i--) {
    const pm = month === 0 ? 11 : month - 1
    const py = month === 0 ? year - 1 : year
    cells.push({ day: daysInPrev - i, month: pm, year: py, cur: false })
  }
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, month, year, cur: true })
  const rem = (7 - (cells.length % 7)) % 7
  for (let d = 1; d <= rem; d++) {
    const nm = month === 11 ? 0 : month + 1
    const ny = month === 11 ? year + 1 : year
    cells.push({ day: d, month: nm, year: ny, cur: false })
  }
  return cells
}

function formatDisplay(val) {
  const p = parseValue(val)
  if (!p) return null
  const mon = MONTHS[p.month].slice(0, 3)
  const ap = p.ampm === 'am' ? 'a.m.' : 'p.m.'
  return `${pad(p.day)} ${mon} ${p.year}  ·  ${pad(p.hour)}:${pad(p.minute)} ${ap}`
}

// Returns first future minute (rounded to 5) given current now
function firstFutureMinute(nowMinute) {
  const next = Math.ceil((nowMinute + 1) / 5) * 5
  return next >= 60 ? null : next // null = need next hour
}

function TimeCol({ items, selected, onSelect, format, label, isDisabled }) {
  const selRef = useRef()
  const colRef = useRef()

  useEffect(() => {
    if (selRef.current && colRef.current) {
      const col = colRef.current
      const item = selRef.current
      col.scrollTop = item.offsetTop - col.clientHeight / 2 + item.clientHeight / 2
    }
  }, [selected])

  return (
    <div className="flex flex-col" style={{ width: 44 }}>
      <p className="text-xs text-center text-slate-400 mb-1 font-medium">{label}</p>
      <div ref={colRef} className="overflow-y-auto border border-outline-variant rounded-lg flex-1"
        style={{ maxHeight: 160 }}>
        {items.map((item) => {
          const sel = item === selected
          const disabled = isDisabled ? isDisabled(item) : false
          return (
            <button
              key={item}
              ref={sel ? selRef : null}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && onSelect(item)}
              className={`w-full py-1.5 text-sm text-center transition-colors leading-tight ${
                disabled
                  ? 'text-slate-300 cursor-not-allowed'
                  : sel
                  ? 'bg-accent text-white font-bold'
                  : 'text-on-surface hover:bg-accent-light hover:text-accent'
              }`}
            >
              {format ? format(item) : item}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function DateTimePicker({
  value,
  onChange,
  placeholder = 'Sin fecha límite',
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(null)
  const [viewYear, setViewYear] = useState(new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(new Date().getMonth())
  const containerRef = useRef()

  function openPicker() {
    const now = new Date()
    const p = parseValue(value)
    if (p) {
      setDraft(p)
      setViewYear(p.year)
      setViewMonth(p.month)
    } else {
      // Initialize to next 5-min slot in the future
      const nowH = now.getHours()
      let minute = Math.ceil((now.getMinutes() + 1) / 5) * 5
      let h24 = nowH
      if (minute >= 60) { minute = 0; h24 = nowH + 1 }
      if (h24 >= 24) { h24 = 0 } // edge: midnight
      const ampm = h24 >= 12 ? 'pm' : 'am'
      const hour = h24 % 12 || 12
      setDraft({
        year: now.getFullYear(),
        month: now.getMonth(),
        day: now.getDate(),
        hour,
        minute,
        ampm,
      })
      setViewYear(now.getFullYear())
      setViewMonth(now.getMonth())
    }
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (!containerRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  function handleConfirm() {
    if (draft) onChange(toValue(draft))
    setOpen(false)
  }

  function handleClear(e) {
    e.stopPropagation()
    onChange('')
    setOpen(false)
  }

  const now = new Date()
  const todayY = now.getFullYear()
  const todayM = now.getMonth()
  const todayD = now.getDate()
  const nowH24 = now.getHours()
  const nowMin = now.getMinutes()

  // Is the draft date today?
  const draftIsToday = draft &&
    draft.day === todayD && draft.month === todayM && draft.year === todayY

  function isPastDay(cell) {
    if (cell.year < todayY) return true
    if (cell.year === todayY && cell.month < todayM) return true
    if (cell.year === todayY && cell.month === todayM && cell.day < todayD) return true
    return false
  }

  function isHourDisabled(h) {
    if (!draftIsToday) return false
    return to24(h, draft.ampm) < nowH24
  }

  function isMinuteDisabled(m) {
    if (!draftIsToday || !draft) return false
    const h24 = to24(draft.hour, draft.ampm)
    if (h24 < nowH24) return true
    if (h24 === nowH24) return m <= nowMin
    return false
  }

  function isAmpmDisabled(ap) {
    if (!draftIsToday) return false
    // AM is disabled if current time is PM (13:00+) and switching to AM would make all hours past
    if (ap === 'am' && nowH24 >= 12) return true
    return false
  }

  // When user picks ampm that might make current hour invalid, advance to first valid hour
  function handleAmpm(ap) {
    setDraft(d => {
      const h24 = to24(d.hour, ap)
      if (draftIsToday && h24 < nowH24) {
        // Find first valid hour in this ampm period
        const firstValid = HOURS.find(h => to24(h, ap) >= nowH24)
        const newHour = firstValid || (ap === 'pm' ? 12 : 12)
        // Also fix minute if needed
        const newH24 = to24(newHour, ap)
        let newMinute = d.minute
        if (newH24 === nowH24 && newMinute <= nowMin) {
          newMinute = MINUTES.find(m => m > nowMin) ?? 0
        }
        return { ...d, ampm: ap, hour: newHour, minute: newMinute }
      }
      return { ...d, ampm: ap }
    })
  }

  // When user picks a hour, also fix minutes if they'd be in the past
  function handleHour(h) {
    setDraft(d => {
      const h24 = to24(h, d.ampm)
      let newMinute = d.minute
      if (draftIsToday && h24 === nowH24 && newMinute <= nowMin) {
        newMinute = MINUTES.find(m => m > nowMin) ?? 0
      }
      return { ...d, hour: h, minute: newMinute }
    })
  }

  const cells = draft ? getCalendarCells(viewYear, viewMonth) : []

  function isToday(c) {
    return c.day === todayD && c.month === todayM && c.year === todayY
  }
  function isSel(c) {
    return draft && c.day === draft.day && c.month === draft.month && c.year === draft.year
  }

  const displayText = formatDisplay(value)
  const draftDisplay = draft ? formatDisplay(toValue(draft)) : null

  // Confirm button disabled if draft is in the past
  const draftInPast = draft && (() => {
    const v = toValue(draft)
    return new Date(v) <= now
  })()

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        onClick={open ? () => setOpen(false) : openPicker}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all text-left ${
          open
            ? 'border-accent ring-2 ring-accent/20 bg-surface'
            : displayText
            ? 'border-accent/40 bg-surface hover:border-accent/70'
            : 'border-outline-variant bg-surface hover:border-accent/50'
        }`}
      >
        <Calendar size={16} className={`flex-shrink-0 ${displayText ? 'text-accent' : 'text-slate-400'}`} />
        <span className={`flex-1 ${displayText ? 'text-on-surface font-medium' : 'text-slate-400'}`}>
          {displayText || placeholder}
        </span>
        {displayText && (
          <button type="button" onClick={handleClear}
            className="flex-shrink-0 p-0.5 rounded text-slate-400 hover:text-red-500 transition-colors"
            title="Borrar fecha">
            <X size={14} />
          </button>
        )}
      </button>

      {/* Popup */}
      {open && draft && (
        <div className="absolute left-0 mt-1 z-50 bg-surface-card border border-outline-variant rounded-xl shadow-2xl overflow-hidden"
          style={{ width: 'max-content' }}>

          {/* Header */}
          <div className="px-3 py-2 border-b border-outline-variant bg-surface">
            <p className="text-xs text-muted font-medium">Seleccionado</p>
            <p className="text-sm font-semibold text-on-surface">{draftDisplay || 'Elige fecha y hora'}</p>
          </div>

          {/* Body: calendar left, time right */}
          <div className="flex gap-0">

            {/* Calendar */}
            <div className="px-2 py-2" style={{ width: 220 }}>
              <div className="flex items-center justify-between mb-1">
                <button type="button" onClick={prevMonth}
                  className="p-1 rounded hover:bg-surface-container text-slate-400 hover:text-on-surface transition-colors">
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs font-semibold text-on-surface capitalize">
                  {MONTHS[viewMonth].slice(0,3)} {viewYear}
                </span>
                <button type="button" onClick={nextMonth}
                  className="p-1 rounded hover:bg-surface-container text-slate-400 hover:text-on-surface transition-colors">
                  <ChevronRight size={14} />
                </button>
              </div>

              <div className="grid grid-cols-7 mb-0.5">
                {WEEK_DAYS.map(d => (
                  <div key={d} className="text-center text-[10px] text-muted py-0.5 font-medium">{d}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-y-0.5">
                {cells.map((cell, i) => {
                  const sel = isSel(cell)
                  const tod = isToday(cell)
                  const past = isPastDay(cell)
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={past}
                      onClick={() => !past && setDraft(d => ({ ...d, day: cell.day, month: cell.month, year: cell.year }))}
                      className={`h-7 w-full rounded-full text-xs transition-colors ${
                        past
                          ? 'text-slate-200 cursor-not-allowed'
                          : sel
                          ? 'bg-accent text-white font-bold'
                          : tod
                          ? 'text-accent font-bold ring-1 ring-accent hover:bg-accent-light'
                          : cell.cur
                          ? 'text-on-surface hover:bg-accent-light hover:text-accent'
                          : 'text-slate-300'
                      }`}
                    >
                      {cell.day}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Divider */}
            <div className="w-px bg-outline-variant self-stretch" />

            {/* Time columns */}
            <div className="px-2 py-2 flex flex-col gap-0">
              <p className="text-xs font-semibold text-muted mb-1.5 text-center">Hora</p>
              <div className="flex gap-1.5 flex-1">
                <TimeCol
                  label="H"
                  items={HOURS}
                  selected={draft.hour}
                  onSelect={handleHour}
                  isDisabled={isHourDisabled}
                />
                <TimeCol
                  label="Min"
                  items={MINUTES}
                  selected={draft.minute}
                  onSelect={(m) => setDraft(d => ({ ...d, minute: m }))}
                  format={pad}
                  isDisabled={isMinuteDisabled}
                />
                <div className="flex flex-col" style={{ width: 44 }}>
                  <p className="text-xs text-center text-slate-400 mb-1 font-medium">—</p>
                  <div className="border border-outline-variant rounded-lg overflow-hidden">
                    {['am', 'pm'].map(ap => {
                      const disabled = isAmpmDisabled(ap)
                      return (
                        <button
                          key={ap}
                          type="button"
                          disabled={disabled}
                          onClick={() => !disabled && handleAmpm(ap)}
                          className={`w-full py-2 text-xs text-center font-medium transition-colors ${
                            disabled
                              ? 'text-slate-300 cursor-not-allowed'
                              : draft.ampm === ap
                              ? 'bg-accent text-white font-bold'
                              : 'text-on-surface hover:bg-accent-light hover:text-accent'
                          }`}
                        >
                          {ap === 'am' ? 'a.m.' : 'p.m.'}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-2 px-3 py-2 border-t border-outline-variant">
            <button type="button" onClick={handleClear}
              className="px-3 py-1.5 text-xs text-slate-500 hover:text-red-500 border border-outline-variant rounded-lg transition-colors">
              Borrar
            </button>
            <button type="button" onClick={handleConfirm} disabled={!!draftInPast}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-accent text-white text-xs font-semibold rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <Check size={13} />
              Confirmar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
