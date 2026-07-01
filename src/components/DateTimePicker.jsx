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

function getCalendarCells(year, month) {
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7 // Mon=0
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

function TimeCol({ items, selected, onSelect, format }) {
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
    <div ref={colRef} className="flex-1 overflow-y-auto border border-outline-variant rounded-lg" style={{ maxHeight: 152 }}>
      {items.map((item) => {
        const sel = item === selected
        return (
          <button
            key={item}
            ref={sel ? selRef : null}
            type="button"
            onClick={() => onSelect(item)}
            className={`w-full py-2 text-sm text-center transition-colors leading-tight ${
              sel
                ? 'bg-accent text-white font-bold'
                : 'text-on-surface hover:bg-accent-light hover:text-accent'
            }`}
          >
            {format ? format(item) : item}
          </button>
        )
      })}
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
    const p = parseValue(value)
    if (p) {
      setDraft(p)
      setViewYear(p.year)
      setViewMonth(p.month)
    } else {
      const now = new Date()
      const h = now.getHours()
      setDraft({
        year: now.getFullYear(),
        month: now.getMonth(),
        day: now.getDate(),
        hour: h % 12 || 12,
        minute: Math.round(now.getMinutes() / 5) * 5 % 60,
        ampm: h >= 12 ? 'pm' : 'am',
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

  const cells = draft ? getCalendarCells(viewYear, viewMonth) : []
  const today = new Date()

  function isToday(c) {
    return c.day === today.getDate() && c.month === today.getMonth() && c.year === today.getFullYear()
  }
  function isSel(c) {
    return draft && c.day === draft.day && c.month === draft.month && c.year === draft.year
  }

  const displayText = formatDisplay(value)
  const draftDisplay = draft ? formatDisplay(toValue(draft)) : null

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger button */}
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
          <button
            type="button"
            onClick={handleClear}
            className="flex-shrink-0 p-0.5 rounded text-slate-400 hover:text-red-500 transition-colors"
            title="Borrar fecha"
          >
            <X size={14} />
          </button>
        )}
      </button>

      {/* Picker popup */}
      {open && draft && (
        <div className="absolute left-0 mt-1 z-50 bg-surface-card border border-outline-variant rounded-2xl shadow-2xl overflow-hidden"
          style={{ minWidth: 300, width: 'max-content' }}>

          {/* Preview strip */}
          <div className="bg-accent px-4 py-2.5">
            <p className="text-xs text-white/70 font-medium uppercase tracking-wide mb-0.5">Seleccionado</p>
            <p className="text-white font-bold text-sm">{draftDisplay || 'Elige una fecha y hora'}</p>
          </div>

          {/* Month nav */}
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <button type="button" onClick={prevMonth}
              className="p-1.5 rounded-lg hover:bg-surface text-slate-400 hover:text-on-surface transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold text-on-surface capitalize">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button type="button" onClick={nextMonth}
              className="p-1.5 rounded-lg hover:bg-surface text-slate-400 hover:text-on-surface transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 px-2 pb-1">
            {WEEK_DAYS.map(d => (
              <div key={d} className="text-center text-xs text-muted py-0.5 font-medium">{d}</div>
            ))}
          </div>

          {/* Days */}
          <div className="grid grid-cols-7 px-2 pb-3 gap-y-0.5">
            {cells.map((cell, i) => {
              const sel = isSel(cell)
              const tod = isToday(cell)
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setDraft(d => ({ ...d, day: cell.day, month: cell.month, year: cell.year }))}
                  className={`h-8 w-full rounded-full text-sm transition-colors ${
                    sel
                      ? 'bg-accent text-white font-bold'
                      : tod && cell.cur
                      ? 'text-accent font-bold ring-1 ring-accent hover:bg-accent-light'
                      : cell.cur
                      ? 'text-on-surface hover:bg-accent-light hover:text-accent'
                      : 'text-slate-300 hover:bg-surface'
                  }`}
                >
                  {cell.day}
                </button>
              )
            })}
          </div>

          {/* Time picker */}
          <div className="border-t border-outline-variant mx-3" />
          <div className="px-3 py-3">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Hora</p>
            <div className="flex gap-2">
              <div className="flex-1">
                <p className="text-xs text-center text-slate-400 mb-1 font-medium">Hora</p>
                <TimeCol
                  items={HOURS}
                  selected={draft.hour}
                  onSelect={(h) => setDraft(d => ({ ...d, hour: h }))}
                />
              </div>
              <div className="flex-1">
                <p className="text-xs text-center text-slate-400 mb-1 font-medium">Min</p>
                <TimeCol
                  items={MINUTES}
                  selected={draft.minute}
                  onSelect={(m) => setDraft(d => ({ ...d, minute: m }))}
                  format={pad}
                />
              </div>
              <div style={{ width: 72 }}>
                <p className="text-xs text-center text-slate-400 mb-1 font-medium">AM/PM</p>
                <div className="border border-outline-variant rounded-lg overflow-hidden">
                  {['am', 'pm'].map(ap => (
                    <button
                      key={ap}
                      type="button"
                      onClick={() => setDraft(d => ({ ...d, ampm: ap }))}
                      className={`w-full py-2 text-sm text-center font-medium transition-colors ${
                        draft.ampm === ap
                          ? 'bg-accent text-white font-bold'
                          : 'text-on-surface hover:bg-accent-light hover:text-accent'
                      }`}
                    >
                      {ap === 'am' ? 'a.m.' : 'p.m.'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-3 pb-3 flex gap-2 border-t border-outline-variant pt-3">
            <button type="button" onClick={handleClear}
              className="px-3 py-2 text-sm text-slate-500 hover:text-red-500 border border-outline-variant rounded-lg transition-colors">
              Borrar
            </button>
            <button type="button" onClick={handleConfirm}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-accent text-white text-sm font-semibold rounded-lg hover:bg-accent/90 transition-colors">
              <Check size={15} />
              Confirmar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
