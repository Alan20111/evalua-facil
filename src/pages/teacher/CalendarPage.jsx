import { useState, useEffect, useMemo, useRef } from 'react'
import { collection, query, where, getDocs, onSnapshot, doc, serverTimestamp } from 'firebase/firestore'
// Escrituras a través del candado de suscripción vencida (ver utils/firestoreGuard.js).
import { updateDoc, writeBatch, addDoc, deleteDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import EventEditor, { EVENT_COLORS } from '../../components/calendar/EventEditor'
import ProgramarBloquesModal from '../../components/calendar/ProgramarBloquesModal'
import ProgramarZonaSemanal from '../../components/calendar/ProgramarZonaSemanal'
import useAlarmas from '../../components/calendar/useAlarmas'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectColors } from '../../utils/subjectPalette'
import { bloqueColor, timeToMinutes, addMinutesToTime, generarBloques, tramosFaltantes as tramosFaltantesDe } from '../../utils/horarioBloques'
import { CATEGORIA_LABEL, deadlineEstado, mergeEvents } from '../../utils/calendarEvents'
import { formatLongDate } from '../../utils/dateRange'
import SubjectIcon from '../../components/SubjectIcon'
import { useNavigate } from 'react-router-dom'
import { buildAsuetoMap, esAsuetoPara } from '../../utils/asuetos'
import { buildVacacionMap, fechasVacacionParaClases } from '../../utils/vacaciones'
import { TEACHER_CONTAINER } from '../../config/layout'
import { IS_NATIVE_APP } from '../../utils/platform'
import { useBackHandler } from '../../hooks/useBackHandler'
import useTelefonoWeb from '../../hooks/useTelefonoWeb'
import { refreshTeacherReminders } from '../../utils/localReminders'
import { formatHora12 } from '../../utils/formatHora'
import MiniSelect from '../../components/calendar/MiniSelect'
import { isActivityPublished, isDraftActivity, withDefaultTime } from '../../utils/activityVisibility'
import { Clock, Send, CalendarDays, ChevronLeft, ChevronRight, Plus, CalendarRange, CalendarPlus, AlertTriangle, CalendarClock, CalendarOff, Trash2, Minus, Lock, LockOpen, Ban } from 'lucide-react'
import { VistaAnio, TiraSemana } from '../../components/calendar/VistasApple'
import { SkeletonList, Button, IconButton, Popover } from '../../components/ui'
import Modal from '../../components/ui/Modal'
import { ICONO } from '../../config/iconos'


         
 
