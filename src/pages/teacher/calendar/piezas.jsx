// Piezas de CalendarPage.jsx que viven fuera del componente principal.
// Salieron tal cual en la fase 5 de PLAN_NORMALIZACION_UI (sin cambio visual).
import { AGENDA_ROW_H, DIAS_CORTO, DIA_HOUR_AMPM, DIA_HOUR_FIN_TEXT, DIA_HOUR_INI_TEXT, DIA_HOUR_TEXT, DIA_ITEM_TEXT, GRID_HOUR_AMPM, GRID_HOUR_TEXT, GRID_ITEM_TEXT, GRID_ITEM_TITLE, MESES, MES_ITEM_TEXT, ROW_H, SNAP_MIN, addDays, fmtHour, getMonthGrid, getWeekDays, isToday, minutesToTimeStr, toDateStr } from './utilidades'
import { Bell, CalendarDays, CalendarOff, CalendarRange, Lock, LockOpen, Plus, Send, Trash2, X } from 'lucide-react'
import { Button } from '../../../components/ui'
import Modal from '../../../components/ui/Modal'
import EFDateTimePicker from '../../../components/EFDateTimePicker'
import { ICONO } from '../../../config/iconos'
import { IS_NATIVE_APP } from '../../../utils/platform'
import { TIPOS_ASUETO, alcanceAsuetoTexto, alcanceCompleto, esAsuetoAlguno } from '../../../utils/asuetos'
import { assignLanes } from '../../../utils/calendarEvents'
import { bloqueColor, timeToMinutes } from '../../../utils/horarioBloques'
import { formatHora12 } from '../../../utils/formatHora'
import { subjectDisplayName } from '../../../utils/subjectName'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePointerDrag } from '../../../hooks/usePointerDrag'

