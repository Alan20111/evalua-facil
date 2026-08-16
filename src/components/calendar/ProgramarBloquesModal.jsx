import { useState, useMemo, useEffect } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import { subjectDisplayName } from '../../utils/subjectName'
import { ArrowRight, CalendarPlus, Pencil, Trash2 } from 'lucide-react'
import { BLOQUE_COLORS } from '../../utils/horarioBloques'
import { formatLongDate } from '../../utils/dateRange'
import Select from '../ui/Select'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'

// Ventana de configuración de una programación (paso 1 de 2).
//
//  - mode 'crear':      se elige la asignatura y todos los parámetros.
//  - mode 'modificar':  la asignatura ya está fija (no se elige); el docente
//                       puede cambiar fechas, duración, bloques/semana, color y
//                       alarma de TODA la asignatura (útil p. ej. para recolorear
//                       todos sus bloques de una vez).
//
// Los días de asueto ya NO se definen aquí: se administran globalmente desde el
// botón "Días de asueto" del calendario.

export default function ProgramarBloquesModal({
  subjects, subjectsDisponibles = null, mode = 'crear', initial = null, subjectName = '',
  onClose, onContinue, onDeleteAll, onIrAsignatura,
}) {
  const toast = useToast()
  const esModificar = mode === 'modificar'

  const [asignaturaId, setAsignaturaId] = useState(initial?.asignaturaId || '')

  // Si la asignatura ya tiene fechas de curso (Dashboard/SubjectPage → "Nueva
  // asignatura" / "Editar asignatura"), el horario las reutiliza y no las
  // vuelve a preguntar — evita que queden desincronizadas de las fechas que
  // ya alimentan las asistencias automáticas (ver utils/attendanceAuto.js).
  const targetSubject = esModificar ? subjects[initial?.asignaturaId] : subjects[asignaturaId]
  const fechasDelCurso = !!(targetSubject?.fechaInicio && targetSubject?.fechaFin)
  // Sin fechas en la asignatura NO se programa: antes se pedían aquí, y eso
  // dejaba el horario con un rango propio mientras la asignatura seguía sin
  // fechas — y sin fechas no hay parciales por periodo ni asistencia
  // automática. Se manda a definirlas donde de verdad viven.
  const faltanFechasCurso = !!targetSubject && !fechasDelCurso

  const [fechaInicio, setFechaInicio] = useState(initial?.fechaInicio || targetSubject?.fechaInicio || '')
  const [fechaFin, setFechaFin] = useState(initial?.fechaFin || targetSubject?.fechaFin || '')
  // En modo 'crear', la asignatura se elige DESPUÉS de montar el modal — al
  // seleccionarla, si ya tiene fechas de curso, se copian aquí (una sola vez
  // por selección; el docente no las edita en ese caso).
  useEffect(() => {
    if (targetSubject?.fechaInicio && targetSubject?.fechaFin) {
      setFechaInicio(targetSubject.fechaInicio)
      setFechaFin(targetSubject.fechaFin)
    }
  }, [targetSubject?.fechaInicio, targetSubject?.fechaFin])
  const [duracionMin, setDuracionMin] = useState(initial?.duracionMin || 60)
  const [bloquesPorSemana, setBloquesPorSemana] = useState(initial?.bloquesPorSemana || 1)
  const [color, setColor] = useState(initial?.color || 'blue')
  // Se mantiene sin exponer en este modal — solo se pasa tal cual para no
  // borrar el valor con el que se generaron los bloques la primera vez (ese
  // sistema viejo de alarma por sonido/minutos ya no tiene una pantalla de
  // edición individual). La casilla de abajo (notificarClase) es el sistema
  // nuevo: push real vía la configuración global de Notificaciones.
  const [alarma] = useState(initial?.alarma || { activa: false, sonido: 'campana', minutosAntes: 10 })
  const [confirmDel, setConfirmDel] = useState(false)

  // Notificarme antes de clase — a diferencia de `alarma` (viejo, por bloque,
  // solo suena con la pestaña/app abierta), esto es un ajuste POR ASIGNATURA
  // que se guarda directo en subjects/{id} y alimenta el sistema de push real
  // (recordatorioClase en NotificationSettings.jsx + localReminders.js filtra
  // por este campo). Por defecto true: hoy TODAS las asignaturas se
  // consideran si no se ha guardado nada distinto.
  const [notificarClase, setNotificarClase] = useState(() => subjects[asignaturaId]?.notificarClase ?? true)
  useEffect(() => {
    if (!esModificar) setNotificarClase(subjects[asignaturaId]?.notificarClase ?? true)
  }, [asignaturaId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleNotificarClase() {
    const targetId = esModificar ? initial?.asignaturaId : asignaturaId
    if (!targetId) return
    const next = !notificarClase
    setNotificarClase(next)
    try {
      await updateDoc(doc(db, 'subjects', targetId), { notificarClase: next })
    } catch (err) {
      setNotificarClase(!next)
      toast('Error al guardar: ' + err.message, 'error')
    }
  }

  // Botón atrás físico (Android): si está pidiendo confirmación de borrado,
  // solo la cancela (no cierra todo el modal). El cierre del modal en sí lo
  // maneja CalendarPage con useBackHandler(() => setProgramar(null), ...).
  useBackHandler(() => setConfirmDel(false), confirmDel)

  // Este componente solo se monta mientras está abierto (lo controla el padre).
  useScrollLock(true)

  // En modo "crear" solo se listan asignaturas SIN programar.
  const subjectList = useMemo(
    () => (subjectsDisponibles || Object.values(subjects)).slice().sort((a, b) =>
      subjectDisplayName(a).localeCompare(subjectDisplayName(b))),
    [subjects, subjectsDisponibles],
  )
  const sinDisponibles = !esModificar && subjectList.length === 0

  function handleContinue() {
    if (!esModificar && !asignaturaId) { toast('Selecciona una asignatura', 'error'); return }
    if (faltanFechasCurso) {
      toast('Primero define las fechas de inicio y fin en la asignatura', 'error'); return
    }
    if (!fechaInicio || !fechaFin) { toast('Indica la fecha de inicio y de finalización', 'error'); return }
    if (fechaFin < fechaInicio) { toast('La fecha de finalización debe ser posterior a la de inicio', 'error'); return }
    if (!duracionMin || duracionMin < 5) { toast('La duración debe ser de al menos 5 minutos', 'error'); return }
    if (!bloquesPorSemana || bloquesPorSemana < 1) { toast('Indica cuántos bloques por semana', 'error'); return }
    onContinue?.({
      asignaturaId, fechaInicio, fechaFin,
      duracionMin, bloquesPorSemana, color, alarma,
    })
  }

  const label = (txt) => <label className="text-xs font-semibold text-muted uppercase tracking-wide">{txt}</label>
  const inputCls = 'px-2.5 py-1.5 rounded border border-outline-variant text-sm bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 border-none cursor-default"
        onClick={onClose}
        aria-label="Cerrar"
      />
      <div
        className={`relative bg-surface-card rounded-t-card md:rounded-card shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col ${esModificar ? 'ring-4 ring-amber-400 ring-inset' : ''}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-outline-variant flex-shrink-0"
          style={esModificar ? { background: '#fef3c7' } : undefined}>
          <div className="flex items-center gap-2 min-w-0">
            {esModificar ? <Pencil size={18} className="text-amber-600" /> : <CalendarPlus size={18} className="text-accent" />}
            <h2 className="font-semibold text-on-surface truncate">
              {esModificar ? `Modificar bloques de ${subjectName}` : 'Programar bloques de clase por asignatura'}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1 text-muted hover:text-error rounded transition-colors">
            <ArrowRight size={18} className="rotate-90 md:rotate-0 hidden" />
            <span className="text-xl leading-none">×</span>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-5">

          {/* Asignatura */}
          {esModificar ? (
            <div className="space-y-1.5">
              {label('Asignatura')}
              <div className="px-2.5 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface font-medium">
                {subjectName}
              </div>
              <p className="text-xs text-muted">Estás modificando toda esta asignatura. Al guardar se reemplazan sus bloques de clases que muevas, para todo el rango de fechas.</p>
            </div>
          ) : sinDisponibles ? (
            <div className="rounded-card border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Ya no hay asignaturas por programar: todas tienen su programación.
              Para cambiar una, usa <strong>Modificar bloques</strong>; si quieres reprogramarla
              desde cero, ábrela en Modificar y borra su programación.
            </div>
          ) : (
            <div className="space-y-1.5">
              {label('Asignatura')}
              <Select
                value={asignaturaId}
                onChange={setAsignaturaId}
                options={[
                  { value: '', label: 'Elige una asignatura…' },
                  ...subjectList.map(s => ({ value: s.id, label: subjectDisplayName(s) })),
                ]}
              />
            </div>
          )}

          {!sinDisponibles && <>

          {/* Rango de fechas — fijo (tomado del curso) si la asignatura ya
              tiene fechaInicio/fechaFin configuradas; si no, se piden aquí. */}
          <div className="space-y-1.5">
            {/* El helper `label` aplica `uppercase` a todo; el paréntesis lleva
                `normal-case` para que se lea tal cual, no gritado. */}
            {label(<>Rango de fechas <span className="normal-case font-normal">(Duración de la asignatura)</span></>)}
            {fechasDelCurso ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="px-2.5 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface font-medium">{formatLongDate(fechaInicio)}</div>
                  <div className="px-2.5 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface font-medium">{formatLongDate(fechaFin)}</div>
                </div>
                <p className="text-xs text-muted">Son las fechas de inicio y fin del curso — se cambian editando la asignatura, no aquí.</p>
              </>
            ) : faltanFechasCurso ? (
              <div className="rounded-card border border-amber-300 bg-amber-50 p-3 space-y-2">
                <p className="text-sm text-amber-900">
                  Edita la asignatura para definir fechas y regresa aquí para poder continuar.
                </p>
                <button
                  type="button"
                  onClick={() => onIrAsignatura?.(esModificar ? initial?.asignaturaId : asignaturaId)}
                  className="w-full py-2 rounded bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 transition-colors"
                >
                  Editar asignatura
                </button>
              </div>
            ) : (
              <p className="text-xs text-muted">Elige primero una asignatura.</p>
            )}
          </div>

          {/* Duración + bloques por semana.
              `items-end` alinea las dos cajas por abajo: la etiqueta de la
              izquierda es más larga y, si se parte en dos renglones, sin esto
              su campo bajaba y quedaban desparejos. */}
          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              {label('Duración del bloque (min)')}
              <input
                type="number" min={5} step={5}
                value={duracionMin}
                onChange={e => setDuracionMin(Number(e.target.value))}
                className={`${inputCls} w-full`}
              />
            </div>
            <div className="space-y-1.5">
              {label('Bloques por semana')}
              <input
                type="number" min={1} max={20}
                value={bloquesPorSemana}
                onChange={e => setBloquesPorSemana(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                className={`${inputCls} w-full`}
              />
            </div>
          </div>
          {/* En rojo (pedido explícito): es lo que más se malentiende — que un
              bloque colocado no es una clase suelta, sino el patrón que se
              repite cada semana hasta la fecha de fin de la asignatura. */}
          <p className={`text-xs -mt-3 ${esModificar ? 'text-muted' : 'text-error'}`}>
            {esModificar
              ? 'En el siguiente paso reacomodas los bloques en la semana.'
              : `En el siguiente paso colocarás estos ${bloquesPorSemana} bloque(s) en los días y horas de la semana que tú elijas; y se repetirán de forma automática semana a semana, hasta la fecha de finalización que has establecido para la asignatura arriba en Rango de fechas.`}
          </p>

          {/* Color */}
          <div className="space-y-1.5">
            {label(esModificar ? 'Color de los bloques' : 'Color de los bloques (por defecto)')}
            <div className="flex flex-wrap gap-2">
              {BLOQUE_COLORS.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColor(c.id)}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${color === c.id ? 'border-on-surface scale-110' : 'border-transparent'}`}
                  style={{ background: c.bg }}
                  data-tooltip={c.label}
                  aria-label={c.label}
                />
              ))}
            </div>
            {esModificar && (
              <p className="text-xs text-muted">Si cambias el color aquí, se aplica a todos los bloques de la asignatura.</p>
            )}
          </div>

          {/* Notificarme antes de clase — guarda directo en la asignatura,
              independiente de "Continuar" (como las demás casillas
              "Notificarme cuando..." de la app). El aviso en sí usa la
              anticipación y el sonido que ya configuraste en Notificaciones. */}
          <div className="flex items-start gap-3 p-3 bg-slate-50 rounded border border-outline-variant">
            <input
              type="checkbox"
              id="notificar-clase"
              checked={notificarClase}
              onChange={toggleNotificarClase}
              disabled={!esModificar && !asignaturaId}
              className="mt-1"
            />
            <label htmlFor="notificar-clase" className="text-sm font-medium text-on-surface cursor-pointer flex-1">
              Notificarme antes de que empiecen las clases de esta asignatura
              <span className="text-muted text-xs block mt-0.5">Aviso para el celular donde tengas instalada la app Evalúa Fácil, según la anticipación que configures en Notificaciones</span>
            </label>
          </div>

          {/* Borrar toda la programación (solo al modificar) */}
          {esModificar && (
            <div className="pt-1 border-t border-outline-variant">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide pt-3 pb-1.5">Zona de riesgo</p>
              {confirmDel ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-card bg-error/10 border border-error/30">
                  <span className="text-xs text-error flex-1">
                    ¿Borrar TODA la programación de {subjectName}? La asignatura quedará libre para programarse de nuevo.
                  </span>
                  <button type="button" onClick={() => setConfirmDel(false)} className="text-xs text-muted px-2 py-1">Cancelar</button>
                  <button type="button" onClick={() => onDeleteAll?.(initial?.asignaturaId)} className="text-xs bg-error text-white rounded px-2.5 py-1 font-medium">Borrar</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDel(true)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-card text-sm text-error border border-error/30 hover:bg-error/10 transition-colors"
                >
                  <Trash2 size={15} /> Borrar toda la programación de esta asignatura
                </button>
              )}
            </div>
          )}

          </>}
        </div>

        {/* Footer */}
        <div className="border-t border-outline-variant px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-muted flex-1">{sinDisponibles ? '' : 'Paso 1 de 2 · configuración'}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm text-muted rounded border border-outline-variant hover:bg-surface transition-colors"
          >
            {sinDisponibles ? 'Cerrar' : 'Cancelar'}
          </button>
          {!sinDisponibles && (
            <button
              type="button"
              onClick={handleContinue}
              disabled={faltanFechasCurso}
              className={`px-4 py-2 text-white rounded text-sm font-semibold flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${esModificar ? 'bg-amber-600 hover:bg-amber-700' : 'bg-accent hover:bg-accent-hover'}`}
            >
              Continuar <ArrowRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
