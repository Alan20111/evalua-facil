import {
  Clock, ArrowRightCircle, TrendingUp, Sparkles, AlertCircle, ListTodo,
  CalendarRange, CheckCircle2, MapPin, User, Plus, GraduationCap,
  ListChecks, ClipboardCheck, FileText, PartyPopper,
} from 'lucide-react'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectColors } from '../../utils/subjectPalette'
import { formatHora12 } from '../../utils/formatHora'
import {
  getAhora, getProximaClase, getPrioridadHoy, getPendientes, getCompletadas,
  getProximos7Dias, getProgresoSemanal, getMensajeInteligente, tiempoRestante,
} from '../../utils/agendaEngine'

const CATEGORIA_ICON = { examen: GraduationCap, cuestionario: ListChecks, observacion: ClipboardCheck }

function SectionHeader({ Icon, title, count }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <Icon size={16} className="text-accent flex-shrink-0" />
      <h2 className="text-sm font-bold uppercase tracking-wide text-on-surface">{title}</h2>
      {count != null && <span className="text-xs text-muted">({count})</span>}
    </div>
  )
}

function Card({ children, className = '' }) {
  return (
    <div className={`bg-surface-card rounded-card shadow-card border border-outline-variant p-3.5 ${className}`}>
      {children}
    </div>
  )
}

// "Ahora" / "Próxima clase" — bloque de horario resuelto.
function ClaseCard({ bloque, vacio }) {
  if (!bloque) {
    return <Card><p className="text-sm text-muted text-center py-1">{vacio}</p></Card>
  }
  const pal = subjectColors(bloque.subject)
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: pal.bg, color: pal.text }}>
          <Clock size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-on-surface truncate">{subjectDisplayName(bloque.subject)}</p>
          <p className="text-xs text-muted">{formatHora12(bloque.horaInicio)} – {formatHora12(bloque.horaFin)}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-muted">
            {bloque.teacherName && <span className="flex items-center gap-1"><User size={11} /> {bloque.teacherName}</span>}
            {bloque.lugar && <span className="flex items-center gap-1"><MapPin size={11} /> {bloque.lugar}</span>}
          </div>
        </div>
      </div>
    </Card>
  )
}

function ActividadCard({ item, onClick }) {
  const { activity: a, submission: sub, subject, estado } = item
  const Icon = CATEGORIA_ICON[a.categoria] || FileText
  const pal = subjectColors(subject)
  return (
    <button
      type="button"
      onClick={() => onClick(a.id)}
      className="w-full flex items-center gap-3 bg-surface-card rounded-card shadow-card border border-outline-variant p-3 text-left hover:shadow-md transition-shadow"
    >
      <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: pal.bg, color: pal.text }}>
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-on-surface truncate text-sm">{a.nombre}</p>
        <p className="text-xs text-muted truncate">{subjectDisplayName(subject)}</p>
      </div>
      <div className="flex-shrink-0 text-right">
        {estado === 'calificada' ? (
          <p className="text-sm font-bold text-emerald-600">{sub.calificacion}<span className="text-slate-400 font-normal">/{a.maxCalif}</span></p>
        ) : (
          <p className={`text-xs font-medium ${estado === 'vencida' ? 'text-red-600' : estado === 'hoy' ? 'text-orange-600' : 'text-amber-600'}`}>
            {tiempoRestante(item.fecha)}
          </p>
        )}
      </div>
    </button>
  )
}

function EventoCard({ evento, onClick }) {
  const esAcademico = evento.tipo === 'academico'
  return (
    <button
      type="button"
      onClick={() => onClick?.(evento)}
      className="w-full flex items-center gap-3 bg-surface-card rounded-card shadow-card border border-outline-variant p-3 text-left hover:shadow-md transition-shadow"
    >
      <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-purple-50 text-purple-600">
        <CalendarRange size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-on-surface truncate text-sm">{evento.titulo}</p>
        <p className="text-xs text-muted truncate">
          {esAcademico ? subjectDisplayName(evento.subject) : 'Personal'} · {formatHora12FromDateSafe(evento.fechaInicio)}
        </p>
      </div>
    </button>
  )
}

function formatHora12FromDateSafe(d) {
  if (!d) return ''
  const h = d.getHours()
  const m = d.getMinutes()
  const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  return formatHora12(hhmm)
}

function EmptyRow({ text }) {
  return <p className="text-sm text-muted text-center py-4">{text}</p>
}

function PrioridadRow({ entry, onActivityClick, onEventClick }) {
  if (entry.tipo === 'evento_academico' || entry.tipo === 'evento_personal') {
    return <EventoCard evento={entry.evento} onClick={onEventClick} />
  }
  return <ActividadCard item={entry.item} onClick={onActivityClick} />
}