// ─── Event pill component ──────────────────────────────────────────────────
export function EventPill({ ev, compact, onClick, movable }) {
  // Fecha límite: candado cerrado/abierto según si ya deja de recibir tarde
  // (cambia solo cuando el docente edita la actividad). Publicación: sin
  // candado, se queda como está.
  // El ojito ya se usa en toda la app para "visible/no visible" (VisibilitySelect) —
  // aquí necesitábamos algo distinto para "se publicó en esta fecha".
  const Icon = ev.tipo === 'deadline' ? (ev.cierraEnFecha ? Lock : LockOpen) : ev.tipo === 'publicacion' ? Send : CalendarDays
  const dot = ev.tipo === 'deadline' && (ev.estado?.tono === 'vencida' || ev.estado?.tono === 'hoy')
  const esActividad = ev.tipo === 'deadline' || ev.tipo === 'publicacion'
  // La materia se muestra SIEMPRE como texto, nunca solo en tooltip: en
  // celular/tablet (touch) los tooltips no aparecen nunca (ver index.css).
  const materia = esActividad && ev.subtitulo ? ev.subtitulo.split(' · ')[0] : null
  return (
    <button
      type="button"
      onClick={onClick ? e => { e.stopPropagation(); onClick(ev) } : undefined}
      data-tooltip={esActividad ? 'Clic para editar esta actividad' : movable ? 'Muévelo' : undefined}
      className={`block rounded text-left w-full transition-opacity ${onClick ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'} ${compact ? `px-1 py-0.5 ${MES_ITEM_TEXT}` : 'px-2 py-1 text-xs'}`}
      style={{ background: ev.bg, color: ev.text }}
    >
      <span className="flex items-start gap-1 w-full">
        <Icon size={ICONO.xs} className="flex-shrink-0 mt-0.5" />
        {dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${ev.estado.tono === 'vencida' ? 'bg-red-500' : 'bg-amber-400'}`} />}
        {/* Nunca se corta el nombre: crece a los renglones que necesite —
            así "(Publicada)"/"(Cierre)" siempre queda visible completo. */}
        <span className="break-words leading-tight">{ev.titulo}</span>
        {!compact && ev.timeStr && (
          <span className="ml-auto flex-shrink-0 opacity-70 pl-1">{fmtHour(ev.timeStr)}</span>
        )}
      </span>
      {materia && <span className={`block truncate opacity-80 leading-tight ${IS_NATIVE_APP ? 'text-[10px]' : 'text-[11px]'}`}>{materia}</span>}
    </button>
  )
}

// ─── Agenda view ───────────────────────────────────────────────────────────
// Agenda del día: rejilla de horas (configurable) con las clases y eventos del
// día mostrado. Los items se pueden arrastrar verticalmente para cambiar de
// hora, o soltarse sobre los chips de días posteriores para moverlos de día.
export function AgendaView({
  date, events, bloques, subjects, dayStart, dayEnd,
  onEventClick, onBlockClick, onMoveBloque, onMoveEvent, onSlotClick, asuetoMap = {}, vacacionMap = {},
  // La Agenda del alumno reutiliza esta misma vista con su horario de
  // clases, que él no puede mover — a diferencia del docente (siempre
  // `true` por default, así su comportamiento no cambia).
  editableBloques = true,
}) {
  const dateStr = toDateStr(date)
  const asuetoDia = asuetoMap[dateStr]
  const vacacionDia = vacacionMap[dateStr]
  const hours = Array.from({ length: dayEnd - dayStart }, (_, i) => i + dayStart)
  const gridH = hours.length * AGENDA_ROW_H

  const gridRef = useRef(null)

  // Línea de la hora actual (solo cuando el día mostrado es hoy) — se actualiza
  // cada minuto para que vaya bajando por la rejilla.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const showNowLine = isToday(date) && nowMinutes >= dayStart * 60 && nowMinutes <= dayEnd * 60
  const nowLineTop = (nowMinutes - dayStart * 60) / 60 * AGENDA_ROW_H

  const dayBloques = bloques.filter(b => b.fecha === dateStr)
  const timedEvs = events.filter(ev => ev.dateStr === dateStr && ev.timeStr)
  const allDayEvs = events.filter(ev => ev.dateStr === dateStr && !ev.timeStr)

  const items = [
    ...dayBloques.map(b => ({
      kind: 'bloque', id: b.id,
      start: timeToMinutes(b.horaInicio),
      end: Math.max(timeToMinutes(b.horaFin), timeToMinutes(b.horaInicio) + 20),
      b,
    })),
    ...timedEvs.map(ev => {
      const start = timeToMinutes(ev.timeStr)
      // Duración visual mínima: las actividades llevan nombre (hasta 2
      // renglones) + materia + estado/candado, así que necesitan más alto
      // que un evento personal simple para no recortarse.
      const minVisual = (ev.tipo === 'deadline' || ev.tipo === 'publicacion') ? 75 : 40
      let end = start + minVisual
      if (ev.endTimeStr && ev.endDateStr === ev.dateStr) {
        const e = timeToMinutes(ev.endTimeStr)
        if (e > start + minVisual) end = e
      }
      return { kind: 'event', id: ev.id, start, end, ev }
    }),
  ]
  const placed = assignLanes(items)

  const isMovable = it => (it.kind === 'bloque' && editableBloques) || it.ev?.editable

  const { drag, startDrag: startDragRaw } = usePointerDrag((d, e) => {
    const { item } = d
    if (!d.moved) {
      // Clic: evento → su editor; bloque de clase → diálogo de acciones.
      if (item.kind === 'bloque') onBlockClick?.(item.b)
      else onEventClick?.(item.ev)
      return
    }
    // ¿Soltó sobre la rejilla? → nueva hora, mismo día. Cambiar de día se
    // hace desde Semana o Mes, donde sí se puede soltar sobre otra columna/celda.
    const g = gridRef.current?.getBoundingClientRect()
    if (g && e.clientX >= g.left && e.clientX < g.right) {
      const blockTop = e.clientY - d.grabDY
      let mins = Math.round(((blockTop - g.top) / AGENDA_ROW_H * 60 + dayStart * 60) / SNAP_MIN) * SNAP_MIN
      mins = Math.max(dayStart * 60, Math.min(dayEnd * 60 - SNAP_MIN, mins))
      const hora = minutesToTimeStr(mins)
      if (item.kind === 'bloque') {
        if (hora !== item.b.horaInicio) onMoveBloque?.(item.b, dateStr, hora)
      } else if (hora !== item.ev.timeStr) {
        onMoveEvent?.(item.ev.rawEvent, dateStr, hora)
      }
    }
  })
  function startDrag(e, it) {
    if (!isMovable(it)) return
    startDragRaw(e, { item: it })
  }

  return (
    <div>
      {/* Aviso de día de asueto o de vacaciones */}
      {(vacacionDia || asuetoDia) && (
        <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800 flex items-center gap-2">
          <CalendarOff size={ICONO.xs} className="flex-shrink-0 text-amber-600" />
          {vacacionDia ? 'Periodo de vacaciones' : 'Día de asueto'} — sin {alcanceAsuetoTexto(vacacionDia || asuetoDia).toLowerCase()}.
        </div>
      )}

      {/* Eventos sin hora */}
      {allDayEvs.length > 0 && (
        <div className="px-3 py-2 border-b border-outline-variant space-y-1">
          {allDayEvs.map(ev => (
            <div key={ev.id} data-tooltip={ev.editable ? 'Editar' : undefined}>
              <EventPill ev={ev} onClick={onEventClick} />
            </div>
          ))}
        </div>
      )}

      {/* Rejilla del día */}
      <div className="flex">
        {/* Gutter de horas. El am/pm va en su propio renglón debajo de la hora
            (pedido explícito, primero en la App y después también en la web),
            así la columna no tiene que caber "12:00 pm" en una sola línea. */}
        <div className={`relative flex-shrink-0 ${IS_NATIVE_APP ? 'w-11' : 'w-20'}`} style={{ height: gridH }}>
          {hours.map((h, i) => {
            const [hNum, periodo] = formatHora12(`${String(h).padStart(2, '0')}:00`).split(' ')
            return (
              <div key={h}
                className={`absolute ${DIA_HOUR_TEXT} text-muted leading-none whitespace-nowrap ${IS_NATIVE_APP ? 'inset-x-0 text-center' : 'right-2 text-right'}`}
                style={{ top: i * AGENDA_ROW_H + AGENDA_ROW_H / 2, transform: 'translateY(-50%)' }}>
                <span className="block">{hNum}</span>
                <span className={`block ${DIA_HOUR_AMPM} opacity-70 -mt-0.5`}>{periodo}</span>
              </div>
            )
          })}
        </div>

        <div ref={gridRef} className="relative flex-1 border-l border-outline-variant" style={{ height: gridH }}>
          {/* Líneas de hora / click para crear evento */}
          {hours.map((h, i) => (
            <button
              key={h}
              type="button"
              onClick={() => onSlotClick?.(dateStr, `${String(h).padStart(2, '0')}:00`)}
              className="absolute left-0 right-0 p-0 border-b border-outline-variant hover:bg-[var(--accent-tint)] transition-colors cursor-pointer"
              style={{ top: i * AGENDA_ROW_H, height: AGENDA_ROW_H }}
              data-tooltip="Crear evento a esta hora"
              aria-label={`Crear evento a las ${formatHora12(`${String(h).padStart(2, '0')}:00`)}`}
            />
          ))}

          {/* Línea de la hora actual — se disuelve hacia abajo. Solo cuando
              el día mostrado es hoy. */}
          {showNowLine && (
            <div className="absolute left-0 right-0 pointer-events-none z-20" style={{ top: nowLineTop }}>
              <div style={{ height: 3, background: 'var(--accent)' }} />
              <div style={{ height: 32, background: 'linear-gradient(to bottom, color-mix(in srgb, var(--accent) 40%, transparent), transparent)' }} />
            </div>
          )}

          {/* Día sin nada programado */}
          {placed.length === 0 && allDayEvs.length === 0 && (
            <div className="absolute inset-x-0 top-6 text-center pointer-events-none">
              <p className="text-sm text-muted">No hay clases ni eventos este día</p>
              <p className="text-xs text-muted opacity-60 mt-0.5">Haz clic en una hora para crear un evento</p>
            </div>
          )}

          {/* Items del día */}
          {placed.map(({ it, lane, total }) => {
            const isDragging = drag?.moved && drag.item.id === it.id
            const rawTop = (it.start - dayStart * 60) / 60 * AGENDA_ROW_H
            // Hueco de 6px entre bloques para que cada hora se lea como un
            // rectángulo propio, separado del siguiente.
            const height = Math.max(34, (it.end - it.start) / 60 * AGENDA_ROW_H - 6)
            const top = Math.max(0, Math.min(rawTop, gridH - height))
            const w = 100 / total
            const movable = isMovable(it)

            const horaIni = it.kind === 'bloque' ? it.b.horaInicio : it.ev.timeStr
            const horaFin = it.kind === 'bloque'
              ? it.b.horaFin
              : (it.ev.endTimeStr && it.ev.endDateStr === it.ev.dateStr && it.ev.endTimeStr !== it.ev.timeStr ? it.ev.endTimeStr : null)

            let bg, fg, titulo, sub
            if (it.kind === 'bloque') {
              const pal = bloqueColor(it.b.color)
              bg = pal.bg; fg = pal.text
              titulo = subjectDisplayName(subjects[it.b.asignaturaId]) || 'Clase'
              sub = it.b.lugar
              if (it.b.cancelada) sub = sub ? `Cancelada · ${sub}` : 'Cancelada'
            } else {
              bg = it.ev.bg; fg = it.ev.text
              titulo = it.ev.titulo
              sub = it.ev.subtitulo
            }

            return (
              <button
                key={it.id}
                type="button"
                onPointerDown={movable ? e => { e.stopPropagation(); startDrag(e, it) } : undefined}
                onClick={!movable ? e => {
                  e.stopPropagation()
                  if (it.kind === 'bloque') onBlockClick?.(it.b)
                  else onEventClick?.(it.ev)
                } : undefined}
                className={`absolute rounded-card shadow-card ring-1 ring-black/5 select-none transition-[filter] hover:brightness-95 p-0 text-left block ${movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
                style={{
                  top, height,
                  left: `calc(${lane * w}% + 3px)`,
                  width: `calc(${w}% - 6px)`,
                  background: bg, color: fg,
                  opacity: isDragging ? 0.3 : (it.kind === 'bloque' && it.b.cancelada ? 0.55 : 1),
                  touchAction: IS_NATIVE_APP && !movable ? 'auto' : 'none',
                }}
                data-tooltip={
                  it.kind === 'bloque' ? (editableBloques ? 'Usa modificar bloques para editar, o muévelo' : undefined)
                  : movable ? 'Editar, o muévelo'
                  : 'Clic para editar esta actividad'
                }
              >
                <div className="flex h-full">
                  {/* Horas a la izquierda — texto sin salto de línea (evita que
                      "am"/"pm" se corte o se pegue al borde). En la app ya
                      quedó bien de tamaño; en la web se veía demasiado chico,
                      un punto más grande ahí (con su columna un poco más
                      ancha para que siga cabiendo completo).
                      Con muchos eventos encimados (total >= 3, carriles muy
                      angostos) esta columna fija de hora ya no cabe —
                      se quitaba casi todo el ancho al título y lo dejaba en
                      una franja de un carácter, envolviendo letra por letra.
                      Con pocos carriles libres, la hora se mueve arriba del
                      título en vez de a un lado, y el título trunca en una
                      línea en vez de envolver. */}
                  {total < 3 && (
                    <div className={`flex-shrink-0 text-right pl-1 pr-1.5 py-1.5 border-r ${IS_NATIVE_APP ? 'w-16' : 'w-[72px]'}`} style={{ borderColor: `${fg}22` }}>
                      <span className={`block font-bold leading-tight whitespace-nowrap ${DIA_HOUR_INI_TEXT}`}>{fmtHour(horaIni)}</span>
                      {horaFin && <span className={`block opacity-70 leading-tight whitespace-nowrap ${DIA_HOUR_FIN_TEXT}`}>{fmtHour(horaFin)}</span>}
                    </div>
                  )}
                  {/* Evento y descripción a la derecha */}
                  <div className="flex-1 min-w-0 pl-2.5 py-1.5">
                    {total >= 3 && (
                      <span className={`block font-bold leading-tight whitespace-nowrap ${DIA_HOUR_INI_TEXT}`}>{fmtHour(horaIni)}</span>
                    )}
                    <span className={`block ${DIA_ITEM_TEXT} font-semibold leading-tight ${total >= 3 ? 'truncate' : 'break-words'} ${it.kind === 'bloque' && it.b.cancelada ? 'line-through' : ''}`}>{titulo}</span>
                    {sub && total < 3 && <span className={`block ${IS_NATIVE_APP ? GRID_ITEM_TEXT : 'text-xs'} opacity-75 leading-tight truncate`}>{sub}</span>}
                    {it.kind === 'bloque' && it.b.alarma?.activa && (
                      <span className="inline-flex items-center gap-1 text-[10px] opacity-70 leading-tight">
                        <Bell size={ICONO.xs} /> {it.b.alarma.minutosAntes} min antes
                      </span>
                    )}
                    {it.ev?.tipo === 'deadline' && (
                      <span className="inline-flex items-center gap-1 text-[10px] opacity-80 leading-tight">
                        {it.ev.cierraEnFecha ? <Lock size={ICONO.xs} /> : <LockOpen size={ICONO.xs} />}
                        {it.ev.estado?.label}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Fantasma que sigue al cursor */}
      {drag?.moved && (() => {
        const it = drag.item
        const pal = it.kind === 'bloque' ? bloqueColor(it.b.color) : { bg: it.ev.bg, text: it.ev.text }
        const titulo = it.kind === 'bloque'
          ? subjectDisplayName(subjects[it.b.asignaturaId])
          : it.ev.titulo
        return (
          <div
            className="fixed z-50 rounded-card px-2 py-1.5 shadow-lg pointer-events-none opacity-90"
            style={{
              left: drag.x - drag.grabDX, top: drag.y - drag.grabDY,
              width: drag.w, height: drag.h,
              background: pal.bg, color: pal.text,
            }}
          >
            <span className={`block ${DIA_ITEM_TEXT} font-semibold leading-tight truncate`}>{titulo}</span>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Month view ────────────────────────────────────────────────────────────
export function BloquePill({ b, subj, onClick }) {
  const pal = bloqueColor(b.color)
  return (
    <button
      type="button"
      onClick={onClick ? e => { e.stopPropagation(); onClick(b) } : undefined}
      className={`flex items-center gap-1 rounded-full w-full px-2 py-0.5 ${MES_ITEM_TEXT} ring-1 ring-black/5 transition-opacity ${onClick ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
      style={{ background: pal.bg, color: pal.text, opacity: b.cancelada ? 0.55 : 1 }}
      data-tooltip={onClick ? (b.cancelada ? 'Clase cancelada — usa modificar bloques para editar' : 'Usa modificar bloques para editar') : undefined}
    >
      <span className={`truncate ${b.cancelada ? 'line-through' : ''}`}>{subjectDisplayName(subj)}</span>
    </button>
  )
}

export function MonthView({ year, month, events, bloques, subjects, selectedDate, onDateClick, onEventClick, onBlockClick, onMoveEvent, asuetoMap = {}, vacacionMap = {}, editable = true }) {
  const cells = getMonthGrid(year, month)
  const selStr = selectedDate ? toDateStr(selectedDate) : null

  const cellRefs = useRef({})

  const bloquesByDate = useMemo(() => {
    const m = {}
    bloques.forEach(b => { (m[b.fecha] ||= []).push(b) })
    Object.values(m).forEach(list => list.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio)))
    return m
  }, [bloques])

  // Arrastrar una pastilla a otro día del mes: solo eventos personales — los
  // bloques de clase no se arrastran en esta vista (ver `movable` más abajo),
  // así que solo se mueven directo conservando su hora.
  const { drag, startDrag } = usePointerDrag((d, e) => {
    if (!d.moved) {
      // Clic: evento → su editor; bloque de clase → diálogo de acciones.
      if (d.kind === 'bloque') onBlockClick?.(d.b)
      else onEventClick?.(d.ev)
      return
    }
    let target = null
    Object.entries(cellRefs.current).forEach(([dStr, el]) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom) target = dStr
    })
    if (!target || target === d.ev.dateStr) return
    onMoveEvent?.(d.ev.rawEvent, target, d.ev.timeStr || null)
  }, { grab: false })

  return (
    <div>
      {/* Patrón del Calendario de Apple: letra del día arriba, sin cuadrícula —
          solo una línea fina entre semanas; fin de semana en gris. */}
      <div className="grid grid-cols-7 border-b border-outline-variant">
        {DIAS_CORTO.map((d, i) => (
          <div key={d} className={`py-2 text-center text-xs font-semibold uppercase tracking-wide ${i >= 5 ? 'text-hint' : 'text-muted'}`}>{d.charAt(0)}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const isThisMonth = cell.getMonth() === month
          const dateStr = toDateStr(cell)
          const dayBloques = bloquesByDate[dateStr] || []
          const dayEvs = events
            .filter(ev => ev.dateStr === dateStr)
            .sort((a, b) => (a.timeStr || '').localeCompare(b.timeStr || ''))
          const items = [
            ...dayBloques.map(b => ({ kind: 'bloque', b })),
            ...dayEvs.map(ev => ({ kind: 'event', ev })),
          ]
          const extra = items.length > 3 ? items.length - 3 : 0

          const asueto = esAsuetoAlguno(asuetoMap, dateStr)
          const vacacion = esAsuetoAlguno(vacacionMap, dateStr)

          return (
            <div
              key={dateStr}
              ref={el => { cellRefs.current[dateStr] = el }}
              role="button"
              tabIndex={0}
              onClick={() => onDateClick?.(cell)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onDateClick?.(cell)
                }
              }}
              aria-label={`Ver día ${cell.getDate()} de ${MESES[cell.getMonth()]}`}
              className={`${IS_NATIVE_APP ? 'min-h-[4.5rem]' : 'min-h-[6.4rem]'} border-b border-outline-variant p-1 cursor-pointer hover:bg-[var(--accent-tint)] transition-colors ${!isThisMonth ? 'opacity-35' : ''}`}
              style={(asueto || vacacion) ? { background: '#fffbeb' } : undefined}
            >
              {/* HOY: misma banda azul de ancho completo que en 3 días/Semana.
                  El -mx-1 cancela el p-1 de la celda para que llegue de borde
                  a borde de la columna; el alto es el del círculo (h-6). */}
              {/* HOY: círculo de acento (Apple). Elegido: anillo. Fin de semana: gris. */}
              <div className={`w-8 h-8 mb-1 mx-auto flex items-center justify-center rounded-full text-base font-semibold tabular-nums ${
                isToday(cell)
                  ? 'bg-accent text-white'
                  : dateStr === selStr ? 'ring-2 ring-accent text-accent'
                  : (cell.getDay() === 0 || cell.getDay() === 6) ? 'text-hint' : 'text-on-surface'
              }`}>
                {cell.getDate()}
              </div>
              {(asueto || vacacion) && (
                <p className="text-[9px] font-semibold text-amber-600 uppercase text-center leading-none mb-1">{vacacion ? 'Vacaciones' : 'Asueto'}</p>
              )}
              <div className="space-y-1">
                {items.slice(0, 3).map((it) => {
                  // En la vista Mes los BLOQUES DE CLASE no se arrastran (no se
                  // pueden cambiar de día aquí; para eso está "Modificar
                  // bloques"). Solo los eventos personales se arrastran a otro
                  // día. Al tocar un bloque se abre el diálogo para borrarlo.
                  const movable = it.kind === 'event' && it.ev?.editable
                  const isDraggingThis = drag?.moved && it.kind === 'event' && drag.kind === 'event' && drag.ev?.id === it.ev.id
                  const pill = it.kind === 'bloque'
                    ? <BloquePill b={it.b} subj={subjects[it.b.asignaturaId]} onClick={editable ? onBlockClick : undefined} />
                    : <EventPill ev={it.ev} compact movable={movable} onClick={movable ? undefined : onEventClick} />
                  return (
                    <div
                      key={it.kind === 'bloque' ? it.b.id : it.ev.id}
                      onPointerDown={movable ? e => { e.stopPropagation(); startDrag(e, { kind: 'event', ev: it.ev }) } : undefined}
                      className={movable ? 'cursor-grab active:cursor-grabbing select-none' : ''}
                      style={{ touchAction: IS_NATIVE_APP && !movable ? 'auto' : 'none', opacity: isDraggingThis ? 0.3 : 1 }}
                    >
                      {pill}
                    </div>
                  )
                })}
                {extra > 0 && (
                  <p className="text-xs text-muted pl-1">+{extra} más</p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Fantasma que sigue al cursor mientras se arrastra — solo eventos
          personales, los bloques de clase no se arrastran en esta vista. */}
      {drag?.moved && (
        <div
          className="fixed z-50 rounded px-2 py-1 shadow-lg pointer-events-none opacity-90 text-xs font-semibold truncate"
          style={{ left: drag.x + 8, top: drag.y + 8, maxWidth: drag.w, background: drag.ev.bg, color: drag.ev.text }}
        >
          {drag.ev.titulo}
        </div>
      )}
    </div>
  )
}

// los bloques se sueltan alineados a 15 min
export function WeekView({ weekStart, events, bloques, subjects, dayStart, dayEnd, numDays = 7, anchorToday = false, selectedDate, onSlotClick, onBlockClick, onEventClick, onMoveBloque, onMoveEvent, asuetoMap = {}, vacacionMap = {}, editable = true }) {
  // Vista "3 días": ventana móvil de numDays días consecutivos arrancando en
  // weekStart (no anclada a lunes, a diferencia de la vista Semana normal).
  const days = anchorToday
    ? Array.from({ length: numDays }, (_, i) => addDays(weekStart, i))
    : getWeekDays(weekStart).slice(0, numDays)
  const todayStr = toDateStr(new Date())
  const selStr = selectedDate ? toDateStr(selectedDate) : null
  const hoursRange = Array.from({ length: dayEnd - dayStart }, (_, i) => i + dayStart)
  const gridH = hoursRange.length * ROW_H
  // En la web, 3 días y Semana usan la MISMA canaleta de horas que la vista
  // Día: 5rem de ancho y la hora pegada a la derecha (Día es `w-20` + `right-2
  // text-right`), para que las tres vistas se lean igual. La app va aparte:
  // ahí la canaleta es angosta a propósito, porque la pantalla no da para más.
  const gutterComoDia = !IS_NATIVE_APP
  const gridCols = `${gutterComoDia ? '5rem' : '3.5rem'} repeat(${numDays}, minmax(0, 1fr))`

  const colRefs = useRef([])

  // Bloques agrupados por fecha.
  const byDate = useMemo(() => {
    const m = {}
    bloques.forEach(b => { (m[b.fecha] ||= []).push(b) })
    return m
  }, [bloques])

  function topPx(time) {
    return (timeToMinutes(time) - dayStart * 60) / 60 * ROW_H
  }

  const { drag, startDrag } = usePointerDrag((d, e) => {
    if (!d.moved) {
      // Clic: en evento abre su editor; en bloque de clase abre el diálogo de
      // acciones (mover el mismo día / borrar esta clase), NO su editor.
      if (d.kind === 'event') onEventClick?.(d.ev)
      else onBlockClick?.(d.bloque)
      return
    }
    const blockTop = e.clientY - d.grabDY
    if (d.kind === 'bloque') {
      // SOLO vertical y el MISMO día: el día no cambia; la hora sale de la
      // posición vertical (todas las columnas comparten el mismo `top`).
      const anyCol = colRefs.current.find(el => el)
      const colTop = anyCol ? anyCol.getBoundingClientRect().top : 0
      let mins = Math.round(((blockTop - colTop) / ROW_H * 60 + dayStart * 60) / SNAP_MIN) * SNAP_MIN
      mins = Math.max(dayStart * 60, Math.min(dayEnd * 60 - SNAP_MIN, mins))
      const nuevaHora = minutesToTimeStr(mins)
      if (nuevaHora !== d.bloque.horaInicio) onMoveBloque?.(d.bloque, d.bloque.fecha, nuevaHora)
      return
    }
    // Eventos personales: pueden cambiar de día (se detecta la columna).
    let target = null
    colRefs.current.forEach((el, idx) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX < r.right) target = { idx, top: r.top }
    })
    if (!target) return
    let mins = Math.round(((blockTop - target.top) / ROW_H * 60 + dayStart * 60) / SNAP_MIN) * SNAP_MIN
    mins = Math.max(dayStart * 60, Math.min(dayEnd * 60 - SNAP_MIN, mins))
    const nuevaFecha = toDateStr(days[target.idx])
    const nuevaHora = minutesToTimeStr(mins)
    // Evento personal: se mueve directo, sin preguntar.
    if (nuevaFecha !== d.ev.dateStr || nuevaHora !== d.ev.timeStr) {
      onMoveEvent?.(d.ev.rawEvent, nuevaFecha, nuevaHora)
    }
  }, {
    // Los bloques de clase solo se mueven en VERTICAL (mismo día): el
    // fantasma no se desplaza en horizontal (x fija).
    freezeX: d => d.kind === 'bloque',
  })

  return (
    <div className="overflow-x-auto">
      {/* Sin mínimo forzado en móvil (min-w-0): las columnas de días, que ya
          usan 1fr, se encogen para caber en la pantalla en vez de obligar a
          hacer scroll horizontal. En escritorio (md+) se mantiene el ancho
          mínimo de siempre para que las columnas no queden demasiado
          angostas para arrastrar bloques/eventos. */}
      <div className={`min-w-0 ${IS_NATIVE_APP ? '' : 'md:min-w-[620px]'}`}>
        {/* Day headers */}
        <div className="grid border-b border-outline-variant sticky top-0 bg-surface-card z-10" style={{ gridTemplateColumns: gridCols }}>
          <div className="py-2 px-2" />
          {days.map((d) => {
            const dStr = toDateStr(d)
            const asueto = esAsuetoAlguno(asuetoMap, dStr)
            const vacacion = esAsuetoAlguno(vacacionMap, dStr)
            return (
              <div
                key={dStr}
                className="py-2 text-center text-xs border-l border-outline-variant"
                style={(asueto || vacacion) ? { background: '#fffbeb' } : dStr === selStr ? { background: 'color-mix(in srgb, var(--accent) 7%, transparent)' } : undefined}
              >
                <span className="block uppercase text-muted">
                  {numDays === 3 ? DIAS_CORTO[(d.getDay() + 6) % 7] : DIAS_CORTO[(d.getDay() + 6) % 7].charAt(0)}
                </span>
                {/* HOY: barra azul de ancho completo, no la bolita. Con la
                    bolita había que buscar cuál de los círculos estaba pintado;
                    una banda que ocupa toda la columna se ve de un vistazo.
                    Conserva el alto que tenía el círculo (h-7). */}
                <span className={`text-sm font-semibold mt-0.5 ${
                  dStr === todayStr
                    ? 'flex items-center justify-center h-7 bg-accent text-white'
                    : `inline-flex items-center justify-center w-7 h-7 rounded-full ${
                        dStr === selStr ? 'ring-2 ring-accent text-accent' : 'text-on-surface'
                      }`
                }`}>
                  {d.getDate()}
                </span>
                {(asueto || vacacion) && (
                  <span className="block text-[9px] font-semibold text-amber-600 uppercase leading-tight mt-0.5">{vacacion ? 'Vacaciones' : 'Asueto'}</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Body: time gutter + day columns */}
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          {/* Time gutter — el am/pm cuelga debajo de la hora, igual que en la
              vista Día, para que las tres se lean igual. z-10: en un grid,
              los items posteriores en el DOM (columnas de días) pintan
              encima de los anteriores donde se toquen (sombras/anillos de
              bloques y eventos) — sin esto, esas sombras tapaban los
              números de hora pegados al borde derecho de esta columna. */}
          <div className="relative z-10" style={{ height: gridH }}>
            {hoursRange.map((hour, i) => {
              const [hNum, periodo] = formatHora12(`${String(hour).padStart(2, '0')}:00`).split(' ')
              return (
                <div key={hour} className={`absolute left-0 right-0 ${GRID_HOUR_TEXT} text-muted leading-none whitespace-nowrap ${gutterComoDia ? 'pr-2 text-right' : 'px-1.5'}`}
                  style={{ top: i * ROW_H + ROW_H / 2, transform: 'translateY(-50%)' }}>
                  <span className="block">{hNum}</span>
                  <span className={`block ${GRID_HOUR_AMPM} opacity-70 -mt-0.5`}>{periodo}</span>
                </div>
              )
            })}
          </div>

          {/* Day columns */}
          {days.map((d, di) => {
            const dStr = toDateStr(d)
            const placed = assignLanes((byDate[dStr] || []).map(b => ({
              start: timeToMinutes(b.horaInicio),
              end: timeToMinutes(b.horaFin),
              b,
            })))
            const dayEvs = events.filter(ev => ev.dateStr === dStr && ev.timeStr)
            return (
              <div
                key={dStr}
                ref={el => { colRefs.current[di] = el }}
                className="relative border-l border-outline-variant"
                style={{
                  height: gridH,
                  ...(dStr === selStr ? { background: 'color-mix(in srgb, var(--accent) 4%, transparent)' } : {}),
                }}
              >
                {/* Hour gridlines / click targets — crean un EVENTO nuevo */}
                {hoursRange.map((hour, i) => (
                  <button
                    key={hour}
                    type="button"
                    onClick={() => onSlotClick?.(dStr, `${String(hour).padStart(2, '0')}:00`)}
                    className="absolute left-0 right-0 p-0 border-b border-outline-variant hover:bg-[var(--accent-tint)] transition-colors cursor-pointer"
                    style={{ top: i * ROW_H, height: ROW_H }}
                    aria-label={`Crear evento a las ${formatHora12(`${String(hour).padStart(2, '0')}:00`)}`}
                  />
                ))}

                {/* Bloques */}
                {placed.map(({ it, lane, total }) => {
                  const { b, start, end } = it
                  const pal = bloqueColor(b.color)
                  // Hueco de 4px entre bloques → cada hora es su propio rectángulo.
                  const height = Math.max(20, (end - start) / 60 * ROW_H - 4)
                  // Acota dentro de la rejilla: lo que cae fuera del rango de
                  // horas visible se ancla al borde en vez de desaparecer.
                  const top = Math.max(0, Math.min(topPx(b.horaInicio), gridH - height))
                  const w = 100 / total
                  const subj = subjects[b.asignaturaId]
                  const isDragging = drag?.moved && drag.kind === 'bloque' && drag.bloque.id === b.id
                  return (
                    <div
                      key={b.id}
                      onPointerDown={editable ? e => { e.stopPropagation(); startDrag(e, { kind: 'bloque', bloque: b }) } : undefined}
                      className={`absolute rounded px-1.5 py-1 text-left shadow-card ring-1 ring-black/5 hover:brightness-95 transition-[filter] select-none ${editable ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      style={{
                        top, height,
                        left: `calc(${lane * w}% + 2px)`,
                        width: `calc(${w}% - 4px)`,
                        background: pal.bg, color: pal.text,
                        opacity: isDragging ? 0.3 : (b.cancelada ? 0.55 : 1),
                        touchAction: IS_NATIVE_APP && !editable ? 'auto' : 'none',
                      }}
                      data-tooltip={b.cancelada ? 'Clase cancelada' : editable ? 'Usa modificar bloques para editar, o muévelo' : undefined}
                    >
                      <span className={`block ${GRID_ITEM_TEXT} font-normal leading-tight truncate ${b.cancelada ? 'line-through' : ''}`}>{subjectDisplayName(subj)}</span>
                      {b.cancelada && <span className={`block ${GRID_ITEM_TEXT} leading-tight truncate`}>Cancelada</span>}
                      {!b.cancelada && b.lugar && <span className={`block ${GRID_ITEM_TEXT} opacity-70 leading-tight truncate`}>{b.lugar}</span>}
                    </div>
                  )
                })}

                {/* Eventos con hora — los personales (editables) se arrastran
                    directo a otro horario, sin preguntar */}
                {dayEvs.map(ev => {
                  const EV_H = 30
                  // Acota dentro de la rejilla (p. ej. fechas límite a las
                  // 23:59 se anclan al fondo en vez de quedar fuera).
                  const top = Math.max(0, Math.min(topPx(ev.timeStr), gridH - EV_H))
                  const isDragging = drag?.moved && drag.kind === 'event' && drag.ev?.id === ev.id
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onPointerDown={ev.editable ? e => { e.stopPropagation(); startDrag(e, { kind: 'event', ev }) } : undefined}
                      onClick={!ev.editable ? e => { e.stopPropagation(); onEventClick?.(ev) } : undefined}
                      className={`absolute right-0.5 rounded px-1 py-0.5 text-left shadow-card ring-1 ring-white/60 hover:brightness-95 transition-[filter] select-none ${ev.editable ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      style={{ top, width: '78%', minHeight: EV_H, background: ev.bg, color: ev.text, zIndex: 5, opacity: isDragging ? 0.3 : 1, touchAction: IS_NATIVE_APP && !ev.editable ? 'auto' : 'none' }}
                      data-tooltip={
                        ev.activityId ? 'Clic para editar esta actividad'
                        : [ev.titulo, fmtHour(ev.timeStr), ev.editable && 'arrastra para mover'].filter(Boolean).join(' · ')
                      }
                    >
                      <span className={`flex items-start gap-1 ${GRID_ITEM_TEXT} font-normal leading-tight`}>
                        {ev.tipo === 'deadline' && (ev.cierraEnFecha
                          ? <Lock size={ICONO.xs} className="flex-shrink-0 opacity-90 mt-0.5" />
                          : <LockOpen size={ICONO.xs} className="flex-shrink-0 opacity-90 mt-0.5" />)}
                        <span className="break-words">{ev.titulo}</span>
                      </span>
                      {ev.tipo === 'deadline' && (
                        <span className={`block text-[10px] opacity-90 leading-tight truncate font-medium ${ev.estado?.tono === 'vencida' ? 'text-red-100' : ''}`}>{ev.estado.label}</span>
                      )}
                      {ev.subtitulo && (
                        <span className="block text-[10px] opacity-75 leading-tight truncate">{ev.subtitulo}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* Fantasma que sigue al cursor mientras se arrastra */}
      {drag?.moved && (() => {
        const esEvento = drag.kind === 'event'
        const pal = esEvento ? { bg: drag.ev.bg, text: drag.ev.text } : bloqueColor(drag.bloque.color)
        const titulo = esEvento ? drag.ev.titulo : subjectDisplayName(subjects[drag.bloque.asignaturaId])
        const horas = esEvento ? fmtHour(drag.ev.timeStr) : `${drag.bloque.horaInicio}–${drag.bloque.horaFin}`
        return (
          <div
            className="fixed z-50 rounded px-1.5 py-1 shadow-lg pointer-events-none opacity-90"
            style={{
              left: drag.x - drag.grabDX, top: drag.y - drag.grabDY,
              width: drag.w, height: drag.h,
              background: pal.bg, color: pal.text,
            }}
          >
            <span className={`block ${GRID_ITEM_TITLE} font-semibold leading-tight truncate`}>{titulo}</span>
            <span className={`block ${GRID_ITEM_TEXT} opacity-80 leading-tight`}>{horas}</span>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Administrador de días de asueto ────────────────────────────────────────
// El docente elige una fecha y a qué afecta (clases, eventos, actividades). Un
// tipo marcado = ese tipo NO se permite ese día. "Todo" marca los tres.
export function AsuetoManager({ asuetos, onAdd, onRemove, onClose }) {
  const [fecha, setFecha] = useState('')
  const [alcance, setAlcance] = useState(alcanceCompleto)

  const lista = [...asuetos].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
  // Derivados de TIPOS_ASUETO y no escritos a mano: al agregar "Asistencias"
  // como cuarto tipo, "Todo" tenía que contarlo sin tocar tres condiciones.
  const algo = TIPOS_ASUETO.some(t => alcance[t.id])
  const todo = TIPOS_ASUETO.every(t => alcance[t.id])

  function toggle(id) { setAlcance(a => ({ ...a, [id]: !a[id] })) }
  function setTodo() { setAlcance(alcanceCompleto(!todo)) }
  function add() {
    if (!fecha || !algo) return
    onAdd(fecha, alcance)
    setFecha('')
    setAlcance(alcanceCompleto())
  }

  const fmt = s => { const d = new Date(s + 'T12:00:00'); return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}` }

  return (
    <Modal open onClose={onClose} ariaLabel="Días de asueto" variant="sheet" size="md" z={50} padding="p-0" className="flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-outline-variant flex-shrink-0">
          <div className="flex items-center gap-2">
            <CalendarOff size={ICONO.md} className="text-amber-600" />
            <h2 className="font-semibold text-on-surface">Días de asueto</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="size-control inline-flex items-center justify-center text-muted hover:text-error rounded-full"><X size={ICONO.md} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          <p className="text-sm text-muted">
            Marca un día como asueto y elige a qué afecta. Lo marcado <strong>no se permitirá</strong> ese día:
            los bloques de clase se omiten al programar, no se podrán crear eventos ni actividades,
            y no se pasará lista. Puedes combinarlos: por ejemplo, suspender clases pero seguir pasando lista.
          </p>

          {/* Alta de asueto */}
          <div className="rounded-card border border-outline-variant p-3 space-y-3">
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-muted uppercase tracking-wide">Fecha</span>
              <EFDateTimePicker mode="date" value={fecha} onChange={setFecha} etiqueta="Elige el día" clearable showShortcuts={false} />
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-muted uppercase tracking-wide">¿A qué afecta?</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button" onClick={setTodo}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors min-h-control-sm ${todo ? 'bg-amber-500 text-white border-amber-500' : 'border-outline-variant text-muted hover:bg-amber-50'}`}
                >
                  Todo
                </button>
                {TIPOS_ASUETO.map(t => (
                  <button
                    key={t.id} type="button" onClick={() => toggle(t.id)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors min-h-control-sm ${alcance[t.id] ? 'bg-amber-100 text-amber-800 border-amber-300' : 'border-outline-variant text-muted hover:bg-surface'}`}
                  >
                    {alcance[t.id] ? '✓ ' : ''}{t.label}
                  </button>
                ))}
              </div>
              {!algo && <p className="text-xs text-error">Elige al menos un tipo.</p>}
            </div>
            <button
              type="button" onClick={add} disabled={!fecha || !algo}
              className="w-full py-2 bg-amber-600 text-white rounded text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2 hover:bg-amber-700 transition-colors"
            >
              <Plus size={ICONO.sm} /> Agregar día de asueto
            </button>
          </div>

          {/* Lista */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted uppercase tracking-wide">
              Días marcados ({lista.length})
            </span>
            {lista.length === 0 ? (
              <p className="text-sm text-muted py-2">Aún no has marcado ningún día de asueto.</p>
            ) : lista.map(a => (
              <div key={a.id} className="flex items-center gap-2 px-3 py-2 rounded-card border border-outline-variant bg-amber-50/50">
                <CalendarOff size={ICONO.sm} className="text-amber-600 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-on-surface">{fmt(a.fecha)}</p>
                  <p className="text-xs text-muted">Sin: {alcanceAsuetoTexto(a)}</p>
                </div>
                <button
                  type="button" onClick={() => onRemove(a.id)}
                  className="size-control inline-flex items-center justify-center text-muted hover:text-error rounded-full transition-colors flex-shrink-0"
                  data-tooltip="Quitar" aria-label="Quitar"
                >
                  <Trash2 size={ICONO.sm} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-outline-variant px-4 py-3 flex justify-end flex-shrink-0">
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
    </Modal>
  )
}

// ─── Administrador de vacaciones ────────────────────────────────────────────
// Igual que AsuetoManager, pero para un PERIODO (fechaInicio–fechaFin) en vez
// de un solo día. El docente elige el rango y a qué afecta (clases, eventos,
// actividades, asistencias) — el mismo alcance que en Días de asueto.
export function VacacionManager({ vacaciones, onAdd, onRemove, onClose }) {
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')
  const [alcance, setAlcance] = useState(alcanceCompleto)

  const lista = [...vacaciones].sort((a, b) => (a.fechaInicio || '').localeCompare(b.fechaInicio || ''))
  const algo = TIPOS_ASUETO.some(t => alcance[t.id])
  const todo = TIPOS_ASUETO.every(t => alcance[t.id])
  const rangoValido = !!(fechaInicio && fechaFin && fechaFin >= fechaInicio)

  function toggle(id) { setAlcance(a => ({ ...a, [id]: !a[id] })) }
  function setTodo() { setAlcance(alcanceCompleto(!todo)) }
  function add() {
    if (!rangoValido || !algo) return
    onAdd(fechaInicio, fechaFin, alcance)
    setFechaInicio('')
    setFechaFin('')
    setAlcance(alcanceCompleto())
  }

  const fmt = s => { const d = new Date(s + 'T12:00:00'); return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}` }

  return (
    <Modal open onClose={onClose} ariaLabel="Vacaciones" variant="sheet" size="md" z={50} padding="p-0" className="flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-outline-variant flex-shrink-0">
          <div className="flex items-center gap-2">
            <CalendarRange size={ICONO.md} className="text-amber-600" />
            <h2 className="font-semibold text-on-surface">Vacaciones</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="size-control inline-flex items-center justify-center text-muted hover:text-error rounded-full"><X size={ICONO.md} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          <p className="text-sm text-muted">
            Marca un periodo de vacaciones y elige a qué afecta. Lo marcado <strong>no se permitirá</strong> ningún
            día del periodo: los bloques de clase se omiten al programar, y no se podrán crear eventos (ni
            actividades) en esos días.
          </p>

          {/* Alta de vacaciones */}
          <div className="rounded-card border border-outline-variant p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-muted uppercase tracking-wide">Inicio</span>
                <EFDateTimePicker mode="date" value={fechaInicio} onChange={setFechaInicio} etiqueta="Inicio" clearable showShortcuts={false} />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-muted uppercase tracking-wide">Fin</span>
                <EFDateTimePicker mode="date" value={fechaFin} onChange={setFechaFin} etiqueta="Fin" clearable showShortcuts={false} />
              </div>
            </div>
            {fechaInicio && fechaFin && fechaFin < fechaInicio && (
              <p className="text-sm text-error">La fecha de fin debe ser igual o posterior a la de inicio.</p>
            )}
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-muted uppercase tracking-wide">¿A qué afecta?</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button" onClick={setTodo}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors min-h-control-sm ${todo ? 'bg-amber-500 text-white border-amber-500' : 'border-outline-variant text-muted hover:bg-amber-50'}`}
                >
                  Todo
                </button>
                {TIPOS_ASUETO.map(t => (
                  <button
                    key={t.id} type="button" onClick={() => toggle(t.id)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors min-h-control-sm ${alcance[t.id] ? 'bg-amber-100 text-amber-800 border-amber-300' : 'border-outline-variant text-muted hover:bg-surface'}`}
                  >
                    {alcance[t.id] ? '✓ ' : ''}{t.label}
                  </button>
                ))}
              </div>
              {!algo && <p className="text-xs text-error">Elige al menos un tipo.</p>}
            </div>
            <button
              type="button" onClick={add} disabled={!rangoValido || !algo}
              className="w-full py-2 bg-amber-600 text-white rounded text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2 hover:bg-amber-700 transition-colors"
            >
              <Plus size={ICONO.sm} /> Agregar periodo de vacaciones
            </button>
          </div>

          {/* Lista */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted uppercase tracking-wide">
              Periodos marcados ({lista.length})
            </span>
            {lista.length === 0 ? (
              <p className="text-sm text-muted py-2">Aún no has marcado ningún periodo de vacaciones.</p>
            ) : lista.map(v => (
              <div key={v.id} className="flex items-center gap-2 px-3 py-2 rounded-card border border-outline-variant bg-amber-50/50">
                <CalendarRange size={ICONO.sm} className="text-amber-600 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-on-surface">{fmt(v.fechaInicio)} – {fmt(v.fechaFin)}</p>
                  <p className="text-xs text-muted">Sin: {alcanceAsuetoTexto(v)}</p>
                </div>
                <button
                  type="button" onClick={() => onRemove(v.id)}
                  className="size-control inline-flex items-center justify-center text-muted hover:text-error rounded-full transition-colors flex-shrink-0"
                  data-tooltip="Quitar" aria-label="Quitar"
                >
                  <Trash2 size={ICONO.sm} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-outline-variant px-4 py-3 flex justify-end flex-shrink-0">
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
    </Modal>
  )
}
