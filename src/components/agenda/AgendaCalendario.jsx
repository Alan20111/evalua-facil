import { useState } from 'react'
import { ChevronLeft, ChevronRight, GraduationCap, ListChecks, ClipboardCheck, FileText } from 'lucide-react'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectColors } from '../../utils/subjectPalette'
import {
  MESES, DIAS_CORTO, addDays, addMonths, addWeeks,
  getMonthGrid, getWeekDays, isToday,
} from '../../utils/calendarGrid'
import { toDateStr } from '../../utils/horarioBloques'

const CATEGORIA_ICON = { examen: GraduationCap, cuestionario: ListChecks, observacion: ClipboardCheck }

const VISTAS = [
  { key: 'dia', label: 'Día' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mes' },
]

function Pill({ item, compact, onClick }) {
  const pal = subjectColors(item.subject)
  const Icon = CATEGORIA_ICON[item.activity.categoria] || FileText
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(item.activity.id) }}
      className={`flex items-center gap-1 rounded text-left w-full truncate transition-opacity hover:opacity-80 ${compact ? 'px-1 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'}`}
      style={{ background: pal.bg, color: pal.text }}
    >
      <Icon size={10} className="flex-shrink-0" />
      <span className="truncate">{item.activity.nombre}</span>
    </button>
  )
}

function NavHeader({ label, onPrev, onNext, onToday }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <button type="button" onClick={onPrev} aria-label="Anterior" className="p-1.5 text-muted hover:text-accent hover:bg-accent-tint rounded transition-colors">
        <ChevronLeft size={18} />
      </button>
      <button type="button" onClick={onToday} className="text-sm font-semibold text-on-surface px-2 py-1 rounded hover:bg-accent-tint transition-colors truncate">
        {label}
      </button>
      <button type="button" onClick={onNext} aria-label="Siguiente" className="p-1.5 text-muted hover:text-accent hover:bg-accent-tint rounded transition-colors">
        <ChevronRight size={18} />
      </button>
    </div>
  )
}

function VistaDia({ fecha, itemsByDate, onActivityClick }) {
  const items = itemsByDate[toDateStr(fecha)] || []
  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className="text-sm text-muted text-center py-10">Sin actividades este día.</p>
      ) : items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onActivityClick(item.activity.id)}
          className="w-full flex items-center gap-3 bg-surface-card rounded-card shadow-card border border-outline-variant p-3 text-left hover:shadow-md transition-shadow"
        >
          <div className="w-2 h-10 rounded-full flex-shrink-0" style={{ background: subjectColors(item.subject).text }} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-on-surface truncate">{item.activity.nombre}</p>
            <p className="text-xs text-muted truncate">{subjectDisplayName(item.subject)}</p>
          </div>
        </button>
      ))}
    </div>
  )
}

function VistaSemana({ fecha, itemsByDate, onActivityClick, onSelectDay }) {
  const dias = getWeekDays(fecha)
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {dias.map((d) => {
        const key = toDateStr(d)
        const items = itemsByDate[key] || []
        return (
          <div key={key} className="min-w-0">
            <button
              type="button"
              onClick={() => onSelectDay(d)}
              className="w-full flex flex-col items-center mb-1.5"
            >
              <span className="text-[10px] uppercase text-muted font-semibold">{DIAS_CORTO[(d.getDay() + 6) % 7]}</span>
              <span className={`w-6 h-6 flex items-center justify-center text-xs font-bold rounded-full ${isToday(d) ? 'bg-accent text-white' : 'text-on-surface'}`}>
                {d.getDate()}
              </span>
            </button>
            <div className="space-y-1">
              {items.slice(0, 4).map((item) => <Pill key={item.id} item={item} compact onClick={onActivityClick} />)}
              {items.length > 4 && <p className="text-[10px] text-muted text-center">+{items.length - 4}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function VistaMes({ fecha, itemsByDate, onActivityClick, onSelectDay }) {
  const celdas = getMonthGrid(fecha.getFullYear(), fecha.getMonth())
  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {DIAS_CORTO.map((d) => <p key={d} className="text-[10px] uppercase text-muted font-semibold text-center">{d}</p>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {celdas.map((d) => {
          const key = toDateStr(d)
          const items = itemsByDate[key] || []
          const esDelMes = d.getMonth() === fecha.getMonth()
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => onSelectDay(d)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectDay(d) } }}
              className={`min-h-[64px] rounded p-1 text-left hover:bg-accent-tint transition-colors cursor-pointer ${esDelMes ? '' : 'opacity-30'}`}
            >
              <span className={`w-5 h-5 flex items-center justify-center text-[11px] font-semibold rounded-full mb-0.5 ${isToday(d) ? 'bg-accent text-white' : 'text-on-surface'}`}>
                {d.getDate()}
              </span>
              <div className="space-y-0.5">
                {items.slice(0, 2).map((item) => <Pill key={item.id} item={item} compact onClick={onActivityClick} />)}
                {items.length > 2 && <p className="text-[9px] text-muted">+{items.length - 2}</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function AgendaCalendario({ itemsByDate, onActivityClick }) {
  const [vista, setVista] = useState('mes')
  const [fecha, setFecha] = useState(new Date())

  function ir(delta) {
    setFecha((f) => vista === 'dia' ? addDays(f, delta) : vista === 'semana' ? addWeeks(f, delta) : addMonths(f, delta))
  }
  function irAHoy() { setFecha(new Date()) }
  function seleccionarDia(d) { setFecha(d); setVista('dia') }

  const label = vista === 'dia'
    ? `${fecha.getDate()} de ${MESES[fecha.getMonth()]}`
    : vista === 'semana'
      ? (() => {
          const dias = getWeekDays(fecha)
          const first = dias[0], last = dias[6]
          return first.getMonth() === last.getMonth()
            ? `${first.getDate()}–${last.getDate()} ${MESES[first.getMonth()]}`
            : `${first.getDate()} ${MESES[first.getMonth()]} – ${last.getDate()} ${MESES[last.getMonth()]}`
        })()
      : `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`

  return (
    <div>
      <div className="flex gap-1 mb-4 bg-surface-container p-1 rounded-full">
        {VISTAS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setVista(v.key)}
            className={`flex-1 py-1.5 text-sm font-semibold rounded-full transition-colors ${
              vista === v.key ? 'bg-surface-card text-accent shadow-card' : 'text-muted hover:bg-accent-tint'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <NavHeader label={label} onPrev={() => ir(-1)} onNext={() => ir(1)} onToday={irAHoy} />

      {vista === 'dia' && <VistaDia fecha={fecha} itemsByDate={itemsByDate} onActivityClick={onActivityClick} />}
      {vista === 'semana' && <VistaSemana fecha={fecha} itemsByDate={itemsByDate} onActivityClick={onActivityClick} onSelectDay={seleccionarDia} />}
      {vista === 'mes' && <VistaMes fecha={fecha} itemsByDate={itemsByDate} onActivityClick={onActivityClick} onSelectDay={seleccionarDia} />}
    </div>
  )
}