function ProximoRow({ entry, onActivityClick, onEventClick }) {
  if (entry.tipo === 'evento_academico' || entry.tipo === 'evento_personal') {
    return <EventoCard evento={entry.evento} onClick={onEventClick} />
  }
  return <ActividadCard item={entry.item} onClick={onActivityClick} />
}

export default function AgendaDashboard({
  items, eventos, bloquesHoy, todayStr, ahora,
  onActivityClick, onEventClick, onCreateEvent,
  promedioActual, porcentajeEntregado,
}) {
  const claseAhora = getAhora(bloquesHoy, ahora)
  const proximaClase = getProximaClase(bloquesHoy, ahora)
  const eventosHoy = eventos.filter((e) => e.fechaInicio && e.fechaInicio.toDateString() === ahora.toDateString())
  const prioridadHoy = getPrioridadHoy(items, eventosHoy, todayStr)
  const pendientes = getPendientes(items)
  const completadas = getCompletadas(items)
  const proximos7 = getProximos7Dias(items, eventos, ahora)
  const progreso = getProgresoSemanal(items, ahora)
  const mensaje = getMensajeInteligente(prioridadHoy, todayStr, items)
  const progresoPct = progreso.total > 0 ? Math.round((progreso.completadas / progreso.total) * 100) : 100

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
      {/* Columna izquierda: contexto inmediato */}
      <div className="space-y-4">
        <Card className="bg-accent-tint border-accent-light">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent flex-shrink-0" />
            <p className="text-sm font-semibold text-on-surface">{mensaje}</p>
          </div>
        </Card>

        <div>
          <SectionHeader Icon={Clock} title="Ahora" />
          <ClaseCard bloque={claseAhora} vacio="No tienes clase en este momento." />
        </div>

        <div>
          <SectionHeader Icon={ArrowRightCircle} title="Próxima clase" />
          <ClaseCard bloque={proximaClase} vacio="No tienes más clases hoy." />
        </div>

        <div>
          <SectionHeader Icon={TrendingUp} title="Progreso semanal" />
          <Card>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-semibold text-on-surface">
                {progreso.completadas} de {progreso.total} actividades completadas
              </p>
              <span className="text-xs font-bold text-accent">{progresoPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-surface-container overflow-hidden">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progresoPct}%` }} />
            </div>
            {(promedioActual != null || porcentajeEntregado != null) && (
              <div className="flex gap-4 mt-3 pt-3 border-t border-outline-variant text-sm">
                {promedioActual != null && (
                  <div>
                    <p className="text-xs text-muted">Promedio actual</p>
                    <p className="font-bold text-on-surface">{promedioActual.toFixed(1)}</p>
                  </div>
                )}
                {porcentajeEntregado != null && (
                  <div>
                    <p className="text-xs text-muted">% entregado</p>
                    <p className="font-bold text-on-surface">{porcentajeEntregado}%</p>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Columna derecha: qué hacer */}
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} className="text-accent flex-shrink-0" />
              <h2 className="text-sm font-bold uppercase tracking-wide text-on-surface">Prioridad de hoy</h2>
            </div>
            <button type="button" onClick={onCreateEvent} className="flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              <Plus size={14} /> Evento
            </button>
          </div>
          {prioridadHoy.length === 0 ? (
            <Card><EmptyRow text="Todo está al corriente." /></Card>
          ) : (
            <div className="space-y-2">
              {prioridadHoy.map((entry, i) => (
                <PrioridadRow key={i} entry={entry} onActivityClick={onActivityClick} onEventClick={onEventClick} />
              ))}
            </div>
          )}
        </div>

        <div>
          <SectionHeader Icon={ListTodo} title="Pendientes" count={pendientes.length} />
          {pendientes.length === 0 ? (
            <Card><EmptyRow text="No tienes actividades pendientes." /></Card>
          ) : (
            <div className="space-y-2">
              {pendientes.map((item) => <ActividadCard key={item.id} item={item} onClick={onActivityClick} />)}
            </div>
          )}
        </div>

        <div>
          <SectionHeader Icon={CalendarRange} title="Próximos 7 días" />
          {proximos7.length === 0 ? (
            <Card><EmptyRow text="Sin nada programado por ahora." /></Card>
          ) : (
            <div className="space-y-2">
              {proximos7.map((entry, i) => <ProximoRow key={i} entry={entry} onActivityClick={onActivityClick} onEventClick={onEventClick} />)}
            </div>
          )}
        </div>

        <div>
          <SectionHeader Icon={CheckCircle2} title="Completadas" count={completadas.length} />
          {completadas.length === 0 ? (
            <Card>
              <div className="flex flex-col items-center text-center py-4">
                <PartyPopper size={26} className="text-accent mb-2" />
                <EmptyRow text="Aún no has completado actividades." />
              </div>
            </Card>
          ) : (
            <div className="space-y-2">
              {completadas.slice(0, 15).map((item) => <ActividadCard key={item.id} item={item} onClick={onActivityClick} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