import { AgendaView, AsuetoManager, MonthView, VacacionManager, WeekView } from './calendar/piezas'
import { DEFAULT_DAY_END, DEFAULT_DAY_START, DIAS_CORTO, DIAS_LARGO, MESES, VIEWS, addDays, addMonths, addWeeks, fmtHour, getMonthGrid, getWeekDays, isSameDay, isToday, startOfWeekMon, toDateStr } from './calendar/utilidades'
export { EventPill, AgendaView, BloquePill, MonthView, WeekView } from './calendar/piezas'
// Select propio con el estilo de la app — reemplaza el <select> nativo, que
// en Android abre el picker del sistema operativo (se ve fuera de lugar).
export default function CalendarPage() {
  const { currentUser } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  // Teléfono (web): el Horario es solo de consulta. Sin asuetos, vacaciones
  // ni programar/modificar bloques, y los bloques no se tocan ni se arrastran
  // (eso se hace desde la computadora). Los eventos personales sí se editan.
  // En la app nativa useTelefonoWeb siempre da false: la app sigue igual.
  const soloConsulta = useTelefonoWeb().telefono
  // Diseño de teléfono (patrón del Calendario de Apple): app nativa o web en celular.
  const movil = IS_NATIVE_APP || soloConsulta

  // Entra donde el docente lo dejó la última vez (vista y fecha) — pedido
  // explícito: no siempre debe aterrizar en Hoy/Día. "Hoy" sigue disponible
  // como botón para volver rápido a la fecha actual.
  const [vistaGuardada, setView] = useState(() => {
    const raw = localStorage.getItem('cal_view')
    return VIEWS.some((v) => v.id === raw) ? raw : 'agenda'
  })
  // En el teléfono no hay Semana (siete columnas no caben): si quedó guardada
  // de la laptop, se ve 3 días. Se DERIVA al pintar, sin un efecto que
  // corrija el estado (eso daba un render de más); la preferencia guardada
  // sigue siendo Semana para cuando vuelva a la laptop.
  const view = movil && vistaGuardada === 'semana' ? '3dias' : vistaGuardada
  const [currentDate, setCurrentDate] = useState(() => {
    const raw = localStorage.getItem('cal_current_date')
    const d = raw ? new Date(raw) : null
    return d && !isNaN(d) ? d : new Date()
  })
  useEffect(() => {
    localStorage.setItem('cal_current_date', currentDate.toISOString())
  }, [currentDate])

  // Foco inicial en el botón "Hoy" al entrar a Horario (web y app).
  const hoyBtnRef = useRef(null)
  useEffect(() => {
    hoyBtnRef.current?.focus()
  }, [])

  // Rango de horas visibles del día (Agenda y Semana), configurable.
  // Ojo: getItem devuelve null si no existe y Number(null) === 0, así que hay
  // que distinguir "sin guardar" de un 0 guardado explícitamente.
  const [dayStart, setDayStart] = useState(() => {
    const raw = localStorage.getItem('cal_dia_ini')
    const v = raw == null || raw === '' ? NaN : Number(raw)
    return Number.isInteger(v) && v >= 0 && v <= 22 ? v : DEFAULT_DAY_START
  })
  const [dayEnd, setDayEnd] = useState(() => {
    const raw = localStorage.getItem('cal_dia_fin')
    const v = raw == null || raw === '' ? NaN : Number(raw)
    return Number.isInteger(v) && v >= 1 && v <= 24 ? v : DEFAULT_DAY_END
  })

  function changeDayStart(v) {
    setDayStart(v)
    localStorage.setItem('cal_dia_ini', String(v))
    if (v >= dayEnd) { setDayEnd(v + 1); localStorage.setItem('cal_dia_fin', String(v + 1)) }
  }
  function changeDayEnd(v) {
    setDayEnd(v)
    localStorage.setItem('cal_dia_fin', String(v))
  }

  // Días visibles de la semana (5 = L-V, 6 = L-S, 7 = L-D).
  const [numDays, setNumDays] = useState(() => {
    const raw = localStorage.getItem('cal_dias_sem')
    const v = raw == null ? NaN : Number(raw)
    return [5, 6, 7].includes(v) ? v : 7
  })
  function changeNumDays(v) {
    setNumDays(v)
    localStorage.setItem('cal_dias_sem', String(v))
  }

  // Selector de fecha al hacer clic en la etiqueta de navegación.
  const [pickerMonth, setPickerMonth] = useState(new Date())

  // Confirmación pendiente al arrastrar un bloque de clase.
  const [pendingMove, setPendingMove] = useState(null) // { bloque, fecha, hora }
  const [subjects, setSubjects] = useState({})
  const [activities, setActivities] = useState([])
  const [personalEvents, setPersonalEvents] = useState([])
  // Horario tal como viene de Firestore. El que consume la página es `bloques`
  // (derivado más abajo), que deja fuera a las asignaturas archivadas.
  const [bloquesRaw, setBloquesRaw] = useState([])
  const [loading, setLoading] = useState(true)

  const [asuetos, setAsuetos] = useState([])
  const [vacaciones, setVacaciones] = useState([])
  const [showEventEditor, setShowEventEditor] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  // Modal de configuración (paso 1): { mode, initial?, subjectName?, baseline?, baselinePatrones? }
  const [programar, setProgramar] = useState(null)
  // Zona semanal de colocación de bloques: { config, mode, initialPatrones, asignaturaId }
  const [zona, setZona] = useState(null)
  const [showModificarPicker, setShowModificarPicker] = useState(false)
  // asignaturaId pendiente de confirmar en "quitar bloques fuera de rango" (picker de Modificar bloques)
  const [confirmLimpiarRango, setConfirmLimpiarRango] = useState(null)
  // asignaturaId pendiente de confirmar en "quitar bloques en asueto/vacaciones" (mismo picker)
  const [confirmLimpiarAsueto, setConfirmLimpiarAsueto] = useState(null)
  const [confirmGenerarFaltantes, setConfirmGenerarFaltantes] = useState(null)
  const [showAsuetos, setShowAsuetos] = useState(false)
  const [showVacaciones, setShowVacaciones] = useState(false)

  // Botón atrás físico (Android): cierra el editor de eventos o el modal de
  // "programar bloques" (paso 1), igual que sus botones de cerrar en pantalla.
  // La zona semanal (paso 2) maneja su propio guard en ProgramarZonaSemanal.
  useBackHandler(closeEventEditor, showEventEditor)
  useBackHandler(() => setProgramar(null), !!programar)

  function changeView(v) {
    setView(v)
    localStorage.setItem('cal_view', v)
  }

  // ── Load data ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return
    let pending = 5
    const finish = () => { pending--; if (pending <= 0) setLoading(false) }

    getDocs(query(collection(db, 'subjects'), where('docenteId', '==', currentUser.uid)))
      .then(snap => {
        const map = {}
        snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() } })
        setSubjects(map)
      }).catch(() => toast('No se pudieron cargar tus asignaturas', 'error')).finally(finish)

    getDocs(query(collection(db, 'activities'), where('docenteId', '==', currentUser.uid)))
      .then(snap => setActivities(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => toast('No se pudieron cargar tus actividades', 'error')).finally(finish)

    const unsubEv = onSnapshot(
      query(collection(db, 'events'), where('docenteId', '==', currentUser.uid)),
      snap => { setPersonalEvents(prev => mergeEvents(snap.docs.map(d => ({ id: d.id, ...d.data(), tipo: 'personal' })), prev, 'personal')); finish() },
      () => { toast('No se pudieron cargar tus eventos', 'error'); finish() }
    )
    // Eventos académicos — colección separada (ver firestore.rules: el
    // alumno los lee por asignaturaId, algo que `events` no puede autorizar
    // para un `list`). Se mezclan en el mismo estado `personalEvents` para
    // que el resto del calendario los pinte sin distinguir de dónde vienen.
    const unsubAcEv = onSnapshot(
      query(collection(db, 'academicEvents'), where('docenteId', '==', currentUser.uid)),
      snap => { setPersonalEvents(prev => mergeEvents(snap.docs.map(d => ({ id: d.id, ...d.data(), tipo: 'academico' })), prev, 'academico')); finish() },
      () => { toast('No se pudieron cargar tus eventos académicos', 'error'); finish() }
    )
    const unsubH = onSnapshot(
      query(collection(db, 'horarioBloques'), where('docenteId', '==', currentUser.uid)),
      snap => { setBloquesRaw(snap.docs.map(d => ({ id: d.id, ...d.data() }))); finish() },
      () => { toast('No se pudo cargar tu horario', 'error'); finish() }
    )
    const unsubA = onSnapshot(
      query(collection(db, 'asuetos'), where('docenteId', '==', currentUser.uid)),
      snap => setAsuetos(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => { /* asuetos son opcionales: si fallan, seguimos sin ellos */ }
    )
    const unsubV = onSnapshot(
      query(collection(db, 'vacaciones'), where('docenteId', '==', currentUser.uid)),
      snap => setVacaciones(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => { /* vacaciones son opcionales: si fallan, seguimos sin ellas */ }
    )

    return () => { unsubEv(); unsubAcEv(); unsubH(); unsubA(); unsubV() }
  }, [currentUser])

  // ── Aggregate events ───────────────────────────────────────────────────
  // Numeración "1.3." = misma regla que ActivityPage: posición entre las
  // hermanas del mismo parcial+asignatura, excluyendo borradores, ordenadas
  // por `orden`. Nunca se confía en un campo guardado, siempre se deriva.
  const activityLabels = useMemo(() => {
    const labels = {}
    const groups = {}
    activities.forEach(a => {
      if (isDraftActivity(a)) return
      const key = `${a.asignaturaId}|${a.parcial}`
      ;(groups[key] ||= []).push(a)
    })
    Object.values(groups).forEach(group => {
      group.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      group.forEach((a, idx) => { labels[a.id] = `${a.parcial}.${idx + 1}.` })
    })
    return labels
  }, [activities])

  const events = useMemo(() => {
    const evs = []

    activities.forEach(a => {
      if (!a.fechaLimite && !a.publishAt && !a.publishedAt) return
      const subj = subjects[a.asignaturaId]
      // Asignatura archivada = ciclo cerrado: sus fechas límite dejan de ser
      // pendientes y salen del calendario, igual que de la agenda del alumno.
      // (Sus bloques de horario salen por su lado, al derivar `bloques`.)
      if (subj?.archived) return
      // Actividad no visible (oculta, borrador o programada a futuro) — igual
      // que en la agenda del alumno, no debe aparecer en la agenda del
      // docente tampoco. Pedido explícito.
      if (!isActivityPublished(a, subj?.parcialesOcultos?.includes(a.parcial))) return
      const pal = subjectColors(subj)
      const subjName = subjectDisplayName(subj)
      const numero = activityLabels[a.id]
      const nombreConNumero = numero ? `${numero} ${a.nombre || 'Actividad'}` : (a.nombre || 'Actividad')

      if (a.fechaLimite) {
        const categoriaLabel = CATEGORIA_LABEL[a.categoria] || CATEGORIA_LABEL.entregable
        const cierraEnFecha = !a.recibirTarde
        // `fechaLimite` puede venir sin hora (fecha límite legada, 'YYYY-MM-DD')
        // — sin normalizar, `timeStr` queda vacío y WeekView (Semana/3 días, a
        // diferencia de AgendaView) nunca pinta eventos sin hora: la actividad
        // desaparecía por completo de esas dos vistas.
        const fechaLimiteConHora = withDefaultTime(a.fechaLimite, '23:59:59')
        evs.push({
          id: `dl-${a.id}`,
          activityId: a.id,
          titulo: cierraEnFecha ? `${nombreConNumero} (Cierre)` : nombreConNumero,
          subtitulo: `${subjName} · Parcial ${a.parcial ?? '–'} · ${categoriaLabel}`,
          tipo: 'deadline',
          dateStr: fechaLimiteConHora.substring(0, 10),
          timeStr: fechaLimiteConHora.substring(11, 16),
          bg: pal.bg, text: pal.text,
          editable: false,
          // true = deja de recibir entregas justo en la fecha; false = la fecha es informativa.
          cierraEnFecha,
          estado: deadlineEstado(a.fechaLimite),
        })
      }
      // `publishAt` solo queda guardado cuando la publicación se PROGRAMÓ a
      // futuro; si se publicó de inmediato, ese campo se guarda en null y la
      // fecha real vive en `publishedAt` (permanente, no cambia si luego se
      // vuelve a ocultar). Sin este fallback, las actividades publicadas al
      // instante nunca mostraban su marca "(Publicada)" en el calendario.
      const fechaPublicacion = a.publishAt || a.publishedAt
      if (fechaPublicacion) {
        evs.push({
          id: `pub-${a.id}`,
          activityId: a.id,
          titulo: `↑ ${nombreConNumero} (Publicada)`,
          subtitulo: subjName,
          tipo: 'publicacion',
          dateStr: fechaPublicacion.substring(0, 10),
          timeStr: fechaPublicacion.substring(11, 16),
          bg: pal.bg, text: pal.text,
          editable: false,
        })
      }
    })

    personalEvents.forEach(e => {
      const colorDef = EVENT_COLORS.find(c => c.id === e.color) || EVENT_COLORS[0]
      evs.push({
        id: e.id,
        titulo: e.titulo || '',
        subtitulo: e.descripcion || '',
        tipo: 'personal',
        dateStr: (e.inicio || '').substring(0, 10),
        timeStr: (e.inicio || '').substring(11, 16),
        endDateStr: (e.fin || '').substring(0, 10),
        endTimeStr: (e.fin || '').substring(11, 16),
        bg: colorDef.bg, text: colorDef.text,
        editable: true,
        rawEvent: e,
      })
    })

    // En la app nativa el horario muestra únicamente bloques de clase.
    // Deadlines, publicaciones y eventos personales no aparecen en móvil.
    if (IS_NATIVE_APP) return []
    return evs.filter(ev => ev.dateStr)
  }, [activities, personalEvents, subjects, activityLabels])

  // Índice de días de asueto por fecha (para marcar y bloquear por tipo).
  const asuetoMap = useMemo(() => buildAsuetoMap(asuetos), [asuetos])
  // Índice de días de vacaciones por fecha (cada periodo expandido día a día).
  const vacacionMap = useMemo(() => buildVacacionMap(vacaciones), [vacaciones])
  // Días en los que no hay clase para nadie (asueto que bloquea clases +
  // vacaciones). Es la MISMA lista con la que se materializan los bloques, así
  // que detectar "faltan clases" y generarlas siempre coinciden.
  const diasAsuetoClases = useMemo(() => [
    ...asuetos.filter(a => a.clases).map(a => a.fecha),
    ...fechasVacacionParaClases(vacaciones),
  ], [asuetos, vacaciones])

  // El horario VIGENTE, que es el que usa toda esta página. Una asignatura
  // archivada = ciclo cerrado: sale del contexto de trabajo de "Bloques" y sus
  // bloques dejan de contar para nada — no se pintan en el calendario, no
  // suenan sus alarmas, no estorban al acomodar el horario nuevo en la zona
  // semanal, y no generan avisos de faltantes / fuera de rango / asueto. Sus
  // documentos NO se borran: archivar ≠ borrar historial, y al desarchivar la
  // asignatura su horario reaparece tal cual estaba.
  const bloques = useMemo(
    () => bloquesRaw.filter(b => !subjects[b.asignaturaId]?.archived),
    [bloquesRaw, subjects],
  )

  // Alarmas de los bloques (suenan con la app abierta + notificación).
  useAlarmas(bloques, subjects, currentUser?.uid)

  // ── Navigation ─────────────────────────────────────────────────────────
  function prev() {
    if (view === 'anio') setCurrentDate(d => addMonths(d, -12))
    else if (view === 'mes') setCurrentDate(d => addMonths(d, -1))
    else if (view === 'semana') setCurrentDate(d => addWeeks(d, -1))
    else if (view === '3dias') setCurrentDate(d => addDays(d, -3))
    else setCurrentDate(d => addDays(d, -1))
  }
  function next() {
    if (view === 'anio') setCurrentDate(d => addMonths(d, 12))
    else if (view === 'mes') setCurrentDate(d => addMonths(d, 1))
    else if (view === 'semana') setCurrentDate(d => addWeeks(d, 1))
    else if (view === '3dias') setCurrentDate(d => addDays(d, 3))
    else setCurrentDate(d => addDays(d, 1))
  }
  function goToday() { setCurrentDate(new Date()) }

  function navLabel() {
    if (view === 'anio') return String(currentDate.getFullYear())
    if (view === 'mes') return `${MESES[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    if (view === 'agenda') {
      const dl = DIAS_LARGO[(currentDate.getDay() + 6) % 7]
      const base = `${dl} ${currentDate.getDate()} de ${MESES[currentDate.getMonth()]}`
      return isToday(currentDate) ? `Hoy · ${base}` : `${base} ${currentDate.getFullYear()}`
    }
    if (view === '3dias') {
      const first = currentDate; const last = addDays(currentDate, 2)
      if (first.getMonth() === last.getMonth()) {
        return `${first.getDate()}–${last.getDate()} ${MESES[first.getMonth()]} ${first.getFullYear()}`
      }
      return `${first.getDate()} ${MESES[first.getMonth()]} – ${last.getDate()} ${MESES[last.getMonth()]}`
    }
    const days = getWeekDays(currentDate)
    const first = days[0]; const last = days[6]
    if (first.getMonth() === last.getMonth()) {
      return `${first.getDate()}–${last.getDate()} ${MESES[first.getMonth()]} ${first.getFullYear()}`
    }
    return `${first.getDate()} ${MESES[first.getMonth()]} – ${last.getDate()} ${MESES[last.getMonth()]}`
  }

  // ── Event editor helpers ───────────────────────────────────────────────
  // Bloquea la creación en un día marcado como asueto o dentro de vacaciones.
  function bloqueadoPorAsueto(fecha, tipo) {
    const d = new Date(fecha + 'T12:00:00')
    // En el teléfono (web) los botones de asueto/vacaciones no están: el aviso
    // manda a la computadora en vez de a un control que no se ve.
    if (esAsuetoPara(asuetoMap, fecha, tipo)) {
      toast(soloConsulta
        ? `${d.getDate()}/${d.getMonth() + 1} es día de asueto (sin ${tipo}). Para permitirlo, quítalo desde Horario en la computadora.`
        : `${d.getDate()}/${d.getMonth() + 1} es día de asueto (sin ${tipo}). Quítalo en "Días de asueto" para permitirlo.`, 'error')
      return true
    }
    if (esAsuetoPara(vacacionMap, fecha, tipo)) {
      toast(soloConsulta
        ? `${d.getDate()}/${d.getMonth() + 1} cae en vacaciones (sin ${tipo}). Para permitirlo, ajusta el periodo desde Horario en la computadora.`
        : `${d.getDate()}/${d.getMonth() + 1} cae en vacaciones (sin ${tipo}). Ajusta el periodo en "Vacaciones" para permitirlo.`, 'error')
      return true
    }
    return false
  }
  function proximaHoraEnPunto(ahora = new Date()) {
    const d = new Date(ahora)
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() + 1)
    return `${toDateStr(d)}T${String(d.getHours()).padStart(2, '0')}:00`
  }
  function openNewEvent(date) {
    if (date && bloqueadoPorAsueto(toDateStr(date), 'eventos')) return
    setEditingEvent(null)
    // Sin día elegido (botón «Evento»): la siguiente hora en punto de hoy,
    // que es casi siempre para cuando se agenda algo (PLAN_NORMALIZACION_UI
    // §5.2). Con día elegido en el calendario, las 8:00 de ese día.
    setSelectedDate(date ? `${toDateStr(date)}T08:00` : proximaHoraEnPunto())
    setShowEventEditor(true)
  }
  function openEditEvent(ev) {
    // Fecha límite / publicación: se editan desde la actividad, no aquí.
    if (ev.activityId) { navigate(`/activity/${ev.activityId}`, { state: { openEditActivity: true, returnTo: 'calendario' } }); return }
    if (!ev.editable) return
    setEditingEvent(ev.rawEvent)
    setSelectedDate(null)
    setShowEventEditor(true)
  }
  function closeEventEditor() {
    setShowEventEditor(false)
    setEditingEvent(null)
    setSelectedDate(null)
  }

  // ── Programación de bloques ────────────────────────────────────────────
  function openProgramar() {
    setProgramar({ mode: 'crear' })
  }

  // Paso 1 (modal) → paso 2 (zona semanal). En "crear" abre la zona vacía; en
  // "modificar" precarga la plantilla derivada y aplica los cambios de
  // color/duración/alarma que el docente haya hecho en el modal a TODA la
  // asignatura (por eso solo se propagan los campos que realmente cambió).
  function continuarAZona(config) {
    const ctx = programar
    setProgramar(null)
    if (ctx?.mode === 'modificar') {
      const base = ctx.baseline || {}
      const patch = {}
      if (config.color !== base.color) patch.color = config.color
      if (config.duracionMin !== base.duracionMin) patch.duracionMin = config.duracionMin
      if (JSON.stringify(config.alarma) !== JSON.stringify(base.alarma)) patch.alarma = config.alarma
      const patrones = (ctx.baselinePatrones || []).map(p => ({
        ...p,
        ...(patch.color ? { color: patch.color } : {}),
        ...(patch.duracionMin ? { duracionMin: patch.duracionMin } : {}),
        ...(patch.alarma ? { alarma: { ...patch.alarma } } : {}),
      }))
      // ¿El docente cambió algo en el modal de configuración? (fechas/duración/
      // BS/color/alarma). Si no, y tampoco toca los bloques en la zona, no hay
      // nada que guardar → el botón será "Salir sin modificar".
      const configChanged = config.fechaInicio !== base.fechaInicio
        || config.fechaFin !== base.fechaFin
        || config.duracionMin !== base.duracionMin
        || config.bloquesPorSemana !== base.bloquesPorSemana
        || config.color !== base.color
        || JSON.stringify(config.alarma) !== JSON.stringify(base.alarma)
      setZona({ config, mode: 'modificar', initialPatrones: patrones, asignaturaId: config.asignaturaId, configChanged })
    } else {
      setZona({ config, mode: 'crear', initialPatrones: null, asignaturaId: config.asignaturaId })
    }
  }

  // Deriva la plantilla semanal (patrones) a partir de las instancias ya
  // materializadas de una asignatura: colapsa por (día, hora) tomando la
  // combinación más frecuente de lugar/color/alarma.
  //
  // IMPORTANTE: los bloques movidos a mano en el horario normal (movido:true)
  // son cambios de UNA sola clase y NO forman parte del horario recurrente, así
  // que se EXCLUYEN de la plantilla de "Modificar". Así, mover una clase en el
  // horario normal nunca afecta a "Modificar bloques". (Si por algún caso todos
  // los bloques estuvieran movidos, se usan todos como respaldo.)
  // Combinación de lugar/color/alarma que más se repite entre las muestras de
  // un mismo (día, hora) — empate se resuelve a favor de la que apareció
  // primero. Antes se tomaba siempre muestras[0] (la primera, sin importar
  // cuántas veces se repitiera cada combinación), contradiciendo el propio
  // comentario de la función.
  function comboMasFrecuente(muestras) {
    const counts = new Map()
    muestras.forEach(m => {
      const combo = {
        lugar: m.lugar || '',
        color: m.color || 'blue',
        alarma: m.alarma || { activa: false, sonido: 'campana', minutosAntes: 10 },
      }
      const key = JSON.stringify(combo)
      const entry = counts.get(key)
      if (entry) entry.count++
      else counts.set(key, { combo, count: 1 })
    })
    let best = null
    counts.forEach(entry => { if (!best || entry.count > best.count) best = entry })
    return best.combo
  }

  function derivarPatrones(asignaturaId) {
    const todos = bloques.filter(b => b.asignaturaId === asignaturaId)
    const recurrentes = todos.filter(b => !b.movido)
    const propios = recurrentes.length ? recurrentes : todos
    const porClave = {}
    propios.forEach(b => {
      const dia = b.diaSemana ?? ((new Date(b.fecha + 'T12:00:00').getDay() + 6) % 7)
      const key = `${dia}-${b.horaInicio}`
      const dur = Math.max(5, timeToMinutes(b.horaFin) - timeToMinutes(b.horaInicio))
      ;(porClave[key] ||= { diaSemana: dia, horaInicio: b.horaInicio, duracionMin: dur, muestras: [] })
      porClave[key].muestras.push(b)
    })
    return Object.values(porClave)
      .sort((a, b) => a.diaSemana - b.diaSemana || timeToMinutes(a.horaInicio) - timeToMinutes(b.horaInicio))
      .map(({ muestras, ...p }) => ({ ...p, ...comboMasFrecuente(muestras) }))
  }

  // "Modificar bloques" → paso 1 (modal de configuración con la asignatura fija
  // y los valores derivados de los bloques actuales). El docente puede ajustar
  // fechas/duración/BS/color/alarma antes de reacomodar en la zona.
  function openModificar(asignaturaId) {
    setShowModificarPicker(false)
    const propios = bloques.filter(b => b.asignaturaId === asignaturaId)
    if (propios.length === 0) {
      toast('Esa asignatura aún no tiene bloques programados', 'error')
      return
    }
    const fechas = propios.map(b => b.fecha).sort()
    // Fuente preferente: el patrón guardado en la asignatura. Fallback (curso
    // viejo sin horarioPatron todavía): reconstruirlo de los bloques reales.
    const patronesGuardados = subjects[asignaturaId]?.horarioPatron
    const patrones = patronesGuardados?.length ? patronesGuardados : derivarPatrones(asignaturaId)
    const durComun = patrones[0]?.duracionMin || 60
    const primerAlarma = patrones.find(p => p.alarma?.activa)?.alarma
      || { activa: false, sonido: 'campana', minutosAntes: 10 }
    // Si la asignatura ya tiene fechas de curso, ProgramarBloquesModal las
    // muestra fijas (no editables) en vez de las derivadas del primer/último
    // bloque real — el baseline debe coincidir con eso, si no, abrir
    // "Modificar" sin tocar nada ya marcaría un cambio falso (fechas
    // derivadas ≠ fechas del curso) y habilitaría "Guardar" de balde.
    const subj = subjects[asignaturaId]
    const fechaInicioBase = (subj?.fechaInicio && subj?.fechaFin) ? subj.fechaInicio : fechas[0]
    const fechaFinBase = (subj?.fechaInicio && subj?.fechaFin) ? subj.fechaFin : fechas[fechas.length - 1]
    const baseline = {
      asignaturaId,
      fechaInicio: fechaInicioBase,
      fechaFin: fechaFinBase,
      duracionMin: durComun,
      bloquesPorSemana: patrones.length,
      color: patrones[0]?.color || 'blue',
      alarma: primerAlarma,
    }
    setProgramar({
      mode: 'modificar',
      initial: baseline,
      baseline,
      baselinePatrones: patrones,
      subjectName: subjectDisplayName(subjects[asignaturaId]),
    })
  }

  // Materializa los patrones colocados en la zona y los persiste. En modo
  // "modificar" reemplaza (borra + recrea) las instancias de esa asignatura.
  async function guardarDesdeZona(patrones) {
    const cfg = zona?.config
    if (!cfg) return
    // Los días de asueto y de vacaciones que bloquean CLASES se omiten al materializar.
    const diasAsueto = [
      ...asuetos.filter(a => a.clases).map(a => a.fecha),
      ...fechasVacacionParaClases(vacaciones),
    ]
    const nuevos = generarBloques({
      fechaInicio: cfg.fechaInicio,
      fechaFin: cfg.fechaFin,
      diasAsueto,
      duracionMin: cfg.duracionMin,
      patrones,
      color: cfg.color,
      alarma: cfg.alarma,
    })
    if (nuevos.length === 0) {
      toast('Con esas fechas y días no se generó ningún bloque. Revisa el rango.', 'error')
      return
    }
    const modo = zona.mode
    const asignaturaId = cfg.asignaturaId
    setZona(null)
    try {
      // Modo modificar: borra primero las instancias actuales de la asignatura.
      if (modo === 'modificar') {
        const viejos = bloques.filter(b => b.asignaturaId === asignaturaId).map(b => b.id)
        for (let i = 0; i < viejos.length; i += 450) {
          const batch = writeBatch(db)
          viejos.slice(i, i + 450).forEach(id => batch.delete(doc(db, 'horarioBloques', id)))
          await batch.commit()
        }
      }
      const programacionId = crypto.randomUUID()
      const meta = { docenteId: currentUser.uid, programacionId, asignaturaId, createdAt: serverTimestamp() }
      const created = []
      for (let i = 0; i < nuevos.length; i += 450) {
        const batch = writeBatch(db)
        nuevos.slice(i, i + 450).forEach(b => {
          const ref = doc(collection(db, 'horarioBloques'))
          batch.set(ref, { ...b, ...meta })
          created.push({ id: ref.id, ...b, docenteId: currentUser.uid, programacionId, asignaturaId })
        })
        await batch.commit()
      }
      // Persiste el mismo patrón semanal usado para materializar los bloques
      // — así queda disponible como dato propio de la asignatura (prerrequisito
      // del "calendario real de sesiones"), sin depender de reconstruirlo con
      // derivarPatrones() a partir de horarioBloques.
      await updateDoc(doc(db, 'subjects', asignaturaId), { horarioPatron: patrones })
      toast(modo === 'modificar'
        ? `Bloques actualizados (${created.length})`
        : `Se programaron ${created.length} bloques de clase`)
      // Reprograma los recordatorios de "clase por comenzar" YA — si no, un
      // bloque recién creado no dispara su aviso hasta el próximo login o
      // resume de la app.
      refreshTeacherReminders(currentUser.uid)
      // Salta a la fecha del primer bloque para que se vean de inmediato.
      const first = created.reduce((min, b) =>
        (b.fecha + b.horaInicio) < (min.fecha + min.horaInicio) ? b : min, created[0])
      if (first?.fecha) { setCurrentDate(new Date(first.fecha + 'T12:00:00')); changeView('semana') }
    } catch (err) {
      toast('Error al guardar: ' + err.message, 'error')
    }
  }

  // Bloques materializados que ya quedaron fuera del rango vigente de la
  // asignatura — pasa cuando se edita fechaInicio/fechaFin desde "Editar
  // asignatura" DESPUÉS de haber programado el horario: nada resincroniza los
  // bloques automáticamente, así que se acumulan clases fantasma fuera del
  // periodo real del curso hasta que alguien las nota aquí.
  function bloquesFueraDeRango(asignaturaId) {
    const subj = subjects[asignaturaId]
    if (!subj?.fechaInicio || !subj?.fechaFin) return []
    return bloques.filter(b => b.asignaturaId === asignaturaId
      && (b.fecha < subj.fechaInicio || b.fecha > subj.fechaFin))
  }

  async function limpiarBloquesFueraDeRango(asignaturaId) {
    const ids = bloquesFueraDeRango(asignaturaId).map(b => b.id)
    setConfirmLimpiarRango(null)
    if (ids.length === 0) return
    try {
      for (let i = 0; i < ids.length; i += 450) {
        const batch = writeBatch(db)
        ids.slice(i, i + 450).forEach(id => batch.delete(doc(db, 'horarioBloques', id)))
        await batch.commit()
      }
      toast(`Se quitaron ${ids.length} bloque(s) que estaban fuera del rango actual de la asignatura`)
    } catch (err) {
      toast('Error al quitar bloques: ' + err.message, 'error')
    }
  }

  // El espejo de bloquesFueraDeRango: tramos del curso que se quedaron SIN
  // bloques. Pasa al ALARGAR la asignatura desde "Editar asignatura" — nada
  // resincroniza, así que las clases terminan en la fecha vieja y, como la
  // asistencia se arma a partir de los bloques reales, ese tramo también se
  // queda sin días de asistencia, en silencio. Cubre los dos lados por si se
  // adelanta la fecha de inicio.
  function tramosFaltantes(asignaturaId) {
    const subj = subjects[asignaturaId]
    if (!subj?.fechaInicio || !subj?.fechaFin) return []
    const bloquesAsignatura = bloques.filter(b => b.asignaturaId === asignaturaId)
    // Qué días son "de clase" lo dice el horario REAL de esta asignatura (su
    // patrón guardado o, en cursos viejos, el derivado de sus propios
    // bloques), nunca una semana genérica de lunes a viernes: si la asignatura
    // es de miércoles y viernes, un lunes sin bloque no es una clase que
    // falte. Mismos patrones y mismos asuetos que usa generarBloquesFaltantes,
    // para que lo que se avisa sea exactamente lo que se va a generar.
    const patronesGuardados = subj.horarioPatron
    const patrones = patronesGuardados?.length ? patronesGuardados : derivarPatrones(asignaturaId)
    return tramosFaltantesDe(bloquesAsignatura, subj.fechaInicio, subj.fechaFin, {
      patrones,
      diasAsueto: diasAsuetoClases,
    })
  }

  // Extiende el patrón semanal vigente a los tramos que faltan. NO borra ni
  // reescribe lo existente (a diferencia de "Modificar bloques", que reemplaza
  // todo): solo rellena el hueco, así que las clases que el docente haya movido
  // a mano dentro del tramo ya programado se quedan como están.
  async function generarBloquesFaltantes(asignaturaId) {
    const tramos = tramosFaltantes(asignaturaId)
    setConfirmGenerarFaltantes(null)
    if (tramos.length === 0) return
    const patronesGuardados = subjects[asignaturaId]?.horarioPatron
    const patrones = patronesGuardados?.length ? patronesGuardados : derivarPatrones(asignaturaId)
    if (patrones.length === 0) { toast('No se pudo deducir el horario semanal de esa asignatura', 'error'); return }
    const nuevos = tramos.flatMap(t => generarBloques({
      fechaInicio: t.desde,
      fechaFin: t.hasta,
      diasAsueto: diasAsuetoClases,
      duracionMin: patrones[0].duracionMin || 60,
      patrones,
      color: patrones[0].color,
      alarma: patrones[0].alarma,
    }))
    if (nuevos.length === 0) {
      toast('No había clases pendientes por generar en ese tramo (cae en asueto o no coincide con el horario semanal)', 'warning')
      return
    }
    try {
      const meta = {
        docenteId: currentUser.uid,
        programacionId: crypto.randomUUID(),
        asignaturaId,
        createdAt: serverTimestamp(),
      }
      for (let i = 0; i < nuevos.length; i += 450) {
        const batch = writeBatch(db)
        nuevos.slice(i, i + 450).forEach(b => batch.set(doc(collection(db, 'horarioBloques')), { ...b, ...meta }))
        await batch.commit()
      }
      toast(`Se generaron ${nuevos.length} bloque(s) para el tramo que faltaba`)
      refreshTeacherReminders(currentUser.uid)
    } catch (err) {
      toast('Error al generar los bloques faltantes: ' + err.message, 'error')
    }
  }

  // Bloques que caen en un día que se marcó como asueto/vacaciones DESPUÉS de
  // materializarse — se generan excluyendo los asuetos que existían en ese
  // momento (utils/horarioBloques.js), pero un asueto agregado después no
  // borra retroactivamente los bloques que ya habían quedado ahí, así que el
  // calendario termina mostrando una clase el mismo día que dice "sin clases".
  function bloquesEnAsueto(asignaturaId) {
    return bloques.filter(b => b.asignaturaId === asignaturaId
      && (esAsuetoPara(asuetoMap, b.fecha, 'clases') || esAsuetoPara(vacacionMap, b.fecha, 'clases')))
  }

  async function limpiarBloquesEnAsueto(asignaturaId) {
    const ids = bloquesEnAsueto(asignaturaId).map(b => b.id)
    setConfirmLimpiarAsueto(null)
    if (ids.length === 0) return
    try {
      for (let i = 0; i < ids.length; i += 450) {
        const batch = writeBatch(db)
        ids.slice(i, i + 450).forEach(id => batch.delete(doc(db, 'horarioBloques', id)))
        await batch.commit()
      }
      toast(`Se quitaron ${ids.length} bloque(s) que caían en día de asueto o vacaciones`)
    } catch (err) {
      toast('Error al quitar bloques: ' + err.message, 'error')
    }
  }

  // Asignaturas que YA tienen programación (solo se pueden modificar, no volver
  // a programar hasta que se borre su programación completa). En las dos listas
  // participan únicamente las asignaturas ACTIVAS: una archivada ya no se
  // programa ni se modifica desde aquí (su historial se conserva intacto).
  const programmedIds = useMemo(() => new Set(bloques.map(b => b.asignaturaId)), [bloques])
  const subjectsConBloques = useMemo(() =>
    Object.values(subjects).filter(s => !s.archived && programmedIds.has(s.id))
      .sort((a, b) => subjectDisplayName(a).localeCompare(subjectDisplayName(b))),
  [subjects, programmedIds])
  const subjectsSinProgramar = useMemo(() =>
    Object.values(subjects).filter(s => !s.archived && !programmedIds.has(s.id))
      .sort((a, b) => subjectDisplayName(a).localeCompare(subjectDisplayName(b))),
  [subjects, programmedIds])
  // Total para el badge del botón "Modificar bloques" — así se nota desde el
  // calendario mismo, sin tener que abrir el selector para descubrirlo.
  const totalBloquesFueraDeRango = useMemo(() =>
    [...programmedIds].reduce((sum, id) => sum + bloquesFueraDeRango(id).length, 0),
  [bloques, subjects, programmedIds]) // eslint-disable-line react-hooks/exhaustive-deps
  const totalBloquesEnAsueto = useMemo(() =>
    [...programmedIds].reduce((sum, id) => sum + bloquesEnAsueto(id).length, 0),
  [bloques, asuetoMap, vacacionMap, programmedIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Borra TODA la programación de una asignatura → vuelve a estar disponible
  // para programarse desde cero.
  async function borrarProgramacion(asignaturaId) {
    const ids = bloques.filter(b => b.asignaturaId === asignaturaId).map(b => b.id)
    setProgramar(null)
    try {
      for (let i = 0; i < ids.length; i += 450) {
        const batch = writeBatch(db)
        ids.slice(i, i + 450).forEach(id => batch.delete(doc(db, 'horarioBloques', id)))
        await batch.commit()
      }
      toast(`Programación eliminada (${ids.length} bloque(s)). La asignatura vuelve a estar disponible para programar.`)
      refreshTeacherReminders(currentUser.uid)
    } catch (err) {
      toast('No se pudo borrar la programación: ' + err.message, 'error')
    }
  }

  // Mover un bloque (arrastrar) → nueva fecha/hora, conservando la duración.
  async function moveBloque(b, nuevaFecha, nuevaHora) {
    const durMin = timeToMinutes(b.horaFin) - timeToMinutes(b.horaInicio)
    const nuevaHoraFin = addMinutesToTime(nuevaHora, durMin)
    const diaSemana = (new Date(nuevaFecha + 'T12:00:00').getDay() + 6) % 7
    // Actualización optimista para que se vea al instante (onSnapshot confirma).
    setBloquesRaw(prev => prev.map(x => x.id === b.id
      ? { ...x, fecha: nuevaFecha, horaInicio: nuevaHora, horaFin: nuevaHoraFin, diaSemana, movido: true }
      : x))
    try {
      await updateDoc(doc(db, 'horarioBloques', b.id), {
        fecha: nuevaFecha, horaInicio: nuevaHora, horaFin: nuevaHoraFin, diaSemana, movido: true,
      })
      refreshTeacherReminders(currentUser.uid)
    } catch (err) {
      toast('No se pudo mover el bloque: ' + err.message, 'error')
    }
  }

  // Mover un evento personal (arrastrar) → nueva fecha/hora, conservando duración.
  async function moveEvent(rawEvent, nuevaFecha, nuevaHora) {
    const inicio = rawEvent.inicio || ''
    const fecha = nuevaFecha || inicio.substring(0, 10)
    if (nuevaFecha && bloqueadoPorAsueto(nuevaFecha, 'eventos')) return
    const hora = nuevaHora || inicio.substring(11, 16) || '08:00'
    const nuevoInicio = `${fecha}T${hora}`
    let nuevoFin = nuevoInicio
    if (rawEvent.fin && inicio) {
      const durMs = new Date(rawEvent.fin) - new Date(inicio)
      if (Number.isFinite(durMs) && durMs > 0) {
        const f = new Date(new Date(`${nuevoInicio}:00`).getTime() + durMs)
        nuevoFin = `${toDateStr(f)}T${String(f.getHours()).padStart(2, '0')}:${String(f.getMinutes()).padStart(2, '0')}`
      }
    }
    // Optimista: onSnapshot confirma después.
    setPersonalEvents(prev => prev.map(x => x.id === rawEvent.id
      ? { ...x, inicio: nuevoInicio, fin: nuevoFin }
      : x))
    try {
      const col = rawEvent.tipo === 'academico' ? 'academicEvents' : 'events'
      await updateDoc(doc(db, col, rawEvent.id), { inicio: nuevoInicio, fin: nuevoFin })
      refreshTeacherReminders(currentUser.uid)
    } catch (err) {
      toast('No se pudo mover el evento: ' + err.message, 'error')
    }
  }

  // Al soltar (o tocar) una clase se abre el diálogo de acciones de ESA clase:
  // mover el mismo día a otra hora, o borrarla (clase suspendida). Un
  // adelanto/movimiento de una sola clase es SIEMPRE el mismo día: solo cambia
  // la hora (nunca el día ni las clases siguientes → eso es "Modificar bloques").
  // Teléfono (web): ninguno de los tres abre el diálogo — el horario es solo
  // de consulta (las vistas ya no los reciben; esto es la red de seguridad).
  function requestMoveBloque(b, _nuevaFecha, nuevaHora) {
    if (soloConsulta) return
    setPendingMove({ bloque: b, fecha: b.fecha, hora: nuevaHora })
  }
  // Tocar una clase (sin arrastrar) abre el mismo diálogo con su hora actual.
  function openBloqueAcciones(b) {
    if (soloConsulta) return
    setPendingMove({ bloque: b, fecha: b.fecha, hora: b.horaInicio })
  }
  // En la vista Mes solo se puede BORRAR ese día (no mover): el diálogo se abre
  // sin la opción de cambiar la hora.
  function openBloqueSoloBorrar(b) {
    if (soloConsulta) return
    setPendingMove({ bloque: b, fecha: b.fecha, hora: b.horaInicio, soloBorrar: true })
  }

  async function confirmPendingMove() {
    const pm = pendingMove
    setPendingMove(null)
    if (!pm) return
    // Mismo día siempre; solo puede cambiar la hora.
    if (pm.hora === pm.bloque.horaInicio) return
    await moveBloque(pm.bloque, pm.bloque.fecha, pm.hora)
  }

  // Eliminar SOLO esta clase (creada por error) — deleteDoc real, sin dejar
  // rastro. Distinto de CANCELAR (abajo): esto es para cuando el bloque nunca
  // debió existir, no para una clase que sí estaba programada y no se dio.
  async function borrarBloqueUnico(bloque) {
    setPendingMove(null)
    try {
      await deleteDoc(doc(db, 'horarioBloques', bloque.id))
      toast('Esta clase se borró. Las demás clases siguen igual.')
      refreshTeacherReminders(currentUser.uid)
    } catch (err) {
      toast('No se pudo borrar la clase: ' + err.message, 'error')
    }
  }

  // CANCELAR una clase que sí estaba programada y no se va a impartir — se
  // conserva el documento (a diferencia de "Eliminar"), solo se marca. Así
  // queda registrada como hecho histórico y puede excluirse del cálculo de
  // sesiones efectivas y de asistencia, sin perder que existió. Reversible
  // con "Reactivar" (p. ej. si al final sí se repuso la clase ese día).
  async function cancelarBloqueUnico(bloque) {
    setPendingMove(null)
    try {
      await updateDoc(doc(db, 'horarioBloques', bloque.id), {
        cancelada: true, canceladaEn: serverTimestamp(),
      })
      toast('Esta clase quedó marcada como cancelada. No generará asistencia.')
      refreshTeacherReminders(currentUser.uid)
    } catch (err) {
      toast('No se pudo cancelar la clase: ' + err.message, 'error')
    }
  }

  async function reactivarBloqueUnico(bloque) {
    setPendingMove(null)
    try {
      await updateDoc(doc(db, 'horarioBloques', bloque.id), { cancelada: false })
      toast('Esta clase vuelve a estar activa.')
      refreshTeacherReminders(currentUser.uid)
    } catch (err) {
      toast('No se pudo reactivar la clase: ' + err.message, 'error')
    }
  }

  // Crear evento desde un hueco de la agenda del día.
  function openNewEventAt(dateStr, hora) {
    if (bloqueadoPorAsueto(dateStr, 'eventos')) return
    setEditingEvent(null)
    setSelectedDate(`${dateStr}T${hora}`)
    setShowEventEditor(true)
  }

  // ── Días de asueto ─────────────────────────────────────────────────────
  async function addAsueto(fecha, alcance) {
    if (!fecha) return
    const existente = asuetos.find(a => a.fecha === fecha)
    try {
      if (existente) {
        await updateDoc(doc(db, 'asuetos', existente.id), alcance)
      } else {
        await addDoc(collection(db, 'asuetos'), {
          docenteId: currentUser.uid, fecha, ...alcance, createdAt: serverTimestamp(),
        })
      }
      toast('Día de asueto guardado')
    } catch (err) {
      toast('No se pudo guardar el día de asueto: ' + err.message, 'error')
    }
  }
  async function removeAsueto(id) {
    try {
      await deleteDoc(doc(db, 'asuetos', id))
    } catch (err) {
      toast('No se pudo quitar el día de asueto: ' + err.message, 'error')
    }
  }

  // ── Vacaciones (periodo) ───────────────────────────────────────────────
  async function addVacacion(fechaInicio, fechaFin, alcance) {
    if (!fechaInicio || !fechaFin) return
    try {
      await addDoc(collection(db, 'vacaciones'), {
        docenteId: currentUser.uid, fechaInicio, fechaFin, ...alcance, createdAt: serverTimestamp(),
      })
      toast('Periodo de vacaciones guardado')
    } catch (err) {
      toast('No se pudo guardar el periodo de vacaciones: ' + err.message, 'error')
    }
  }
  async function removeVacacion(id) {
    try {
      await deleteDoc(doc(db, 'vacaciones', id))
    } catch (err) {
      toast('No se pudo quitar el periodo de vacaciones: ' + err.message, 'error')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  // Piezas del toolbar armadas como variables JSX para poder recomponerlas en
  // dos layouts distintos (nativo vs. web) sin duplicar el marcado.
  const dateNav = (
    <div className="relative flex items-center gap-1">
      <IconButton icon={ChevronLeft} label="Anterior" tooltip={false} onClick={prev} />
      {/* Mini calendario para saltar a una fecha: Popover de la librería
          (mismo panel, animación y cierre que los demás menús). */}
      <Popover align="start" label="Ir a otra fecha" className="p-3 w-64"
        trigger={({ onClick, ...props }) => (
      <button
        type="button"
        {...props}
        onClick={(e) => {
          setPickerMonth(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1))
          onClick(e)
        }}
        className={`min-h-control text-2xl font-bold text-on-surface px-3 ${IS_NATIVE_APP ? 'flex-1 min-w-0' : 'min-w-[11rem]'} truncate text-left select-none rounded-full hover:bg-[var(--accent-tint)] transition-colors py-0.5`}
        data-tooltip="Ir a otra fecha"
        data-tooltip-pos="bottom"
      >
        {navLabel()}
      </button>
        )}>
        {({ cerrar }) => (
          <>
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => setPickerMonth(m => addMonths(m, -1))} className="size-control inline-flex items-center justify-center rounded-full hover:bg-[var(--accent-tint)] text-muted">
                <ChevronLeft size={ICONO.sm} />
              </button>
              <span className="text-sm font-semibold text-on-surface">
                {MESES[pickerMonth.getMonth()]} {pickerMonth.getFullYear()}
              </span>
              <button type="button" onClick={() => setPickerMonth(m => addMonths(m, 1))} className="size-control inline-flex items-center justify-center rounded-full hover:bg-[var(--accent-tint)] text-muted">
                <ChevronRight size={ICONO.sm} />
              </button>
            </div>
            <div className="grid grid-cols-7 mb-1">
              {DIAS_CORTO.map(d => (
                <span key={d} className="text-center text-[10px] font-semibold text-muted uppercase">{d.charAt(0)}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5">
              {getMonthGrid(pickerMonth.getFullYear(), pickerMonth.getMonth()).map(cell => {
                const inMonth = cell.getMonth() === pickerMonth.getMonth()
                const sel = isSameDay(cell, currentDate)
                return (
                  <button
                    key={toDateStr(cell)}
                    type="button"
                    onClick={() => { setCurrentDate(cell); cerrar() }}
                    className={`h-7 w-7 mx-auto rounded-full text-xs flex items-center justify-center transition-colors ${
                      sel ? 'bg-accent text-white font-bold'
                        : isToday(cell) ? 'ring-1 ring-accent text-accent font-semibold hover:bg-[var(--accent-tint)]'
                        : inMonth ? 'text-on-surface hover:bg-[var(--accent-tint)]' : 'text-muted opacity-40 hover:bg-[var(--accent-tint)]'
                    }`}
                  >
                    {cell.getDate()}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </Popover>
      <IconButton icon={ChevronRight} label="Siguiente" tooltip={false} onClick={next} />

    </div>
  )

  const hoyBtn = (
    <button
      ref={hoyBtnRef}
      type="button"
      onClick={goToday}
      className="text-sm font-semibold px-4 py-2 rounded-full bg-surface-card shadow-card text-on-surface hover:bg-[var(--accent-tint)] transition-colors min-h-control-sm"
    >
      Hoy
    </button>
  )

  const eventoBtn = (
    <Button icon={Plus} iconEffect="gira90"
      onClick={() => openNewEvent(null)}>
       Evento
    </Button>
  )

  const viewSwitcher = (
    // Control segmentado (Apple): cápsula gris con la opción elegida en blanco.
    <fieldset className="flex items-center gap-1 bg-surface-container rounded-full p-1">
      <legend className="sr-only">Vista del calendario</legend>
      {VIEWS.map(({ id, label, Icon }) => (
        <button
          type="button"
          key={id}
          onClick={() => changeView(id)}
          aria-pressed={view === id}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors min-h-control-sm ${view === id ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-tint)]'}`}
        >
          <Icon size={ICONO.xs} />{label}
        </button>
      ))}
    </fieldset>
  )

  const hourRangeBtn = (
    <Popover align="end" label="Horas del día en tu agenda" className="p-3 w-64 space-y-2"
      trigger={(props) => (
      <button
        type="button"
        {...props}
        aria-label="Horas visibles de tu día"
        className={movil
          ? 'size-control flex items-center justify-center rounded-full text-on-surface hover:bg-[var(--accent-tint)] transition-colors'
          : 'flex items-center gap-1.5 px-4 py-2 rounded-full bg-surface-card shadow-card text-sm text-muted hover:bg-[var(--accent-tint)] transition-colors'}
        data-tooltip="Horas visibles de tu día (Agenda y Semana)"
        data-tooltip-pos="bottom"
      >
        {/* % 24 — dayEnd puede ser 24 (medianoche, límite exclusivo del rango
            visible), que formatHora12 debe leer como "12:00 am", no "24:00". */}
        <Clock size={movil ? ICONO.md : ICONO.xs} />
        {!movil && <> {formatHora12(`${String(dayStart % 24).padStart(2, '0')}:00`)}–{formatHora12(`${String(dayEnd % 24).padStart(2, '0')}:00`)}</>}
      </button>
      )}>
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">Horas del día en tu agenda</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted w-12 flex-shrink-0">Desde</span>
              <MiniSelect
                value={dayStart}
                onChange={v => changeDayStart(v)}
                options={Array.from({ length: 23 }, (_, h) => h).map(h => ({
                  value: h, label: formatHora12(`${String(h).padStart(2, '0')}:00`),
                }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted w-12 flex-shrink-0">Hasta</span>
              <MiniSelect
                value={dayEnd}
                onChange={v => changeDayEnd(v)}
                options={Array.from({ length: 24 }, (_, h) => h + 1).filter(h => h > dayStart).map(h => ({
                  value: h, label: formatHora12(`${String(h % 24).padStart(2, '0')}:00`),
                }))}
              />
            </div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wide pt-1">Días de tu semana</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted w-12 flex-shrink-0">Días</span>
              <MiniSelect
                value={numDays}
                onChange={v => changeNumDays(v)}
                options={[
                  { value: 5, label: 'Lunes a Viernes' },
                  { value: 6, label: 'Lunes a Sábado' },
                  { value: 7, label: 'Lunes a Domingo' },
                ]}
              />
            </div>
    </Popover>
  )

  return (
    <>
      <div className={movil ? 'px-4 pt-2 pb-28' : `px-4 py-4 ${TEACHER_CONTAINER}`}>

        {movil ? (
          <>
            {/* Teléfono — patrón del Calendario de Apple: cápsula para SUBIR de
                nivel (Día → Mes → Año) a la izquierda, acciones a la derecha,
                y el título grande debajo. Hoy y el cambio de vista flotan abajo. */}
            <div className="flex items-center justify-between gap-2 mb-3">
              {view === 'anio' ? <span /> : (
                <button
                  type="button"
                  onClick={() => changeView(view === 'mes' ? 'anio' : 'mes')}
                  className="flex items-center gap-1 pl-2 pr-4 py-2 rounded-full bg-surface-card shadow-barra text-base font-semibold text-on-surface min-h-control-sm"
                >
                  <ChevronLeft size={ICONO.md} />
                  {view === 'mes' ? currentDate.getFullYear() : MESES[currentDate.getMonth()]}
                </button>
              )}
              <div className="flex items-center gap-1 px-1 py-1 rounded-full bg-surface-card shadow-barra">
                {hourRangeBtn}
                <IconButton icon={Plus} effect="gira90" label="Nuevo evento" tooltip={false} onClick={() => openNewEvent(null)} />
              </div>
            </div>
            {view === 'anio' && (
              <div className="flex items-center justify-between px-1 mb-1">
                <h1 className="text-4xl font-bold text-accent tabular-nums">{currentDate.getFullYear()}</h1>
                <span className="flex">
                  <IconButton icon={ChevronLeft} label="Año anterior" tooltip={false} onClick={prev} />
                  <IconButton icon={ChevronRight} label="Año siguiente" tooltip={false} onClick={next} />
                </span>
              </div>
            )}
            {view === 'mes' && (
              <div className="flex items-center justify-between px-1 mb-1">
                <h1 className="text-3xl font-bold text-on-surface">{MESES[currentDate.getMonth()]}</h1>
                <span className="flex">
                  <IconButton icon={ChevronLeft} label="Mes anterior" tooltip={false} onClick={prev} />
                  <IconButton icon={ChevronRight} label="Mes siguiente" tooltip={false} onClick={next} />
                </span>
              </div>
            )}
            {(view === 'agenda' || view === '3dias') && (
              <div className="mb-3">
                <TiraSemana fecha={currentDate} onElegir={setCurrentDate} />
              </div>
            )}

            {/* Flotantes, encima de la barra inferior: Hoy (izq.) y vistas (der.) */}
            <div className="fixed z-30 left-3 right-3 flex items-center justify-between pointer-events-none"
              style={{ bottom: 'calc(var(--barra-alto) + 1.25rem + env(safe-area-inset-bottom, 0px))' }}>
              <button ref={hoyBtnRef} type="button" onClick={goToday}
                className="pointer-events-auto px-5 py-2.5 rounded-full bg-surface-card shadow-barra text-base font-semibold text-on-surface min-h-control">
                Hoy
              </button>
              <fieldset className="pointer-events-auto flex items-center gap-1 p-1 rounded-full bg-surface-card shadow-barra">
                <legend className="sr-only">Vista del calendario</legend>
                {VIEWS.filter((v) => v.id !== 'semana').map(({ id, label, Icon }) => (
                  <button key={id} type="button" onClick={() => changeView(id)} aria-label={label} aria-pressed={view === id}
                    className={`size-[calc(var(--control)-0.5rem)] flex items-center justify-center rounded-full transition-colors ${view === id ? 'bg-accent text-white' : 'text-on-surface hover:bg-[var(--accent-tint)]'}`}>
                    <Icon size={ICONO.md} />
                  </button>
                ))}
              </fieldset>
            </div>
          </>
        ) : (
          <>
            {/* Laptop — título grande a la izquierda (toca para elegir fecha),
                acciones y vistas en cápsulas a la derecha. */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              {dateNav}
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                {hoyBtn}
                {eventoBtn}
                {hourRangeBtn}
                {viewSwitcher}
              </div>
            </div>

            {/* Segunda fila: asuetos + programación de bloques. Solo en la
                computadora: en el teléfono (web) el horario es de consulta. */}
            {!soloConsulta && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Button variant="secondary" icon={CalendarOff}
                onClick={() => setShowAsuetos(true)}
               
                data-tooltip="Marca días sin clases, eventos y/o actividades"
                data-tooltip-pos="bottom">
                 Días de asueto
                {asuetos.length > 0 && (
                  <span className="ml-0.5 text-xs px-1.5 rounded-full bg-amber-700 text-white">{asuetos.length}</span>
                )}
              </Button>
              <Button variant="secondary" icon={CalendarRange}
                onClick={() => setShowVacaciones(true)}
               
                data-tooltip="Marca un periodo sin clases, eventos y/o actividades"
                data-tooltip-pos="bottom">
                 Vacaciones
                {vacaciones.length > 0 && (
                  <span className="ml-0.5 text-xs px-1.5 rounded-full bg-amber-700 text-white">{vacaciones.length}</span>
                )}
              </Button>

              <div className="flex-1" />

              <Button variant="secondary" icon={CalendarClock}
                onClick={() => setShowModificarPicker(true)}
               
                data-tooltip={(totalBloquesFueraDeRango + totalBloquesEnAsueto) > 0
                  ? `${totalBloquesFueraDeRango + totalBloquesEnAsueto} bloque(s) necesitan revisión (rango o asueto/vacaciones)`
                  : 'Modificar bloques de clase por asignatura'}
                data-tooltip-pos="bottom">
                 Modificar bloques
                {(totalBloquesFueraDeRango + totalBloquesEnAsueto) > 0 && (
                  <span className="ml-0.5 flex items-center gap-0.5 text-xs px-1.5 rounded-full bg-amber-700 text-white">
                    <AlertTriangle size={ICONO.xs} /> {totalBloquesFueraDeRango + totalBloquesEnAsueto}
                  </span>
                )}
              </Button>
              <Button icon={CalendarPlus}
                onClick={() => openProgramar()}
               
                data-tooltip="Programar bloques de clase por asignatura"
                data-tooltip-pos="bottom">
                 Programar bloques
              </Button>
            </div>
            )}
          </>
        )}

{/* Calendar body — en web, Día y 3 días se ven mal a lo ancho de las
            demás vistas (columnas gigantes); se acotan y centran. Semana y
            Mes se quedan a ancho completo, como ya estaban. Solo web: en la
            app esta franja ya es angosta por el propio viewport. En el
            teléfono (web) tampoco se acotan: ocupan todo el ancho.
            Además, en el teléfono (web) Día y 3 días devuelven el
            desplazamiento con el dedo a lo que no se arrastra (bloques de
            solo consulta, actividades): las vistas les ponen
            `touch-action: none` fuera de la app, y con eso la página no se
            movía si el dedo empezaba encima de un bloque. Lo que sí se
            arrastra (eventos personales, `cursor-grab`) se queda igual.
            3 días, también en el teléfono (web), anula el mínimo de 620px de
            WeekView (`md:min-w-[620px]`, pensado para arrastrar con mouse):
            un teléfono girado pasa de 768px y, con la barra lateral, deja
            menos de 620px — la vista se salía de lado en vez de caber. */}
        {/* key={view}: al cambiar de vista el calendario entra con «aparece»
            (sube 8px y aparece, 250ms) — continuidad entre Año, Mes y Día. */}
        <div key={view} className={IS_NATIVE_APP
          ? 'bg-surface-card rounded-card shadow-card overflow-x-hidden animate-aparece motion-reduce:animate-none'
          : `bg-surface-card rounded-card shadow-card overflow-hidden animate-aparece motion-reduce:animate-none ${soloConsulta
            ? (view === 'agenda' ? '[&_[style*=touch-action]:not(.cursor-grab)]:!touch-auto'
              : view === '3dias' ? '[&_[style*=touch-action]:not(.cursor-grab)]:!touch-auto [&>div>div]:!min-w-0' : '')
            : ''}`
        }>
          {loading ? (
            <SkeletonList rows={6} className="py-6" />
          ) : view === 'agenda' ? (
            <AgendaView
              date={currentDate}
              events={events}
              bloques={bloques}
              subjects={subjects}
              dayStart={dayStart}
              dayEnd={dayEnd}
              onEventClick={openEditEvent}
              // Teléfono (web): bloques solo de consulta (mismo camino que la
              // Agenda del alumno). Los eventos personales siguen editables.
              onBlockClick={soloConsulta ? undefined : openBloqueAcciones}
              onMoveBloque={soloConsulta ? undefined : requestMoveBloque}
              editableBloques={!soloConsulta}
              onMoveEvent={moveEvent}
              onSlotClick={IS_NATIVE_APP ? undefined : openNewEventAt}
              asuetoMap={asuetoMap}
              vacacionMap={vacacionMap}
            />
          ) : view === 'anio' ? (
            <VistaAnio
              anio={currentDate.getFullYear()}
              onElegirMes={(d) => { setCurrentDate(d); changeView('mes') }}
            />
          ) : view === 'mes' ? (
            <MonthView
              year={currentDate.getFullYear()}
              month={currentDate.getMonth()}
              events={events}
              bloques={bloques}
              subjects={subjects}
              selectedDate={currentDate}
              // Teléfono (Apple): tocar un día abre ese día. Laptop: nuevo evento.
              onDateClick={movil ? (d) => { setCurrentDate(d); changeView('agenda') } : openNewEvent}
              // En la App, Mes es solo informativo: presionar un bloque o
              // evento no hace nada — evita saturar una vista ya de por sí
              // apretada en pantallas chicas. La web sigue igual. El long
              // press del arrastre táctil NO cambia esta decisión.
              onEventClick={IS_NATIVE_APP ? undefined : openEditEvent}
              onBlockClick={IS_NATIVE_APP ? undefined : openBloqueSoloBorrar}
              onMoveEvent={IS_NATIVE_APP ? undefined : moveEvent}
              onMoveBloque={IS_NATIVE_APP ? undefined : requestMoveBloque}
              asuetoMap={asuetoMap}
              vacacionMap={vacacionMap}
              editable={false}
            />
          ) : view === '3dias' ? (
            <WeekView
              weekStart={currentDate}
              anchorToday
              numDays={3}
              events={events}
              bloques={bloques}
              subjects={subjects}
              dayStart={dayStart}
              dayEnd={dayEnd}
              selectedDate={currentDate}
              onSlotClick={IS_NATIVE_APP ? undefined : openNewEventAt}
              onEventClick={openEditEvent}
              // Teléfono (web): bloques solo de consulta, como en Día.
              onBlockClick={soloConsulta ? undefined : openBloqueAcciones}
              onMoveBloque={soloConsulta ? undefined : requestMoveBloque}
              editable={!soloConsulta}
              onMoveEvent={moveEvent}
              asuetoMap={asuetoMap}
              vacacionMap={vacacionMap}
            />
          ) : (
            <WeekView
              weekStart={startOfWeekMon(currentDate)}
              events={events}
              bloques={bloques}
              subjects={subjects}
              dayStart={dayStart}
              dayEnd={dayEnd}
              numDays={numDays}
              selectedDate={currentDate}
              onSlotClick={IS_NATIVE_APP ? undefined : openNewEventAt}
              // En la App, Semana es solo informativa: presionar un bloque o
              // evento no hace nada — evita saturar la vista. La web sigue
              // igual, y 3 días (arriba) tampoco cambia. El long press del
              // arrastre táctil NO cambia esta decisión.
              onEventClick={IS_NATIVE_APP ? undefined : openEditEvent}
              onBlockClick={IS_NATIVE_APP ? undefined : openBloqueAcciones}
              onMoveBloque={IS_NATIVE_APP ? undefined : requestMoveBloque}
              onMoveEvent={IS_NATIVE_APP ? undefined : moveEvent}
              asuetoMap={asuetoMap}
              vacacionMap={vacacionMap}
              editable={false}
            />
          )}
        </div>

        {/* Legend — solo laptop (en el teléfono no hace falta). */}
        {!movil && (
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted px-1">
          <span className="flex items-center gap-1"><CalendarPlus size={ICONO.xs} /> Bloques de clase (Semana/Mes)</span>
          <span className="flex items-center gap-1"><Send size={ICONO.xs} /> Publicación</span>
          <span className="flex items-center gap-1"><CalendarDays size={ICONO.xs} /> Evento personal</span>
          <span className="flex items-center gap-1"><Lock size={ICONO.xs} /> Fecha límite — ya no recibe tarde</span>
          <span className="flex items-center gap-1"><LockOpen size={ICONO.xs} /> Sigue recibiendo tarde</span>
        </div>
        )}
      </div>

      {/* Modals */}
      {showEventEditor && (
        <EventEditor
          event={editingEvent}
          defaultDate={selectedDate}
          subjects={Object.values(subjects).filter(s => !s.archived)}
          onClose={closeEventEditor}
          onSaved={closeEventEditor}
          onDeleted={closeEventEditor}
        />
      )}
      {programar && (
        <ProgramarBloquesModal
          subjects={subjects}
          subjectsDisponibles={subjectsSinProgramar}
          mode={programar.mode}
          initial={programar.initial}
          subjectName={programar.subjectName}
          onClose={() => setProgramar(null)}
          onContinue={continuarAZona}
          onDeleteAll={borrarProgramacion}
          onIrAsignatura={(id) => {
            if (!id) return
            setProgramar(null)
            // `openEditSubject` abre allá el modal de "Editar asignatura" — que
            // es donde viven las fechas y, con ellas, los parciales.
            navigate(`/subject/${id}`, { state: { openEditSubject: true } })
          }}
        />
      )}

      {zona && (
        <ProgramarZonaSemanal
          config={zona.config}
          mode={zona.mode}
          initialPatrones={zona.initialPatrones}
          configChanged={zona.configChanged}
          subjects={subjects}
          otrosBloques={bloques.filter(b => b.asignaturaId !== zona.asignaturaId)}
          dayStart={dayStart}
          dayEnd={dayEnd}
          numDays={numDays}
          onCancel={() => setZona(null)}
          onConfirm={guardarDesdeZona}
        />
      )}

      {/* Selector de asignatura para "Modificar bloques" */}
      {showModificarPicker && (
        <Modal open onClose={() => setShowModificarPicker(false)} ariaLabel="Modificar bloques por asignatura" variant="sheet" size="sm" z={50} padding="p-4" className={`space-y-3 ${IS_NATIVE_APP ? '' : 'pb-6'}`}>
          {/* pb mayor en la web: la lista terminaba pegada al borde inferior de
              la tarjeta. `pb-*` se emite después de `p-*`, así que gana sin
              depender del orden en que se escriban las clases. */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarClock size={ICONO.md} className="text-accent" />
                <h2 className="font-semibold text-on-surface">Modificar bloques por asignatura</h2>
              </div>
              <button type="button" onClick={() => setShowModificarPicker(false)} aria-label="Cerrar" className="size-control inline-flex items-center justify-center text-muted hover:text-error rounded-full"><Plus size={ICONO.md} className="rotate-45" /></button>
            </div>
            {subjectsConBloques.length === 0 ? (
              <p className="text-sm text-muted py-4 text-center">
                Todavía no has programado bloques de ninguna asignatura. Usa <strong>Programar bloques</strong> para empezar.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
                <p className="text-sm text-muted">Elige la asignatura cuyos bloques quieres reacomodar:</p>
                {subjectsConBloques.map(s => {
                  const delSubj = bloques.filter(b => b.asignaturaId === s.id)
                  const n = delSubj.length
                  // El color de sus bloques, no el de la paleta de la
                  // asignatura: así cada renglón se reconoce contra la rejilla,
                  // donde el docente ya vio esa clase de ese color.
                  const pal = bloqueColor(delSubj[0]?.color)
                  const fuera = bloquesFueraDeRango(s.id)
                  const enAsueto = bloquesEnAsueto(s.id)
                  const faltan = tramosFaltantes(s.id)
                  const faltanClases = faltan.reduce((acc, t) => acc + t.clases, 0)
                  return (
                    <div className="rounded-card border overflow-hidden" key={s.id} style={{ borderColor: pal.text + '55' }}>
                      {/* El renglón entero va del color de la asignatura, sin
                          muestra aparte. El hover se hace con brillo y no con
                          una clase de fondo: el color va en `style` y una
                          utilidad de Tailwind no le ganaría. */}
                      <button
                        type="button"
                        onClick={() => openModificar(s.id)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:brightness-95 transition-[filter]"
                        style={{ background: pal.bg, color: pal.text }}
                      >
                        {/* Los íconos del banco se pintan con currentColor, así
                            que toman el tono de la asignatura sin más. */}
                        <SubjectIcon iconKey={s.icon} size={ICONO.md} className="flex-shrink-0" />
                        <span className="text-sm font-medium truncate flex-1">{subjectDisplayName(s)}</span>
                        <span className="text-xs opacity-75 flex-shrink-0">{n} bloque(s)</span>
                      </button>
                      {fuera.length > 0 && (
                        confirmLimpiarRango === s.id ? (
                          <div className="flex items-center gap-2 px-3 py-2 bg-error/10 border-t border-error/30">
                            <span className="text-xs text-error flex-1">¿Quitar los {fuera.length} bloque(s) fuera de rango?</span>
                            <button type="button" onClick={() => setConfirmLimpiarRango(null)} className="text-xs text-muted px-2 py-1">Cancelar</button>
                            <button type="button" onClick={() => limpiarBloquesFueraDeRango(s.id)} className="text-xs bg-error text-white rounded px-2.5 py-1 font-medium">Quitar</button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmLimpiarRango(s.id)}
                            className="w-full flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-t border-amber-200 text-xs text-amber-800 hover:bg-amber-100 transition-colors text-left"
                          >
                            <AlertTriangle size={ICONO.xs} className="flex-shrink-0" />
                            {fuera.length} bloque(s) quedaron fuera del rango actual — tócalo para quitarlos
                          </button>
                        )
                      )}
                      {faltan.length > 0 && (
                        confirmGenerarFaltantes === s.id ? (
                          <div className="flex items-center gap-2 px-3 py-2 bg-[var(--accent-tint)] border-t border-accent-soft">
                            <span className="text-sm text-accent flex-1">
                              ¿Generar las clases que faltan {faltan.map(t => t.desde === t.hasta
                                ? `el ${formatLongDate(t.desde)}`
                                : `del ${formatLongDate(t.desde)} al ${formatLongDate(t.hasta)}`).join(' y ')}?
                            </span>
                            <button type="button" onClick={() => setConfirmGenerarFaltantes(null)} className="text-xs text-muted px-2 py-1">Cancelar</button>
                            <Button onClick={() => generarBloquesFaltantes(s.id)}>Generar</Button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmGenerarFaltantes(s.id)}
                            className="w-full flex items-center gap-1.5 px-3 py-1.5 bg-[var(--accent-tint)] border-t border-accent-soft text-xs text-accent hover:brightness-95 transition-[filter] text-left"
                          >
                            <CalendarClock size={ICONO.xs} className="flex-shrink-0" />
                            {/* El conteo son clases REALES de esta asignatura
                                (sus días de horario, sin asuetos), no días
                                hábiles sueltos del calendario. */}
                            {faltanClases === 1
                              ? `Falta 1 clase el ${formatLongDate(faltan[0].desde)}`
                              : `Faltan ${faltanClases} clases desde el ${formatLongDate(faltan[0].desde)}`} — tócalo para generarlas
                          </button>
                        )
                      )}
                      {enAsueto.length > 0 && (
                        confirmLimpiarAsueto === s.id ? (
                          <div className="flex items-center gap-2 px-3 py-2 bg-error/10 border-t border-error/30">
                            <span className="text-sm text-error flex-1">¿Quitar los {enAsueto.length} bloque(s) en día de asueto/vacaciones?</span>
                            <button type="button" onClick={() => setConfirmLimpiarAsueto(null)} className="text-xs text-muted px-2 py-1">Cancelar</button>
                            <button type="button" onClick={() => limpiarBloquesEnAsueto(s.id)} className="text-xs bg-error text-white rounded px-2.5 py-1 font-medium">Quitar</button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmLimpiarAsueto(s.id)}
                            className="w-full flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-t border-amber-200 text-xs text-amber-800 hover:bg-amber-100 transition-colors text-left"
                          >
                            <AlertTriangle size={ICONO.xs} className="flex-shrink-0" />
                            {enAsueto.length} bloque(s) caen en día de asueto o vacaciones — tócalo para quitarlos
                          </button>
                        )
                      )}
                    </div>
                  )
                })}
              </div>
            )}
        </Modal>
      )}
      {showAsuetos && (
        <AsuetoManager
          asuetos={asuetos}
          onAdd={addAsueto}
          onRemove={removeAsueto}
          onClose={() => setShowAsuetos(false)}
        />
      )}
      {showVacaciones && (
        <VacacionManager
          vacaciones={vacaciones}
          onAdd={addVacacion}
          onRemove={removeVacacion}
          onClose={() => setShowVacaciones(false)}
        />
      )}

      {/* Acciones de UNA sola clase: mover el mismo día a otra hora, o borrarla
          (clase suspendida). Nunca afecta a las clases siguientes ni cambia de
          día — para eso está "Modificar bloques". */}
      {pendingMove && (() => {
        const { bloque: b, hora, confirmDel, soloBorrar } = pendingMove
        const subj = subjects[b.asignaturaId]
        const cancelada = !!b.cancelada
        const durMin = Math.max(5, timeToMinutes(b.horaFin) - timeToMinutes(b.horaInicio))
        const fmtF = s => {
          const d = new Date(s + 'T12:00:00')
          return `${DIAS_LARGO[(d.getDay() + 6) % 7]} ${d.getDate()} de ${MESES[d.getMonth()]}`
        }
        const stepHora = (delta) => setPendingMove(pm => ({ ...pm, hora: addMinutesToTime(pm.hora, delta) }))
        const inputCls = 'px-2.5 py-1.5 rounded-full border border-outline-variant text-sm bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'
        const cambioHora = hora !== b.horaInicio
        // No permitir encimar con otra clase del MISMO día.
        const iniMin = timeToMinutes(hora)
        const finMin = iniMin + durMin
        const seEncima = bloques.some(x => x.id !== b.id && x.fecha === b.fecha
          && timeToMinutes(x.horaInicio) < finMin && iniMin < timeToMinutes(x.horaFin))
        return (
          <Modal open onClose={() => setPendingMove(null)} ariaLabel={cancelada ? 'Clase cancelada' : soloBorrar ? 'Borrar esta clase' : 'Mover, cancelar o borrar esta clase'} variant="centered" size="sm" z={50} padding="p-4" className="space-y-3">
              <h2 className="font-semibold text-on-surface">{cancelada ? 'Clase cancelada' : soloBorrar ? 'Borrar esta clase' : 'Mover, cancelar o borrar esta clase'}</h2>
              <div className="text-sm text-on-surface space-y-0.5 bg-surface rounded-card border border-outline-variant p-3">
                <p className="font-medium">{subjectDisplayName(subj) || 'Clase'}</p>
                <p className="text-muted text-xs">{fmtF(b.fecha)} · empieza a las {fmtHour(b.horaInicio)}</p>
              </div>

              {cancelada && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-card bg-amber-50 border border-amber-200">
                  <span className="text-xs text-amber-800 flex-1">Esta clase está cancelada — no genera asistencia ni cuenta como sesión disponible.</span>
                </div>
              )}

              {/* Mover el MISMO día a otra hora — no disponible en la vista Mes ni en una clase cancelada */}
              {!soloBorrar && !cancelada && (<>
              <div className="space-y-1">
                <span className="text-xs font-semibold text-muted uppercase tracking-wide">Cambiar la hora (el mismo día)</span>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => stepHora(-5)}
                    className="px-2 py-1.5 rounded-full border border-outline-variant text-accent hover:bg-[var(--accent-tint)] transition-colors" aria-label="−5 minutos">
                    <Minus size={ICONO.xs} />
                  </button>
                  <input
                    type="time" value={hora} step={60}
                    onChange={e => e.target.value && setPendingMove(pm => ({ ...pm, hora: e.target.value }))}
                    className={`${inputCls} flex-1 text-base font-semibold tabular-nums`}
                  />
                  <button type="button" onClick={() => stepHora(5)}
                    className="px-2 py-1.5 rounded-full border border-outline-variant text-accent hover:bg-[var(--accent-tint)] transition-colors" aria-label="+5 minutos">
                    <Plus size={ICONO.xs} />
                  </button>
                </div>
                <p className="text-xs text-muted">Termina a las <strong className="text-on-surface">{formatHora12(addMinutesToTime(hora, durMin))}</strong></p>
                {seEncima && (
                  <p className="text-sm text-error flex items-center gap-1">
                    <AlertTriangle size={ICONO.xs} className="flex-shrink-0" /> A esa hora se encima con otra clase. Elige otra hora.
                  </p>
                )}
              </div>

              <Button fullWidth
                onClick={() => confirmPendingMove()}
                disabled={!cambioHora || seEncima}>
                {seEncima ? 'Se encima con otra clase' : cambioHora ? `Mover a las ${fmtHour(hora)}` : 'Ajusta la hora para mover'}
              </Button>
              </>)}

              {soloBorrar && !cancelada && (
                <p className="text-sm text-muted">En la vista Mes las clases no se cambian de hora ni de día. Para eso, usa <strong className="text-on-surface">Modificar bloques</strong>.</p>
              )}

              {cancelada ? (
                /* Ya cancelada: la única acción disponible es reactivarla. */
                <button
                  type="button"
                  onClick={() => reactivarBloqueUnico(b)}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-full border border-accent-soft text-accent text-sm hover:bg-[var(--accent-tint)] transition-colors min-h-control"
                >
                  Reactivar esta clase
                </button>
              ) : (<>
                {/* CANCELAR: la clase sí estaba programada pero no se va a
                    impartir — se conserva el registro (no es un deleteDoc). */}
                <button
                  type="button"
                  onClick={() => cancelarBloqueUnico(b)}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-full border border-amber-300 text-amber-700 text-sm hover:bg-amber-50 transition-colors min-h-control"
                >
                  <Ban size={ICONO.xs} /> Cancelar esta clase (no se impartirá)
                </button>

                {/* ELIMINAR: el bloque se creó por error, no debió existir. */}
                {confirmDel ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-card bg-error/10 border border-error/30">
                    <span className="text-sm text-error flex-1">¿Borrar solo esta clase? Las demás clases no se tocan.</span>
                    <button type="button" onClick={() => setPendingMove(pm => ({ ...pm, confirmDel: false }))} className="text-xs text-muted px-2 py-1">No</button>
                    <button type="button" onClick={() => borrarBloqueUnico(b)} className="text-xs bg-error text-white rounded px-2.5 py-1 font-medium">Sí, borrar</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingMove(pm => ({ ...pm, confirmDel: true }))}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-full border border-error/30 text-error text-sm hover:bg-error/10 transition-colors min-h-control"
                  >
                    <Trash2 size={ICONO.xs} /> Eliminar esta clase (se creó por error)
                  </button>
                )}
              </>)}

              <p className="text-xs text-muted">
                {cancelada
                  ? <>Cancelar conserva el registro de la clase; eliminar la borra por completo. Reactivar la vuelve a dejar disponible.</>
                  : <>Esto solo afecta a <strong className="text-on-surface">esta clase</strong>. Para mover también las clases siguientes, o reacomodar todo el horario, entra a <strong className="text-on-surface">Modificar bloques</strong>.</>}
              </p>

              <Button variant="secondary" fullWidth
                onClick={() => setPendingMove(null)}>
                Cancelar
              </Button>
          </Modal>
        )
      })()}
    </>
  )
}


