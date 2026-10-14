import { useState, useMemo } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import { subjectDisplayName } from '../../utils/subjectName'
import { ArrowRight, Trash2 } from 'lucide-react'
import { BLOQUE_COLORS } from '../../utils/horarioBloques'
import { formatLongDate } from '../../utils/dateRange'
import Select from '../ui/Select'
import { useBackHandler } from '../../hooks/useBackHandler'
import { Button, Checkbox, Input, Modal, MotivoApagado } from '../ui'

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

  // Lo obvio ya viene puesto (PLAN_NORMALIZACION_UI §5.2): con una sola
  // asignatura por programar, queda elegida.
  const unicaDisponible = !esModificar && !initial?.asignaturaId && subjectsDisponibles?.length === 1
    ? subjectsDisponibles[0].id : ''
  const [asignaturaId, setAsignaturaId] = useState(initial?.asignaturaId || unicaDisponible)

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

  // Las fechas son SIEMPRE las del curso: aquí solo se leen. Se derivan de la
  // asignatura elegida (en 'crear' se elige después de abrir) en vez de
  // copiarse a un estado con un efecto.
  const fechaInicio = targetSubject?.fechaInicio || initial?.fechaInicio || ''
  const fechaFin = targetSubject?.fechaFin || initial?.fechaFin || ''
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
  // Lo que el docente cambió aquí, por asignatura: así cambiar de asignatura
  // en el selector muestra la casilla de ESA asignatura sin un efecto que la
  // reinicie, y volver a una ya tocada conserva el cambio.
  const [notificarCambios, setNotificarCambios] = useState({})
  const targetId = esModificar ? initial?.asignaturaId : asignaturaId
  const notificarClase = notificarCambios[targetId] ?? subjects[targetId]?.notificarClase ?? true

  async function toggleNotificarClase() {
    if (!targetId) return
    const next = !notificarClase
    setNotificarCambios((c) => ({ ...c, [targetId]: next }))
    try {
      await updateDoc(doc(db, 'subjects', targetId), { notificarClase: next })
    } catch (err) {
      setNotificarCambios((c) => ({ ...c, [targetId]: !next }))
      toast('Error al guardar: ' + err.message, 'error')
    }
  }

  // Botón atrás físico (Android): si está pidiendo confirmación de borrado,
  // solo la cancela (no cierra todo el modal). El cierre del modal en sí lo
  // maneja CalendarPage con useBackHandler(() => setProgramar(null), ...).
  useBackHandler(() => setConfirmDel(false), confirmDel)

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

  // Lo que falta para continuar: el botón se apaga y lo dice debajo.
  const faltan = [
    !esModificar && !asignaturaId && 'la asignatura',
    faltanFechasCurso && 'las fechas del curso',
  ].filter(Boolean)

  // Misma hoja que «Nueva asignatura» (oct-2026): título con X, campos con su
  // etiqueta, pistas de una línea y un solo botón grande fijo en el pie.
  return (
    <Modal
      open
      onClose={onClose}
      variant="sheet"
      size="md"
      title={esModificar ? `Modificar bloques · ${subjectName}` : 'Programar bloques de clase'}
    >
      <div className="space-y-3">
        <p className="text-xs text-hint -mt-2">Paso 1 de 2 · después los acomodas en la semana.</p>

        {esModificar ? null : sinDisponibles ? (
          <p className="text-sm text-muted">
            Todas tus asignaturas ya tienen bloques. Para cambiar una, usa <strong>Modificar bloques</strong>.
          </p>
        ) : (
          <Select
            id="programar-asignatura"
            label="Asignatura"
            value={asignaturaId}
            onChange={setAsignaturaId}
            options={[
              { value: '', label: 'Elige una asignatura…' },
              ...subjectList.map(s => ({ value: s.id, label: subjectDisplayName(s) })),
            ]}
          />
        )}

        {!sinDisponibles && <>
          {/* Las fechas son las del curso: se leen aquí y se cambian en la asignatura. */}
          {fechasDelCurso ? (
            <p className="text-sm text-muted">
              Del <span className="font-medium text-on-surface">{formatLongDate(fechaInicio)}</span> al{' '}
              <span className="font-medium text-on-surface">{formatLongDate(fechaFin)}</span> (fechas del curso).
            </p>
          ) : faltanFechasCurso ? (
            <div className="rounded-card bg-amber-50 p-3 space-y-2">
              <p className="text-sm text-amber-900">Esta asignatura aún no tiene fechas de inicio y fin.</p>
              <Button variant="secondary" fullWidth
                onClick={() => onIrAsignatura?.(esModificar ? initial?.asignaturaId : asignaturaId)}>
                Ponerle fechas
              </Button>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 items-end">
            <Input
              id="programar-duracion"
              label="Minutos por bloque"
              type="number" min={5} step={5}
              value={duracionMin}
              onChange={e => setDuracionMin(Number(e.target.value))}
            />
            <Input
              id="programar-bloques"
              label="Bloques por semana"
              type="number" min={1} max={20}
              value={bloquesPorSemana}
              onChange={e => setBloquesPorSemana(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            />
          </div>
          {!esModificar && (
            <p className="text-xs text-hint -mt-1">Se repiten cada semana hasta el fin del curso.</p>
          )}

          <fieldset>
            <legend className="block text-sm font-medium text-muted mb-2">Color</legend>
            <div className="flex flex-wrap gap-2 p-1">
              {BLOQUE_COLORS.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColor(c.id)}
                  aria-pressed={color === c.id}
                  className={`size-control-sm rounded-full border border-outline-variant transition ${color === c.id ? 'ring-2 ring-offset-2 ring-slate-400' : 'hover:scale-105'}`}
                  style={{ background: c.bg }}
                  data-tooltip={c.label}
                  aria-label={c.label}
                />
              ))}
            </div>
            {esModificar && <p className="text-xs text-hint mt-1">Se aplica a todos los bloques de la asignatura.</p>}
          </fieldset>

          {/* Se guarda directo en la asignatura, sin esperar a Continuar (como
              las demás casillas «Notificarme» de la app). La anticipación es la
              de Notificaciones › Recordatorios. */}
          <Checkbox
            id="notificar-clase"
            checked={notificarClase}
            onChange={toggleNotificarClase}
            disabled={!esModificar && !asignaturaId}
            label="Avisarme antes de cada clase"
            hint="En la app del celular."
          />

          {/* Borrar toda la programación (solo al modificar) */}
          {esModificar && (
            confirmDel ? (
              <div className="rounded-card bg-red-50 p-3 space-y-2">
                <p className="text-sm text-red-700">¿Borrar todos los bloques de {subjectName}? Podrás programarla de nuevo.</p>
                <div className="flex gap-2">
                  <Button variant="quiet" className="flex-1" onClick={() => setConfirmDel(false)}>Cancelar</Button>
                  <Button variant="danger" className="flex-1" onClick={() => onDeleteAll?.(initial?.asignaturaId)}>Borrar</Button>
                </div>
              </div>
            ) : (
              <Button variant="danger-outline" fullWidth icon={Trash2} onClick={() => setConfirmDel(true)}>
                Borrar todos los bloques
              </Button>
            )
          )}

          {/* pie-hoja: el botón se queda fijo abajo mientras se llena el formulario. */}
          <div className="pie-hoja">
            <Button size="lg" fullWidth iconRight={ArrowRight} onClick={handleContinue} disabled={faltan.length > 0}>
              Continuar
            </Button>
            <MotivoApagado faltan={faltan} />
          </div>
        </>}
      </div>
    </Modal>
  )
}
