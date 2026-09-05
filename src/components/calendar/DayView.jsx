import { useState, useEffect, useRef } from 'react'
import { Lock, LockOpen, Bell } from 'lucide-react'
import { assignLanes } from '../../utils/calendarEvents'
import { timeToMinutes, bloqueColor, toDateStr } from '../../utils/horarioBloques'
import { subjectDisplayName } from '../../utils/subjectName'
import { formatHora12 } from '../../utils/formatHora'
import { isToday } from '../../utils/calendarGrid'
import { IS_NATIVE_APP } from '../../utils/platform'
import { usePointerDrag } from '../../hooks/usePointerDrag'

// Altura fija por hora — igual que AGENDA_ROW_H en CalendarPage.jsx.
const ROW_H = 64

// Los eventos se sueltan alineados a 15 min, igual que en las vistas del
// docente. Ahí estos dos ayudantes son locales de CalendarPage.jsx; aquí se
// repiten a propósito para no arrastrar a esta vista una dependencia de la
// página del docente (son cinco líneas puras, sin estado).
const SNAP_MIN = 15
function minutesToTimeStr(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ─── DayView ──────────────────────────────────────────────────────────────────
//
// Vista de día que reemplaza a AgendaView en la Agenda del estudiante.
// Arquitectura deliberadamente sin position:fixed, sticky, overflow en el
// contenedor raíz, touchAction global ni listeners en window — el scroll lo
// maneja el ancestro scrollable (la página o el body); DayView solo renderiza
// su contenido a altura determinística en px y deja que el flujo normal haga
// el resto. La única excepción es el fantasma del arrastre, que va `fixed`
// fuera de la rejilla (mismo patrón que AgendaView).
//
// Arrastre: solo los eventos personales del estudiante (`ev.editable`) se
// pueden mover, y solo de hora dentro del mismo día — cambiar de día se hace
// desde Semana o Mes, igual que en AgendaView. Los bloques de clase y las
// fechas límite nunca se arrastran. Toda la mecánica (umbral de 5 px en web,
// long press de 450 ms en la app, y la cancelación por scroll a los 8 px)
// vive en usePointerDrag, no aquí.
export default function DayView({
  date, events, bloques, subjects,
  dayStart, dayEnd,
  onEventClick, onSlotClick, onMoveEvent,
  // editableBloques — la recibe la Agenda del estudiante siempre en false (sus
  // clases no se mueven) y aquí ni siquiera hace falta leerla: el arrastre se
  // limita a los eventos con `editable`. Se deja documentada, sin destructurar.
}) {
  const dateStr = toDateStr(date)
  const hours = Array.from({ length: dayEnd - dayStart }, (_, i) => i + dayStart)
  // gridH es un entero en px; no depende del viewport.
  const gridH = hours.length * ROW_H

  // Línea de hora actual — se actualiza cada minuto.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const showNowLine = isToday(date) && nowMins >= dayStart * 60 && nowMins <= dayEnd * 60
  const nowLineTop = ((nowMins - dayStart * 60) / 60) * ROW_H

  // Separar eventos del día.
  const dayBloques = bloques.filter(b => b.fecha === dateStr)
  const timedEvs   = events.filter(ev => ev.dateStr === dateStr && ev.timeStr)
  const allDayEvs  = events.filter(ev => ev.dateStr === dateStr && !ev.timeStr)

  // Construir items para asignación de carriles.
  const rawItems = [
    ...dayBloques.map(b => ({
      kind: 'bloque', id: b.id,
      start: timeToMinutes(b.horaInicio),
      end: Math.max(timeToMinutes(b.horaFin), timeToMinutes(b.horaInicio) + 20),
      b,
    })),
    ...timedEvs.map(ev => {
      const start = timeToMinutes(ev.timeStr)
      // Altura visual mínima: más alta para deadline/publicacion (llevan más texto).
      const minVisual = (ev.tipo === 'deadline' || ev.tipo === 'publicacion') ? 75 : 40
      let end = start + minVisual
      if (ev.endTimeStr && ev.endDateStr === dateStr) {
        const e = timeToMinutes(ev.endTimeStr)
        if (e > start + minVisual) end = e
      }
      return { kind: 'event', id: ev.id, start, end, ev }
    }),
  ]
  const placed = assignLanes(rawItems)

  // Ancho del gutter — constante en px, no porcentaje ni viewport.
  const gutterW = IS_NATIVE_APP ? 44 : 80

  // Solo los eventos personales del estudiante se mueven. Los bloques de clase
  // y las actividades (deadline/publicacion) llegan con `editable` ausente.
  const isMovable = it => it.kind === 'event' && !!it.ev.editable

  const gridRef = useRef(null)

  const { drag, startDrag: startDragRaw } = usePointerDrag((d, e) => {
    const { item } = d
    if (!d.moved) {
      // Tap (y, en la app, cualquier toque que no llegó a long press):
      // abrir el editor del evento, que es lo que hacía el onClick.
      onEventClick?.(item.ev)
      return
    }
    // ¿Soltó sobre la rejilla? → nueva hora, mismo día. Cambiar de día se hace
    // desde Semana o Mes, donde sí se puede soltar sobre otra columna/celda.
    const g = gridRef.current?.getBoundingClientRect()
    if (g && e.clientX >= g.left && e.clientX < g.right) {
      // Se usa el borde SUPERIOR del bloque (no el dedo), para que el evento
      // caiga donde el usuario lo ve, no donde lo agarró.
      const blockTop = e.clientY - d.grabDY
      let mins = Math.round(((blockTop - g.top) / ROW_H * 60 + dayStart * 60) / SNAP_MIN) * SNAP_MIN
      mins = Math.max(dayStart * 60, Math.min(dayEnd * 60 - SNAP_MIN, mins))
      const hora = minutesToTimeStr(mins)
      if (hora !== item.ev.timeStr) onMoveEvent?.(item.ev.rawEvent, dateStr, hora)
    }
  })

  function startDrag(e, it) {
    if (!isMovable(it)) return
    startDragRaw(e, { item: it })
  }

  return (
    <div>
      {/* Eventos sin hora — franja encima de la rejilla */}
      {allDayEvs.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--outline-variant)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {allDayEvs.map(ev => (
            <button
              key={ev.id}
              type="button"
              onClick={() => onEventClick?.(ev)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                background: ev.bg, color: ev.text,
                padding: '4px 8px', borderRadius: 4,
                fontSize: IS_NATIVE_APP ? 11 : 13,
                cursor: 'pointer',
              }}
            >
              {ev.titulo}
            </button>
          ))}
        </div>
      )}

      {/* Rejilla de tiempo */}
      <div style={{ display: 'flex' }}>

        {/* ── Gutter de horas ──────────────────────────────────────────────── */}
        {/* flexShrink:0 garantiza que el gutter nunca se comprima aunque el
            contenedor padre sea más angosto de lo esperado — elimina el recorte
            del primer carácter de la hora que se veía en Android. */}
        <div style={{ width: gutterW, flexShrink: 0, position: 'relative', height: gridH }}>
          {hours.map((h, i) => {
            const formatted = formatHora12(`${String(h).padStart(2, '0')}:00`)
            const spaceIdx  = formatted.lastIndexOf(' ')
            const hNum      = formatted.slice(0, spaceIdx)   // e.g. "7:00"
            const periodo   = formatted.slice(spaceIdx + 1)  // e.g. "am"
            return (
              <div
                key={h}
                style={{
                  position: 'absolute',
                  top: i * ROW_H + ROW_H / 2,
                  transform: 'translateY(-50%)',
                  width: '100%',
                  textAlign: IS_NATIVE_APP ? 'center' : 'right',
                  paddingRight: IS_NATIVE_APP ? 0 : 8,
                  color: 'var(--on-surface-variant)',
                  lineHeight: 1.2,
                  pointerEvents: 'none',
                }}
              >
                <span style={{ display: 'block', fontSize: IS_NATIVE_APP ? 10 : 12, fontWeight: 500 }}>{hNum}</span>
                <span style={{ display: 'block', fontSize: IS_NATIVE_APP ? 9 : 10, opacity: 0.7 }}>{periodo}</span>
              </div>
            )
          })}
        </div>

        {/* ── Grid de eventos ──────────────────────────────────────────────── */}
        {/* minWidth:0 evita que el flex child desborde el contenedor padre
            cuando algún texto interno es largo — sin él, el grid puede empujar
            el gutter fuera de pantalla y generar overflow horizontal. */}
        <div
          ref={gridRef}
          style={{
            flex: 1,
            minWidth: 0,
            position: 'relative',
            height: gridH,
            borderLeft: '1px solid var(--outline-variant)',
          }}
        >
          {/* Botones de slot — uno por hora, transparentes, para crear evento */}
          {hours.map((h, i) => (
            <button
              key={h}
              type="button"
              onClick={() => onSlotClick?.(dateStr, `${String(h).padStart(2, '0')}:00`)}
              aria-label={`Crear evento a las ${formatHora12(`${String(h).padStart(2, '0')}:00`)}`}
              style={{
                position: 'absolute', left: 0, right: 0,
                top: i * ROW_H, height: ROW_H,
                borderBottom: '1px solid var(--outline-variant)',
                background: 'transparent', padding: 0, cursor: 'pointer',
              }}
            />
          ))}

          {/* Línea de hora actual */}
          {showNowLine && (
            <div
              style={{ position: 'absolute', left: 0, right: 0, top: nowLineTop, pointerEvents: 'none', zIndex: 10 }}
            >
              <div style={{ height: 3, background: 'var(--accent)' }} />
              <div style={{ height: 28, background: 'linear-gradient(to bottom, color-mix(in srgb, var(--accent) 40%, transparent), transparent)' }} />
            </div>
          )}

          {/* Mensaje de día sin eventos */}
          {placed.length === 0 && allDayEvs.length === 0 && (
            <div style={{ position: 'absolute', top: 24, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
              <p style={{ fontSize: '14px', color: 'var(--on-surface-variant)' }}>No hay clases ni eventos este día</p>
              <p style={{ fontSize: '12px', color: 'var(--on-surface-variant)', opacity: 0.6, marginTop: 2 }}>
                Haz clic en una hora para crear un evento
              </p>
            </div>
          )}

          {/* ── Items posicionados ─────────────────────────────────────────── */}
          {placed.map(({ it, lane, total }) => {
            const rawTop = ((it.start - dayStart * 60) / 60) * ROW_H
            const height = Math.max(34, ((it.end - it.start) / 60) * ROW_H - 6)
            const top    = Math.max(0, Math.min(rawTop, gridH - height))
            const w      = 100 / total
            const colLeft = lane * w

            const isCancelada = it.kind === 'bloque' && it.b.cancelada
            const movable    = isMovable(it)
            const isDragging = drag?.moved && drag.item.id === it.id
            let bg, fg, titulo, sub, horaIni, horaFin

            if (it.kind === 'bloque') {
              const pal = bloqueColor(it.b.color)
              bg = pal.bg; fg = pal.text
              titulo  = subjectDisplayName(subjects[it.b.asignaturaId]) || 'Clase'
              sub     = isCancelada
                ? (it.b.lugar ? `Cancelada · ${it.b.lugar}` : 'Cancelada')
                : it.b.lugar
              horaIni = it.b.horaInicio
              horaFin = it.b.horaFin
            } else {
              bg = it.ev.bg; fg = it.ev.text
              titulo  = it.ev.titulo
              sub     = it.ev.subtitulo
              horaIni = it.ev.timeStr
              horaFin = (it.ev.endTimeStr && it.ev.endDateStr === dateStr && it.ev.endTimeStr !== it.ev.timeStr)
                ? it.ev.endTimeStr : null
            }

            return (
              <button
                key={it.id}
                type="button"
                onPointerDown={movable ? e => { e.stopPropagation(); startDrag(e, it) } : undefined}
                // El onClick se instala SOLO en los no movibles. En un evento
                // movible el editor se abre desde la rama `!d.moved` del
                // onDrop, para que un arrastre no dispare además el clic.
                // stopPropagation en todos los casos: impide que el slot
                // transparente de debajo capture el tap aunque este botón no
                // tenga acción (bloques no editables en la agenda del alumno).
                onClick={!movable ? e => {
                  e.stopPropagation()
                  if (it.kind === 'event') onEventClick?.(it.ev)
                } : undefined}
                style={{
                  position: 'absolute',
                  top, height,
                  left: `calc(${colLeft}% + 3px)`,
                  width: `calc(${w}% - 6px)`,
                  background: bg, color: fg,
                  borderRadius: 6,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                  padding: 0, textAlign: 'left', display: 'block',
                  cursor: movable ? 'grab' : (it.kind === 'event' ? 'pointer' : 'default'),
                  opacity: isDragging ? 0.3 : (isCancelada ? 0.55 : 1),
                  zIndex: 1,
                  overflow: 'hidden',
                  // Sobre lo NO movible el navegador maneja el scroll libremente
                  // en la app; sobre lo movible se le quita el gesto para que el
                  // arrastre sea nuestro. Misma fórmula que AgendaView.
                  touchAction: IS_NATIVE_APP && !movable ? 'auto' : 'none',
                }}
              >
                <div style={{ display: 'flex', height: '100%' }}>
                  {/* Columna de horas — solo cuando no hay demasiados carriles */}
                  {total < 3 && (
                    <div style={{
                      flexShrink: 0,
                      width: IS_NATIVE_APP ? 60 : 70,
                      textAlign: 'right',
                      padding: '6px 6px 6px 4px',
                      borderRight: `1px solid ${fg}22`,
                      display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    }}>
                      <span style={{ display: 'block', fontWeight: 700, lineHeight: 1.2, fontSize: IS_NATIVE_APP ? 10 : 12, whiteSpace: 'nowrap' }}>
                        {formatHora12(horaIni)}
                      </span>
                      {horaFin && (
                        <span style={{ display: 'block', opacity: 0.7, lineHeight: 1.2, fontSize: IS_NATIVE_APP ? 9 : 11, whiteSpace: 'nowrap' }}>
                          {formatHora12(horaFin)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Columna de texto */}
                  <div style={{ flex: 1, minWidth: 0, padding: '6px 8px 6px 10px', overflow: 'hidden' }}>
                    {/* Hora compacta cuando hay 3+ carriles */}
                    {total >= 3 && (
                      <span style={{ display: 'block', fontWeight: 700, lineHeight: 1.2, fontSize: IS_NATIVE_APP ? 10 : 12, whiteSpace: 'nowrap' }}>
                        {formatHora12(horaIni)}
                      </span>
                    )}
                    {/* Título */}
                    <span style={{
                      display: 'block', fontWeight: 600, lineHeight: 1.3,
                      fontSize: IS_NATIVE_APP ? 10 : 13,
                      ...(total >= 3
                        ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                        : { overflowWrap: 'break-word' }),
                      textDecoration: isCancelada ? 'line-through' : 'none',
                    }}>
                      {titulo}
                    </span>
                    {/* Subtítulo — solo cuando cabe (≤2 carriles) */}
                    {sub && total < 3 && (
                      <span style={{
                        display: 'block', opacity: 0.75, lineHeight: 1.2,
                        fontSize: IS_NATIVE_APP ? 10 : 11,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {sub}
                      </span>
                    )}
                    {/* Badge de estado para actividades con fecha límite */}
                    {it.kind === 'event' && it.ev.tipo === 'deadline' && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '10px', opacity: 0.85, lineHeight: 1.2, marginTop: 2 }}>
                        {it.ev.cierraEnFecha ? <Lock size={11} /> : <LockOpen size={11} />}
                        {it.ev.estado?.label}
                      </span>
                    )}
                    {/* Badge de alarma en bloques de clase */}
                    {it.kind === 'bloque' && it.b.alarma?.activa && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '10px', opacity: 0.7, lineHeight: 1.2, marginTop: 2 }}>
                        <Bell size={11} /> {it.b.alarma.minutosAntes} min antes
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Fantasma que sigue al dedo/cursor mientras se arrastra. Va `fixed`
          FUERA de la rejilla —única excepción a la regla de esta vista— para
          que no lo recorte el overflow de ningún ancestro. Mismo patrón que
          AgendaView. */}
      {drag?.moved && (
        <div
          style={{
            position: 'fixed',
            left: drag.x - drag.grabDX,
            top:  drag.y - drag.grabDY,
            width: drag.w, height: drag.h,
            background: drag.item.ev.bg, color: drag.item.ev.text,
            borderRadius: 6,
            padding: '6px 8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            opacity: 0.9,
            pointerEvents: 'none',
            overflow: 'hidden',
            zIndex: 50,
          }}
        >
          <span style={{
            display: 'block', fontWeight: 600, lineHeight: 1.3,
            fontSize: IS_NATIVE_APP ? 10 : 13,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {drag.item.ev.titulo}
          </span>
        </div>
      )}
    </div>
  )
}
