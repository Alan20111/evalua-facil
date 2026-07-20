import { useEffect, useRef } from 'react'
import { GraduationCap, ListChecks, ClipboardCheck, FileText, PartyPopper } from 'lucide-react'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectColors } from '../../utils/subjectPalette'
import { MESES, DIAS_LARGO, addDays, isSameDay } from '../../utils/calendarGrid'
import { toDateStr } from '../../utils/horarioBloques'
import { formatHora12FromDate } from '../../utils/formatHora'

const CATEGORIA_ICON = { examen: GraduationCap, cuestionario: ListChecks, observacion: ClipboardCheck }

const ESTADO_PILL = {
  calificada: { label: 'Calificada', className: 'bg-emerald-100 text-emerald-700' },
  entregada: { label: 'Entregada', className: 'bg-accent-light text-accent' },
  hoy: { label: 'Hoy', className: 'bg-amber-100 text-amber-700' },
  vencida: { label: 'Vencida', className: 'bg-red-100 text-red-700' },
  proxima: { label: 'Próxima', className: 'bg-surface-container text-muted' },
}

function etiquetaDia(fecha, todayStr) {
  const key = toDateStr(fecha)
  const hoy = new Date(`${todayStr}T12:00:00`)
  if (key === todayStr) return 'Hoy'
  if (isSameDay(fecha, addDays(hoy, -1))) return 'Ayer'
  if (isSameDay(fecha, addDays(hoy, 1))) return 'Mañana'
  return `${DIAS_LARGO[(fecha.getDay() + 6) % 7]} ${fecha.getDate()} de ${MESES[fecha.getMonth()]}`
}

function ActividadCard({ item, onClick }) {
  const { activity: a, submission: sub, subject, estado } = item
  const Icon = CATEGORIA_ICON[a.categoria] || FileText
  const pal = subjectColors(subject)
  const pill = ESTADO_PILL[estado]
  const hora = formatHora12FromDate(item.fecha)

  return (
    <button
      type="button"
      onClick={() => onClick(a.id)}
      className="w-full flex items-center gap-3 bg-surface-card rounded-card shadow-card border border-outline-variant p-3 text-left hover:shadow-md transition-shadow"
    >
      <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: pal.bg, color: pal.text }}>
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-on-surface truncate">{a.nombre}</p>
        <p className="text-xs text-muted truncate">{subjectDisplayName(subject)} · {hora}</p>
      </div>
      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        {estado === 'calificada' ? (
          <p className="text-sm font-bold text-emerald-600">{sub.calificacion}<span className="text-slate-400 font-normal">/{a.maxCalif}</span></p>
        ) : (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pill.className}`}>{pill.label}</span>
        )}
      </div>
    </button>
  )
}

export default function AgendaLista({ itemsByDate, todayStr, onActivityClick }) {
  const todayRef = useRef(null)
  const dateKeys = Object.keys(itemsByDate).sort()

  useEffect(() => {
    // Al entrar, ubica al estudiante justo en "hoy" — ni hasta arriba en lo
    // vencido, ni hasta abajo en lo lejano.
    todayRef.current?.scrollIntoView({ block: 'start' })
  }, [])

  if (dateKeys.length === 0) {
    return (
      <div className="flex flex-col items-center text-center py-16 px-6">
        <PartyPopper size={40} className="text-accent mb-3" />
        <p className="font-semibold text-on-surface mb-1">Nada por aquí todavía</p>
        <p className="text-sm text-muted">Cuando tus maestros publiquen actividades con fecha límite, las verás organizadas por día.</p>
      </div>
    )
  }

  const hoyIndex = dateKeys.indexOf(todayStr)

  return (
    <div className="space-y-5">
      {dateKeys.map((key, i) => {
        const dayItems = itemsByDate[key]
        const fecha = dayItems[0].fecha
        const esHoy = key === todayStr
        // Si "hoy" no tiene actividades propias, igual se ancla el scroll en
        // el primer grupo que sea hoy o posterior.
        const esAncla = esHoy || (hoyIndex === -1 && dateKeys.slice(0, i).every((k) => k < todayStr) && key >= todayStr)
        return (
          <div key={key} ref={esAncla ? todayRef : undefined}>
            <div className="flex items-center gap-2 mb-2">
              <p className={`text-sm font-bold uppercase tracking-wide ${esHoy ? 'text-accent' : 'text-muted'}`}>
                {etiquetaDia(fecha, todayStr)}
              </p>
              {esHoy && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
            </div>
            <div className="space-y-2">
              {dayItems.map((item) => <ActividadCard key={item.id} item={item} onClick={onActivityClick} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
